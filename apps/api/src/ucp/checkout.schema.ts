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
}

export const CheckoutSchema = SchemaFactory.createForClass(Checkout);
