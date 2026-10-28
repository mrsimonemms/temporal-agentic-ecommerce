import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  type CheckoutCompleteRequest,
  CheckoutCompleteRequestSchema,
  type CheckoutCreateRequest,
  CheckoutCreateRequestSchema,
} from '@ucp-js/sdk';

import { schemaRef } from '../swagger';
import { UcpSchemaPipe } from '../ucp/ucp-schema.pipe';
import { completeCheckoutExample, createCheckoutExample } from './checkout.examples';
import { CheckoutService } from './checkout.service';

const checkoutIdParam = ApiParam({
  name: 'id',
  description: 'Checkout ID returned when the checkout was created',
  example: 'chk_0b6f7c1e-3f0a-4d2b-9a57-2f1c8e0d4b11',
});

const invalidRequestResponse = ApiBadRequestResponse({
  description:
    'The body does not match the official UCP request schema. No state is changed. ' +
    'A body that is not valid JSON is rejected by the HTTP server with its default error body.',
  schema: schemaRef('InvalidRequest'),
});

const checkoutOrErrorResponse = (description: string) =>
  ApiOkResponse({
    description,
    // anyOf rather than oneOf: the UCP schemas are not mutually exclusive
    schema: { anyOf: [schemaRef('CheckoutResponse'), schemaRef('ErrorResponse')] },
  });

// UCP checkout capability REST binding, relative to the advertised
// dev.ucp.shopping service endpoint
// @link https://ucp.dev/2026-08-25/specification/shopping/checkout/rest/
@ApiTags('UCP checkout')
@ApiInternalServerErrorResponse({
  description: 'Unexpected failure, such as MongoDB being unavailable',
})
@Controller('checkout-sessions')
export class CheckoutController {
  constructor(private readonly service: CheckoutService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a checkout',
    description:
      'Creates a checkout for items in the demo catalogue (`sku_kettle`, `sku_toaster` and ' +
      '`sku_mug_set`), priced in GBP minor units. The checkout is `ready_for_complete` when a ' +
      'buyer email is provided, otherwise `incomplete` with a message describing the missing ' +
      'information.',
  })
  @ApiBody({
    schema: schemaRef('CheckoutCreateRequest'),
    examples: { checkout: { summary: 'Two items with a buyer', value: createCheckoutExample } },
  })
  @ApiCreatedResponse({ description: 'Checkout created', schema: schemaRef('CheckoutResponse') })
  @ApiOkResponse({
    description:
      'No checkout was created: the line item list is empty (`missing`) or an item is not ' +
      'available (`item_unavailable`)',
    schema: schemaRef('ErrorResponse'),
  })
  @invalidRequestResponse
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
  @ApiOperation({ summary: 'Get a checkout' })
  @checkoutIdParam
  @checkoutOrErrorResponse(
    'The checkout, or an error response with code `not_found` when the checkout does not exist',
  )
  getCheckout(@Param('id') id: string) {
    return this.service.getCheckout(id);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete a checkout',
    description:
      'Completes a `ready_for_complete` checkout using a selected payment instrument from an ' +
      'advertised payment handler. Payment is stubbed: no provider is called and credentials are ' +
      'not stored. Completion starts the Temporal Order Workflow and, once the Order is ' +
      'recorded, returns the checkout as `completed` with an `order` reference.\n\n' +
      'If the Order cannot be placed the checkout remains `complete_in_progress`. Repeating ' +
      'the request resumes placement using the stored payment selection without creating a ' +
      'second Order.\n\n' +
      'Other outcomes are returned as the checkout with messages: `incomplete` checkouts are ' +
      'returned unchanged, a missing payment instrument returns `missing`, an unsupported ' +
      'handler returns `payment_failed` and any other status, such as `completed`, returns ' +
      '`operation_not_allowed`.',
  })
  @checkoutIdParam
  @ApiBody({
    schema: schemaRef('CheckoutCompleteRequest'),
    examples: { payment: { summary: 'Google Pay card', value: completeCheckoutExample } },
  })
  @checkoutOrErrorResponse(
    'The checkout after the completion attempt, or an error response with code `not_found` ' +
      'when the checkout does not exist',
  )
  @invalidRequestResponse
  completeCheckout(
    @Param('id') id: string,
    @Body(new UcpSchemaPipe(CheckoutCompleteRequestSchema)) body: CheckoutCompleteRequest,
  ) {
    return this.service.completeCheckout(id, body);
  }
}
