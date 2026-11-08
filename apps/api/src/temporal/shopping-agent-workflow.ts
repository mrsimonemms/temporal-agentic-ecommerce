// Contract for the Go ShoppingAgentWorkflow in workers/order. Field names and
// types must match the JSON tags of the Go structs in
// workers/order/internal/app/workflows/shopping_agent.go.
import { OrderBuyer } from './order-workflow';

export const SHOPPING_AGENT_WORKFLOW_TYPE = 'ShoppingAgentWorkflow';

// Matches workflows.QueryGetShoppingAgent
export const SHOPPING_AGENT_QUERY_GET = 'getShoppingAgent';

// Matches workflows.UpdateDecidePurchase
export const SHOPPING_AGENT_UPDATE_DECIDE_PURCHASE = 'decidePurchase';

// Matches workflows.ShoppingAgentStatus
export type ShoppingAgentStatus =
  | 'planning'
  | 'awaiting_approval'
  | 'approved'
  | 'purchasing'
  | 'purchased'
  | 'rejected'
  | 'failed';

// Matches workflows.PurchaseDecision
export type PurchaseDecision = 'approve' | 'reject';

// Matches workflows.ShoppingAgentDemoOptions. Demo-only: not part of the
// purchase proposal or the checkout.
export interface ShoppingAgentDemoOptions {
  // Inventory reservation attempts that fail for the Order the purchase places.
  // The Go field is an int32 and the Workflow accepts 0 to 2.
  inventoryFailures?: number;
}

// Matches workflows.ShoppingAgentInput
export interface ShoppingAgentInput {
  request: string;
  buyer: OrderBuyer;
  demo?: ShoppingAgentDemoOptions;
}

// Matches activities.ProposalLine. Prices are integers in the minor unit.
export interface ProposalLine {
  productId: string;
  title: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

// Matches activities.PurchaseProposal
export interface PurchaseProposal {
  lines: ProposalLine[];
  currency: string;
  total: number;
  budget: number;
}

// Matches workflows.DecidePurchaseRequest
export interface DecidePurchaseRequest {
  decision: PurchaseDecision;
  decidedBy?: string;
  note?: string;
}

// Matches workflows.PurchaseDecisionRecord
export interface PurchaseDecisionRecord extends DecidePurchaseRequest {
  decidedAt: string;
}

// Matches workflows.ShoppingAgent. Timestamps are RFC 3339 strings as
// serialised by Go.
export interface ShoppingAgent {
  id: string;
  status: ShoppingAgentStatus;
  request: string;
  buyer: OrderBuyer;
  proposal?: PurchaseProposal;
  decision?: PurchaseDecisionRecord;
  explanation?: string;
  checkoutId?: string;
  orderId?: string;
  orderPermalinkUrl?: string;
  error?: string;
  demo?: ShoppingAgentDemoOptions;
  createdAt: string;
}

// A Shopping Agent Workflow that ended without recording its state, for
// example because it was terminated. Only the outcome is known.
export interface ClosedShoppingAgent {
  id: string;
  status: 'failed';
  error: string;
}

// A decision rejected by the Workflow's Update validator, carrying its reason
export class PurchaseDecisionRejectedError extends Error {
  constructor(
    message: string,
    readonly type?: string,
  ) {
    super(message);
    this.name = 'PurchaseDecisionRejectedError';
  }
}
