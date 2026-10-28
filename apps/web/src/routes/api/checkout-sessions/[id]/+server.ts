import { apiBaseUrl, proxyToApi } from '$lib/server/api';

import type { RequestHandler } from './$types';

// UCP: get a checkout
export const GET: RequestHandler = ({ fetch, params }) =>
  proxyToApi(fetch, apiBaseUrl(), `/v1/checkout-sessions/${encodeURIComponent(params.id)}`);
