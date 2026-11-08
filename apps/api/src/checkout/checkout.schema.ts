import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type CheckoutResponseStatus, CheckoutResponseStatusSchema } from '@ucp-js/sdk';

// Property types are declared explicitly rather than inferred from decorator
// metadata so the schema does not depend on how the code is compiled.

@Schema({ _id: false })
export class CheckoutLineItem {
  @Prop({ type: String, required: true })
  id: string;

  @Prop({ type: String, required: true })
  productId: string;

  @Prop({ type: String, required: true })
  title: string;

  // Unit price in the checkout currency's minor unit
  @Prop({ type: Number, required: true })
  unitPrice: number;

  @Prop({ type: Number, required: true })
  quantity: number;
}

@Schema({ _id: false })
export class CheckoutBuyer {
  @Prop({ type: String })
  email?: string;

  @Prop({ type: String })
  firstName?: string;

  @Prop({ type: String })
  lastName?: string;

  @Prop({ type: String })
  phoneNumber?: string;
}

// The payment instrument selected at completion. Credentials are never stored.
@Schema({ _id: false })
export class CheckoutPayment {
  @Prop({ type: String, required: true })
  instrumentId: string;

  @Prop({ type: String, required: true })
  handlerId: string;

  @Prop({ type: String, required: true })
  type: string;

  @Prop({ type: Object })
  display?: Record<string, unknown>;
}

// Reference to the Order placed by a completed checkout
@Schema({ _id: false })
export class CheckoutOrder {
  @Prop({ type: String, required: true })
  id: string;

  @Prop({ type: String, required: true })
  permalinkUrl: string;
}

// Demo-only configuration applied when the checkout places its Order. Never
// exposed through UCP.
@Schema({ _id: false })
export class CheckoutDemo {
  // Inventory reservation attempts that fail before succeeding
  @Prop({ type: Number, required: true, min: 0 })
  inventoryFailures: number;
}

// UCP Idempotency-Key values and request fingerprints, so a retried request is
// answered with the original outcome rather than repeating the operation.
// Never exposed through UCP.
@Schema({ _id: false })
export class CheckoutIdempotency {
  // Key of the request that created the checkout
  @Prop({ type: String })
  createKey?: string;

  @Prop({ type: String })
  createRequestHash?: string;

  // Key of the request whose completion was accepted
  @Prop({ type: String })
  completeKey?: string;

  @Prop({ type: String })
  completeRequestHash?: string;
}

@Schema({ collection: 'checkouts', timestamps: true })
export class Checkout {
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ type: String, required: true, enum: CheckoutResponseStatusSchema.options })
  status: CheckoutResponseStatus;

  @Prop({ type: String, required: true })
  currency: string;

  @Prop({ type: [SchemaFactory.createForClass(CheckoutLineItem)], required: true })
  lineItems: CheckoutLineItem[];

  @Prop({ type: SchemaFactory.createForClass(CheckoutBuyer) })
  buyer?: CheckoutBuyer;

  @Prop({ type: SchemaFactory.createForClass(CheckoutPayment) })
  payment?: CheckoutPayment;

  @Prop({ type: SchemaFactory.createForClass(CheckoutOrder) })
  order?: CheckoutOrder;

  @Prop({ type: SchemaFactory.createForClass(CheckoutDemo) })
  demo?: CheckoutDemo;

  @Prop({ type: SchemaFactory.createForClass(CheckoutIdempotency) })
  idempotency?: CheckoutIdempotency;
}

export const CheckoutSchema = SchemaFactory.createForClass(Checkout);

// Each key identifies at most one checkout per operation, enforced by MongoDB
// so concurrent retries cannot create a second checkout. Checkouts created
// without a key are not indexed.
for (const field of ['idempotency.createKey', 'idempotency.completeKey']) {
  CheckoutSchema.index(
    { [field]: 1 },
    { unique: true, partialFilterExpression: { [field]: { $type: 'string' } } },
  );
}
