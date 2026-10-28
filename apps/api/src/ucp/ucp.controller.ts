import { Controller, Get, Post, VERSION_NEUTRAL, Version } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { schemaRef } from '../swagger';
import { UcpService } from './ucp.service';

@Controller()
export class UcpController {
  constructor(private readonly service: UcpService) {}

  @Get('/.well-known/ucp')
  @Version(VERSION_NEUTRAL)
  @ApiTags('UCP discovery')
  @ApiOperation({
    summary: 'Get the UCP merchant profile',
    description:
      'Returns the UCP profile document advertising the supported protocol version, ' +
      'capabilities, services and payment handlers. This path is not versioned.',
  })
  @ApiOkResponse({ description: 'UCP profile document', schema: schemaRef('UcpProfileDocument') })
  discovery() {
    return this.service.getMerchantProfile();
  }

  // @todo(sje): stubbed
  @Get('ucp')
  @ApiTags('Placeholders')
  @ApiOperation({
    summary: 'UCP service endpoint placeholder',
    description:
      'Not implemented. Returns a static placeholder body. This is not a UCP operation: UCP ' +
      'operations are relative to this advertised service endpoint, for example ' +
      '`/v1/ucp/checkout-sessions`.',
  })
  @ApiOkResponse({ description: 'Static placeholder body', schema: schemaRef('Placeholder') })
  ucp() {
    return {
      hello: 'world',
    };
  }

  // @todo(sje): stubbed
  @Post('webhooks/ucp/orders')
  @ApiTags('Placeholders')
  @ApiOperation({
    summary: 'UCP order webhook placeholder',
    description:
      'Not implemented. The request body is ignored and a static placeholder body is returned.',
  })
  @ApiCreatedResponse({ description: 'Static placeholder body', schema: schemaRef('Placeholder') })
  createOrderWebhook() {
    return {
      hello: 'world',
    };
  }
}
