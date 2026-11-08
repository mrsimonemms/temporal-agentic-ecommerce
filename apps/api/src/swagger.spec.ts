import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { OpenAPIObject } from '@nestjs/swagger';
import {
  CheckoutCompleteRequestSchema,
  CheckoutCreateRequestSchema,
  CheckoutResponseSchema,
  UcpProfileDocumentSchema,
} from '@ucp-js/sdk';

import { TestApp, closeTestApp, createTestApp } from '../test/app';
import { FakeTemporalService } from '../test/fakes';
import { completeCheckoutExample, createCheckoutExample } from './checkout/checkout.examples';
import { createOpenApiDocument } from './swagger';

type Operation = {
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: { name: string; in: string; required?: boolean }[];
  requestBody?: { content: Record<string, { schema: unknown; examples?: Record<string, any> }> };
  responses: Record<string, { content?: Record<string, { schema: unknown }> }>;
};

function operation(document: OpenAPIObject, path: string, method: string): Operation {
  return (document.paths[path] as Record<string, Operation>)[method];
}

function collectRefs(value: unknown, refs: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item) => collectRefs(item, refs));
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string') {
        refs.push(child);
      } else {
        collectRefs(child, refs);
      }
    }
  }
  return refs;
}

describe('OpenAPI document', () => {
  let app: NestFastifyApplication;
  let document: OpenAPIObject;
  let temporal: FakeTemporalService;

  let testApp: TestApp;

  beforeEach(async () => {
    testApp = await createTestApp();
    ({ app, temporal } = testApp);
    document = createOpenApiDocument(app);
  });

  afterEach(() => closeTestApp(testApp));

  const endpoints = [
    ['/.well-known/ucp', 'get'],
    ['/health', 'get'],
    ['/orders/{id}', 'get'],
    ['/v1/catalogue', 'get'],
    ['/v1/checkout-sessions', 'post'],
    ['/v1/checkout-sessions/{id}', 'get'],
    ['/v1/checkout-sessions/{id}/complete', 'post'],
    ['/v1/demo/checkout-sessions/{checkoutId}/inventory-failures', 'put'],
    ['/v1/demo/orders/{id}/fulfil', 'post'],
    ['/v1/demo/orders/{orderId}', 'get'],
    ['/v1/demo/orders/{orderId}/fulfilment-exception', 'post'],
    ['/v1/demo/orders/{orderId}/resolve-fulfilment-exception', 'post'],
    ['/v1/demo/shopping-agents', 'post'],
    ['/v1/demo/shopping-agents/{id}', 'get'],
    ['/v1/demo/shopping-agents/{id}/decision', 'post'],
    ['/v1/orders/{id}', 'get'],
  ];

  it('serves Swagger UI and the generated document', async () => {
    const ui = await app.inject({ method: 'GET', url: '/api' });
    expect(ui.statusCode).toBe(200);
    expect(ui.headers['content-type']).toContain('text/html');

    const json = await app.inject({ method: 'GET', url: '/api-json' });
    expect(json.statusCode).toBe(200);
    expect(json.json()).toEqual(JSON.parse(JSON.stringify(document)));
  });

  it('documents every endpoint with its route and method', () => {
    const documented = Object.entries(document.paths)
      .flatMap(([path, item]) => Object.keys(item).map((method) => [path, method]))
      .sort();

    expect(documented).toEqual([...endpoints].sort());
  });

  it('does not expose the removed /v1/ucp and webhook placeholder routes', async () => {
    expect(
      Object.keys(document.paths).filter((path) => /^\/v1\/ucp(\/|$)|webhooks/.test(path)),
    ).toEqual([]);

    for (const [method, url] of [
      ['GET', '/v1/ucp'],
      ['POST', '/v1/ucp/checkout-sessions'],
      ['GET', '/v1/ucp/checkout-sessions/chk_123'],
      ['POST', '/v1/ucp/checkout-sessions/chk_123/complete'],
      ['GET', '/v1/ucp/orders/ord_123'],
      ['POST', '/v1/webhooks/ucp/orders'],
    ] as const) {
      expect((await app.inject({ method, url, payload: {} })).statusCode).toBe(404);
    }
  });

  it('serves every UCP operation relative to the advertised service endpoint', async () => {
    const profile = UcpProfileDocumentSchema.parse(
      (await app.inject({ method: 'GET', url: '/.well-known/ucp' })).json(),
    );
    const endpoint = profile.ucp.services?.['dev.ucp.shopping'][0].endpoint ?? '';

    expect(endpoint).toBe('http://localhost:9999/v1');
    for (const path of [
      '/checkout-sessions',
      '/checkout-sessions/{id}',
      '/checkout-sessions/{id}/complete',
      '/orders/{id}',
    ]) {
      expect(document.paths).toHaveProperty([`${new URL(endpoint).pathname}${path}`]);
    }
  });

  it('does not advertise a webhook URL in the business profile', async () => {
    const profile = (await app.inject({ method: 'GET', url: '/.well-known/ucp' })).json();

    expect(profile.ucp.capabilities['dev.ucp.shopping.order']).toEqual([
      expect.not.objectContaining({ config: expect.anything() }),
    ]);
  });

  it.each(endpoints)('routes %s %s to an implemented handler', async (path, method) => {
    // The Order permalink returns 404 for unknown Orders, so an Order exists
    await temporal.startOrderWorkflow({
      id: 'ord_123',
      buyer: { email: 'jane@example.com' },
      currency: 'GBP',
      lines: [{ id: 'li_1', productId: 'sku_kettle', quantity: 1, unitPrice: 3499 }],
    });

    // A Shopping Agent exists for the same reason
    await temporal.startShoppingAgentWorkflow('agent_123', {
      request: 'Buy me a kettle',
      buyer: { email: 'jane@example.com' },
    });

    const id = path.includes('orders')
      ? 'ord_123'
      : path.includes('shopping-agents')
        ? 'agent_123'
        : 'chk_missing';
    const res = await app.inject({
      method: method.toUpperCase() as 'GET' | 'POST' | 'PUT',
      url: path.replace(/\{\w+\}/, id),
      payload: method === 'post' ? {} : undefined,
    });

    expect(res.statusCode).not.toBe(404);
  });

  it.each(endpoints)('describes %s %s with a summary, tag and responses', (path, method) => {
    const op = operation(document, path, method);

    expect(op.summary).toBeTruthy();
    expect(op.tags?.length).toBe(1);
    expect(Object.keys(op.responses).length).toBeGreaterThan(0);
  });

  it('resolves every schema reference', () => {
    const schemas = document.components?.schemas ?? {};

    for (const ref of collectRefs([document.paths, schemas])) {
      expect(ref).toMatch(/^#\/components\/schemas\//);
      expect(schemas).toHaveProperty([ref.replace('#/components/schemas/', '')]);
    }
    // Components converted from the UCP SDK are self-contained so they can be
    // reused without rewriting
    for (const name of [
      'UcpProfileDocument',
      'CheckoutCreateRequest',
      'CheckoutCompleteRequest',
      'CheckoutResponse',
      'Order',
      'ErrorResponse',
    ]) {
      expect(schemas).toHaveProperty([name]);
      expect(collectRefs(schemas[name])).toEqual([]);
    }
  });

  it('documents UCP request bodies and responses using the SDK schemas', () => {
    const create = operation(document, '/v1/checkout-sessions', 'post');
    expect(create.requestBody?.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/CheckoutCreateRequest',
    });
    expect(create.responses['201'].content?.['application/json'].schema).toEqual({
      $ref: '#/components/schemas/CheckoutResponse',
    });
    expect(create.responses['200'].content?.['application/json'].schema).toEqual({
      $ref: '#/components/schemas/ErrorResponse',
    });
    expect(create.responses['400'].content?.['application/json'].schema).toEqual({
      $ref: '#/components/schemas/InvalidRequest',
    });

    const complete = operation(document, '/v1/checkout-sessions/{id}/complete', 'post');
    expect(complete.requestBody?.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/CheckoutCompleteRequest',
    });
    expect(complete.parameters).toContainEqual(
      expect.objectContaining({ name: 'id', in: 'path', required: true }),
    );
    // Completion always returns HTTP 200, never the default 201 for POST
    expect(Object.keys(complete.responses).sort()).toEqual(['200', '400', '409', '500']);
    expect(complete.responses['200'].content?.['application/json'].schema).toEqual({
      anyOf: [
        { $ref: '#/components/schemas/CheckoutResponse' },
        { $ref: '#/components/schemas/ErrorResponse' },
      ],
    });

    const schemas = document.components!.schemas!;
    const checkoutResponse = schemas.CheckoutResponse as {
      required: string[];
      properties: Record<string, { enum?: string[] }>;
    };
    expect(checkoutResponse.required).toEqual(expect.arrayContaining(['id', 'status', 'ucp']));
    expect(checkoutResponse.properties.status.enum).toEqual(
      expect.arrayContaining(['complete_in_progress', 'completed']),
    );
  });

  it.each([
    ['/v1/checkout-sessions', 'post'],
    ['/v1/checkout-sessions/{id}/complete', 'post'],
  ])('documents the optional UCP Idempotency-Key header for %s', (path, method) => {
    const op = operation(document, path, method);

    expect(op.parameters).toContainEqual(
      expect.objectContaining({ name: 'Idempotency-Key', in: 'header', required: false }),
    );
    expect(op.responses['409'].content?.['application/json'].schema).toEqual({
      $ref: '#/components/schemas/InvalidRequest',
    });
  });

  it('documents the catalogue as a merchant endpoint, not a UCP operation', () => {
    const op = operation(document, '/v1/catalogue', 'get');

    expect(op.tags).toEqual(['Catalogue']);
    expect(op.description).toContain('not a UCP operation');
    expect(op.requestBody).toBeUndefined();
    expect(Object.keys(op.responses)).toEqual(['200']);
    expect(op.responses['200'].content?.['application/json'].schema).toEqual({
      $ref: '#/components/schemas/CatalogueDto',
    });
    const json = op.responses['200'].content?.['application/json'] as
      { example?: unknown } | undefined;
    expect(json?.example).toMatchObject({
      currency: 'GBP',
      products: expect.arrayContaining([
        {
          id: 'sku_kettle',
          title: 'Stainless Steel Kettle',
          description: expect.any(String),
          unitPrice: 3499,
        },
      ]),
    });

    const schemas = document.components!.schemas!;
    expect(schemas.CatalogueDto).toMatchObject({
      required: ['currency', 'products'],
      properties: { products: { type: 'array' } },
    });
    expect(schemas.CatalogueProductDto).toMatchObject({
      required: ['id', 'title', 'description', 'unitPrice'],
      properties: { unitPrice: { type: 'integer', minimum: 0 } },
    });
    expect(document.tags).toContainEqual(
      expect.objectContaining({
        name: 'Catalogue',
        description: expect.stringContaining('Not a UCP'),
      }),
    );
  });

  it('documents the demo-only Shopping Agent endpoints', () => {
    const start = operation(document, '/v1/demo/shopping-agents', 'post');
    const get = operation(document, '/v1/demo/shopping-agents/{id}', 'get');
    const decide = operation(document, '/v1/demo/shopping-agents/{id}/decision', 'post');

    for (const op of [start, get, decide]) {
      expect(op.tags).toEqual(['Demo']);
      expect(op.summary).toContain('demo only');
      expect(op.description).toContain('not part of UCP');
    }

    expect(start.requestBody?.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/StartShoppingAgentDto',
    });
    const examples = start.requestBody?.content['application/json'].examples ?? {};
    expect(examples.kettleAndMugs.value).toEqual({
      request: 'Buy me a kettle and two sets of mugs. Keep it under £100.',
      buyer: { email: 'ada@example.com', name: 'Ada Lovelace' },
    });
    expect(examples.withInventoryFailures.value).toMatchObject({ demo: { inventoryFailures: 2 } });
    expect(Object.keys(start.responses).sort()).toEqual(['201', '400', '500']);
    expect(start.responses['201'].content?.['application/json'].schema).toEqual({
      $ref: '#/components/schemas/StartShoppingAgentResponseDto',
    });

    expect(Object.keys(get.responses).sort()).toEqual(['200', '404', '500']);
    expect(get.responses['200'].content?.['application/json'].schema).toEqual({
      $ref: '#/components/schemas/ShoppingAgentStateDto',
    });

    expect(decide.requestBody?.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/DecidePurchaseDto',
    });
    expect(Object.keys(decide.requestBody?.content['application/json'].examples ?? {})).toEqual([
      'approve',
      'reject',
    ]);
    expect(Object.keys(decide.responses).sort()).toEqual(['200', '400', '404', '409', '500']);
    for (const op of [get, decide]) {
      expect(op.parameters).toContainEqual(
        expect.objectContaining({ name: 'id', in: 'path', required: true }),
      );
      expect(op.responses['404'].content?.['application/json'].schema).toEqual({
        $ref: '#/components/schemas/HttpError',
      });
    }

    const schemas = document.components!.schemas!;
    expect(schemas.StartShoppingAgentDto).toMatchObject({
      required: ['request', 'buyer'],
      properties: { request: { maxLength: 1000 } },
    });
    expect(schemas.ShoppingAgentDemoDto).toMatchObject({
      properties: {
        scenario: { enum: ['none', 'ai_service_unavailable'], default: 'none' },
        inventoryFailures: { type: 'integer', minimum: 0, maximum: 2 },
      },
    });
    // Both demo controls are optional and independent
    expect((schemas.ShoppingAgentDemoDto as { required?: string[] }).required).toBeUndefined();
    expect(examples.aiServiceUnavailable.value).toMatchObject({
      demo: { scenario: 'ai_service_unavailable', inventoryFailures: 2 },
    });
    expect(start.description).toContain('ai_service_unavailable');
    expect(schemas.DecidePurchaseDto).toMatchObject({
      required: ['decision'],
      properties: { decision: { enum: ['approve', 'reject'] } },
    });
    const state = schemas.ShoppingAgentStateDto as {
      properties: Record<string, { enum?: string[] }>;
    };
    expect(state.properties.status.enum).toEqual([
      'planning',
      'awaiting_approval',
      'approved',
      'purchasing',
      'purchased',
      'rejected',
      'failed',
    ]);
    expect(Object.keys(state.properties)).toEqual(
      expect.arrayContaining(['proposal', 'decision', 'checkoutId', 'orderId', 'error']),
    );
  });

  it('documents Order retrieval using the SDK Order schema', () => {
    const getOrder = operation(document, '/v1/orders/{id}', 'get');

    expect(getOrder.tags).toEqual(['UCP order']);
    expect(getOrder.parameters).toContainEqual(
      expect.objectContaining({ name: 'id', in: 'path', required: true }),
    );
    expect(Object.keys(getOrder.responses).sort()).toEqual(['200', '500']);
    expect(getOrder.responses['200'].content?.['application/json'].schema).toEqual({
      anyOf: [
        { $ref: '#/components/schemas/Order' },
        { $ref: '#/components/schemas/ErrorResponse' },
      ],
    });

    const order = document.components!.schemas!.Order as { required: string[] };
    expect(order.required).toEqual(
      expect.arrayContaining(['id', 'checkout_id', 'permalink_url', 'line_items', 'fulfillment']),
    );
  });

  it('documents the Order permalink as an HTML page', () => {
    const page = operation(document, '/orders/{id}', 'get');

    expect(page.tags).toEqual(['Order permalink']);
    expect(Object.keys(page.responses).sort()).toEqual(['200', '404', '500']);
    expect(Object.keys(page.responses['200'].content ?? {})).toEqual(['text/html']);
    expect(Object.keys(page.responses['404'].content ?? {})).toEqual(['text/html']);
  });

  it('identifies the fulfilment control as demo-only', () => {
    const fulfil = operation(document, '/v1/demo/orders/{id}/fulfil', 'post');

    expect(fulfil.tags).toEqual(['Demo']);
    expect(fulfil.summary).toContain('demo only');
    expect(fulfil.description).toContain('not part of UCP');
    expect(fulfil.requestBody).toBeUndefined();
    expect(Object.keys(fulfil.responses).sort()).toEqual(['200', '500']);
    expect(fulfil.parameters).toContainEqual(
      expect.objectContaining({
        name: 'id',
        in: 'path',
        schema: expect.objectContaining({ example: 'ord_0b6f7c1e-3f0a-4d2b-9a57-2f1c8e0d4b11' }),
      }),
    );
  });

  it('documents the demo-only inventory failure configuration', () => {
    const op = operation(
      document,
      '/v1/demo/checkout-sessions/{checkoutId}/inventory-failures',
      'put',
    );

    expect(op.tags).toEqual(['Demo']);
    expect(op.summary).toContain('demo only');
    expect(op.description).toContain('not part of UCP');
    expect(op.parameters).toContainEqual(
      expect.objectContaining({ name: 'checkoutId', in: 'path', required: true }),
    );
    expect(op.requestBody?.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/InventoryFailuresDto',
    });
    expect(op.requestBody?.content['application/json'].examples?.twoFailures.value).toEqual({
      failures: 2,
    });
    expect(Object.keys(op.responses).sort()).toEqual(['200', '400', '404', '409']);
    for (const status of ['400', '404', '409']) {
      expect(op.responses[status].content?.['application/json'].schema).toEqual({
        $ref: '#/components/schemas/HttpError',
      });
    }

    expect(document.components?.schemas?.InventoryFailuresDto).toMatchObject({
      required: ['failures'],
      properties: { failures: { type: 'integer', minimum: 0, maximum: 2147483647 } },
    });
  });

  it.each([
    [
      '/v1/demo/orders/{orderId}/fulfilment-exception',
      'ReportFulfilmentExceptionDto',
      'supplierUnavailable',
      ['lineId', 'reason'],
    ],
    [
      '/v1/demo/orders/{orderId}/resolve-fulfilment-exception',
      'ResolveFulfilmentExceptionDto',
      'alternativeSource',
      ['lineId', 'alternativeSource', 'approvedBy'],
    ],
  ])('documents the demo-only %s endpoint', (path, body, example, required) => {
    const op = operation(document, path, 'post');

    expect(op.tags).toEqual(['Demo']);
    expect(op.summary).toContain('demo only');
    expect(op.description).toContain('not part of UCP');
    expect(op.parameters).toContainEqual(
      expect.objectContaining({ name: 'orderId', in: 'path', required: true }),
    );
    expect(op.requestBody?.content['application/json'].schema).toEqual({
      $ref: `#/components/schemas/${body}`,
    });
    expect(op.requestBody?.content['application/json'].examples?.[example].value).toMatchObject({
      lineId: 'li_2',
    });
    expect(Object.keys(op.responses).sort()).toEqual(['200', '400', '404', '409', '500']);
    expect(op.responses['200'].content?.['application/json'].schema).toEqual({
      $ref: '#/components/schemas/OrderStateDto',
    });
    for (const status of ['400', '404', '409']) {
      expect(op.responses[status].content?.['application/json'].schema).toEqual({
        $ref: '#/components/schemas/HttpError',
      });
    }
    expect((document.components!.schemas![body] as { required: string[] }).required).toEqual(
      required,
    );
  });

  it('documents the demo-only read-only Order Workflow state endpoint', () => {
    const op = operation(document, '/v1/demo/orders/{orderId}', 'get');

    expect(op.tags).toEqual(['Demo']);
    expect(op.summary).toContain('demo only');
    expect(op.description).toContain('not part of UCP');
    expect(op.requestBody).toBeUndefined();
    expect(op.parameters).toContainEqual(
      expect.objectContaining({ name: 'orderId', in: 'path', required: true }),
    );
    expect(Object.keys(op.responses).sort()).toEqual(['200', '404', '500']);
    expect(op.responses['200'].content?.['application/json'].schema).toEqual({
      $ref: '#/components/schemas/OrderStateDto',
    });
    expect(op.responses['404'].content?.['application/json'].schema).toEqual({
      $ref: '#/components/schemas/HttpError',
    });
  });

  it('documents the Order Workflow state returned by the demo endpoints', () => {
    const state = document.components!.schemas!.OrderStateDto as {
      required: string[];
      properties: Record<string, { enum?: string[] }>;
    };

    expect(state.required).toEqual(expect.arrayContaining(['id', 'status', 'fulfilment']));
    expect(state.properties.status.enum).toEqual([
      'reserving_inventory',
      'confirmed',
      'awaiting_intervention',
      'fulfilled',
    ]);
    expect(document.components!.schemas!.FulfilmentPlanDto).toMatchObject({
      properties: {
        exception: { allOf: [{ $ref: '#/components/schemas/FulfilmentExceptionDto' }] },
        sources: { type: 'array' },
        resolutions: { type: 'array' },
      },
    });
  });

  it('does not forbid unknown properties that the UCP schemas strip', () => {
    expect(JSON.stringify(document.components?.schemas?.CheckoutCompleteRequest)).not.toContain(
      '"additionalProperties":false',
    );
  });

  it('documents the health check responses', () => {
    expect(Object.keys(operation(document, '/health', 'get').responses).sort()).toEqual([
      '200',
      '503',
    ]);
  });

  it('returns a discovery profile matching the documented schema', async () => {
    const res = await app.inject({ method: 'GET', url: '/.well-known/ucp' });

    const result = UcpProfileDocumentSchema.safeParse(res.json());
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it('provides request examples that are valid and complete a checkout', async () => {
    const createExample = operation(document, '/v1/checkout-sessions', 'post').requestBody?.content[
      'application/json'
    ].examples?.checkout.value;
    const completeExample = operation(document, '/v1/checkout-sessions/{id}/complete', 'post')
      .requestBody?.content['application/json'].examples?.payment.value;

    expect(createExample).toEqual(createCheckoutExample);
    expect(completeExample).toEqual(completeCheckoutExample);
    expect(CheckoutCreateRequestSchema.safeParse(createExample).success).toBe(true);
    expect(CheckoutCompleteRequestSchema.safeParse(completeExample).success).toBe(true);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/checkout-sessions',
      payload: createExample,
    });
    expect(created.statusCode).toBe(201);

    const completed = await app.inject({
      method: 'POST',
      url: `/v1/checkout-sessions/${created.json().id}/complete`,
      payload: completeExample,
    });
    expect(completed.statusCode).toBe(200);
    const checkout = CheckoutResponseSchema.parse(completed.json());
    expect(checkout.status).toBe('completed');
  });

  it('provides examples that configure simulated inventory failures for a checkout', async () => {
    const examples = (path: string, method: string) =>
      operation(document, path, method).requestBody?.content['application/json'].examples ?? {};

    const created = await app.inject({
      method: 'POST',
      url: '/v1/checkout-sessions',
      payload: examples('/v1/checkout-sessions', 'post').checkout.value,
    });
    const checkoutId: string = created.json().id;

    const configured = await app.inject({
      method: 'PUT',
      url: `/v1/demo/checkout-sessions/${checkoutId}/inventory-failures`,
      payload: examples('/v1/demo/checkout-sessions/{checkoutId}/inventory-failures', 'put')
        .twoFailures.value,
    });
    expect(configured.statusCode).toBe(200);

    const completed = await app.inject({
      method: 'POST',
      url: `/v1/checkout-sessions/${checkoutId}/complete`,
      payload: examples('/v1/checkout-sessions/{id}/complete', 'post').payment.value,
    });
    expect(CheckoutResponseSchema.parse(completed.json()).status).toBe('completed');
    expect(temporal.startOrderWorkflow).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ demo: { inventoryFailures: 2 } }),
    );
  });
});
