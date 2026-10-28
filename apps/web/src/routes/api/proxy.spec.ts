import { describe, expect, it, vi } from 'vitest';

import { POST as createCheckout } from './checkout-sessions/+server';
import { GET as getCheckout } from './checkout-sessions/[id]/+server';
import { POST as completeCheckout } from './checkout-sessions/[id]/complete/+server';
import { PUT as setInventoryFailures } from './demo/checkout-sessions/[id]/inventory-failures/+server';
import { GET as getOrderState } from './demo/orders/[id]/+server';
import { POST as fulfilOrder } from './demo/orders/[id]/fulfil/+server';
import { POST as reportException } from './demo/orders/[id]/fulfilment-exception/+server';
import { POST as resolveException } from './demo/orders/[id]/resolve-fulfilment-exception/+server';
import { GET as getOrder } from './orders/[id]/+server';

vi.mock('$env/dynamic/private', () => ({ env: { API_URL: 'http://api:9999' } }));

// Calls a route handler and returns the fetch used to reach the API. The
// handlers only read `fetch`, `params` and `request` from the event.
async function invoke<E>(
  handler: (event: E) => Response | Promise<Response>,
  params: Record<string, string>,
  body?: unknown,
) {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  const request = new Request('http://localhost:5173/api', {
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  await handler({ fetch: fetchMock, params, request } as unknown as E);

  return fetchMock;
}

describe('UCP proxy routes', () => {
  it('creates a checkout via the UCP API', async () => {
    const fetchMock = await invoke(createCheckout, {}, { line_items: [] });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://api:9999/v1/checkout-sessions');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"line_items":[]}');
  });

  it('gets a checkout via the UCP API', async () => {
    const fetchMock = await invoke(getCheckout, { id: 'chk_123' });

    expect(String(fetchMock.mock.calls[0][0])).toBe('http://api:9999/v1/checkout-sessions/chk_123');
  });

  it('completes a checkout via the UCP API', async () => {
    const fetchMock = await invoke(completeCheckout, { id: 'chk_123' }, { payment: {} });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://api:9999/v1/checkout-sessions/chk_123/complete');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"payment":{}}');
  });

  it('gets an Order via the UCP API, encoding the ID', async () => {
    const fetchMock = await invoke(getOrder, { id: 'ord_1/../x' });

    expect(String(fetchMock.mock.calls[0][0])).toBe('http://api:9999/v1/orders/ord_1%2F..%2Fx');
  });
});

describe('Demo proxy routes', () => {
  it('configures inventory failures for a checkout', async () => {
    const fetchMock = await invoke(setInventoryFailures, { id: 'chk_123' }, { failures: 2 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      'http://api:9999/v1/demo/checkout-sessions/chk_123/inventory-failures',
    );
    expect(init.method).toBe('PUT');
    expect(init.body).toBe('{"failures":2}');
  });

  it('gets the internal Order Workflow state', async () => {
    const fetchMock = await invoke(getOrderState, { id: 'ord_123' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://api:9999/v1/demo/orders/ord_123');
    expect(init.method).toBe('GET');
  });

  it('reports a fulfilment exception', async () => {
    const body = { lineId: 'li_2', reason: 'Unavailable' };
    const fetchMock = await invoke(reportException, { id: 'ord_123' }, body);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://api:9999/v1/demo/orders/ord_123/fulfilment-exception');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it('resolves a fulfilment exception', async () => {
    const body = { lineId: 'li_2', alternativeSource: 'warehouse-north', approvedBy: 'ops' };
    const fetchMock = await invoke(resolveException, { id: 'ord_123' }, body);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://api:9999/v1/demo/orders/ord_123/resolve-fulfilment-exception');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it('marks an Order fulfilled without a request body', async () => {
    const fetchMock = await invoke(fulfilOrder, { id: 'ord_1/../x' }, {});

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://api:9999/v1/demo/orders/ord_1%2F..%2Fx/fulfil');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });
});
