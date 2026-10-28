import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { CheckoutResponseSchema, OrderSchema } from '@ucp-js/sdk';

import { TestApp, closeTestApp, createTestApp } from '../../test/app';
import { FakeCheckoutModel, FakeTemporalService } from '../../test/fakes';
import { completeCheckoutExample } from '../checkout/checkout.examples';
import { orderIdForCheckout } from '../order/order.mapper';

describe('DemoController inventory failures', () => {
  let app: NestFastifyApplication;
  let model: FakeCheckoutModel;
  let temporal: FakeTemporalService;
  let testApp: TestApp;

  beforeEach(async () => {
    testApp = await createTestApp();
    ({ app, model, temporal } = testApp);
  });

  afterEach(() => closeTestApp(testApp));

  async function createCheckout({ withBuyer = true } = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/checkout-sessions',
      payload: {
        buyer: withBuyer ? { email: 'jane@example.com' } : undefined,
        line_items: [{ item: { id: 'sku_kettle' }, quantity: 1 }],
      },
    });
    return res.json().id as string;
  }

  function configure(checkoutId: string, payload: unknown) {
    return app.inject({
      method: 'PUT',
      url: `/v1/demo/checkout-sessions/${checkoutId}/inventory-failures`,
      payload: payload as object,
    });
  }

  function complete(checkoutId: string) {
    return app.inject({
      method: 'POST',
      url: `/v1/checkout-sessions/${checkoutId}/complete`,
      payload: completeCheckoutExample,
    });
  }

  // The OrderInput sent to Temporal when the checkout was completed
  function orderInputFor(checkoutId: string) {
    const call = temporal.startOrderWorkflow.mock.calls.find(
      ([input]) => input.id === orderIdForCheckout(checkoutId),
    );
    expect(call).toBeDefined();
    return call![0];
  }

  it('places Orders without simulated failures by default', async () => {
    const id = await createCheckout();

    expect((await complete(id)).json().status).toBe('completed');

    expect(orderInputFor(id).demo).toBeUndefined();
    expect(model.docs.get(id)?.demo).toBeUndefined();
  });

  it('configures two failures for a checkout and passes them to the Order Workflow', async () => {
    const id = await createCheckout();

    const res = await configure(id, { failures: 2 });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ checkoutId: id, failures: 2 });
    expect(model.docs.get(id)?.demo).toEqual({ inventoryFailures: 2 });

    expect((await complete(id)).json().status).toBe('completed');
    expect(orderInputFor(id).demo).toEqual({ inventoryFailures: 2 });
  });

  it('resets the configuration with zero failures', async () => {
    const id = await createCheckout();
    await configure(id, { failures: 2 });

    const res = await configure(id, { failures: 0 });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ checkoutId: id, failures: 0 });
    await complete(id);
    expect(orderInputFor(id).demo).toBeUndefined();
  });

  it('applies the configuration only to the configured checkout', async () => {
    const configured = await createCheckout();
    const other = await createCheckout();
    await configure(configured, { failures: 2 });

    await complete(other);
    await complete(configured);

    expect(orderInputFor(configured).demo).toEqual({ inventoryFailures: 2 });
    expect(orderInputFor(other).demo).toBeUndefined();
    expect(model.docs.get(other)?.demo).toBeUndefined();
  });

  it('can be configured before the buyer details are complete', async () => {
    const id = await createCheckout({ withBuyer: false });

    const res = await configure(id, { failures: 1 });

    expect(res.statusCode).toBe(200);
    expect(model.docs.get(id)?.status).toBe('incomplete');
  });

  it.each([
    ['negative', { failures: -1 }],
    ['fractional', { failures: 1.5 }],
    ['a string', { failures: '2' }],
    ['null', { failures: null }],
    ['missing', {}],
    ['above the Go int32 range', { failures: 2_147_483_648 }],
  ])('rejects a failure count that is %s', async (_, payload) => {
    const id = await createCheckout();

    const res = await configure(id, payload);

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ statusCode: 400, error: 'Bad Request' });
    expect(model.docs.get(id)?.demo).toBeUndefined();
  });

  it('rejects changes once the checkout is completed', async () => {
    const id = await createCheckout();
    await complete(id);

    const res = await configure(id, { failures: 2 });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      statusCode: 409,
      error: 'Conflict',
      message: 'Inventory failures cannot be configured while the checkout status is "completed"',
    });
    expect(model.docs.get(id)?.demo).toBeUndefined();
  });

  it('rejects changes while completion is in progress', async () => {
    const id = await createCheckout();
    await configure(id, { failures: 2 });
    // The Order Workflow could not be started, leaving completion in progress
    temporal.startOrderWorkflow.mockRejectedValueOnce(new Error('Temporal unavailable'));
    expect((await complete(id)).json().status).toBe('complete_in_progress');

    const res = await configure(id, { failures: 0 });

    expect(res.statusCode).toBe(409);
    expect(model.docs.get(id)?.demo).toEqual({ inventoryFailures: 2 });
  });

  it('returns 404 for an unknown checkout', async () => {
    const res = await configure('chk_missing', { failures: 2 });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'Checkout "chk_missing" was not found',
    });
  });

  it('does not expose the configuration through the UCP checkout', async () => {
    const id = await createCheckout();
    await configure(id, { failures: 2 });

    const res = await app.inject({ method: 'GET', url: `/v1/checkout-sessions/${id}` });

    const checkout = res.json();
    expect(CheckoutResponseSchema.safeParse(checkout).success).toBe(true);
    expect(JSON.stringify(checkout)).not.toMatch(/demo|failures/i);
  });
});

