import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  orderIdParam,
  orderOrErrorResponse,
  orderUnavailableResponse,
} from '../order/order.controller';
import { OrderService } from '../order/order.service';

// Demo-only controls for driving an Order through its lifecycle. These are not
// part of UCP and stand in for events from real fulfilment systems.
@ApiTags('Demo')
@Controller('demo')
export class DemoController {
  constructor(private readonly orders: OrderService) {}

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
