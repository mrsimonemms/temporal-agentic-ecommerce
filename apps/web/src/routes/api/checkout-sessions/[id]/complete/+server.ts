import { apiBaseUrl, proxyToApi } from '$lib/server/api';

import type { RequestHandler } from './$types';

// UCP: complete a checkout
export const POST: RequestHandler = async ({ fetch, params, request }) =>
  proxyToApi(
    fetch,
    apiBaseUrl(),
    `/v1/checkout-sessions/${encodeURIComponent(params.id)}/complete`,
    {
      method: 'POST',
      body: await request.text(),
    },
  );
