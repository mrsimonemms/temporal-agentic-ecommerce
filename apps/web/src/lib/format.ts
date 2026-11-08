import type { CheckoutResponse, Order } from '@ucp-js/sdk';

import type { AgentStatus } from './agent';
import type { OrderStatus } from './demo';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface StatusDisplay {
  label: string;
  tone: Tone;
}

type Totals = { type: string; amount: number }[];

// Amounts are integers in the currency's minor unit
export function formatAmount(amount: number, currency: string): string {
  const format = new Intl.NumberFormat('en-GB', { style: 'currency', currency });
  return format.format(amount / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2));
}

export function totalOf(totals: Totals, type: string): number | undefined {
  return totals.find((total) => total.type === type)?.amount;
}

const CHECKOUT_STATUSES: Record<CheckoutResponse['status'], StatusDisplay> = {
  incomplete: { label: 'Incomplete', tone: 'warning' },
  requires_escalation: { label: 'Requires escalation', tone: 'warning' },
  ready_for_complete: { label: 'Ready to complete', tone: 'info' },
  complete_in_progress: { label: 'Completion in progress', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
  canceled: { label: 'Cancelled', tone: 'neutral' },
};

export function checkoutStatus(status: CheckoutResponse['status']): StatusDisplay {
  return CHECKOUT_STATUSES[status];
}

type LineItemStatus = Order['line_items'][number]['status'];

const LINE_ITEM_STATUSES: Record<LineItemStatus, StatusDisplay> = {
  processing: { label: 'Processing', tone: 'info' },
  partial: { label: 'Partially fulfilled', tone: 'info' },
  fulfilled: { label: 'Fulfilled', tone: 'success' },
  removed: { label: 'Removed', tone: 'neutral' },
};

export function lineItemStatus(status: LineItemStatus): StatusDisplay {
  return LINE_ITEM_STATUSES[status];
}

// UCP has no Order-level status, so it is summarised from the line items in
// the same way as the buyer-facing permalink page
export function orderStatus(order: Order): LineItemStatus {
  const statuses = new Set(order.line_items.map((lineItem) => lineItem.status));
  if (statuses.size === 1) {
    return [...statuses][0];
  }
  return statuses.has('fulfilled') || statuses.has('partial') ? 'partial' : 'processing';
}

const WORKFLOW_STATUSES: Record<OrderStatus, StatusDisplay> = {
  reserving_inventory: { label: 'Reserving inventory', tone: 'info' },
  confirmed: { label: 'Confirmed', tone: 'success' },
  awaiting_intervention: { label: 'Awaiting intervention', tone: 'warning' },
  fulfilled: { label: 'Fulfilled', tone: 'success' },
};

// Internal Order Workflow status, shown only in the demo operational view
export function workflowStatus(status: OrderStatus): StatusDisplay {
  return WORKFLOW_STATUSES[status];
}

const AGENT_STATUSES: Record<AgentStatus, StatusDisplay> = {
  planning: { label: 'Planning', tone: 'info' },
  awaiting_approval: { label: 'Awaiting approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'info' },
  purchasing: { label: 'Purchasing', tone: 'info' },
  purchased: { label: 'Purchased', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'danger' },
};

// Shopping Agent Workflow status
export function agentStatus(status: AgentStatus): StatusDisplay {
  return AGENT_STATUSES[status];
}

export function formatTime(value: string | Date): string {
  return new Date(value).toLocaleTimeString('en-GB');
}

// Outcome of a demo action, shown next to the control that triggered it
export interface Feedback {
  tone: 'success' | 'warning' | 'danger';
  message: string;
}

// Demo-only number of simulated inventory reservation failures
export function failuresLabel(failures: number): string {
  return failures === 0 ? 'None' : `${failures} ${failures === 1 ? 'failure' : 'failures'}`;
}
