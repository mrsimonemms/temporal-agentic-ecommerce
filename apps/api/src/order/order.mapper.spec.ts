import { OrderSchema } from '@ucp-js/sdk';

import { Order } from '../temporal/order-workflow';
import { checkoutIdForOrder, orderIdForCheckout, toUcpOrder } from './order.mapper';

const checkoutId = 'chk_0b6f7c1e-3f0a-4d2b-9a57-2f1c8e0d4b11';

describe('orderIdForCheckout', () => {
  it('derives a stable Order ID from the checkout ID', () => {
    expect(orderIdForCheckout(checkoutId)).toBe('ord_0b6f7c1e-3f0a-4d2b-9a57-2f1c8e0d4b11');
    expect(orderIdForCheckout(checkoutId)).toBe(orderIdForCheckout(checkoutId));
  });

  it('gives different checkouts different Order IDs', () => {
    expect(orderIdForCheckout('chk_a')).not.toBe(orderIdForCheckout('chk_b'));
  });
});

describe('checkoutIdForOrder', () => {
  it('reverses orderIdForCheckout', () => {
    expect(checkoutIdForOrder(orderIdForCheckout(checkoutId))).toBe(checkoutId);
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

  it('reports an Order still reserving inventory as processing', () => {
    const ucpOrder = map({ ...order, status: 'reserving_inventory' });

    expect(OrderSchema.safeParse(ucpOrder).success).toBe(true);
    expect(ucpOrder.line_items.map((l) => [l.status, l.quantity])).toEqual([
      ['processing', { original: 2, total: 2, fulfilled: 0 }],
      ['processing', { original: 1, total: 1, fulfilled: 0 }],
    ]);
    // The internal Workflow status is not exposed through UCP
    expect(JSON.stringify(ucpOrder)).not.toContain('reserving_inventory');
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
