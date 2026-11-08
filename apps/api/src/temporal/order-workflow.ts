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

// Matches workflows.SignalReportFulfilmentException
export const ORDER_SIGNAL_REPORT_FULFILMENT_EXCEPTION = 'reportFulfilmentException';

// Matches workflows.UpdateResolveFulfilmentException
export const ORDER_UPDATE_RESOLVE_FULFILMENT_EXCEPTION = 'resolveFulfilmentException';

// Matches workflows.errTypeInvalidResolution, the type of a rejected resolution
export const ORDER_ERROR_INVALID_FULFILMENT_RESOLUTION = 'InvalidFulfilmentResolution';

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

// Demo-only controls for simulating downstream behaviour. Not part of the
// commercial Order.
export interface OrderDemoOptions {
  // Number of inventory reservation attempts that fail before succeeding.
  // The Go field is an int32.
  inventoryFailures?: number;
}

export interface OrderInput {
  id: string;
  buyer: OrderBuyer;
  currency: string;
  lines: OrderLine[];
  demo?: OrderDemoOptions;
}

// Matches workflows.OrderStatus
export type OrderStatus =
  'reserving_inventory' | 'confirmed' | 'awaiting_intervention' | 'fulfilled';

// Matches workflows.FulfilmentDecision
export type FulfilmentDecision = 'alternative_source';

// Matches workflows.FulfilmentSource
export interface FulfilmentSource {
  lineId: string;
  source: string;
}

// Matches workflows.FulfilmentException
export interface FulfilmentException {
  lineId: string;
  reason: string;
  raisedAt: string;
}

// Matches workflows.FulfilmentResolution
export interface FulfilmentResolution {
  lineId: string;
  reason: string;
  decision: FulfilmentDecision;
  alternativeSource: string;
  approvedBy: string;
  note?: string;
  raisedAt: string;
  resolvedAt: string;
}

// Matches workflows.FulfilmentPlan: how the Order is fulfilled, separate from
// what was purchased
export interface FulfilmentPlan {
  sources?: FulfilmentSource[];
  exception?: FulfilmentException;
  resolutions?: FulfilmentResolution[];
}

// Matches workflows.ReportFulfilmentExceptionSignal
export interface ReportFulfilmentExceptionSignal {
  lineId: string;
  reason: string;
}

// Matches workflows.ResolveFulfilmentExceptionRequest
export interface ResolveFulfilmentExceptionRequest {
  lineId: string;
  alternativeSource: string;
  approvedBy: string;
  note?: string;
}

// An Update rejected by the Order Workflow's validator, carrying its reason
export class OrderUpdateRejectedError extends Error {
  constructor(
    message: string,
    readonly type?: string,
  ) {
    super(message);
    this.name = 'OrderUpdateRejectedError';
  }
}

// Order state returned by the getOrder Query while the Order Workflow runs,
// and as its result once fulfilment completes it. Timestamps are RFC 3339
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
  inventoryReservationId?: string;
  fulfilment: FulfilmentPlan;
}
