import { apiBaseUrl, proxyToApi } from '$lib/server/api';

import type { RequestHandler } from './$types';

// Demo only: mark an Order as fulfilled. The API takes no request body.
export const POST: RequestHandler = ({ fetch, params }) =>
  proxyToApi(fetch, apiBaseUrl(), `/v1/demo/orders/${encodeURIComponent(params.id)}/fulfil`, {
    method: 'POST',
  });
