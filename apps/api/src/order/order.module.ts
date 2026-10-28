import { Module } from '@nestjs/common';

import { TemporalModule } from '../temporal/temporal.module';
import { UcpModule } from '../ucp/ucp.module';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';

// UCP order capability and buyer-facing permalink. The Order Workflow is the
// authoritative source of Order state.
@Module({
  imports: [TemporalModule, UcpModule],
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
