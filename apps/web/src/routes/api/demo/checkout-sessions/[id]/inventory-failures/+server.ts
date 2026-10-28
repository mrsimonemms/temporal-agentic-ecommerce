import { apiBaseUrl, proxyToApi } from '$lib/server/api';

import type { RequestHandler } from './$types';

// Demo only: configure simulated inventory reservation failures
export const PUT: RequestHandler = async ({ fetch, params, request }) =>
  proxyToApi(
    fetch,
    apiBaseUrl(),
    `/v1/demo/checkout-sessions/${encodeURIComponent(params.id)}/inventory-failures`,
    { method: 'PUT', body: await request.text() },
  );
