import { apiBaseUrl, proxyToApi } from '$lib/server/api';

import type { RequestHandler } from './$types';

// Demo only: get the Shopping Agent state
export const GET: RequestHandler = ({ fetch, params }) =>
  proxyToApi(fetch, apiBaseUrl(), `/v1/demo/shopping-agents/${encodeURIComponent(params.id)}`);
