import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Res } from '@nestjs/common';
import {
  type CheckoutCompleteRequest,
  CheckoutCompleteRequestSchema,
  type CheckoutCreateRequest,
  CheckoutCreateRequestSchema,
} from '@ucp-js/sdk';

import { UcpSchemaPipe } from './ucp-schema.pipe';
import { UcpService } from './ucp.service';

// UCP checkout capability REST binding, relative to the advertised
// dev.ucp.shopping service endpoint
// @link https://ucp.dev/2026-08-25/specification/shopping/checkout/rest/
@Controller('ucp/checkout-sessions')
export class CheckoutController {
  constructor(private readonly service: UcpService) {}

  @Post()
  async createCheckout(
    @Body(new UcpSchemaPipe(CheckoutCreateRequestSchema)) body: CheckoutCreateRequest,
    @Res({ passthrough: true }) res: { status(code: number): unknown },
  ) {
    const result = await this.service.createCheckout(body);

    // A business outcome where no checkout was created is returned with HTTP 200
    res.status('id' in result ? HttpStatus.CREATED : HttpStatus.OK);

    return result;
  }

  @Get(':id')
  getCheckout(@Param('id') id: string) {
    return this.service.getCheckout(id);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  completeCheckout(
    @Param('id') id: string,
    @Body(new UcpSchemaPipe(CheckoutCompleteRequestSchema)) body: CheckoutCompleteRequest,
  ) {
    return this.service.completeCheckout(id, body);
  }
}
