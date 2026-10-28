import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type ErrorResponse, type Order } from '@ucp-js/sdk';

import { OrderInput } from '../temporal/order-workflow';
import { TemporalService } from '../temporal/temporal.service';
import { UcpService } from '../ucp/ucp.service';
import { checkoutIdForOrder, toUcpOrder } from './order.mapper';

// Reference to a placed Order, recorded by the channel that placed it
export interface OrderReference {
  id: string;
  permalinkUrl: string;
}

@Injectable()
export class OrderService {
  constructor(
    private readonly config: ConfigService,
    private readonly temporal: TemporalService,
    private readonly ucp: UcpService,
  ) {}

  // Starts the Order Workflow. Starting is idempotent, so placing the same
  // Order again does not create another Workflow.
  async placeOrder(input: OrderInput): Promise<OrderReference> {
    await this.temporal.startOrderWorkflow(input);

    return { id: input.id, permalinkUrl: this.orderPermalinkUrl(input.id) };
  }

  async getOrder(id: string): Promise<Order | ErrorResponse> {
    return (await this.findOrder(id)) ?? this.ucp.notFound('Order', id);
  }

  // Signals the Order Workflow to mark the Order as fulfilled and returns the
  // resulting Order. Used by the demo controls: this is not a UCP operation.
  async markOrderFulfilled(id: string): Promise<Order | ErrorResponse> {
    if (!checkoutIdForOrder(id) || !(await this.temporal.markOrderFulfilled(id))) {
      return this.ucp.notFound('Order', id);
    }
    return this.getOrder(id);
  }

  // The Order Workflow is the authoritative source of Order state. Only IDs
  // that can have been issued for a UCP checkout are queried.
  async findOrder(id: string): Promise<Order | undefined> {
    if (!checkoutIdForOrder(id)) {
      return undefined;
    }

    const order = await this.temporal.getOrder(id);
    return order && toUcpOrder(order, this.orderPermalinkUrl(order.id), this.ucp.version());
  }

  // Buyer-facing Order page, distinct from the UCP Order API endpoint and
  // served from the same origin as the API
  private orderPermalinkUrl(orderId: string): string {
    return new URL(`/orders/${orderId}`, this.config.getOrThrow<string>('SCHEMA_URL')).toString();
  }
}
