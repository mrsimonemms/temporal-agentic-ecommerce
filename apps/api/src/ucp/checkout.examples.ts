import type { CheckoutCompleteRequest, CheckoutCreateRequest } from '@ucp-js/sdk';

// Request examples shown in the OpenAPI documentation. Item IDs must exist in
// the demo catalogue so the examples can be sent as-is from Swagger UI.

export const createCheckoutExample: CheckoutCreateRequest = {
  buyer: {
    email: 'jane@example.com',
    first_name: 'Jane',
    last_name: 'Doe',
  },
  line_items: [
    { item: { id: 'sku_kettle' }, quantity: 1 },
    { item: { id: 'sku_mug_set' }, quantity: 2 },
  ],
};

export const completeCheckoutExample: CheckoutCompleteRequest = {
  payment: {
    instruments: [
      {
        id: 'pi_gpay_5678',
        handler_id: 'gpay',
        type: 'card',
        selected: true,
        display: { brand: 'mastercard', last_digits: '5678' },
        credential: { type: 'PAYMENT_GATEWAY' },
      },
    ],
  },
};
