import { describe, expect, it, vi } from 'vitest';

import { POST as createCheckout } from './checkout-sessions/+server';
import { GET as getCheckout } from './checkout-sessions/[id]/+server';
import { POST as completeCheckout } from './checkout-sessions/[id]/complete/+server';
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
