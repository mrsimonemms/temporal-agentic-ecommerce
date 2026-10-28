import { apiBaseUrl, proxyToApi } from '$lib/server/api';

import type { RequestHandler } from './$types';

// UCP: create a checkout
export const POST: RequestHandler = async ({ fetch, request }) =>
  proxyToApi(fetch, apiBaseUrl(), '/v1/checkout-sessions', {
    method: 'POST',
    body: await request.text(),
  });
