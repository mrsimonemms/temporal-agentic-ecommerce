import { Checkout } from './checkout.schema';
import { orderIdForCheckout, toOrderInput } from './order.mapper';

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

describe('orderIdForCheckout', () => {
  it('derives a stable Order ID from the checkout ID', () => {
    expect(orderIdForCheckout(checkout._id)).toBe('ord_0b6f7c1e-3f0a-4d2b-9a57-2f1c8e0d4b11');
    expect(orderIdForCheckout(checkout._id)).toBe(orderIdForCheckout(checkout._id));
  });

  it('gives different checkouts different Order IDs', () => {
    expect(orderIdForCheckout('chk_a')).not.toBe(orderIdForCheckout('chk_b'));
  });
});

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
});
