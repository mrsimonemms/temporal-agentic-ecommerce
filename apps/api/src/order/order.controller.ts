import {
  Controller,
  Get,
  Header,
  HttpStatus,
  Param,
  Res,
  VERSION_NEUTRAL,
  Version,
} from '@nestjs/common';
import {
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';

import { schemaRef } from '../swagger';
import { renderOrderNotFoundPage, renderOrderPage } from './order.page';
import { OrderService } from './order.service';

export const orderIdParam = ApiParam({
  name: 'id',
  description: 'Order ID from the `order` reference of a completed checkout',
  example: 'ord_0b6f7c1e-3f0a-4d2b-9a57-2f1c8e0d4b11',
});

export const orderOrErrorResponse = (description: string) =>
  ApiOkResponse({
    description,
    // anyOf rather than oneOf: the UCP schemas are not mutually exclusive
    schema: { anyOf: [schemaRef('Order'), schemaRef('ErrorResponse')] },
  });

export const orderUnavailableResponse = ApiInternalServerErrorResponse({
  description: 'Unexpected failure, such as Temporal being unavailable or not responding in time',
});

@Controller()
export class OrderController {
  constructor(private readonly service: OrderService) {}

  // UCP order capability REST binding, relative to the advertised
  // dev.ucp.shopping service endpoint
  // @link https://ucp.dev/2026-08-25/specification/shopping/order/rest/
  @Get('orders/:id')
  @ApiTags('UCP order')
  @ApiOperation({
    summary: 'Get an order',
    description:
      'Returns the current state of the Order, queried from its Temporal Order Workflow. Each ' +
      'line item reports `processing` until the Order is fulfilled, then `fulfilled` with its ' +
      'full quantity fulfilled. No fulfilment events are reported.',
  })
  @orderIdParam
  @orderOrErrorResponse(
    'The Order, or an error response with code `not_found` when the Order does not exist',
  )
  @orderUnavailableResponse
  getOrder(@Param('id') id: string) {
    return this.service.getOrder(id);
  }

  // Buyer-facing permalink, distinct from the UCP API endpoint
  @Get('/orders/:id')
  @Version(VERSION_NEUTRAL)
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiTags('Order permalink')
  @ApiOperation({
    summary: 'View an order',
    description:
      'Buyer-facing HTML page for the Order, linked from the `permalink_url` of the checkout ' +
      'order reference and the UCP Order. This path is not versioned.',
  })
  @orderIdParam
  @ApiProduces('text/html')
  @ApiOkResponse({ description: 'HTML page describing the Order', schema: { type: 'string' } })
  @ApiNotFoundResponse({
    description: 'HTML page stating that the Order was not found',
    schema: { type: 'string' },
  })
  @orderUnavailableResponse
  async orderPage(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: { status(code: number): unknown },
  ) {
    const order = await this.service.findOrder(id);
    if (!order) {
      res.status(HttpStatus.NOT_FOUND);
      return renderOrderNotFoundPage(id);
    }
    return renderOrderPage(order);
  }
}
