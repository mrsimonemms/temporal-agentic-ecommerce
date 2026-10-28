import { Module } from '@nestjs/common';

import { DiscoveryController } from './discovery.controller';
import { UcpService } from './ucp.service';

// UCP discovery and protocol-level helpers shared by the UCP capabilities
@Module({
  controllers: [DiscoveryController],
  providers: [UcpService],
  exports: [UcpService],
})
export class UcpModule {}
