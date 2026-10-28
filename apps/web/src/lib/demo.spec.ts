import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fulfilOrder,
  fulfilmentOutcome,
  getOrderSnapshot,
  getOrderState,
  reportFulfilmentException,
  resolveFulfilmentException,
  setInventoryFailures,
} from './demo';
import { startPolling } from './poll';
import {
  exceptionFixture,
  orderFixture,
  orderStateFixture,
  resolutionFixture,
} from './testing/fixtures';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function respond(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(json(body, status));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('setInventoryFailures', () => {
  it('configures failures for the selected checkout only', async () => {
    const fetchMock = respond({ checkoutId: 'chk_123', failures: 2 });

    await expect(setInventoryFailures('chk_123', 2)).resolves.toEqual({
      checkoutId: 'chk_123',
      failures: 2,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/demo/checkout-sessions/chk_123/inventory-failures');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ failures: 2 });
  });

  it('rejects with the API reason once completion has started', async () => {
    respond(
      {
        statusCode: 409,
        error: 'Conflict',
        message: 'Inventory failures cannot be configured while the checkout status is "completed"',
      },
      409,
    );

    await expect(setInventoryFailures('chk_123', 1)).rejects.toMatchObject({
      status: 409,
      message: 'Inventory failures cannot be configured while the checkout status is "completed"',
    });
  });
});

describe('fulfilment exceptions', () => {
  it('reports an exception for an Order line and returns the Workflow state', async () => {
    const state = orderStateFixture({
      status: 'awaiting_intervention',
      fulfilment: { exception: exceptionFixture },
    });
    const fetchMock = respond(state);

    await expect(
      reportFulfilmentException('ord_123', { lineId: 'li_2', reason: exceptionFixture.reason }),
    ).resolves.toEqual(state);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/demo/orders/ord_123/fulfilment-exception');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ lineId: 'li_2', reason: exceptionFixture.reason });
  });

  it('rejects when the Workflow does not accept the exception', async () => {
    respond(
      {
        statusCode: 409,
        error: 'Conflict',
        message:
          'The fulfilment exception was not accepted by Order "ord_123" with status "reserving_inventory"',
      },
      409,
    );

    await expect(
      reportFulfilmentException('ord_123', { lineId: 'li_2', reason: 'Unavailable' }),
    ).rejects.toThrow('with status "reserving_inventory"');
  });

  it('approves an alternative source and returns the confirmed Workflow state', async () => {
    const state = orderStateFixture({
      fulfilment: {
        sources: [{ lineId: 'li_2', source: 'warehouse-north' }],
        resolutions: [resolutionFixture],
      },
    });
    const fetchMock = respond(state);
    const request = {
      lineId: 'li_2',
      alternativeSource: 'warehouse-north',
      approvedBy: 'ops@example.com',
      note: 'Same item, ships a day later',
    };

    await expect(resolveFulfilmentException('ord_123', request)).resolves.toEqual(state);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/demo/orders/ord_123/resolve-fulfilment-exception');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(request);
  });

  it('rejects with the Workflow reason when the resolution is invalid', async () => {
    respond(
      {
        statusCode: 409,
        error: 'Conflict',
        message: 'order is not awaiting intervention: status is confirmed',
      },
      409,
    );

    await expect(
      resolveFulfilmentException('ord_123', {
        lineId: 'li_2',
        alternativeSource: 'warehouse-north',
        approvedBy: 'ops@example.com',
      }),
    ).rejects.toThrow('order is not awaiting intervention: status is confirmed');
  });
});

describe('fulfilOrder', () => {
  it('posts without a body and returns the UCP Order', async () => {
    const order = orderFixture('fulfilled');
    const fetchMock = respond(order);

    await expect(fulfilOrder('ord_123')).resolves.toEqual(order);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/demo/orders/ord_123/fulfil');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });
});

describe('fulfilmentOutcome', () => {
  it('reports success only when every line item is fulfilled', () => {
    expect(fulfilmentOutcome(orderFixture('fulfilled'))).toEqual({
      tone: 'success',
      message: 'Order marked fulfilled',
    });
  });

  it('warns when the Workflow ignored the request', () => {
    expect(fulfilmentOutcome(orderFixture('processing'))).toMatchObject({
      tone: 'warning',
      message: expect.stringContaining('only confirmed Orders can be fulfilled'),
    });
  });
});

describe('getOrderState', () => {
  it('reads the internal Workflow state from the demo endpoint', async () => {
    const fetchMock = respond(orderStateFixture());

    const state = await getOrderState('ord_123');

    expect(state.inventoryReservationId).toBe('res_ord_123');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/demo/orders/ord_123');
  });
});

describe('getOrderSnapshot', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function stubApi(states: ReturnType<typeof orderStateFixture>[]) {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        url.startsWith('/api/demo/')
          ? json(states.length > 1 ? states.shift() : states[0])
          : json(orderFixture()),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('reads the UCP Order and the Workflow state with the same abort signal', async () => {
    const fetchMock = stubApi([orderStateFixture()]);
    const controller = new AbortController();

    const snapshot = await getOrderSnapshot('ord_123', controller.signal);

    expect(snapshot.order.id).toBe('ord_123');
    expect(snapshot.state.status).toBe('confirmed');
    expect(fetchMock.mock.calls.map(([url]) => url).sort()).toEqual([
      '/api/demo/orders/ord_123',
      '/api/orders/ord_123',
    ]);
    for (const [, init] of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect(init.signal).toBe(controller.signal);
    }
  });

  it('fails the snapshot when either request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          url.startsWith('/api/demo/')
            ? json(
                { code: 'api_timeout', content: 'The commerce API did not respond in time' },
                504,
              )
            : json(orderFixture()),
        ),
      ),
    );

    await expect(getOrderSnapshot('ord_123')).rejects.toThrow(
      'The commerce API did not respond in time',
    );
  });

  it('refreshes the Workflow state as Temporal retries and confirms the Order', async () => {
    stubApi([
      orderStateFixture({ status: 'reserving_inventory', inventoryReservationId: undefined }),
      orderStateFixture({ status: 'reserving_inventory', inventoryReservationId: undefined }),
      orderStateFixture({ status: 'confirmed' }),
    ]);
    const statuses: string[] = [];

    const stop = startPolling((signal) => getOrderSnapshot('ord_123', signal), {
      intervalMs: 1000,
      onSuccess: (snapshot) => statuses.push(snapshot.state.status),
      onError: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(2000);
    stop();

    expect(statuses).toEqual(['reserving_inventory', 'reserving_inventory', 'confirmed']);
  });
});
