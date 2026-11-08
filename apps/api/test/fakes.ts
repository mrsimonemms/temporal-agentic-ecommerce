import { Checkout } from '../src/checkout/checkout.schema';
import {
  Order,
  OrderInput,
  OrderUpdateRejectedError,
  ReportFulfilmentExceptionSignal,
  ResolveFulfilmentExceptionRequest,
} from '../src/temporal/order-workflow';
import {
  ClosedShoppingAgent,
  DecidePurchaseRequest,
  PurchaseDecisionRejectedError,
  ShoppingAgent,
  ShoppingAgentInput,
} from '../src/temporal/shopping-agent-workflow';

// In-memory stand-in for the Mongoose model, covering the queries the service uses
export class FakeCheckoutModel {
  readonly docs = new Map<string, Checkout>();

  // When set, the next update to this status fails as if MongoDB were unavailable
  failNextUpdateTo?: string;

  async create(doc: Checkout) {
    this.assertUniqueKeys(doc);
    this.docs.set(doc._id, structuredClone(doc));
    return doc;
  }

  findById(id: string) {
    return this.query(this.docs.get(id) ?? null);
  }

  // Supports the idempotency key lookups the service uses
  findOne(filter: { 'idempotency.createKey'?: string; 'idempotency.completeKey'?: string }) {
    const [[path, value]] = Object.entries(filter);
    const field = path.replace('idempotency.', '') as keyof NonNullable<Checkout['idempotency']>;
    const doc = [...this.docs.values()].find((d) => d.idempotency?.[field] === value);
    return this.query(doc ?? null);
  }

  // Mirrors the unique partial indexes on the idempotency keys
  private assertUniqueKeys(doc: Checkout) {
    for (const field of ['createKey', 'completeKey'] as const) {
      const key = doc.idempotency?.[field];
      const clash = [...this.docs.values()].some(
        (d) => d._id !== doc._id && key !== undefined && d.idempotency?.[field] === key,
      );
      if (clash) {
        throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
      }
    }
  }

  findOneAndUpdate(
    filter: { _id: string; status: string | { $in: string[] } },
    update: { $set: Partial<Checkout> },
  ) {
    if (this.failNextUpdateTo && update.$set.status === this.failNextUpdateTo) {
      this.failNextUpdateTo = undefined;
      return {
        lean: () => ({
          exec: () => Promise.reject(new Error('MongoDB unavailable')),
        }),
      };
    }

    const doc = this.docs.get(filter._id);
    const statuses = typeof filter.status === 'string' ? [filter.status] : filter.status.$in;
    if (!doc || !statuses.includes(doc.status)) {
      return this.query(null);
    }

    const updated = { ...doc, ...structuredClone(update.$set) };
    try {
      this.assertUniqueKeys(updated);
    } catch (err) {
      return { lean: () => ({ exec: () => Promise.reject(err) }) };
    }
    this.docs.set(updated._id, updated);
    return this.query(updated);
  }

  private query(value: Checkout | null) {
    return { lean: () => ({ exec: async () => structuredClone(value) }) };
  }
}

export const ORDER_CREATED_AT = '2026-10-28T12:00:00Z';
export const ORDER_FULFILLED_AT = '2026-10-28T15:30:00Z';
export const EXCEPTION_RAISED_AT = '2026-10-28T13:00:00Z';
export const EXCEPTION_RESOLVED_AT = '2026-10-28T14:00:00Z';

// Stand-in for Temporal that mirrors the Go OrderWorkflow: one Workflow per
// Workflow ID, confirmed until the markFulfilled Signal, which is only applied
// to confirmed Orders. Fulfilment exceptions follow the Workflow's rules,
// including its Update rejection messages.
export class FakeTemporalService {
  readonly workflows = new Map<string, Order>();

  // Shopping Agent state by Workflow ID. Tests advance the state to stand in
  // for planning and purchasing in the Go Workflow.
  readonly agents = new Map<string, ShoppingAgent | ClosedShoppingAgent>();

  readonly startShoppingAgentWorkflow = vi.fn(async (id: string, input: ShoppingAgentInput) => {
    this.agents.set(id, {
      id,
      status: 'planning',
      request: input.request,
      buyer: structuredClone(input.buyer),
      demo: input.demo && structuredClone(input.demo),
      createdAt: ORDER_CREATED_AT,
    });
  });