describe('DemoController fulfilment exceptions', () => {
  let app: NestFastifyApplication;
  let temporal: FakeTemporalService;
  let testApp: TestApp;

  const exception = {
    lineId: 'li_2',
    reason: 'Supplier reports the item is unavailable at the selected warehouse',
  };
  const resolution = {
    lineId: 'li_2',
    alternativeSource: 'warehouse-north',
    approvedBy: 'ops@example.com',
    note: 'Same item, ships a day later',
  };

  beforeEach(async () => {
    testApp = await createTestApp();
    ({ app, temporal } = testApp);
  });

  afterEach(() => closeTestApp(testApp));

  // Places an Order with two lines through UCP checkout and returns its ID
  async function placeOrder() {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/checkout-sessions',
      payload: {
        buyer: { email: 'jane@example.com' },
        line_items: [
          { item: { id: 'sku_kettle' }, quantity: 1 },
          { item: { id: 'sku_mug_set' }, quantity: 2 },
        ],
      },
    });
    const completed = await app.inject({
      method: 'POST',
      url: `/v1/checkout-sessions/${created.json().id}/complete`,
      payload: completeCheckoutExample,
    });
    return completed.json().order.id as string;
  }

  function raise(orderId: string, payload: object) {
    return app.inject({
      method: 'POST',
      url: `/v1/demo/orders/${orderId}/fulfilment-exception`,
      payload,
    });
  }

  function resolve(orderId: string, payload: object) {
    return app.inject({
      method: 'POST',
      url: `/v1/demo/orders/${orderId}/resolve-fulfilment-exception`,
      payload,
    });
  }

  function getUcpOrder(orderId: string) {
    return app.inject({ method: 'GET', url: `/v1/orders/${orderId}` });
  }

  describe('GET /v1/demo/orders/:orderId', () => {
    function getState(orderId: string) {
      return app.inject({ method: 'GET', url: `/v1/demo/orders/${orderId}` });
    }

    it('returns the Order Workflow state queried from Temporal', async () => {
      const orderId = await placeOrder();

      const res = await getState(orderId);

      expect(res.statusCode).toBe(200);
      const order = res.json();
      expect(order.id).toBe(orderId);
      expect(order.status).toBe('confirmed');
      expect(order.lines.map((line: { id: string }) => line.id)).toEqual(['li_1', 'li_2']);
      expect(temporal.getOrder).toHaveBeenCalledWith(orderId);
    });

    it('reports the outstanding exception and resolution history', async () => {
      const orderId = await placeOrder();
      await raise(orderId, exception);

      const awaiting = (await getState(orderId)).json();
      expect(awaiting.status).toBe('awaiting_intervention');
      expect(awaiting.fulfilment.exception).toEqual({ ...exception, raisedAt: expect.any(String) });

      await resolve(orderId, resolution);

      const confirmed = (await getState(orderId)).json();
      expect(confirmed.status).toBe('confirmed');
      expect(confirmed.fulfilment.exception).toBeUndefined();
      expect(confirmed.fulfilment.sources).toEqual([{ lineId: 'li_2', source: 'warehouse-north' }]);
      expect(confirmed.fulfilment.resolutions).toHaveLength(1);
    });

    it('does not change the Order', async () => {
      const orderId = await placeOrder();

      await getState(orderId);

      expect(temporal.markOrderFulfilled).not.toHaveBeenCalled();
      expect(temporal.reportFulfilmentException).not.toHaveBeenCalled();
      expect(temporal.resolveFulfilmentException).not.toHaveBeenCalled();
      expect(temporal.workflows.get(orderId)?.status).toBe('confirmed');
    });

    it('returns 404 for an unknown Order', async () => {
      const res = await getState('ord_missing');

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({
        statusCode: 404,
        error: 'Not Found',
        message: 'Order "ord_missing" was not found',
      });
    });

    it('returns 404 without querying Temporal for IDs not issued for a checkout', async () => {
      const res = await getState('chk_123');

      expect(res.statusCode).toBe(404);
      expect(temporal.getOrder).not.toHaveBeenCalled();
    });

    it('fails with HTTP 500 when Temporal is unavailable', async () => {
      temporal.getOrder.mockRejectedValueOnce(new Error('Temporal unavailable'));

      const res = await getState('ord_123');

      expect(res.statusCode).toBe(500);
    });
  });

  describe('POST /v1/demo/orders/:orderId/fulfilment-exception', () => {
    it('reports the exception and returns the Order awaiting intervention', async () => {
      const orderId = await placeOrder();

      const res = await raise(orderId, exception);

      expect(res.statusCode).toBe(200);
      const order = res.json();
      expect(order.id).toBe(orderId);
      expect(order.status).toBe('awaiting_intervention');
      expect(order.fulfilment.exception).toEqual({ ...exception, raisedAt: expect.any(String) });
    });

    it('sends exactly the Go Signal payload', async () => {
      const orderId = await placeOrder();

      await raise(orderId, { ...exception, unexpected: 'ignored' });

      expect(temporal.reportFulfilmentException).toHaveBeenCalledExactlyOnceWith(
        orderId,
        exception,
      );
    });

    it('returns 409 when the Workflow does not accept the exception', async () => {
      const orderId = await placeOrder();

      const res = await raise(orderId, { lineId: 'li_99', reason: 'Unavailable' });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({
        statusCode: 409,
        error: 'Conflict',
        message: `The fulfilment exception was not accepted by Order "${orderId}" with status "confirmed"`,
      });
    });

    it('returns 409 for an exception against a fulfilled Order', async () => {
      const orderId = await placeOrder();
      await app.inject({ method: 'POST', url: `/v1/demo/orders/${orderId}/fulfil` });

      const res = await raise(orderId, exception);

      expect(res.statusCode).toBe(409);
      expect(res.json().message).toContain('with status "fulfilled"');
    });

    it('returns 404 for an unknown Order', async () => {
      const res = await raise('ord_missing', exception);

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({
        statusCode: 404,
        error: 'Not Found',
        message: 'Order "ord_missing" was not found',
      });
    });

    it('returns 404 without signalling Temporal for IDs not issued for a checkout', async () => {
      const res = await raise('chk_123', exception);

      expect(res.statusCode).toBe(404);
      expect(temporal.reportFulfilmentException).not.toHaveBeenCalled();
    });

    it.each([
      ['missing lineId', { reason: exception.reason }],
      ['missing reason', { lineId: 'li_2' }],
      ['empty reason', { lineId: 'li_2', reason: '' }],
      ['non-string lineId', { lineId: 2, reason: exception.reason }],
    ])('returns 400 for %s', async (_, payload) => {
      const orderId = await placeOrder();

      const res = await raise(orderId, payload);

      expect(res.statusCode).toBe(400);
      expect(temporal.reportFulfilmentException).not.toHaveBeenCalled();
    });

    it('fails with HTTP 500 when Temporal is unavailable', async () => {
      temporal.reportFulfilmentException.mockRejectedValueOnce(new Error('Temporal unavailable'));

      const res = await raise('ord_123', exception);

      expect(res.statusCode).toBe(500);
    });
  });

  describe('POST /v1/demo/orders/:orderId/resolve-fulfilment-exception', () => {
    it('approves an alternative source and returns the confirmed Order', async () => {
      const orderId = await placeOrder();
      await raise(orderId, exception);

      const res = await resolve(orderId, resolution);

      expect(res.statusCode).toBe(200);
      const order = res.json();
      expect(order.id).toBe(orderId);
      expect(order.status).toBe('confirmed');
      expect(order.fulfilment.exception).toBeUndefined();
      expect(order.fulfilment.sources).toEqual([{ lineId: 'li_2', source: 'warehouse-north' }]);
      expect(order.fulfilment.resolutions).toEqual([
        {
          ...resolution,
          reason: exception.reason,
          decision: 'alternative_source',
          raisedAt: expect.any(String),
          resolvedAt: expect.any(String),
        },
      ]);
      // What was purchased is unchanged
      expect(order.lines.map((line: { id: string }) => line.id)).toEqual(['li_1', 'li_2']);
    });

    it('sends exactly the Go Update payload', async () => {
      const orderId = await placeOrder();
      await raise(orderId, exception);
      const { note: _note, ...withoutNote } = resolution;

      await resolve(orderId, { ...withoutNote, unexpected: 'ignored' });

      expect(temporal.resolveFulfilmentException).toHaveBeenCalledExactlyOnceWith(
        orderId,
        withoutNote,
      );
    });

    it('returns 409 with the Workflow reason when the resolution is rejected', async () => {
      const orderId = await placeOrder();
      await raise(orderId, exception);

      const res = await resolve(orderId, { ...resolution, lineId: 'li_1' });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({
        statusCode: 409,
        error: 'Conflict',
        message: 'line "li_1" is not affected by the exception: line "li_2" is',
      });
      expect(temporal.workflows.get(orderId)?.status).toBe('awaiting_intervention');
    });

    it('returns 409 when the Order is not awaiting intervention', async () => {
      const orderId = await placeOrder();

      const res = await resolve(orderId, resolution);

      expect(res.statusCode).toBe(409);
      expect(res.json().message).toBe('order is not awaiting intervention: status is confirmed');
    });

    it('returns 404 for an unknown Order', async () => {
      const res = await resolve('ord_missing', resolution);

      expect(res.statusCode).toBe(404);
      expect(res.json().message).toBe('Order "ord_missing" was not found');
    });

    it('returns 404 without calling Temporal for IDs not issued for a checkout', async () => {
      const res = await resolve('chk_123', resolution);

      expect(res.statusCode).toBe(404);
      expect(temporal.resolveFulfilmentException).not.toHaveBeenCalled();
    });

    it.each([
      ['missing alternativeSource', { lineId: 'li_2', approvedBy: 'ops@example.com' }],
      [
        'empty approvedBy',
        { lineId: 'li_2', alternativeSource: 'warehouse-north', approvedBy: '' },
      ],
      ['non-string note', { ...resolution, note: 5 }],
    ])('returns 400 for %s', async (_, payload) => {
      const orderId = await placeOrder();
      await raise(orderId, exception);

      const res = await resolve(orderId, payload);

      expect(res.statusCode).toBe(400);
      expect(temporal.resolveFulfilmentException).not.toHaveBeenCalled();
    });

    it('fails with HTTP 500 when Temporal is unavailable', async () => {
      temporal.resolveFulfilmentException.mockRejectedValueOnce(new Error('Temporal unavailable'));

      const res = await resolve('ord_123', resolution);

      expect(res.statusCode).toBe(500);
    });
  });

  describe('UCP Order and fulfilment', () => {
    it('reports lines as processing while awaiting intervention', async () => {
      const orderId = await placeOrder();
      await raise(orderId, exception);

      const res = await getUcpOrder(orderId);

      const order = OrderSchema.parse(res.json());
      expect(order.line_items.map((line) => line.status)).toEqual(['processing', 'processing']);
      expect(res.body).not.toMatch(/awaiting_intervention|warehouse/);
    });

    it('does not fulfil an Order awaiting intervention', async () => {
      const orderId = await placeOrder();
      await raise(orderId, exception);

      const res = await app.inject({ method: 'POST', url: `/v1/demo/orders/${orderId}/fulfil` });

      expect(res.statusCode).toBe(200);
      expect(OrderSchema.parse(res.json()).line_items.every((l) => l.status === 'processing')).toBe(
        true,
      );
      expect(temporal.workflows.get(orderId)?.status).toBe('awaiting_intervention');
    });

    it('fulfils the Order once the exception is resolved', async () => {
      const orderId = await placeOrder();
      await raise(orderId, exception);
      await resolve(orderId, resolution);

      const res = await app.inject({ method: 'POST', url: `/v1/demo/orders/${orderId}/fulfil` });

      expect(OrderSchema.parse(res.json()).line_items.every((l) => l.status === 'fulfilled')).toBe(
        true,
      );
    });
  });
});
