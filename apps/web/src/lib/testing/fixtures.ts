import type { CheckoutResponse, Order } from '@ucp-js/sdk';

import type { OrderState } from '../demo';

// Responses shaped like those returned by apps/api for the demo catalogue

export function checkoutFixture(overrides: Partial<CheckoutResponse> = {}): CheckoutResponse {
  return {
    ucp: {
      version: '2026-08-25',
      capabilities: { 'dev.ucp.shopping.checkout': [{ version: '2026-08-25' }] },
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
    id: 'chk_123',
    status: 'ready_for_complete',
    currency: 'GBP',
    buyer: { email: 'jane@example.com', first_name: 'Jane', last_name: 'Doe' },
    line_items: [
      {
        id: 'li_1',
        item: { id: 'sku_kettle', title: 'Stainless Steel Kettle', price: 3499 },
        quantity: 1,
        totals: [
          { type: 'subtotal', amount: 3499 },
          { type: 'total', amount: 3499 },
        ],
      },
      {
        id: 'li_2',
        item: { id: 'sku_mug_set', title: 'Stoneware Mug Set (4 pack)', price: 2400 },
        quantity: 2,
        totals: [
          { type: 'subtotal', amount: 4800 },
          { type: 'total', amount: 4800 },
        ],
      },
    ],
    totals: [
      { type: 'subtotal', amount: 8299 },
      { type: 'total', amount: 8299 },
    ],
    links: [],
    ...overrides,
  } as CheckoutResponse;
}

export function orderFixture(
  status: 'processing' | 'fulfilled' = 'processing',
  overrides: Partial<Order> = {},
): Order {
  const fulfilled = status === 'fulfilled';
  const line = (id: string, sku: string, title: string, price: number, quantity: number) => ({
    id,
    item: { id: sku, title, price },
    quantity: { original: quantity, total: quantity, fulfilled: fulfilled ? quantity : 0 },
    status,
    totals: [
      { type: 'subtotal', amount: price * quantity },
      { type: 'total', amount: price * quantity },
    ],
  });

  return {
    ucp: {
      version: '2026-08-25',
      capabilities: { 'dev.ucp.shopping.order': [{ version: '2026-08-25' }] },
    },
    id: 'ord_123',
    checkout_id: 'chk_123',
    permalink_url: 'http://localhost:9999/orders/ord_123',
    currency: 'GBP',
    line_items: [
      line('li_1', 'sku_kettle', 'Stainless Steel Kettle', 3499, 1),
      line('li_2', 'sku_mug_set', 'Stoneware Mug Set (4 pack)', 2400, 2),
    ],
    fulfillment: { expectations: [], events: [] },
    totals: [
      { type: 'subtotal', amount: 8299 },
      { type: 'total', amount: 8299 },
    ],
    ...overrides,
  } as Order;
}

// Internal Order Workflow state as returned by the demo endpoints
export function orderStateFixture(overrides: Partial<OrderState> = {}): OrderState {
  return {
    id: 'ord_123',
    status: 'confirmed',
    buyer: { name: 'Jane Doe', email: 'jane@example.com' },
    currency: 'GBP',
    lines: [
      {
        id: 'li_1',
        productId: 'sku_kettle',
        title: 'Stainless Steel Kettle',
        quantity: 1,
        unitPrice: 3499,
      },
      {
        id: 'li_2',
        productId: 'sku_mug_set',
        title: 'Stoneware Mug Set (4 pack)',
        quantity: 2,
        unitPrice: 2400,
      },
    ],
    total: 8299,
    createdAt: '2026-10-28T15:00:00Z',
    inventoryReservationId: 'res_ord_123',
    fulfilment: {},
    ...overrides,
  };
}

export const exceptionFixture = {
  lineId: 'li_2',
  reason: 'Supplier reports the item is unavailable at the selected warehouse',
  raisedAt: '2026-10-28T15:01:00Z',
};

export const resolutionFixture = {
  lineId: 'li_2',
  reason: exceptionFixture.reason,
  decision: 'alternative_source' as const,
  alternativeSource: 'warehouse-north',
  approvedBy: 'ops@example.com',
  note: 'Same item, ships a day later',
  raisedAt: exceptionFixture.raisedAt,
  resolvedAt: '2026-10-28T15:02:00Z',
};
