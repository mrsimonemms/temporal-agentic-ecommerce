import { OrderInput } from '../temporal/order-workflow';
import { Checkout } from './checkout.schema';

// Each checkout places at most one Order, so the Order ID is derived from the
// checkout ID. Repeating completion therefore always targets the same Order.
export function orderIdForCheckout(checkoutId: string): string {
  return `ord_${checkoutId.replace(/^chk_/, '')}`;
}

// Maps a checkout into the protocol-agnostic Order Workflow input
export function toOrderInput(checkout: Checkout): OrderInput {
  const email = checkout.buyer?.email;
  if (!email) {
    throw new Error(`Checkout "${checkout._id}" has no buyer email`);
  }

  const name = [checkout.buyer?.firstName, checkout.buyer?.lastName]
    .filter((part) => !!part)
    .join(' ');

  return {
    id: orderIdForCheckout(checkout._id),
    buyer: {
      name: name || undefined,
      email,
    },
    currency: checkout.currency,
    lines: checkout.lineItems.map((lineItem) => ({
      id: lineItem.id,
      productId: lineItem.productId,
      title: lineItem.title,
      quantity: lineItem.quantity,
      unitPrice: lineItem.unitPrice,
    })),
  };
}
