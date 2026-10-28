import { Order, OrderInput } from '../src/temporal/order-workflow';
import { Checkout } from '../src/ucp/checkout.schema';

// In-memory stand-in for the Mongoose model, covering the queries the service uses
export class FakeCheckoutModel {
  readonly docs = new Map<string, Checkout>();

  // When set, the next update to this status fails as if MongoDB were unavailable
  failNextUpdateTo?: string;

  async create(doc: Checkout) {
    this.docs.set(doc._id, structuredClone(doc));
    return doc;
  }

  findById(id: string) {
    return this.query(this.docs.get(id) ?? null);
  }

  findOneAndUpdate(filter: { _id: string; status: string }, update: { $set: Partial<Checkout> }) {
    if (this.failNextUpdateTo && update.$set.status === this.failNextUpdateTo) {
      this.failNextUpdateTo = undefined;
      return {
        lean: () => ({
          exec: () => Promise.reject(new Error('MongoDB unavailable')),
        }),
      };
    }

    const doc = this.docs.get(filter._id);
    if (!doc || doc.status !== filter.status) {
      return this.query(null);
    }

    const updated = { ...doc, ...structuredClone(update.$set) };
    this.docs.set(updated._id, updated);
    return this.query(updated);
  }

  private query(value: Checkout | null) {
    return { lean: () => ({ exec: async () => structuredClone(value) }) };
  }
}

export const ORDER_CREATED_AT = '2026-10-28T12:00:00Z';
export const ORDER_FULFILLED_AT = '2026-10-28T15:30:00Z';

// Stand-in for Temporal that mirrors the Go OrderWorkflow: one Workflow per
// Workflow ID, confirmed until the markFulfilled Signal, which is ignored once
// the Order is fulfilled
export class FakeTemporalService {
  readonly workflows = new Map<string, Order>();

  readonly startOrderWorkflow = vi.fn(async (input: OrderInput) => {
    if (!this.workflows.has(input.id)) {
      this.workflows.set(input.id, {
        ...structuredClone(input),
        status: 'confirmed',
        total: input.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
        createdAt: ORDER_CREATED_AT,
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
}
