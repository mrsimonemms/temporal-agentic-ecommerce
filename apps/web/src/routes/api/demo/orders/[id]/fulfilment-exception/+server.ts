import { apiBaseUrl, proxyToApi } from '$lib/server/api';

import type { RequestHandler } from './$types';

// Demo only: report a fulfilment exception
export const POST: RequestHandler = async ({ fetch, params, request }) =>
  proxyToApi(
    fetch,
    apiBaseUrl(),
    `/v1/demo/orders/${encodeURIComponent(params.id)}/fulfilment-exception`,
    { method: 'POST', body: await request.text() },
  );
