import { Controller, Get, Post, VERSION_NEUTRAL, Version } from '@nestjs/common';

import { UcpService } from './ucp.service';

@Controller()
export class UcpController {
  constructor(private readonly service: UcpService) {}

  @Get('/.well-known/ucp')
  @Version(VERSION_NEUTRAL)
  discovery() {
    return this.service.getMerchantProfile();
  }

  // @todo(sje): stubbed
  @Get('ucp')
  ucp() {
    return {
      hello: 'world',
    };
  }

  // @todo(sje): stubbed
  @Post('webhooks/ucp/orders')
  createOrderWebhook() {
    return {
      hello: 'world',
    };
  }
}
