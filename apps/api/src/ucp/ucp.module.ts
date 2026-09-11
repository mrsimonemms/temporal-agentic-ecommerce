import { Get, Module } from '@nestjs/common';

import { UcpController } from './ucp.controller';
import { UcpService } from './ucp.service';

@Module({
  controllers: [UcpController],
  providers: [UcpService],
})
export class UcpModule {}
