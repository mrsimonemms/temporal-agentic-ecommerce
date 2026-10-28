import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { OrderModule } from '../order/order.module';
import { UcpModule } from '../ucp/ucp.module';
import { CheckoutController } from './checkout.controller';
import { Checkout, CheckoutSchema } from './checkout.schema';
import { CheckoutService } from './checkout.service';

// UCP checkout capability: checkout lifecycle, catalogue and persistence.
// Completing a checkout places an Order through the Order module.
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Checkout.name, schema: CheckoutSchema }]),
    OrderModule,
    UcpModule,
  ],
  controllers: [CheckoutController],
  providers: [CheckoutService],
  exports: [CheckoutService],
})
export class CheckoutModule {}
