import { OrderSchema } from '@ucp-js/sdk';

import { Order } from '../temporal/order-workflow';
import { Checkout } from './checkout.schema';
import { checkoutIdForOrder, orderIdForCheckout, toOrderInput, toUcpOrder } from './order.mapper';

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

describe('checkoutIdForOrder', () => {
  it('reverses orderIdForCheckout', () => {
    expect(checkoutIdForOrder(orderIdForCheckout(checkout._id))).toBe(checkout._id);
  });

  it.each(['chk_123', 'ord_', 'order-123', ''])('rejects "%s"', (id) => {
    expect(checkoutIdForOrder(id)).toBeUndefined();
  });
});

describe('toUcpOrder', () => {
  const order: Order = {
    id: 'ord_123',
    status: 'confirmed',
    buyer: { email: 'jane@example.com' },
    currency: 'GBP',
    lines: [
      { id: 'li_1', productId: 'sku_kettle', title: 'Kettle', quantity: 2, unitPrice: 3499 },
      { id: 'li_2', productId: 'sku_untitled', quantity: 1, unitPrice: 0 },
    ],
    total: 6998,
    createdAt: '2026-10-28T12:00:00Z',
  };

  const map = (o: Order) => toUcpOrder(o, 'https://merchant.example/orders/ord_123', '2026-08-25');

  it('produces a valid UCP Order', () => {
    const result = OrderSchema.safeParse(map(order));

    expect(result.error?.issues ?? []).toEqual([]);
  });

  it('reports confirmed lines as processing with nothing fulfilled', () => {
    const ucpOrder = map(order);

    expect(ucpOrder.checkout_id).toBe('chk_123');
    expect(ucpOrder.line_items.map((l) => [l.status, l.quantity])).toEqual([
      ['processing', { original: 2, total: 2, fulfilled: 0 }],
      ['processing', { original: 1, total: 1, fulfilled: 0 }],
    ]);
  });

  it('reports every line of a fulfilled Order as fully fulfilled', () => {
    const ucpOrder = map({ ...order, status: 'fulfilled', fulfilledAt: '2026-10-28T15:00:00Z' });

    expect(OrderSchema.safeParse(ucpOrder).success).toBe(true);
    expect(ucpOrder.line_items.map((l) => [l.status, l.quantity])).toEqual([
      ['fulfilled', { original: 2, total: 2, fulfilled: 2 }],
      ['fulfilled', { original: 1, total: 1, fulfilled: 1 }],
    ]);
    expect(ucpOrder.fulfillment).toEqual({ expectations: [], events: [] });
  });

  it('falls back to the product ID when a line has no title', () => {
    expect(map(order).line_items[1].item.title).toBe('sku_untitled');
  });

  it('rejects an Order that was not placed by a UCP checkout', () => {
    expect(() => map({ ...order, id: 'other-123' })).toThrow(
      'Order "other-123" was not placed by a UCP checkout',
    );
  });
});
