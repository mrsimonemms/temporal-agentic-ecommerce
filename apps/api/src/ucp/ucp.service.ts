import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import {
  type CheckoutCompleteRequest,
  type CheckoutCreateRequest,
  type CheckoutResponse,
  type ErrorResponse,
  type MessageError,
  type Order,
  type SelectedPaymentInstrument,
  UcpDiscoveryProfile,
  type UcpProfileDocument,
} from '@ucp-js/sdk';
import { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';

import { TemporalService } from '../temporal/temporal.service';
import { CATALOGUE_CURRENCY, findProduct } from './catalogue';
import { Checkout, CheckoutLineItem, CheckoutOrder, CheckoutPayment } from './checkout.schema';
import { checkoutIdForOrder, toOrderInput, toUcpOrder } from './order.mapper';

@Injectable()
export class UcpService {
  protected readonly logger = new Logger(this.constructor.name);

  constructor(
    private readonly config: ConfigService,
    @InjectModel(Checkout.name) private readonly checkouts: Model<Checkout>,
    private readonly temporal: TemporalService,
  ) {}

  getMerchantProfile(): UcpDiscoveryProfile {
    return this.config.getOrThrow<UcpDiscoveryProfile>('ucp');
  }

  async createCheckout(request: CheckoutCreateRequest): Promise<CheckoutResponse | ErrorResponse> {
    if (request.line_items.length === 0) {
      return this.errorResponse([
        {
          type: 'error',
          code: 'missing',
          path: '$.line_items',
          content: 'At least one line item is required',
          severity: 'unrecoverable',
        },
      ]);
    }

    const unavailable: MessageError[] = [];
    const lineItems: CheckoutLineItem[] = [];

    request.line_items.forEach((lineItem, index) => {
      const product = findProduct(lineItem.item.id);
      if (!product) {
        unavailable.push({
          type: 'error',
          code: 'item_unavailable',
          path: `$.line_items[${index}].item.id`,
          content: `Item "${lineItem.item.id}" is not available for purchase`,
          severity: 'unrecoverable',
        });
        return;
      }

      lineItems.push({
        id: `li_${index + 1}`,
        productId: product.id,
        title: product.title,
        unitPrice: product.price,
        quantity: lineItem.quantity,
      });
    });

    // No checkout is created when any requested item cannot be purchased
    if (unavailable.length > 0) {
      return this.errorResponse(unavailable);
    }

    const buyer = request.buyer && {
      email: request.buyer.email,
      firstName: request.buyer.first_name,
      lastName: request.buyer.last_name,
      phoneNumber: request.buyer.phone_number,
    };

    const checkout: Checkout = {
      _id: `chk_${randomUUID()}`,
      // A buyer email is the only information required beyond valid line items
      status: buyer?.email ? 'ready_for_complete' : 'incomplete',
      currency: CATALOGUE_CURRENCY,
      lineItems,
      buyer,
    };

    await this.checkouts.create(checkout);

    return this.checkoutResponse(checkout);
  }

  async getCheckout(id: string): Promise<CheckoutResponse | ErrorResponse> {
    const checkout = await this.checkouts.findById(id).lean<Checkout>().exec();
    if (!checkout) {
      return this.notFound('Checkout', id);
    }

    return this.checkoutResponse(checkout);
  }

  async completeCheckout(
    id: string,
    request: CheckoutCompleteRequest,
  ): Promise<CheckoutResponse | ErrorResponse> {
    const checkout = await this.checkouts.findById(id).lean<Checkout>().exec();
    if (!checkout) {
      return this.notFound('Checkout', id);
    }

    if (checkout.status === 'incomplete') {
      // The response carries the messages describing the missing information
      return this.checkoutResponse(checkout);
    }

    if (checkout.status === 'complete_in_progress') {
      // Completion was previously accepted but the Order was not recorded.
      // The stored payment selection is used and the request is not
      // re-evaluated.
      return this.placeOrder(checkout);
    }

    if (checkout.status !== 'ready_for_complete') {
      return this.checkoutResponse(checkout, [this.notCompletable(checkout)]);
    }

    const instruments = request.payment.instruments ?? [];
    const instrument: SelectedPaymentInstrument | undefined =
      instruments.find((i) => i.selected) ??
      (instruments.length === 1 ? instruments[0] : undefined);

    if (!instrument) {
      return this.checkoutResponse(checkout, [
        {
          type: 'error',
          code: 'missing',
          path: '$.payment.instruments',
          content: 'A selected payment instrument is required',
          severity: 'recoverable',
        },
      ]);
    }

    // Stubbed payment: the instrument must belong to an advertised payment
    // handler. No payment provider is called and no credential is stored.
    const handlerIds = Object.values(this.profile().ucp.payment_handlers ?? {})
      .flat()
      .map((handler) => handler.id);

    if (!handlerIds.includes(instrument.handler_id)) {
      return this.checkoutResponse(checkout, [
        {
          type: 'error',
          code: 'payment_failed',
          path: `$.payment.instruments[${instruments.indexOf(instrument)}].handler_id`,
          content: `Payment handler "${instrument.handler_id}" is not supported`,
          severity: 'recoverable',
        },
      ]);
    }

    const payment: CheckoutPayment = {
      instrumentId: instrument.id,
      handlerId: instrument.handler_id,
      type: instrument.type,
      display: instrument.display,
    };

    // Conditional update guards against concurrent completion requests.
    // The checkout becomes completed once an Order has been placed for it.
    const accepted = await this.checkouts
      .findOneAndUpdate(
        { _id: id, status: 'ready_for_complete' },
        { $set: { status: 'complete_in_progress', payment } },
        { new: true },
      )
      .lean<Checkout>()
      .exec();

    if (!accepted) {
      return this.getCheckout(id);
    }

    return this.placeOrder(accepted);
  }

  async getOrder(id: string): Promise<Order | ErrorResponse> {
    return (await this.findOrder(id)) ?? this.notFound('Order', id);
  }

  // Demo-only: signals the Order Workflow to mark the Order as fulfilled and
  // returns the resulting Order. This is not a UCP operation.
  async markOrderFulfilled(id: string): Promise<Order | ErrorResponse> {
    if (!checkoutIdForOrder(id) || !(await this.temporal.markOrderFulfilled(id))) {
      return this.notFound('Order', id);
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
    return order && toUcpOrder(order, this.orderPermalinkUrl(order.id), this.ucpVersion());
  }

  // Starts the Order Workflow and then records the Order against the
  // checkout. Both steps are idempotent, so if either fails the checkout
  // remains complete_in_progress and a repeated completion request resumes
  // from here without creating another Order.
  private async placeOrder(checkout: Checkout): Promise<CheckoutResponse | ErrorResponse> {
    const input = toOrderInput(checkout);

    try {
      await this.temporal.startOrderWorkflow(input);
    } catch (err) {
      this.logger.error(`Unable to start Order Workflow for checkout "${checkout._id}"`, err);
      return this.checkoutResponse(checkout);
    }

    const order: CheckoutOrder = {
      id: input.id,
      permalinkUrl: this.orderPermalinkUrl(input.id),
    };

    let completed: Checkout | null;
    try {
      completed = await this.checkouts
        .findOneAndUpdate(
          { _id: checkout._id, status: 'complete_in_progress' },
          { $set: { status: 'completed', order } },
          { new: true },
        )
        .lean<Checkout>()
        .exec();
    } catch (err) {
      this.logger.error(`Unable to record Order "${order.id}" for checkout "${checkout._id}"`, err);
      return this.checkoutResponse(checkout);
    }

    if (!completed) {
      // A concurrent request has already recorded the outcome
      return this.getCheckout(checkout._id);
    }

    return this.checkoutResponse(completed);
  }

  // Buyer-facing Order page, distinct from the UCP Order API endpoint and
  // served from the same origin as the API
  private orderPermalinkUrl(orderId: string): string {
    return new URL(`/orders/${orderId}`, this.config.getOrThrow<string>('SCHEMA_URL')).toString();
  }

  private checkoutResponse(checkout: Checkout, messages: MessageError[] = []): CheckoutResponse {
    const lineItems = checkout.lineItems.map((lineItem) => {
      const amount = lineItem.unitPrice * lineItem.quantity;
      return {
        id: lineItem.id,
        item: {
          id: lineItem.productId,
          title: lineItem.title,
          price: lineItem.unitPrice,
        },
        quantity: lineItem.quantity,
        totals: [
          { type: 'subtotal', amount },
          { type: 'total', amount },
        ],
      };
    });

    const subtotal = lineItems.reduce((sum, lineItem) => sum + lineItem.totals[0].amount, 0);

    if (checkout.status === 'incomplete' && !checkout.buyer?.email) {
      messages = [
        {
          type: 'error',
          code: 'missing',
          path: '$.buyer.email',
          content: 'Buyer email is required',
          severity: 'recoverable',
        },
        ...messages,
      ];
    }

    return {
      ucp: {
        version: this.ucpVersion(),
        capabilities: {
          'dev.ucp.shopping.checkout': [{ version: this.ucpVersion() }],
        },
        payment_handlers: this.profile().ucp.payment_handlers ?? {},
      },
      id: checkout._id,
      status: checkout.status,
      currency: checkout.currency,
      buyer: checkout.buyer && {
        email: checkout.buyer.email,
        first_name: checkout.buyer.firstName,
        last_name: checkout.buyer.lastName,
        phone_number: checkout.buyer.phoneNumber,
      },
      line_items: lineItems,
      totals: [
        { type: 'subtotal', amount: subtotal },
        { type: 'total', amount: subtotal },
      ],
      links: [],
      messages: messages.length > 0 ? messages : undefined,
      order: checkout.order && {
        id: checkout.order.id,
        permalink_url: checkout.order.permalinkUrl,
      },
      payment: checkout.payment && {
        instruments: [
          {
            id: checkout.payment.instrumentId,
            handler_id: checkout.payment.handlerId,
            type: checkout.payment.type,
            display: checkout.payment.display,
            selected: true,
          },
        ],
      },
    };
  }

  private notCompletable(checkout: Checkout): MessageError {
    return {
      type: 'error',
      code: 'operation_not_allowed',
      content: `Checkout cannot be completed while its status is "${checkout.status}"`,
      severity: checkout.status === 'complete_in_progress' ? 'recoverable' : 'unrecoverable',
    };
  }

  private notFound(resource: 'Checkout' | 'Order', id: string): ErrorResponse {
    return this.errorResponse([
      {
        type: 'error',
        code: 'not_found',
        content: `${resource} "${id}" was not found`,
        severity: 'unrecoverable',
      },
    ]);
  }

  // Business outcome where no checkout resource exists to return
  private errorResponse(messages: MessageError[]): ErrorResponse {
    return {
      ucp: { version: this.ucpVersion(), status: 'error' },
      messages,
    };
  }

  // The configured profile follows the 2026-08-25 profile document shape
  private profile(): UcpProfileDocument {
    return this.config.getOrThrow<UcpProfileDocument>('ucp');
  }

  private ucpVersion(): string {
    return this.profile().ucp.version;
  }
}
