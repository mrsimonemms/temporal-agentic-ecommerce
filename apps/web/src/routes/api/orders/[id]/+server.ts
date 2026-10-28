import { apiBaseUrl, proxyToApi } from '$lib/server/api';

import type { RequestHandler } from './$types';

// UCP: get an order
export const GET: RequestHandler = ({ fetch, params }) =>
  proxyToApi(fetch, apiBaseUrl(), `/v1/orders/${encodeURIComponent(params.id)}`);
