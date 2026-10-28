import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import {
  type CheckoutCompleteRequest,
  type CheckoutCreateRequest,
  type CheckoutResponse,
  type ErrorResponse,
  type MessageError,
  type SelectedPaymentInstrument,
  UcpDiscoveryProfile,
  type UcpProfileDocument,
} from '@ucp-js/sdk';
import { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';

import { CATALOGUE_CURRENCY, findProduct } from './catalogue';
import { Checkout, CheckoutLineItem, CheckoutPayment } from './checkout.schema';

@Injectable()
export class UcpService {
  constructor(
    private readonly config: ConfigService,
    @InjectModel(Checkout.name) private readonly checkouts: Model<Checkout>,
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
      return this.notFound(id);
    }

    return this.checkoutResponse(checkout);
  }

  async completeCheckout(
    id: string,
    request: CheckoutCompleteRequest,
  ): Promise<CheckoutResponse | ErrorResponse> {
    const checkout = await this.checkouts.findById(id).lean<Checkout>().exec();
    if (!checkout) {
      return this.notFound(id);
    }

    if (checkout.status === 'incomplete') {
      // The response carries the messages describing the missing information
      return this.checkoutResponse(checkout);
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
    // Completion is accepted for asynchronous processing: the checkout
    // becomes completed once an Order has been placed for it.
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

    return this.checkoutResponse(accepted);
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

  private notFound(id: string): ErrorResponse {
    return this.errorResponse([
      {
        type: 'error',
        code: 'not_found',
        content: `Checkout "${id}" was not found`,
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
