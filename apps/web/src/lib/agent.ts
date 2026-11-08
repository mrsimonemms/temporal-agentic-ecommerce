import { ApiError, request } from './ucp';

// Browser client for the demo-only Shopping Agent endpoints of the NestJS API.
// These are not part of UCP: the agent itself buys through the UCP checkout.

// Mirrors ShoppingAgentStateDto in apps/api/src/shopping-agent/shopping-agent.dto.ts
export type AgentStatus =
  | 'planning'
  | 'awaiting_approval'
  | 'approved'
  | 'purchasing'
  | 'purchased'
  | 'rejected'
  | 'failed';

export type PurchaseDecision = 'approve' | 'reject';

export interface ProposalLine {
  productId: string;
  title: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

// Amounts are integers in the minor unit of the currency
export interface PurchaseProposal {
  lines: ProposalLine[];
  currency: string;
  total: number;
  budget: number;
}

export interface DecisionRecord {
  decision: PurchaseDecision;
  decidedBy?: string;
  note?: string;
  decidedAt: string;
}

// Request, buyer and createdAt are absent only when the Workflow ended
// without recording its state, for example when it was terminated
export interface AgentState {
  id: string;
  status: AgentStatus;
  request?: string;
  buyer?: { email: string; name?: string };
  proposal?: PurchaseProposal;
  decision?: DecisionRecord;
  explanation?: string;
  checkoutId?: string;
  orderId?: string;
  orderPermalinkUrl?: string;
  error?: string;
  demo?: { inventoryFailures?: number };
  createdAt?: string;
}

// Mirrors StartShoppingAgentDto
export interface StartAgentRequest {
  request: string;
  buyer: { email: string; name?: string };
  demo?: { inventoryFailures: number };
}

export interface DecideRequest {
  decision: PurchaseDecision;
  decidedBy?: string;
  note?: string;
}

const FINAL_STATUSES: AgentStatus[] = ['purchased', 'rejected', 'failed'];

// The Workflow has finished, so its state will not change again
export function isFinal(state: AgentState): boolean {
  return FINAL_STATUSES.includes(state.status);
}

// The API returns 404 for an unknown Shopping Agent or Order. UCP endpoints
// report unknown resources as a not_found message instead.
export function isNotFound(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    (err.status === 404 || err.messages.some((message) => message.code === 'not_found'))
  );
}

export function startShoppingAgent(body: StartAgentRequest): Promise<{ id: string }> {
  return request('/api/demo/shopping-agents', { method: 'POST', body: JSON.stringify(body) });
}

export function getShoppingAgent(id: string, signal?: AbortSignal): Promise<AgentState> {
  return request(`/api/demo/shopping-agents/${encodeURIComponent(id)}`, { signal });
}

// Resolves with the state when the decision was recorded. The Workflow rejects
// decisions it cannot accept, which surface as an ApiError with HTTP 409.
export function decidePurchase(id: string, body: DecideRequest): Promise<AgentState> {
  return request(`/api/demo/shopping-agents/${encodeURIComponent(id)}/decision`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
