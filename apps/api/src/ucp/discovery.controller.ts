import { Controller, Get, VERSION_NEUTRAL, Version } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { schemaRef } from '../swagger';
import { UcpService } from './ucp.service';

@Controller()
export class DiscoveryController {
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
    return this.service.profile();
  }
}
