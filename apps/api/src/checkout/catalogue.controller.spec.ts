import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { CheckoutResponseSchema } from '@ucp-js/sdk';

import { TestApp, closeTestApp, createTestApp } from '../../test/app';
import { CATALOGUE_CURRENCY, listProducts } from './catalogue';

describe('CatalogueController', () => {
  let app: NestFastifyApplication;
  let testApp: TestApp;

  beforeEach(async () => {
    testApp = await createTestApp();
    ({ app } = testApp);
  });

  afterEach(() => closeTestApp(testApp));

  async function getCatalogue() {
    const res = await app.inject({ method: 'GET', url: '/v1/catalogue' });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  it('returns every product with prices in GBP minor units', async () => {
    expect(await getCatalogue()).toEqual({
      currency: 'GBP',
      products: [
        {
          id: 'sku_kettle',
          title: 'Stainless Steel Kettle',
          description: '1.7 litre cordless electric kettle',
          unitPrice: 3499,
        },
        {
          id: 'sku_toaster',
          title: 'Four-Slice Toaster',
          description: 'Four-slot electric toaster',
          unitPrice: 4999,
        },
        {
          id: 'sku_mug_set',
          title: 'Stoneware Mug Set (4 pack)',
          description: 'One set of four stoneware mugs',
          unitPrice: 2400,
        },
      ],
    });
  });

  it('is a view of the authoritative catalogue', async () => {
    const catalogue = await getCatalogue();

    expect(catalogue.currency).toBe(CATALOGUE_CURRENCY);
    expect(catalogue.products).toEqual(
      listProducts().map(({ price, ...product }) => ({ ...product, unitPrice: price })),
    );
  });

  it('lists the same prices that checkout charges', async () => {
    const catalogue = await getCatalogue();

    for (const product of catalogue.products) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/checkout-sessions',
        payload: {
          buyer: { email: 'jane@example.com' },
          line_items: [{ item: { id: product.id }, quantity: 2 }],
        },
      });

      const checkout = CheckoutResponseSchema.parse(res.json());
      expect(checkout.currency).toBe(catalogue.currency);
      expect(checkout.line_items[0].item).toMatchObject({
        id: product.id,
        title: product.title,
        price: product.unitPrice,
      });
      expect(checkout.totals).toContainEqual({ type: 'total', amount: 2 * product.unitPrice });
    }
  });

  it('cannot be changed through the returned products', async () => {
    const before = listProducts();

    listProducts()[0].price = 1;

    expect(listProducts()).toEqual(before);
  });

  it('is not advertised as a UCP capability or service', async () => {
    const profile = (await app.inject({ method: 'GET', url: '/.well-known/ucp' })).json();

    expect(JSON.stringify(profile)).not.toContain('catalogue');
    expect(Object.keys(profile.ucp.capabilities).sort()).toEqual([
      'dev.ucp.shopping.checkout',
      'dev.ucp.shopping.fulfillment',
      'dev.ucp.shopping.order',
    ]);
  });
});
