import { orderIdForCheckout } from '../order/order.mapper';
import { OrderInput } from '../temporal/order-workflow';
import { Checkout } from './checkout.schema';

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
    // Omitted unless failures are configured, matching the Go default of none
    demo: checkout.demo?.inventoryFailures
      ? { inventoryFailures: checkout.demo.inventoryFailures }
      : undefined,
  };
}
