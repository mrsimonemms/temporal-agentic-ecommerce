import { apiBaseUrl, proxyToApi } from '$lib/server/api';

import type { RequestHandler } from './$types';

// Demo only: approve or reject the proposed purchase
export const POST: RequestHandler = async ({ fetch, params, request }) =>
  proxyToApi(
    fetch,
    apiBaseUrl(),
    `/v1/demo/shopping-agents/${encodeURIComponent(params.id)}/decision`,
    { method: 'POST', body: await request.text() },
  );
