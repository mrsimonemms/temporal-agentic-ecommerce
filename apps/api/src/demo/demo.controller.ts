import { Body, Controller, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { CheckoutService } from '../checkout/checkout.service';
import {
  orderIdParam,
  orderOrErrorResponse,
  orderUnavailableResponse,
} from '../order/order.controller';
import { OrderService } from '../order/order.service';
import { schemaRef } from '../swagger';
import { InventoryFailuresDto, InventoryFailuresResponseDto } from './inventory-failures.dto';

// Demo-only controls for driving an Order through its lifecycle. These are not
// part of UCP and stand in for events from real fulfilment systems.
@ApiTags('Demo')
@Controller('demo')
export class DemoController {
  constructor(
    private readonly checkouts: CheckoutService,
    private readonly orders: OrderService,
  ) {}

  @Put('checkout-sessions/:checkoutId/inventory-failures')
  @ApiOperation({
    summary: 'Simulate inventory reservation failures (demo only)',
    description:
      'Demo-only endpoint, not part of UCP. Configures how many inventory reservation ' +
      'attempts fail when the Order for this checkout is placed. Temporal retries the ' +
      'reservation Activity until it succeeds, after which the Order is confirmed. The ' +
      'setting applies only to this checkout and defaults to no failures. Send `0` to reset ' +
      'it.\n\nThe setting can only be changed while the checkout is `incomplete` or ' +
      '`ready_for_complete`. Once completion has started the Order Workflow may already exist.',
  })
  @ApiParam({
    name: 'checkoutId',
    description: 'Checkout ID returned when the checkout was created',
    example: 'chk_0b6f7c1e-3f0a-4d2b-9a57-2f1c8e0d4b11',
  })
  @ApiBody({
    type: InventoryFailuresDto,
    examples: { twoFailures: { summary: 'Fail twice, then succeed', value: { failures: 2 } } },
  })
  @ApiOkResponse({ description: 'The configuration was saved', type: InventoryFailuresResponseDto })
  @ApiBadRequestResponse({
    description: '`failures` is missing or is not an integer between 0 and 2147483647',
    schema: schemaRef('HttpError'),
  })
  @ApiNotFoundResponse({
    description: 'The checkout does not exist',
    schema: schemaRef('HttpError'),
  })
  @ApiConflictResponse({
    description: 'Checkout completion has started, so the configuration can no longer change',
    schema: schemaRef('HttpError'),
  })
  async setInventoryFailures(
    @Param('checkoutId') checkoutId: string,
    @Body() body: InventoryFailuresDto,
  ): Promise<InventoryFailuresResponseDto> {
    const demo = await this.checkouts.setInventoryFailures(checkoutId, body.failures);
    return { checkoutId, failures: demo.inventoryFailures };
  }

  @Post('orders/:id/fulfil')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark an order as fulfilled (demo only)',
    description:
      'Demo-only endpoint, not part of UCP. Sends the `markFulfilled` Signal to the Order ' +
      'Workflow and returns the resulting UCP Order. Repeating the request has no further ' +
      'effect. No request body is required.',
  })
  @orderIdParam
  @orderOrErrorResponse(
    'The updated Order, or an error response with code `not_found` when no running Order ' +
      'Workflow exists',
  )
  @orderUnavailableResponse
  fulfilOrder(@Param('id') id: string) {
    return this.orders.markOrderFulfilled(id);
  }
}
