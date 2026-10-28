import { Module } from '@nestjs/common';

import { CheckoutModule } from '../checkout/checkout.module';
import { OrderModule } from '../order/order.module';
import { DemoController } from './demo.controller';

// Demo-only controls that are not part of UCP
@Module({
  imports: [CheckoutModule, OrderModule],
  controllers: [DemoController],
})
export class DemoModule {}
