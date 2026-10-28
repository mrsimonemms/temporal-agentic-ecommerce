import { type Order as UcpOrder } from '@ucp-js/sdk';

import { Order } from '../temporal/order-workflow';

const CHECKOUT_ID_PREFIX = 'chk_';
const ORDER_ID_PREFIX = 'ord_';

// Each checkout places at most one Order, so the Order ID is derived from the
// checkout ID. Repeating completion therefore always targets the same Order.
export function orderIdForCheckout(checkoutId: string): string {
  return `${ORDER_ID_PREFIX}${checkoutId.replace(/^chk_/, '')}`;
}

// Reverses orderIdForCheckout. Returns undefined for IDs that cannot have been
// issued for a UCP checkout.
export function checkoutIdForOrder(orderId: string): string | undefined {
  if (!orderId.startsWith(ORDER_ID_PREFIX) || orderId.length === ORDER_ID_PREFIX.length) {
    return undefined;
  }
  return `${CHECKOUT_ID_PREFIX}${orderId.slice(ORDER_ID_PREFIX.length)}`;
}

// Maps the internal Order state into a UCP Order. Fulfilment progress is
// expressed through each line item's status and fulfilled quantity. No
// fulfilment events are reported because no carrier or tracking information
// exists, which UCP requires for events other than processing.
export function toUcpOrder(order: Order, permalinkUrl: string, ucpVersion: string): UcpOrder {
  const checkoutId = checkoutIdForOrder(order.id);
  if (!checkoutId) {
    throw new Error(`Order "${order.id}" was not placed by a UCP checkout`);
  }

  const fulfilled = order.status === 'fulfilled';

  return {
    ucp: {
      version: ucpVersion,
      capabilities: {
        'dev.ucp.shopping.order': [{ version: ucpVersion }],
      },
    },
    id: order.id,
    checkout_id: checkoutId,
    permalink_url: permalinkUrl,
    currency: order.currency,
    line_items: order.lines.map((line) => {
      const amount = line.unitPrice * line.quantity;
      return {
        id: line.id,
        item: {
          id: line.productId,
          title: line.title ?? line.productId,
          price: line.unitPrice,
        },
        quantity: {
          original: line.quantity,
          total: line.quantity,
          fulfilled: fulfilled ? line.quantity : 0,
        },
        status: fulfilled ? 'fulfilled' : 'processing',
        totals: [
          { type: 'subtotal', amount },
          { type: 'total', amount },
        ],
      };
    }),
    fulfillment: {
      expectations: [],
      events: [],
    },
    totals: [
      { type: 'subtotal', amount: order.total },
      { type: 'total', amount: order.total },
    ],
  };
}
