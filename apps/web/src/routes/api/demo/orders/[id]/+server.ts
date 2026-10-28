import { apiBaseUrl, proxyToApi } from '$lib/server/api';

import type { RequestHandler } from './$types';

// Demo only: get the internal Order Workflow state
export const GET: RequestHandler = ({ fetch, params }) =>
  proxyToApi(fetch, apiBaseUrl(), `/v1/demo/orders/${encodeURIComponent(params.id)}`);
