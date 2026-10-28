import { toOrderInput } from './checkout.mapper';
import { Checkout } from './checkout.schema';

const checkout: Checkout = {
  _id: 'chk_0b6f7c1e-3f0a-4d2b-9a57-2f1c8e0d4b11',
  status: 'complete_in_progress',
  currency: 'GBP',
  buyer: { email: 'jane@example.com', firstName: 'Jane', lastName: 'Doe', phoneNumber: '+44' },
  lineItems: [
    {
      id: 'li_1',
      productId: 'sku_kettle',
      title: 'Stainless Steel Kettle',
      unitPrice: 3499,
      quantity: 2,
    },
  ],
  payment: { instrumentId: 'pi_1', handlerId: 'gpay', type: 'card' },
};

describe('toOrderInput', () => {
  // The serialised form is what the Go worker decodes, so this asserts the
  // exact JSON field names and types of the Go OrderInput struct
  it('serialises to the Go OrderInput JSON shape', () => {
    expect(JSON.parse(JSON.stringify(toOrderInput(checkout)))).toStrictEqual({
      id: 'ord_0b6f7c1e-3f0a-4d2b-9a57-2f1c8e0d4b11',
      buyer: { name: 'Jane Doe', email: 'jane@example.com' },
      currency: 'GBP',
      lines: [
        {
          id: 'li_1',
          productId: 'sku_kettle',
          title: 'Stainless Steel Kettle',
          quantity: 2,
          unitPrice: 3499,
        },
      ],
    });
  });

  it('omits the buyer name when none was provided', () => {
    const input = toOrderInput({ ...checkout, buyer: { email: 'jane@example.com' } });

    expect(JSON.parse(JSON.stringify(input.buyer))).toStrictEqual({ email: 'jane@example.com' });
  });

  it('uses a partial buyer name', () => {
    const input = toOrderInput({
      ...checkout,
      buyer: { email: 'jane@example.com', lastName: 'Doe' },
    });

    expect(input.buyer.name).toBe('Doe');
  });

  it('rejects a checkout without a buyer email', () => {
    expect(() => toOrderInput({ ...checkout, buyer: undefined })).toThrow(
      `Checkout "${checkout._id}" has no buyer email`,
    );
  });

  it('passes configured inventory failures to the Go DemoOptions', () => {
    const input = toOrderInput({ ...checkout, demo: { inventoryFailures: 2 } });

    expect(JSON.parse(JSON.stringify(input)).demo).toStrictEqual({ inventoryFailures: 2 });
  });

  it('omits demo options when no failures are configured', () => {
    expect(JSON.parse(JSON.stringify(toOrderInput(checkout)))).not.toHaveProperty('demo');
    expect(
      JSON.parse(JSON.stringify(toOrderInput({ ...checkout, demo: { inventoryFailures: 0 } }))),
    ).not.toHaveProperty('demo');
  });
});
