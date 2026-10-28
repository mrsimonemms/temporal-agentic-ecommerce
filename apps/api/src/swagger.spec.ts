import { VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { OpenAPIObject } from '@nestjs/swagger';
import { HealthCheckService, MongooseHealthIndicator } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import {
  CheckoutCompleteRequestSchema,
  CheckoutCreateRequestSchema,
  CheckoutResponseSchema,
  UcpProfileDocumentSchema,
} from '@ucp-js/sdk';

import { FakeCheckoutModel, FakeTemporalService } from '../test/fakes';
import ucp from './config/ucp';
import { HealthController } from './health/health.controller';
import { createOpenApiDocument, setupSwagger } from './swagger';
import { TemporalService } from './temporal/temporal.service';
import { CheckoutController } from './ucp/checkout.controller';
import { completeCheckoutExample, createCheckoutExample } from './ucp/checkout.examples';
import { Checkout } from './ucp/checkout.schema';
import { DemoController } from './ucp/demo.controller';
import { OrderController } from './ucp/order.controller';
import { UcpController } from './ucp/ucp.controller';
import { UcpService } from './ucp/ucp.service';

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

  beforeEach(async () => {
    vi.stubEnv('SCHEMA_URL', 'http://localhost:9999');
    temporal = new FakeTemporalService();

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ ignoreEnvFile: true, load: [ucp] })],
      controllers: [
        UcpController,
        CheckoutController,
        OrderController,
        DemoController,
        HealthController,
      ],
      providers: [
        UcpService,
        { provide: getModelToken(Checkout.name), useValue: new FakeCheckoutModel() },
        { provide: TemporalService, useValue: temporal },
        {
          provide: HealthCheckService,
          useValue: { check: async () => ({ status: 'ok', info: {}, error: {}, details: {} }) },
        },
        { provide: MongooseHealthIndicator, useValue: {} },
      ],
    }).compile();

    // Matches the versioning configured in main.ts
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    setupSwagger(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    document = createOpenApiDocument(app);
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  const endpoints = [
    ['/.well-known/ucp', 'get'],
    ['/health', 'get'],
    ['/orders/{id}', 'get'],
    ['/v1/demo/orders/{id}/fulfil', 'post'],
    ['/v1/ucp', 'get'],
    ['/v1/ucp/checkout-sessions', 'post'],
    ['/v1/ucp/checkout-sessions/{id}', 'get'],
    ['/v1/ucp/checkout-sessions/{id}/complete', 'post'],
    ['/v1/ucp/orders/{id}', 'get'],
    ['/v1/webhooks/ucp/orders', 'post'],
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

  it.each(endpoints)('routes %s %s to an implemented handler', async (path, method) => {
    // The Order permalink returns 404 for unknown Orders, so an Order exists
    await temporal.startOrderWorkflow({
      id: 'ord_123',
      buyer: { email: 'jane@example.com' },
      currency: 'GBP',
      lines: [{ id: 'li_1', productId: 'sku_kettle', quantity: 1, unitPrice: 3499 }],
    });

    const res = await app.inject({
      method: method.toUpperCase() as 'GET' | 'POST',
      url: path.replace('{id}', path.includes('orders') ? 'ord_123' : 'chk_missing'),
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

    for (const ref of collectRefs(document.paths)) {
      expect(ref).toMatch(/^#\/components\/schemas\//);
      expect(schemas).toHaveProperty([ref.replace('#/components/schemas/', '')]);
    }
    // Components are self-contained so they can be reused without rewriting
    expect(collectRefs(schemas)).toEqual([]);
  });

  it('documents UCP request bodies and responses using the SDK schemas', () => {
    const create = operation(document, '/v1/ucp/checkout-sessions', 'post');
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

    const complete = operation(document, '/v1/ucp/checkout-sessions/{id}/complete', 'post');
    expect(complete.requestBody?.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/CheckoutCompleteRequest',
    });
    expect(complete.parameters).toContainEqual(
      expect.objectContaining({ name: 'id', in: 'path', required: true }),
    );
    // Completion always returns HTTP 200, never the default 201 for POST
    expect(Object.keys(complete.responses).sort()).toEqual(['200', '400', '500']);
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

  it('documents Order retrieval using the SDK Order schema', () => {
    const getOrder = operation(document, '/v1/ucp/orders/{id}', 'get');

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
    const createExample = operation(document, '/v1/ucp/checkout-sessions', 'post').requestBody
      ?.content['application/json'].examples?.checkout.value;
    const completeExample = operation(document, '/v1/ucp/checkout-sessions/{id}/complete', 'post')
      .requestBody?.content['application/json'].examples?.payment.value;

    expect(createExample).toEqual(createCheckoutExample);
    expect(completeExample).toEqual(completeCheckoutExample);
    expect(CheckoutCreateRequestSchema.safeParse(createExample).success).toBe(true);
    expect(CheckoutCompleteRequestSchema.safeParse(completeExample).success).toBe(true);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/ucp/checkout-sessions',
      payload: createExample,
    });
    expect(created.statusCode).toBe(201);

    const completed = await app.inject({
      method: 'POST',
      url: `/v1/ucp/checkout-sessions/${created.json().id}/complete`,
      payload: completeExample,
    });
    expect(completed.statusCode).toBe(200);
    const checkout = CheckoutResponseSchema.parse(completed.json());
    expect(checkout.status).toBe('completed');
  });
});
