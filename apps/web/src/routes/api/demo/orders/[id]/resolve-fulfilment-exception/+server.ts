import { apiBaseUrl, proxyToApi } from '$lib/server/api';

import type { RequestHandler } from './$types';

// Demo only: approve an alternative fulfilment source
export const POST: RequestHandler = async ({ fetch, params, request }) =>
  proxyToApi(
    fetch,
    apiBaseUrl(),
    `/v1/demo/orders/${encodeURIComponent(params.id)}/resolve-fulfilment-exception`,
    { method: 'POST', body: await request.text() },
  );
