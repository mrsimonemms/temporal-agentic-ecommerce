import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { CheckoutResponseSchema } from '@ucp-js/sdk';

import { TestApp, closeTestApp, createTestApp } from '../../test/app';
import { FakeCheckoutModel, FakeTemporalService } from '../../test/fakes';
import { completeCheckoutExample } from '../checkout/checkout.examples';
import { orderIdForCheckout } from '../order/order.mapper';

describe('DemoController inventory failures', () => {
  let app: NestFastifyApplication;
  let model: FakeCheckoutModel;
  let temporal: FakeTemporalService;
  let testApp: TestApp;

  beforeEach(async () => {
    testApp = await createTestApp();
    ({ app, model, temporal } = testApp);
  });

  afterEach(() => closeTestApp(testApp));

  async function createCheckout({ withBuyer = true } = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/checkout-sessions',
      payload: {
        buyer: withBuyer ? { email: 'jane@example.com' } : undefined,
        line_items: [{ item: { id: 'sku_kettle' }, quantity: 1 }],
      },
    });
    return res.json().id as string;
  }

  function configure(checkoutId: string, payload: unknown) {
    return app.inject({
      method: 'PUT',
      url: `/v1/demo/checkout-sessions/${checkoutId}/inventory-failures`,
      payload: payload as object,
    });
  }

  function complete(checkoutId: string) {
    return app.inject({
      method: 'POST',
      url: `/v1/checkout-sessions/${checkoutId}/complete`,
      payload: completeCheckoutExample,
    });
  }

  // The OrderInput sent to Temporal when the checkout was completed
  function orderInputFor(checkoutId: string) {
    const call = temporal.startOrderWorkflow.mock.calls.find(
      ([input]) => input.id === orderIdForCheckout(checkoutId),
    );
    expect(call).toBeDefined();
    return call![0];
  }

  it('places Orders without simulated failures by default', async () => {
    const id = await createCheckout();

    expect((await complete(id)).json().status).toBe('completed');

    expect(orderInputFor(id).demo).toBeUndefined();
    expect(model.docs.get(id)?.demo).toBeUndefined();
  });

  it('configures two failures for a checkout and passes them to the Order Workflow', async () => {
    const id = await createCheckout();

    const res = await configure(id, { failures: 2 });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ checkoutId: id, failures: 2 });
    expect(model.docs.get(id)?.demo).toEqual({ inventoryFailures: 2 });

    expect((await complete(id)).json().status).toBe('completed');
    expect(orderInputFor(id).demo).toEqual({ inventoryFailures: 2 });
  });

  it('resets the configuration with zero failures', async () => {
    const id = await createCheckout();
    await configure(id, { failures: 2 });

    const res = await configure(id, { failures: 0 });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ checkoutId: id, failures: 0 });
    await complete(id);
    expect(orderInputFor(id).demo).toBeUndefined();
  });

  it('applies the configuration only to the configured checkout', async () => {
    const configured = await createCheckout();
    const other = await createCheckout();
    await configure(configured, { failures: 2 });

    await complete(other);
    await complete(configured);

    expect(orderInputFor(configured).demo).toEqual({ inventoryFailures: 2 });
    expect(orderInputFor(other).demo).toBeUndefined();
    expect(model.docs.get(other)?.demo).toBeUndefined();
  });

  it('can be configured before the buyer details are complete', async () => {
    const id = await createCheckout({ withBuyer: false });

    const res = await configure(id, { failures: 1 });

    expect(res.statusCode).toBe(200);
    expect(model.docs.get(id)?.status).toBe('incomplete');
  });

  it.each([
    ['negative', { failures: -1 }],
    ['fractional', { failures: 1.5 }],
    ['a string', { failures: '2' }],
    ['null', { failures: null }],
    ['missing', {}],
    ['above the Go int32 range', { failures: 2_147_483_648 }],
  ])('rejects a failure count that is %s', async (_, payload) => {
    const id = await createCheckout();

    const res = await configure(id, payload);

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ statusCode: 400, error: 'Bad Request' });
    expect(model.docs.get(id)?.demo).toBeUndefined();
  });

  it('rejects changes once the checkout is completed', async () => {
    const id = await createCheckout();
    await complete(id);

    const res = await configure(id, { failures: 2 });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      statusCode: 409,
      error: 'Conflict',
      message: 'Inventory failures cannot be configured while the checkout status is "completed"',
    });
    expect(model.docs.get(id)?.demo).toBeUndefined();
  });

  it('rejects changes while completion is in progress', async () => {
    const id = await createCheckout();
    await configure(id, { failures: 2 });
    // The Order Workflow could not be started, leaving completion in progress
    temporal.startOrderWorkflow.mockRejectedValueOnce(new Error('Temporal unavailable'));
    expect((await complete(id)).json().status).toBe('complete_in_progress');

    const res = await configure(id, { failures: 0 });

    expect(res.statusCode).toBe(409);
    expect(model.docs.get(id)?.demo).toEqual({ inventoryFailures: 2 });
  });

  it('returns 404 for an unknown checkout', async () => {
    const res = await configure('chk_missing', { failures: 2 });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'Checkout "chk_missing" was not found',
    });
  });

  it('does not expose the configuration through the UCP checkout', async () => {
    const id = await createCheckout();
    await configure(id, { failures: 2 });

    const res = await app.inject({ method: 'GET', url: `/v1/checkout-sessions/${id}` });

    const checkout = res.json();
    expect(CheckoutResponseSchema.safeParse(checkout).success).toBe(true);
    expect(JSON.stringify(checkout)).not.toMatch(/demo|failures/i);
  });
});
