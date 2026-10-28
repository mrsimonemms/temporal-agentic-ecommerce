import { registerAs } from '@nestjs/config';
import { type UcpProfileDocument } from '@ucp-js/sdk';

export default registerAs('ucp', (): UcpProfileDocument => {
  // Latest spec at time of writing
  // @link https://ucp.dev/2026-08-25/specification/overview/
  const ucpVersion = '2026-08-25';

  const schemaUrlEnvvar = process.env.SCHEMA_URL;
  if (!schemaUrlEnvvar || schemaUrlEnvvar === '') {
    throw new Error('SCHEMA_URL must be set');
  }

  const schemaUrl = new URL(schemaUrlEnvvar);

  return {
    ucp: {
      version: ucpVersion,
      capabilities: {
        'dev.ucp.shopping.checkout': [
          {
            version: ucpVersion,
            spec: `https://ucp.dev/${ucpVersion}/specification/shopping/checkout`,
            schema: `https://ucp.dev/${ucpVersion}/schemas/shopping/checkout.json`,
          },
        ],
        'dev.ucp.shopping.fulfillment': [
          {
            version: ucpVersion,
            spec: `https://ucp.dev/${ucpVersion}/specification/shopping/extensions/fulfillment`,
            schema: `https://ucp.dev/${ucpVersion}/schemas/shopping/fulfillment.json`,
            extends: 'dev.ucp.shopping.checkout',
          },
        ],
        'dev.ucp.shopping.order': [
          {
            version: ucpVersion,
            spec: `https://ucp.dev/${ucpVersion}/specification/shopping/order`,
            schema: `https://ucp.dev/${ucpVersion}/schemas/shopping/order.json`,
            config: {
              webhook_url: `${schemaUrl.origin}/v1/webhooks/ucp/orders`,
            },
          },
        ],
      },
      services: {
        'dev.ucp.shopping': [
          {
            version: ucpVersion,
            transport: 'rest',
            spec: `https://ucp.dev/${ucpVersion}/specification/overview`,
            schema: `https://ucp.dev/${ucpVersion}/services/shopping/rest.openapi.json`,
            endpoint: `${schemaUrl.origin}/v1/ucp`, // Our primary UCP endpoint
          },
        ],
      },
      payment_handlers: {
        'com.google.pay': [
          {
            id: 'gpay',
            version: '2026-01-11',
            spec: 'https://pay.google.com/gp/p/ucp/2026-01-11',
            schema: 'https://pay.google.com/gp/p/ucp/2026-01-11/schemas/config.json',
          },
        ],
      },
    },
  } as UcpProfileDocument;
});
