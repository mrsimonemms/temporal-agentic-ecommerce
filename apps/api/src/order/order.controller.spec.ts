import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ErrorResponseSchema, OrderSchema } from '@ucp-js/sdk';

import { TestApp, closeTestApp, createTestApp } from '../../test/app';
import { FakeTemporalService } from '../../test/fakes';
import { completeCheckoutExample } from '../checkout/checkout.examples';

function expectOrder(body: unknown) {
  const result = OrderSchema.safeParse(body);
  expect(result.error?.issues ?? []).toEqual([]);
  return result.data!;
}

function expectNotFound(body: unknown, id: string) {
  const result = ErrorResponseSchema.safeParse(body);
  expect(result.error?.issues ?? []).toEqual([]);
  expect(result.data!.ucp.status).toBe('error');
  expect(result.data!.messages).toEqual([
    {
      type: 'error',
      code: 'not_found',
      content: `Order "${id}" was not found`,
      severity: 'unrecoverable',
    },
  ]);
}

describe('OrderController and DemoController', () => {
  let app: NestFastifyApplication;
  let temporal: FakeTemporalService;

  let testApp: TestApp;

  beforeEach(async () => {
    testApp = await createTestApp();
    ({ app, temporal } = testApp);
  });

  afterEach(() => closeTestApp(testApp));

  // Places an Order through the UCP checkout and returns the checkout's order reference
  async function placeOrder() {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/checkout-sessions',
      payload: {
        buyer: { email: 'jane@example.com', first_name: 'Jane', last_name: 'Doe' },
        line_items: [
          { item: { id: 'sku_kettle' }, quantity: 2 },
          { item: { id: 'sku_mug_set' }, quantity: 1 },
        ],
      },
    });
    const checkoutId: string = created.json().id;

    const completed = await app.inject({
      method: 'POST',
      url: `/v1/checkout-sessions/${checkoutId}/complete`,
      payload: completeCheckoutExample,
    });
    expect(completed.json().status).toBe('completed');

    return { checkoutId, ...(completed.json().order as { id: string; permalink_url: string }) };
  }

  function getOrder(id: string) {
    return app.inject({ method: 'GET', url: `/v1/orders/${id}` });
  }

  function fulfilOrder(id: string) {
    return app.inject({ method: 'POST', url: `/v1/demo/orders/${id}/fulfil` });
  }

  describe('GET /v1/orders/:id', () => {
    it('returns the Order placed by checkout as a valid UCP Order', async () => {
      const { checkoutId, id, permalink_url } = await placeOrder();

      const res = await getOrder(id);

      expect(res.statusCode).toBe(200);
      expect(expectOrder(res.json())).toEqual({
        ucp: {
          version: '2026-08-25',
          capabilities: { 'dev.ucp.shopping.order': [{ version: '2026-08-25' }] },
        },
        id,
        checkout_id: checkoutId,
        permalink_url,
        currency: 'GBP',
        line_items: [
          {
            id: 'li_1',
            item: { id: 'sku_kettle', title: 'Stainless Steel Kettle', price: 3499 },
            quantity: { original: 2, total: 2, fulfilled: 0 },
            status: 'processing',
            totals: [
              { type: 'subtotal', amount: 6998 },
              { type: 'total', amount: 6998 },
            ],
          },
          {
            id: 'li_2',
            item: { id: 'sku_mug_set', title: 'Stoneware Mug Set (4 pack)', price: 2400 },
            quantity: { original: 1, total: 1, fulfilled: 0 },
            status: 'processing',
            totals: [
              { type: 'subtotal', amount: 2400 },
              { type: 'total', amount: 2400 },
            ],
          },
        ],
        fulfillment: { expectations: [], events: [] },
        totals: [
          { type: 'subtotal', amount: 9398 },
          { type: 'total', amount: 9398 },
        ],
      });
      expect(temporal.getOrder).toHaveBeenCalledExactlyOnceWith(id);
    });

    it('returns not_found for an Order with no Workflow', async () => {
      const res = await getOrder('ord_missing');

      expect(res.statusCode).toBe(200);
      expectNotFound(res.json(), 'ord_missing');
    });

    it('returns not_found without querying Temporal for IDs not issued for a checkout', async () => {
      const res = await getOrder('chk_123');

      expect(res.statusCode).toBe(200);
      expectNotFound(res.json(), 'chk_123');
      expect(temporal.getOrder).not.toHaveBeenCalled();
    });

    it('fails with HTTP 500 when Temporal is unavailable', async () => {
      temporal.getOrder.mockRejectedValueOnce(new Error('Temporal unavailable'));

      const res = await getOrder('ord_123');

      expect(res.statusCode).toBe(500);
    });
  });

  describe('POST /v1/demo/orders/:id/fulfil', () => {
    it('signals the Workflow and returns the fulfilled Order', async () => {
      const { id } = await placeOrder();

      const res = await fulfilOrder(id);

      expect(res.statusCode).toBe(200);
      expect(temporal.markOrderFulfilled).toHaveBeenCalledExactlyOnceWith(id);
      const order = expectOrder(res.json());
      expect(order.line_items.map((lineItem) => [lineItem.status, lineItem.quantity])).toEqual([
        ['fulfilled', { original: 2, total: 2, fulfilled: 2 }],
        ['fulfilled', { original: 1, total: 1, fulfilled: 1 }],
      ]);
    });

    it('is reflected by subsequent Order retrieval', async () => {
      const { id } = await placeOrder();
      await fulfilOrder(id);

      const order = expectOrder((await getOrder(id)).json());

      expect(order.line_items.every((lineItem) => lineItem.status === 'fulfilled')).toBe(true);
      expect(order.totals).toEqual([
        { type: 'subtotal', amount: 9398 },
        { type: 'total', amount: 9398 },
      ]);
    });

    it('has no further effect when repeated', async () => {
      const { id } = await placeOrder();
      const first = (await fulfilOrder(id)).json();

      const res = await fulfilOrder(id);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(first);
    });

    it('returns not_found for an Order with no Workflow', async () => {
      const res = await fulfilOrder('ord_missing');

      expect(res.statusCode).toBe(200);
      expectNotFound(res.json(), 'ord_missing');
    });

    it('does not signal Temporal for IDs not issued for a checkout', async () => {
      const res = await fulfilOrder('chk_123');

      expectNotFound(res.json(), 'chk_123');
      expect(temporal.markOrderFulfilled).not.toHaveBeenCalled();
    });

    it('fails with HTTP 500 when Temporal is unavailable', async () => {
      temporal.markOrderFulfilled.mockRejectedValueOnce(new Error('Temporal unavailable'));

      const res = await fulfilOrder('ord_123');

      expect(res.statusCode).toBe(500);
    });
  });

  describe('GET /orders/:id (permalink)', () => {
    it('is the unversioned buyer-facing page, distinct from the UCP API endpoint', async () => {
      const { id, permalink_url } = await placeOrder();

      expect(permalink_url).toBe(`http://localhost:9999/orders/${id}`);
      expect(new URL(permalink_url).pathname).not.toBe(`/v1/orders/${id}`);
      expect(expectOrder((await getOrder(id)).json()).permalink_url).toBe(permalink_url);
    });

    it('renders the Order as HTML', async () => {
      const { id, permalink_url } = await placeOrder();

      const res = await app.inject({ method: 'GET', url: new URL(permalink_url).pathname });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.body).toContain(`<h1>Order ${id}</h1>`);
      expect(res.body).toContain('Status: <strong>Processing</strong>');
      expect(res.body).toContain('<td>Stainless Steel Kettle</td>');
      expect(res.body).toContain('£93.98');
    });

    it('reflects fulfilment', async () => {
      const { id, permalink_url } = await placeOrder();
      await fulfilOrder(id);

      const res = await app.inject({ method: 'GET', url: new URL(permalink_url).pathname });

      expect(res.body).toContain('Status: <strong>Fulfilled</strong>');
    });

    it('returns an HTML 404 for an unknown Order', async () => {
      const res = await app.inject({ method: 'GET', url: '/orders/ord_missing' });

      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.body).toContain('Order not found');
    });

    it('escapes the requested ID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/orders/${encodeURIComponent('<script>alert(1)</script>')}`,
      });

      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain('<script>');
      expect(res.body).toContain('&lt;script&gt;');
    });
  });
});
