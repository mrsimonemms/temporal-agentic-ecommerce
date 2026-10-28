import { describe, expect, it, vi } from 'vitest';

import { proxyToApi } from './api';

describe('proxyToApi', () => {
  it('forwards the request and relays the status and body unchanged', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"id":"chk_123"}', {
        status: 201,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      }),
    );

    const res = await proxyToApi(fetchMock, 'http://api:9999', '/v1/checkout-sessions', {
      method: 'POST',
      body: '{"line_items":[]}',
    });

    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await res.json()).toEqual({ id: 'chk_123' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://api:9999/v1/checkout-sessions');
    expect(init).toMatchObject({
      method: 'POST',
      body: '{"line_items":[]}',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
    });
  });

  it('relays API error responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response('{"code":"invalid_request","content":"bad"}', { status: 400 }),
      );

    const res = await proxyToApi(fetchMock, 'http://api:9999', '/v1/checkout-sessions');

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: 'invalid_request', content: 'bad' });
  });

  it('returns HTTP 502 when the API cannot be reached', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

    const res = await proxyToApi(fetchMock, 'http://api:9999', '/v1/orders/ord_123');

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      code: 'api_unavailable',
      content: 'The commerce API at http://api:9999 could not be reached',
    });
  });

  it('returns HTTP 504 when the API does not respond in time', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new DOMException('The operation timed out', 'TimeoutError'));

    const res = await proxyToApi(fetchMock, 'http://api:9999', '/v1/orders/ord_123');

    expect(res.status).toBe(504);
    expect((await res.json()).code).toBe('api_timeout');
  });
});
