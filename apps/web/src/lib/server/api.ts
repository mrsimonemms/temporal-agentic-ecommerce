import { json } from '@sveltejs/kit';

import { env } from '$env/dynamic/private';

// Upper bound on each API request, so a stalled API surfaces as an error
// rather than leaving the dashboard waiting indefinitely
const API_TIMEOUT_MS = 10_000;

// Server-side base URL of the NestJS API. This is not the browser-visible URL:
// inside Docker Compose it is the service name (http://api:9999), while in the
// devcontainer the API is reachable on localhost.
export function apiBaseUrl(): string {
  return env.API_URL || 'http://localhost:9999';
}

interface ProxyRequest {
  method?: 'GET' | 'POST' | 'PUT';
  body?: string;
}

// Forwards a request to the NestJS API and relays its status and body
// unchanged. The browser only talks to the dashboard's own origin, avoiding
// CORS and Docker networking concerns. No business logic lives here.
export async function proxyToApi(
  fetchFn: typeof fetch,
  baseUrl: string,
  path: string,
  { method = 'GET', body }: ProxyRequest = {},
): Promise<Response> {
  let res: Response;
  try {
    res = await fetchFn(new URL(path, baseUrl), {
      method,
      body,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return json(
        { code: 'api_timeout', content: 'The commerce API did not respond in time' },
        { status: 504 },
      );
    }
    return json(
      { code: 'api_unavailable', content: `The commerce API at ${baseUrl} could not be reached` },
      { status: 502 },
    );
  }

  return new Response(await res.text(), {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
  });
}