  readonly getShoppingAgent = vi.fn(async (id: string) => {
    const agent = this.agents.get(id);
    return agent && structuredClone(agent);
  });

  // Mirrors the decidePurchase Update validator, including its messages
  readonly decidePurchase = vi.fn(async (id: string, req: DecidePurchaseRequest) => {
    const agent = this.agents.get(id);
    if (!agent) {
      return undefined;
    }
    if (!('request' in agent) || ['purchased', 'rejected', 'failed'].includes(agent.status)) {
      throw new PurchaseDecisionRejectedError(
        'shopping agent has finished and cannot accept a decision',
      );
    }

    const reject = (message: string) =>
      new PurchaseDecisionRejectedError(message, 'InvalidPurchaseDecision');
    if (agent.status !== 'awaiting_approval') {
      throw reject(`shopping agent is not awaiting approval: status is ${agent.status}`);
    }
    if (req.decision !== 'approve' && req.decision !== 'reject') {
      throw reject('decision must be "approve" or "reject"');
    }

    agent.decision = { ...req, decidedAt: EXCEPTION_RESOLVED_AT };
    agent.status = req.decision === 'approve' ? 'approved' : 'rejected';
    return structuredClone(agent);
  });

  readonly startOrderWorkflow = vi.fn(async (input: OrderInput) => {
    if (!this.workflows.has(input.id)) {
      // Demo options are not part of the Order state
      const { demo: _demo, ...order } = structuredClone(input);
      this.workflows.set(input.id, {
        ...order,
        status: 'confirmed',
        total: input.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
        createdAt: ORDER_CREATED_AT,
        fulfilment: {},
      });
    }
  });

  readonly getOrder = vi.fn(async (orderId: string) => {
    const order = this.workflows.get(orderId);
    return order && structuredClone(order);
  });

  readonly markOrderFulfilled = vi.fn(async (orderId: string) => {
    const order = this.workflows.get(orderId);
    if (!order) {
      return false;
    }
    if (order.status === 'confirmed') {
      order.status = 'fulfilled';
      order.fulfilledAt = ORDER_FULFILLED_AT;
    }
    return true;
  });

  readonly reportFulfilmentException = vi.fn(
    async (orderId: string, signal: ReportFulfilmentExceptionSignal) => {
      const order = this.workflows.get(orderId);
      if (!order) {
        return false;
      }
      // Invalid exceptions are ignored, as Signals cannot be rejected
      if (
        order.status === 'confirmed' &&
        order.lines.some((line) => line.id === signal.lineId) &&
        signal.reason
      ) {
        order.status = 'awaiting_intervention';
        order.fulfilment.exception = { ...signal, raisedAt: EXCEPTION_RAISED_AT };
      }
      return true;
    },
  );

  readonly resolveFulfilmentException = vi.fn(
    async (orderId: string, req: ResolveFulfilmentExceptionRequest) => {
      const order = this.workflows.get(orderId);
      if (!order) {
        return undefined;
      }

      const exception = order.fulfilment.exception;
      const reject = (message: string) =>
        new OrderUpdateRejectedError(message, 'InvalidFulfilmentResolution');
      if (order.status !== 'awaiting_intervention' || !exception) {
        throw reject(`order is not awaiting intervention: status is ${order.status}`);
      }
      if (req.lineId !== exception.lineId) {
        throw reject(
          `line "${req.lineId}" is not affected by the exception: line "${exception.lineId}" is`,
        );
      }

      order.fulfilment = {
        sources: [{ lineId: req.lineId, source: req.alternativeSource }],
        resolutions: [
          ...(order.fulfilment.resolutions ?? []),
          {
            lineId: exception.lineId,
            reason: exception.reason,
            decision: 'alternative_source',
            alternativeSource: req.alternativeSource,
            approvedBy: req.approvedBy,
            note: req.note,
            raisedAt: exception.raisedAt,
            resolvedAt: EXCEPTION_RESOLVED_AT,
          },
        ],
      };
      order.status = 'confirmed';
      return structuredClone(order);
    },
  );
}
