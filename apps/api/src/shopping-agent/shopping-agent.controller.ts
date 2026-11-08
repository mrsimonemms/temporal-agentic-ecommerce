import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { schemaRef } from '../swagger';
import { ClosedShoppingAgent, ShoppingAgent } from '../temporal/shopping-agent-workflow';
import {
  DecidePurchaseDto,
  ShoppingAgentStateDto,
  StartShoppingAgentDto,
  StartShoppingAgentResponseDto,
  shoppingAgentRequestExample,
} from './shopping-agent.dto';
import { ShoppingAgentService } from './shopping-agent.service';

const agentIdParam = ApiParam({
  name: 'id',
  description: 'Shopping agent ID returned when the request was started',
  example: 'agent_0b6f7c1e-3f0a-4d2b-9a57-2f1c8e0d4b11',
});

const agentNotFoundResponse = ApiNotFoundResponse({
  description: 'No Shopping Agent Workflow exists with this ID',
  schema: schemaRef('HttpError'),
});

const temporalUnavailableResponse = ApiInternalServerErrorResponse({
  description: 'Unexpected failure, such as Temporal being unavailable or not responding in time',
});

// Demo-only endpoints for the AI Shopping Agent. These are not part of UCP:
// the agent itself buys through the UCP checkout endpoints, like any other
// UCP client.
@ApiTags('Demo')
@Controller('demo/shopping-agents')
export class ShoppingAgentController {
  constructor(private readonly service: ShoppingAgentService) {}

  @Post()
  @ApiOperation({
    summary: 'Start a shopping request (demo only)',
    description:
      'Demo-only endpoint, not part of UCP. Starts a Shopping Agent Workflow for a ' +
      'natural-language request. The agent uses an AI model with function calling to select ' +
      'products from the catalogue, the worker validates the proposal against the catalogue ' +
      'and budget, and the Workflow then waits durably for a human decision.\n\n' +
      'Once approved, the Workflow creates and completes a UCP checkout, which places an Order ' +
      'that continues independently in its own Workflow.\n\n' +
      '`demo.inventoryFailures` optionally simulates up to two inventory reservation failures ' +
      'for that Order. It is applied to the checkout before completion and is not part of the ' +
      'purchase.\n\nReturns once the Workflow has started: planning continues in the background.',
  })
  @ApiBody({
    type: StartShoppingAgentDto,
    examples: {
      kettleAndMugs: {
        summary: 'A kettle and two sets of mugs',
        value: {
          request: shoppingAgentRequestExample,
          buyer: { email: 'ada@example.com', name: 'Ada Lovelace' },
        },
      },
      withInventoryFailures: {
        summary: 'The same request with two simulated inventory failures',
        value: {
          request: shoppingAgentRequestExample,
          buyer: { email: 'ada@example.com', name: 'Ada Lovelace' },
          demo: { inventoryFailures: 2 },
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'The Shopping Agent Workflow was started',
    type: StartShoppingAgentResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      '`request` is missing, blank or longer than 1000 characters, `buyer.email` is not an ' +
      'email address, or `demo.inventoryFailures` is not an integer between 0 and 2',
    schema: schemaRef('HttpError'),
  })
  @temporalUnavailableResponse
  start(@Body() body: StartShoppingAgentDto): Promise<StartShoppingAgentResponseDto> {
    return this.service.start(body);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get the shopping agent state (demo only)',
    description:
      'Demo-only endpoint, not part of UCP. Returns the Shopping Agent state: the request, ' +
      'status, validated proposal, decision and, once purchased, the checkout and Order ' +
      'references.\n\nWhile the Workflow is running the state is read with the ' +
      '`getShoppingAgent` Query. Once it has completed, the state is its result. If it failed, ' +
      'the state attached to the failure is returned with status `failed` and the reason in ' +
      '`error`. A Workflow that ended without recording state, for example because it was ' +
      'terminated, returns only `id`, `status` (`failed`) and `error`.',
  })
  @agentIdParam
  @ApiOkResponse({ description: 'The Shopping Agent state', type: ShoppingAgentStateDto })
  @agentNotFoundResponse
  @temporalUnavailableResponse
  get(@Param('id') id: string): Promise<ShoppingAgent | ClosedShoppingAgent> {
    return this.service.get(id);
  }

  @Post(':id/decision')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve or reject the proposed purchase (demo only)',
    description:
      'Demo-only endpoint, not part of UCP. Executes the `decidePurchase` Update. The Workflow ' +
      'only accepts a decision while it is `awaiting_approval`, and only one decision is ' +
      'accepted.\n\nApproving returns the state with status `approved`: the Workflow then ' +
      'purchases in the background, so poll the state to follow it to `purchased`. Rejecting ' +
      'returns the final state with status `rejected` and no checkout is created.\n\n' +
      'Rejected decisions are returned as HTTP 409 with the reason given by the Workflow and do ' +
      'not change the state.',
  })
  @agentIdParam
  @ApiBody({
    type: DecidePurchaseDto,
    examples: {
      approve: {
        summary: 'Approve the purchase',
        value: { decision: 'approve', decidedBy: 'ada@example.com', note: 'Looks good' },
      },
      reject: {
        summary: 'Reject the purchase',
        value: { decision: 'reject', decidedBy: 'ada@example.com', note: 'Too expensive' },
      },
    },
  })
  @ApiOkResponse({
    description: 'The decision was accepted. Returns the state when it was recorded.',
    type: ShoppingAgentStateDto,
  })
  @ApiBadRequestResponse({
    description: '`decision` is not `approve` or `reject`, or `decidedBy` or `note` is too long',
    schema: schemaRef('HttpError'),
  })
  @agentNotFoundResponse
  @ApiConflictResponse({
    description:
      'The Workflow rejected the decision, for example because it is still planning or a ' +
      'decision was already made, or the Workflow has finished',
    schema: schemaRef('HttpError'),
  })
  @temporalUnavailableResponse
  decide(@Param('id') id: string, @Body() body: DecidePurchaseDto): Promise<ShoppingAgent> {
    return this.service.decide(id, body);
  }
}
