import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiInternalServerErrorResponse,
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
import { Order as OrderState } from '../temporal/order-workflow';
import {
  OrderStateDto,
  ReportFulfilmentExceptionDto,
  ResolveFulfilmentExceptionDto,
} from './fulfilment-exception.dto';
import { InventoryFailuresDto, InventoryFailuresResponseDto } from './inventory-failures.dto';

const orderIdPathParam = ApiParam({
  name: 'orderId',
  description: 'Order ID from the `order` reference of a completed checkout',
  example: 'ord_0b6f7c1e-3f0a-4d2b-9a57-2f1c8e0d4b11',
});

const orderNotFoundResponse = ApiNotFoundResponse({
  description: 'No running Order Workflow exists with this ID',
  schema: schemaRef('HttpError'),
});

const orderStateUnavailableResponse = ApiInternalServerErrorResponse({
  description: 'Unexpected failure, such as Temporal being unavailable or not responding in time',
});

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

  @Get('orders/:orderId')
  @ApiOperation({
    summary: 'Get the Order Workflow state (demo only)',
    description:
      'Demo-only endpoint, not part of UCP. Returns the current state of the Order Workflow, ' +
      'queried with the `getOrder` Query. This is the internal operational view used to ' +
      'observe the demo: it includes the Workflow status (`reserving_inventory`, `confirmed`, ' +
      '`awaiting_intervention` or `fulfilled`), the inventory reservation and the fulfilment ' +
      'plan, none of which are exposed by the UCP Order.\n\nRead-only: the Order is not ' +
      'changed. This is not a UCP Order.',
  })
  @orderIdPathParam
  @ApiOkResponse({ description: 'The current Order Workflow state', type: OrderStateDto })
  @orderNotFoundResponse
  @orderStateUnavailableResponse
  getOrderState(@Param('orderId') orderId: string): Promise<OrderState> {
    return this.orders.getOrderState(orderId);
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

  @Post('orders/:orderId/fulfilment-exception')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Report a fulfilment exception (demo only)',
    description:
      'Demo-only endpoint, not part of UCP. Sends the `reportFulfilmentException` Signal to the ' +
      'Order Workflow, standing in for a supplier reporting a business problem with a line. ' +
      'The Order moves to `awaiting_intervention` and waits for a decision.\n\n' +
      'The Workflow only accepts an exception for a line of a `confirmed` Order with no other ' +
      'exception outstanding. Delivery is not treated as acceptance: the Order is read back and ' +
      'HTTP 409 is returned if the exception was not recorded.\n\n' +
      'Returns the Order Workflow state, which includes the fulfilment plan. This is not a UCP ' +
      'Order.',
  })
  @orderIdPathParam
  @ApiBody({
    type: ReportFulfilmentExceptionDto,
    examples: {
      supplierUnavailable: {
        summary: 'Item unavailable at the selected warehouse',
        value: {
          lineId: 'li_2',
          reason: 'Supplier reports the item is unavailable at the selected warehouse',
        },
      },
    },
  })
  @ApiOkResponse({ description: 'The exception was recorded', type: OrderStateDto })
  @ApiBadRequestResponse({
    description: '`lineId` or `reason` is missing or empty',
    schema: schemaRef('HttpError'),
  })
  @orderNotFoundResponse
  @ApiConflictResponse({
    description: 'The Order did not accept the exception, for example because it is not confirmed',
    schema: schemaRef('HttpError'),
  })
  @orderStateUnavailableResponse
  reportFulfilmentException(
    @Param('orderId') orderId: string,
    @Body() body: ReportFulfilmentExceptionDto,
  ): Promise<OrderState> {
    return this.orders.reportFulfilmentException(orderId, body);
  }

  @Post('orders/:orderId/resolve-fulfilment-exception')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve an alternative fulfilment source (demo only)',
    description:
      'Demo-only endpoint, not part of UCP. Executes the `resolveFulfilmentException` Update, ' +
      'standing in for an operator decision. Approving an alternative source for the affected ' +
      'line records the decision in the fulfilment plan and returns the Order to `confirmed`. ' +
      'What was purchased is unchanged.\n\n' +
      'The Workflow validates the resolution and rejects it unless the Order is awaiting ' +
      'intervention and `lineId` is the affected line. Rejections are returned as HTTP 409 ' +
      'with the reason given by the Workflow and do not change the Order.\n\n' +
      'Returns the Order Workflow state. This is not a UCP Order.',
  })
  @orderIdPathParam
  @ApiBody({
    type: ResolveFulfilmentExceptionDto,
    examples: {
      alternativeSource: {
        summary: 'Fulfil from another warehouse',
        value: {
          lineId: 'li_2',
          alternativeSource: 'warehouse-north',
          approvedBy: 'ops@example.com',
          note: 'Same item, ships a day later',
        },
      },
    },
  })
  @ApiOkResponse({ description: 'The resolution was applied', type: OrderStateDto })
  @ApiBadRequestResponse({
    description: '`lineId`, `alternativeSource` or `approvedBy` is missing or empty',
    schema: schemaRef('HttpError'),
  })
  @orderNotFoundResponse
  @ApiConflictResponse({
    description: 'The Workflow rejected the resolution',
    schema: schemaRef('HttpError'),
  })
  @orderStateUnavailableResponse
  resolveFulfilmentException(
    @Param('orderId') orderId: string,
    @Body() body: ResolveFulfilmentExceptionDto,
  ): Promise<OrderState> {
    return this.orders.resolveFulfilmentException(orderId, body);
  }
}
