import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkoutFixture, orderFixture } from './testing/fixtures';
import {
  ApiError,
  buyerName,
  checkoutBuyer,
  checkoutRequest,
  completeCheckout,
  createCheckout,
  demoPaymentInstrument,
  getCheckout,
  getOrder,
} from './ucp';

function respond(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createCheckout', () => {
  it('posts the UCP create request through the dashboard proxy', async () => {
    const checkout = checkoutFixture();
    const fetchMock = respond(checkout, 201);
    const request = {
      line_items: [{ item: { id: 'sku_kettle' }, quantity: 1 }],
      buyer: { email: 'jane@example.com' },
    };

    await expect(createCheckout(request)).resolves.toEqual(checkout);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/checkout-sessions');
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual(request);
  });

  it('rejects with the UCP messages when no checkout was created', async () => {
    respond({
      ucp: { version: '2026-08-25', status: 'error' },
      messages: [
        {
          type: 'error',
          code: 'item_unavailable',
          content: 'Item "sku_x" is not available for purchase',
          severity: 'unrecoverable',
        },
      ],
    });

    const error = await createCheckout({ line_items: [{ item: { id: 'sku_x' }, quantity: 1 }] })
      .then(() => undefined)
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe('Item "sku_x" is not available for purchase');
    expect((error as ApiError).messages[0].code).toBe('item_unavailable');
  });

  it('rejects with the content of a UCP invalid_request error', async () => {
    respond({ code: 'invalid_request', content: '$.line_items: Required' }, 400);

    await expect(createCheckout({ line_items: [] })).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: '$.line_items: Required',
    });
  });
});

describe('completeCheckout', () => {
  it('posts the payment selection and returns the completed checkout', async () => {
    const completed = checkoutFixture({
      status: 'completed',
      order: { id: 'ord_123', permalink_url: 'http://localhost:9999/orders/ord_123' },
    });
    const fetchMock = respond(completed);
    const instrument = demoPaymentInstrument(checkoutFixture())!;

    const result = await completeCheckout('chk_123', { payment: { instruments: [instrument] } });

    expect(result.order?.id).toBe('ord_123');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/checkout-sessions/chk_123/complete');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).payment.instruments[0]).toMatchObject({
      handler_id: 'gpay',
      selected: true,
    });
  });
});

describe('demoPaymentInstrument', () => {
  it('uses the first payment handler advertised by the checkout', () => {
    expect(demoPaymentInstrument(checkoutFixture())).toMatchObject({
      handler_id: 'gpay',
      type: 'card',
      selected: true,
    });
  });

  it('returns undefined when no payment handler is advertised', () => {
    const checkout = checkoutFixture();
    checkout.ucp.payment_handlers = {};

    expect(demoPaymentInstrument(checkout)).toBeUndefined();
  });
});

describe('getCheckout', () => {
  it('encodes the checkout ID in the path', async () => {
    const fetchMock = respond(checkoutFixture());

    await getCheckout('chk/../x');

    expect(fetchMock.mock.calls[0][0]).toBe('/api/checkout-sessions/chk%2F..%2Fx');
  });
});

describe('getOrder', () => {
  it('returns the UCP Order', async () => {
    const order = orderFixture();
    const fetchMock = respond(order);
    const controller = new AbortController();

    await expect(getOrder('ord_123', controller.signal)).resolves.toEqual(order);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/orders/ord_123');
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it('rejects when the Order is not found', async () => {
    respond({
      ucp: { version: '2026-08-25', status: 'error' },
      messages: [
        {
          type: 'error',
          code: 'not_found',
          content: 'Order "ord_x" was not found',
          severity: 'unrecoverable',
        },
      ],
    });

    await expect(getOrder('ord_x')).rejects.toThrow('Order "ord_x" was not found');
  });

  it('rejects with the NestJS error message on a server error', async () => {
    respond({ statusCode: 500, message: 'Internal server error' }, 500);

    await expect(getOrder('ord_123')).rejects.toMatchObject({
      status: 500,
      message: 'Internal server error',
    });
  });

  it('rejects with a generic message when the response has no body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(getOrder('ord_123')).rejects.toThrow('Request failed with HTTP 503');
  });

  it('rejects when the dashboard server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    await expect(getOrder('ord_123')).rejects.toThrow('Unable to reach the dashboard server');
  });
});

describe('checkoutBuyer', () => {
  it.each([
    ['a single-word name', 'Sukarno'],
    ['a name with two parts', 'Jane Doe'],
    ['a name with several parts', 'María José García López'],
    ['a family name written first', 'Nguyễn Văn An'],
    ['a name with a particle', 'Ludwig van Beethoven'],
  ])('keeps %s whole, without splitting it', (_, name) => {
    expect(checkoutBuyer('buyer@example.com', name)).toEqual({
      email: 'buyer@example.com',
      first_name: name,
    });
  });

  it('trims surrounding whitespace only', () => {
    expect(checkoutBuyer(' jane@example.com ', '  Jean-Luc  Picard ')).toEqual({
      email: 'jane@example.com',
      first_name: 'Jean-Luc  Picard',
    });
  });

  it('omits the name when none is given', () => {
    expect(checkoutBuyer('jane@example.com', '   ')).toEqual({ email: 'jane@example.com' });
  });
});

describe('buyerName', () => {
  it('shows a name entered in the single Name field exactly', () => {
    for (const name of ['Sukarno', 'María José García López']) {
      expect(buyerName(checkoutBuyer('buyer@example.com', name))).toBe(name);
    }
  });

  it('joins first and last names sent by other clients', () => {
    expect(buyerName({ email: 'jane@example.com', first_name: 'Jane', last_name: 'Doe' })).toBe(
      'Jane Doe',
    );
  });

  it('is empty when there is no name', () => {
    expect(buyerName({ email: 'jane@example.com' })).toBe('');
    expect(buyerName(undefined)).toBe('');
  });
});

describe('checkoutRequest', () => {
  it('maps the selected products and buyer into the UCP create request', () => {
    expect(
      checkoutRequest(
        { sku_kettle: 1, sku_toaster: 0, sku_mug_set: 2 },
        { email: 'jane@example.com', name: 'Jane Doe' },
      ),
    ).toEqual({
      line_items: [
        { item: { id: 'sku_kettle' }, quantity: 1 },
        { item: { id: 'sku_mug_set' }, quantity: 2 },
      ],
      buyer: { email: 'jane@example.com', first_name: 'Jane Doe' },
    });
  });

  it('keeps catalogue order and product IDs regardless of selection order', () => {
    const request = checkoutRequest(
      { sku_mug_set: 3, sku_kettle: 1 },
      { email: 'a@example.com', name: 'Aaliyah' },
    );

    expect(request.line_items.map((line) => line.item.id)).toEqual(['sku_kettle', 'sku_mug_set']);
    expect(request.buyer).toEqual({ email: 'a@example.com', first_name: 'Aaliyah' });
  });
});
