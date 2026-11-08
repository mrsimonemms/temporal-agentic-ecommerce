import { apiBaseUrl, proxyToApi } from '$lib/server/api';

import type { RequestHandler } from './$types';

// Demo only: start a Shopping Agent Workflow
export const POST: RequestHandler = async ({ fetch, request }) =>
  proxyToApi(fetch, apiBaseUrl(), '/v1/demo/shopping-agents', {
    method: 'POST',
    body: await request.text(),
  });
