// Contract for the Go OrderWorkflow in workers/order. Field names and types
// must match the JSON tags of the Go structs in
// workers/order/internal/app/workflows/order.go.

export const ORDER_WORKFLOW_TYPE = 'OrderWorkflow';

// Matches app.TaskQueue in workers/order/internal/app/constants.go
export const ORDER_TASK_QUEUE = 'order-management';

// Matches workflows.QueryGetOrder
export const ORDER_QUERY_GET_ORDER = 'getOrder';

// Matches workflows.SignalMarkFulfilled
export const ORDER_SIGNAL_MARK_FULFILLED = 'markFulfilled';

export interface OrderBuyer {
  id?: string;
  name?: string;
  email: string;
}

// Prices are integers in the minor unit of the Order currency
export interface OrderLine {
  id: string;
  productId: string;
  title?: string;
  quantity: number;
  unitPrice: number;
}

export interface OrderInput {
  id: string;
  buyer: OrderBuyer;
  currency: string;
  lines: OrderLine[];
}

// Matches workflows.OrderStatus
export type OrderStatus = 'confirmed' | 'fulfilled';

// Current Order state returned by the getOrder Query. Timestamps are RFC 3339
// strings as serialised by Go.
export interface Order {
  id: string;
  status: OrderStatus;
  buyer: OrderBuyer;
  currency: string;
  lines: OrderLine[];
  total: number;
  createdAt: string;
  fulfilledAt?: string;
}
