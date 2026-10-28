import { VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { CheckoutResponseSchema, ErrorResponseSchema } from '@ucp-js/sdk';

import ucp from '../config/ucp';
import { CheckoutController } from './checkout.controller';
import { Checkout } from './checkout.schema';
import { UcpController } from './ucp.controller';
import { UcpService } from './ucp.service';

// In-memory stand-in for the Mongoose model, covering the queries the service uses
class FakeCheckoutModel {
  readonly docs = new Map<string, Checkout>();

  async create(doc: Checkout) {
    this.docs.set(doc._id, structuredClone(doc));
    return doc;
  }

  findById(id: string) {
    return this.query(this.docs.get(id) ?? null);
  }

  findOneAndUpdate(filter: { _id: string; status: string }, update: { $set: Partial<Checkout> }) {
    const doc = this.docs.get(filter._id);
    if (!doc || doc.status !== filter.status) {
      return this.query(null);
    }

    const updated = { ...doc, ...structuredClone(update.$set) };
    this.docs.set(updated._id, updated);
    return this.query(updated);
  }

  private query(value: Checkout | null) {
    return { lean: () => ({ exec: async () => structuredClone(value) }) };
  }
}

const buyer = { email: 'jane@example.com', first_name: 'Jane', last_name: 'Doe' };

const payment = {
  instruments: [
    {
      id: 'pi_gpay_5678',
      handler_id: 'gpay',
      type: 'card',
      selected: true,
      display: { brand: 'mastercard', last_digits: '5678' },
      credential: { type: 'PAYMENT_GATEWAY', token: 'examplePaymentMethodToken' },
    },
  ],
};

function expectCheckout(body: unknown) {
  const result = CheckoutResponseSchema.safeParse(body);
  expect(result.error?.issues ?? []).toEqual([]);
  return result.data!;
}

function expectError(body: unknown) {
  const result = ErrorResponseSchema.safeParse(body);
  expect(result.error?.issues ?? []).toEqual([]);
  expect(result.data!.ucp.status).toBe('error');
  return result.data!;
}

describe('CheckoutController', () => {
  let app: NestFastifyApplication;
  let model: FakeCheckoutModel;

  beforeEach(async () => {
    vi.stubEnv('SCHEMA_URL', 'http://localhost:9999');
    model = new FakeCheckoutModel();

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ ignoreEnvFile: true, load: [ucp] })],
      controllers: [UcpController, CheckoutController],
      providers: [UcpService, { provide: getModelToken(Checkout.name), useValue: model }],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  function createCheckout(payload: object) {
    return app.inject({ method: 'POST', url: '/v1/ucp/checkout-sessions', payload });
  }

  function completeCheckout(id: string, payload: object) {
    return app.inject({
      method: 'POST',
      url: `/v1/ucp/checkout-sessions/${id}/complete`,
      payload,
    });
  }

  it('preserves the discovery endpoint', async () => {
    const res = await app.inject({ method: 'GET', url: '/.well-known/ucp' });

    expect(res.statusCode).toBe(200);
    expect(res.json().ucp.version).toBe('2026-08-25');
  });

  describe('create', () => {
    it('creates a checkout ready for completion', async () => {
      const res = await createCheckout({
        buyer,
        line_items: [
          { item: { id: 'sku_kettle' }, quantity: 2 },
          { item: { id: 'sku_toaster' }, quantity: 1 },
        ],
      });

      expect(res.statusCode).toBe(201);
      const checkout = expectCheckout(res.json());
      expect(checkout.status).toBe('ready_for_complete');
      expect(checkout.currency).toBe('GBP');
      expect(checkout.buyer).toEqual(buyer);
      expect(checkout.messages).toBeUndefined();
      expect(checkout.line_items).toEqual([
        {
          id: 'li_1',
          item: { id: 'sku_kettle', title: 'Stainless Steel Kettle', price: 3499 },
          quantity: 2,
          totals: [
            { type: 'subtotal', amount: 6998 },
            { type: 'total', amount: 6998 },
          ],
        },
        {
          id: 'li_2',
          item: { id: 'sku_toaster', title: 'Four-Slice Toaster', price: 4999 },
          quantity: 1,
          totals: [
            { type: 'subtotal', amount: 4999 },
            { type: 'total', amount: 4999 },
          ],
        },
      ]);
      expect(checkout.totals).toEqual([
        { type: 'subtotal', amount: 11997 },
        { type: 'total', amount: 11997 },
      ]);
      expect(checkout.ucp.capabilities).toEqual({
        'dev.ucp.shopping.checkout': [{ version: '2026-08-25' }],
      });
      expect(Object.keys(checkout.ucp.payment_handlers)).toEqual(['com.google.pay']);
      expect(model.docs.get(checkout.id)?.status).toBe('ready_for_complete');
    });

    it('creates an incomplete checkout when the buyer email is missing', async () => {
      const res = await createCheckout({
        line_items: [{ item: { id: 'sku_mug_set' }, quantity: 1 }],
      });

      expect(res.statusCode).toBe(201);
      const checkout = expectCheckout(res.json());
      expect(checkout.status).toBe('incomplete');
      expect(checkout.messages).toEqual([
        {
          type: 'error',
          code: 'missing',
          path: '$.buyer.email',
          content: 'Buyer email is required',
          severity: 'recoverable',
        },
      ]);
    });

    it('rejects a request that does not match the UCP schema', async () => {
      const res = await createCheckout({
        line_items: [{ item: { id: 'sku_kettle' }, quantity: 0 }],
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({
        code: 'invalid_request',
        content: expect.stringContaining('$.line_items[0].quantity'),
      });
      expect(model.docs.size).toBe(0);
    });

    it('rejects a request without line items', async () => {
      const res = await createCheckout({ buyer });

      expect(res.statusCode).toBe(400);
      expect(res.json().content).toContain('$.line_items');
    });

    it('returns an error response without creating a checkout for unknown items', async () => {
      const res = await createCheckout({
        buyer,
        line_items: [
          { item: { id: 'sku_kettle' }, quantity: 1 },
          { item: { id: 'sku_unknown' }, quantity: 1 },
        ],
      });

      expect(res.statusCode).toBe(200);
      expect(expectError(res.json()).messages).toEqual([
        {
          type: 'error',
          code: 'item_unavailable',
          path: '$.line_items[1].item.id',
          content: 'Item "sku_unknown" is not available for purchase',
          severity: 'unrecoverable',
        },
      ]);
      expect(model.docs.size).toBe(0);
    });

    it('returns an error response for an empty line item list', async () => {
      const res = await createCheckout({ buyer, line_items: [] });

      expect(res.statusCode).toBe(200);
      expect(expectError(res.json()).messages[0]).toMatchObject({
        code: 'missing',
        path: '$.line_items',
      });
      expect(model.docs.size).toBe(0);
    });
  });

  describe('get', () => {
    it('retrieves a persisted checkout', async () => {
      const created = (
        await createCheckout({ buyer, line_items: [{ item: { id: 'sku_kettle' }, quantity: 1 }] })
      ).json();

      const res = await app.inject({
        method: 'GET',
        url: `/v1/ucp/checkout-sessions/${created.id}`,
      });

      expect(res.statusCode).toBe(200);
      expect(expectCheckout(res.json())).toEqual(expectCheckout(created));
    });

    it('returns an error response for an unknown checkout', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/ucp/checkout-sessions/chk_missing' });

      expect(res.statusCode).toBe(200);
      expect(expectError(res.json()).messages).toEqual([
        {
          type: 'error',
          code: 'not_found',
          content: 'Checkout "chk_missing" was not found',
          severity: 'unrecoverable',
        },
      ]);
    });
  });

  describe('complete', () => {
    async function readyCheckout(): Promise<string> {
      const res = await createCheckout({
        buyer,
        line_items: [{ item: { id: 'sku_kettle' }, quantity: 1 }],
      });
      return res.json().id;
    }

    it('accepts completion of a ready checkout', async () => {
      const id = await readyCheckout();

      const res = await completeCheckout(id, { payment });

      expect(res.statusCode).toBe(200);
      const checkout = expectCheckout(res.json());
      expect(checkout.status).toBe('complete_in_progress');
      // The order is only present once the checkout is completed
      expect(checkout.order).toBeUndefined();
      expect(checkout.payment).toEqual({
        instruments: [
          {
            id: 'pi_gpay_5678',
            handler_id: 'gpay',
            type: 'card',
            selected: true,
            display: { brand: 'mastercard', last_digits: '5678' },
          },
        ],
      });

      const stored = model.docs.get(id)!;
      expect(stored.status).toBe('complete_in_progress');
      expect(stored.payment).toEqual({
        instrumentId: 'pi_gpay_5678',
        handlerId: 'gpay',
        type: 'card',
        display: { brand: 'mastercard', last_digits: '5678' },
      });
      expect(JSON.stringify(stored)).not.toContain('examplePaymentMethodToken');
    });

    it('does not complete an incomplete checkout', async () => {
      const created = (
        await createCheckout({ line_items: [{ item: { id: 'sku_kettle' }, quantity: 1 }] })
      ).json();

      const res = await completeCheckout(created.id, { payment });

      expect(res.statusCode).toBe(200);
      const checkout = expectCheckout(res.json());
      expect(checkout.status).toBe('incomplete');
      expect(checkout.messages?.[0]).toMatchObject({ code: 'missing', path: '$.buyer.email' });
      expect(model.docs.get(created.id)?.status).toBe('incomplete');
    });

    it('rejects a new completion while completion is in progress', async () => {
      const id = await readyCheckout();
      await completeCheckout(id, { payment });

      const res = await completeCheckout(id, { payment });

      expect(res.statusCode).toBe(200);
      const checkout = expectCheckout(res.json());
      expect(checkout.status).toBe('complete_in_progress');
      expect(checkout.messages).toEqual([
        {
          type: 'error',
          code: 'operation_not_allowed',
          content: 'Checkout cannot be completed while its status is "complete_in_progress"',
          severity: 'recoverable',
        },
      ]);
    });

    it('rejects completion with an unsupported payment handler', async () => {
      const id = await readyCheckout();

      const res = await completeCheckout(id, {
        payment: { instruments: [{ ...payment.instruments[0], handler_id: 'unknown' }] },
      });

      expect(res.statusCode).toBe(200);
      const checkout = expectCheckout(res.json());
      expect(checkout.status).toBe('ready_for_complete');
      expect(checkout.messages).toEqual([
        {
          type: 'error',
          code: 'payment_failed',
          path: '$.payment.instruments[0].handler_id',
          content: 'Payment handler "unknown" is not supported',
          severity: 'recoverable',
        },
      ]);
      expect(model.docs.get(id)?.status).toBe('ready_for_complete');
    });

    it('rejects completion without a selected payment instrument', async () => {
      const id = await readyCheckout();

      const res = await completeCheckout(id, { payment: { instruments: [] } });

      expect(res.statusCode).toBe(200);
      const checkout = expectCheckout(res.json());
      expect(checkout.status).toBe('ready_for_complete');
      expect(checkout.messages?.[0]).toMatchObject({
        code: 'missing',
        path: '$.payment.instruments',
      });
    });

    it('rejects a request that does not match the UCP schema', async () => {
      const id = await readyCheckout();

      const res = await completeCheckout(id, {});

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({
        code: 'invalid_request',
        content: expect.stringContaining('$.payment'),
      });
      expect(model.docs.get(id)?.status).toBe('ready_for_complete');
    });

    it('returns an error response for an unknown checkout', async () => {
      const res = await completeCheckout('chk_missing', { payment });

      expect(res.statusCode).toBe(200);
      expect(expectError(res.json()).messages[0]).toMatchObject({ code: 'not_found' });
    });
  });
});
