import type { Order } from '@ucp-js/sdk';

import type { Feedback } from './format';
import { getOrder, request } from './ucp';

// Browser client for the demo-only endpoints of the NestJS API. These are not
// part of UCP: they stand in for external systems and expose the internal
// Order Workflow state so the demo can be observed.

// Mirrors OrderStateDto in apps/api/src/demo/fulfilment-exception.dto.ts
export type OrderStatus =
  'reserving_inventory' | 'confirmed' | 'awaiting_intervention' | 'fulfilled';

export interface OrderLine {
  id: string;
  productId: string;
  title?: string;
  quantity: number;
  unitPrice: number;
}

export interface FulfilmentSource {
  lineId: string;
  source: string;
}

export interface FulfilmentException {
  lineId: string;
  reason: string;
  raisedAt: string;
}

export interface FulfilmentResolution {
  lineId: string;
  reason: string;
  decision: 'alternative_source';
  alternativeSource: string;
  approvedBy: string;
  note?: string;
  raisedAt: string;
  resolvedAt: string;
}

export interface OrderState {
  id: string;
  status: OrderStatus;
  buyer: { id?: string; name?: string; email: string };
  currency: string;
  lines: OrderLine[];
  total: number;
  createdAt: string;
  fulfilledAt?: string;
  inventoryReservationId?: string;
  fulfilment: {
    sources?: FulfilmentSource[];
    exception?: FulfilmentException;
    resolutions?: FulfilmentResolution[];
  };
}

export interface ReportFulfilmentException {
  lineId: string;
  reason: string;
}

export interface ResolveFulfilmentException {
  lineId: string;
  alternativeSource: string;
  approvedBy: string;
  note?: string;
}

export function setInventoryFailures(
  checkoutId: string,
  failures: number,
): Promise<{ checkoutId: string; failures: number }> {
  return request(
    `/api/demo/checkout-sessions/${encodeURIComponent(checkoutId)}/inventory-failures`,
    {
      method: 'PUT',
      body: JSON.stringify({ failures }),
    },
  );
}

export function getOrderState(orderId: string, signal?: AbortSignal): Promise<OrderState> {
  return request(`/api/demo/orders/${encodeURIComponent(orderId)}`, { signal });
}

export function reportFulfilmentException(
  orderId: string,
  body: ReportFulfilmentException,
): Promise<OrderState> {
  return request(`/api/demo/orders/${encodeURIComponent(orderId)}/fulfilment-exception`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function resolveFulfilmentException(
  orderId: string,
  body: ResolveFulfilmentException,
): Promise<OrderState> {
  return request(`/api/demo/orders/${encodeURIComponent(orderId)}/resolve-fulfilment-exception`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// Returns the resulting UCP Order. The Workflow ignores the request unless the
// Order is confirmed, so callers must check the Order rather than assume
// success.
export function fulfilOrder(orderId: string): Promise<Order> {
  return request(`/api/demo/orders/${encodeURIComponent(orderId)}/fulfil`, { method: 'POST' });
}

export interface OrderSnapshot {
  order: Order;
  state: OrderState;
}

// Reads the UCP Order and the internal Workflow state together, so the two
// views are refreshed from the same poll
export async function getOrderSnapshot(
  orderId: string,
  signal?: AbortSignal,
): Promise<OrderSnapshot> {
  const [order, state] = await Promise.all([
    getOrder(orderId, signal),
    getOrderState(orderId, signal),
  ]);
  return { order, state };
}

// Interprets the Order returned by the fulfil endpoint. The Workflow ignores
// the request unless the Order is confirmed, so success is only reported
// when every line item is fulfilled.
export function fulfilmentOutcome(order: Order): Feedback {
  return order.line_items.every((lineItem) => lineItem.status === 'fulfilled')
    ? { tone: 'success', message: 'Order marked fulfilled' }
    : {
        tone: 'warning',
        message:
          'The Order Workflow did not fulfil the Order: only confirmed Orders can be fulfilled',
      };
}
