// Contract for the Go OrderWorkflow in workers/order. Field names and types
// must match the JSON tags of the Go structs in
// workers/order/internal/app/workflows/order.go.

export const ORDER_WORKFLOW_TYPE = 'OrderWorkflow';

// Matches app.TaskQueue in workers/order/internal/app/constants.go
export const ORDER_TASK_QUEUE = 'order-management';

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
