import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { TemporalModule } from '../temporal/temporal.module';
import { CheckoutController } from './checkout.controller';
import { Checkout, CheckoutSchema } from './checkout.schema';
import { UcpController } from './ucp.controller';
import { UcpService } from './ucp.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Checkout.name, schema: CheckoutSchema }]),
    TemporalModule,
  ],
  controllers: [UcpController, CheckoutController],
  providers: [UcpService],
})
export class UcpModule {}
