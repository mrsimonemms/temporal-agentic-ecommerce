import { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  OpenAPIObject,
  type ReferenceObject,
  type SchemaObject,
  SwaggerModule,
} from '@nestjs/swagger';
import {
  CheckoutCompleteRequestSchema,
  CheckoutCreateRequestSchema,
  CheckoutResponseSchema,
  ErrorResponseSchema,
  OrderSchema,
  UcpProfileDocumentSchema,
} from '@ucp-js/sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Official UCP schemas exposed as named OpenAPI components. They are converted
// from the @ucp-js/sdk Zod schemas so the documentation cannot drift from the
// schemas used for validation.
const ucpSchemas = {
  UcpProfileDocument: UcpProfileDocumentSchema,
  CheckoutCreateRequest: CheckoutCreateRequestSchema,
  CheckoutCompleteRequest: CheckoutCompleteRequestSchema,
  CheckoutResponse: CheckoutResponseSchema,
  Order: OrderSchema,
  ErrorResponse: ErrorResponseSchema,
};

// Demo-specific schemas that have no UCP equivalent
const apiSchemas = {
  // Body of the HTTP 400 response produced by UcpSchemaPipe
  InvalidRequest: {
    type: 'object',
    required: ['code', 'content'],
    properties: {
      code: { type: 'string', enum: ['invalid_request'] },
      content: {
        type: 'string',
        description: 'Each failing JSON path and its validation message, separated by "; "',
        example: '$.line_items[0].quantity: Number must be greater than or equal to 1',
      },
    },
  },
  // Static body returned by endpoints that are not yet implemented
  Placeholder: {
    type: 'object',
    required: ['hello'],
    properties: {
      hello: { type: 'string', enum: ['world'] },
    },
  },
} satisfies Record<string, SchemaObject>;

export type SchemaName = keyof typeof ucpSchemas | keyof typeof apiSchemas;

export function schemaRef(name: SchemaName): ReferenceObject {
  return { $ref: `#/components/schemas/${name}` };
}

function toOpenApiSchema(schema: Parameters<typeof zodToJsonSchema>[0]): SchemaObject {
  const { $schema: _, ...converted } = zodToJsonSchema(schema, {
    target: 'openApi3',
    // Sub-schemas are inlined so every component is self-contained
    $refStrategy: 'none',
    // Zod strips unknown keys rather than rejecting them, so only strict
    // schemas disallow additional properties
    removeAdditionalStrategy: 'strict',
  }) as SchemaObject & { $schema?: string };

  return converted;
}

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Temporal UCP Reference Architecture')
    .setDescription(
      'A reference architecture for using Temporal and Universal Commerce Protocol in harmony',
    )
    .setExternalDoc(
      'Source code',
      'https://github.com/mrsimonemms/temporal-ucp-reference-architecture',
    )
    .addTag('UCP discovery', 'UCP merchant profile discovery')
    .addTag(
      'UCP checkout',
      'UCP checkout capability REST binding. Business outcomes are returned as UCP responses with HTTP 200 or 201.',
    )
    .addTag('UCP order', 'UCP order capability REST binding')
    .addTag('Order permalink', 'Buyer-facing Order pages linked from `permalink_url`')
    .addTag('Demo', 'Demo-only controls that are not part of UCP')
    .addTag('Health', 'Service health')
    .addTag('Placeholders', 'Demo-specific endpoints that are not yet implemented')
    .build();

  // Every endpoint declares its tags explicitly, so controller names are not
  // added as additional tags
  const document = SwaggerModule.createDocument(app, config, { autoTagControllers: false });

  document.components = {
    ...document.components,
    schemas: {
      ...document.components?.schemas,
      ...Object.fromEntries(
        Object.entries(ucpSchemas).map(([name, schema]) => [name, toOpenApiSchema(schema)]),
      ),
      ...apiSchemas,
    },
  };

  return document;
}

// Serves Swagger UI at /api and the OpenAPI document at /api-json
export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup('api', app, () => createOpenApiDocument(app));
}
