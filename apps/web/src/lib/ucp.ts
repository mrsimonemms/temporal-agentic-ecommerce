import type {
  CheckoutCompleteRequest,
  CheckoutCreateRequest,
  CheckoutResponse,
  ErrorResponse,
  Message,
  Order,
  SelectedPaymentInstrument,
} from '@ucp-js/sdk';

import { CATALOGUE } from './catalogue';

// Browser client for the UCP endpoints, called through the dashboard's own
// server routes which proxy to the NestJS API

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly messages: Message[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function isErrorResponse(body: unknown): body is ErrorResponse {
  return (
    typeof body === 'object' &&
    body !== null &&
    'ucp' in body &&
    (body as ErrorResponse).ucp?.status === 'error'
  );
}

// Extracts a readable message from the error bodies the API can return: UCP
// protocol errors and proxy errors use `content`, NestJS HTTP errors use
// `message`
function errorMessage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  if ('content' in body && typeof body.content === 'string') {
    return body.content;
  }
  if ('message' in body) {
    if (typeof body.message === 'string') {
      return body.message;
    }
    if (Array.isArray(body.message)) {
      return body.message.join('; ');
    }
  }
  return undefined;
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
    });
  } catch (err) {
    if (init.signal?.aborted) {
      throw err;
    }
    throw new ApiError('Unable to reach the dashboard server');
  }

  const body: unknown = await res.json().catch(() => undefined);

  if (!res.ok) {
    throw new ApiError(errorMessage(body) ?? `Request failed with HTTP ${res.status}`, res.status);
  }

  // UCP business outcomes where no resource exists, such as not_found, are
  // returned with HTTP 200
  if (isErrorResponse(body)) {
    throw new ApiError(
      body.messages.map((message) => message.content).join(' '),
      res.status,
      body.messages,
    );
  }

  return body as T;
}

export function createCheckout(req: CheckoutCreateRequest): Promise<CheckoutResponse> {
  return request('/api/checkout-sessions', { method: 'POST', body: JSON.stringify(req) });
}

export function getCheckout(id: string): Promise<CheckoutResponse> {
  return request(`/api/checkout-sessions/${encodeURIComponent(id)}`);
}

export function completeCheckout(
  id: string,
  req: CheckoutCompleteRequest,
): Promise<CheckoutResponse> {
  return request(`/api/checkout-sessions/${encodeURIComponent(id)}/complete`, {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export function getOrder(id: string, signal?: AbortSignal): Promise<Order> {
  return request(`/api/orders/${encodeURIComponent(id)}`, { signal });
}

// Builds the stubbed payment instrument for the first payment handler the
// checkout advertises. The API does not call a payment provider, it only
// checks that the handler is supported.
export function demoPaymentInstrument(
  checkout: CheckoutResponse,
): SelectedPaymentInstrument | undefined {
  const handler = Object.values(checkout.ucp.payment_handlers ?? {}).flat()[0];
  if (!handler?.id) {
    return undefined;
  }

  return {
    id: 'pi_demo_card',
    handler_id: handler.id,
    type: 'card',
    selected: true,
    display: { brand: 'mastercard', last_digits: '5678' },
    credential: { type: 'PAYMENT_GATEWAY' },
  };
}

type Buyer = NonNullable<CheckoutCreateRequest['buyer']>;

// UCP describes the buyer with separate first and last names, but names do not
// all divide that way: some have one part, some several, and the order differs
// between cultures. The whole name is therefore sent as first_name, without a
// last_name, so it is never split or reordered. The commerce API joins the two
// fields with a space, so the name reaches the Order exactly as entered.
export function checkoutBuyer(email: string, name: string): Buyer {
  const trimmed = name.trim();
  return { email: email.trim(), first_name: trimmed || undefined };
}

// The buyer's name as entered, from a checkout created by any client
export function buyerName(buyer: Buyer | undefined): string {
  return [buyer?.first_name, buyer?.last_name].filter(Boolean).join(' ');
}

// Builds the create request for the products and quantities selected in the
// dashboard. Products with no quantity are left out.
export function checkoutRequest(
  quantities: Record<string, number>,
  buyer: { email: string; name: string },
): CheckoutCreateRequest {
  return {
    line_items: CATALOGUE.filter((item) => (quantities[item.id] ?? 0) > 0).map((item) => ({
      item: { id: item.id },
      quantity: quantities[item.id],
    })),
    buyer: checkoutBuyer(buyer.email, buyer.name),
  };
}
