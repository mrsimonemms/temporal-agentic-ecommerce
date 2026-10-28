import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type ErrorResponse, type Order } from '@ucp-js/sdk';

import {
  OrderInput,
  Order as OrderState,
  OrderUpdateRejectedError,
  ReportFulfilmentExceptionSignal,
  ResolveFulfilmentExceptionRequest,
} from '../temporal/order-workflow';
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

  // Reports a fulfilment exception and returns the resulting Order state. The
  // Workflow applies its own rules and ignores exceptions it cannot accept, so
  // acceptance is confirmed by reading the Order back rather than assumed from
  // Signal delivery. Used by the demo controls: this is not a UCP operation.
  async reportFulfilmentException(
    id: string,
    signal: ReportFulfilmentExceptionSignal,
  ): Promise<OrderState> {
    if (!checkoutIdForOrder(id) || !(await this.temporal.reportFulfilmentException(id, signal))) {
      throw this.orderNotFound(id);
    }

    const order = await this.temporal.getOrder(id);
    if (!order) {
      throw this.orderNotFound(id);
    }

    const exception = order.fulfilment?.exception;
    const accepted =
      order.status === 'awaiting_intervention' &&
      exception?.lineId === signal.lineId &&
      exception.reason === signal.reason;
    if (!accepted) {
      throw new ConflictException(
        `The fulfilment exception was not accepted by Order "${id}" with status "${order.status}"`,
      );
    }

    return order;
  }

  // Resolves the current fulfilment exception and returns the resulting Order
  // state. The Workflow validates the resolution. Used by the demo controls:
  // this is not a UCP operation.
  async resolveFulfilmentException(
    id: string,
    req: ResolveFulfilmentExceptionRequest,
  ): Promise<OrderState> {
    if (!checkoutIdForOrder(id)) {
      throw this.orderNotFound(id);
    }

    let order: OrderState | undefined;
    try {
      order = await this.temporal.resolveFulfilmentException(id, req);
    } catch (err) {
      if (err instanceof OrderUpdateRejectedError) {
        throw new ConflictException(err.message);
      }
      throw err;
    }

    if (!order) {
      throw this.orderNotFound(id);
    }
    return order;
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

  private orderNotFound(id: string): NotFoundException {
    return new NotFoundException(`Order "${id}" was not found`);
  }

  // Buyer-facing Order page, distinct from the UCP Order API endpoint and
  // served from the same origin as the API
  private orderPermalinkUrl(orderId: string): string {
    return new URL(`/orders/${orderId}`, this.config.getOrThrow<string>('SCHEMA_URL')).toString();
  }
}
