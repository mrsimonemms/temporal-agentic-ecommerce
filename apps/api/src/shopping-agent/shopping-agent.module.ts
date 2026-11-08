import { Module } from '@nestjs/common';

import { TemporalModule } from '../temporal/temporal.module';
import { ShoppingAgentController } from './shopping-agent.controller';
import { ShoppingAgentService } from './shopping-agent.service';

// Demo-only control of the AI Shopping Agent Workflow. Not part of UCP.
@Module({
  imports: [TemporalModule],
  controllers: [ShoppingAgentController],
  providers: [ShoppingAgentService],
})
export class ShoppingAgentModule {}
