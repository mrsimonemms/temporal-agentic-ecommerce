import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import type { OrderBuyer } from '../temporal/order-workflow';
import { DEMO_SCENARIOS, type DemoScenario } from '../temporal/shopping-agent-workflow';
import type {
  ProposalLine,
  PurchaseDecision,
  PurchaseDecisionRecord,
  PurchaseProposal,
  ShoppingAgent,
  ShoppingAgentDemoOptions,
  ShoppingAgentStatus,
} from '../temporal/shopping-agent-workflow';

// Matches the Workflow's input limits
const MAX_REQUEST_LENGTH = 1000;
const MAX_INVENTORY_FAILURES = 2;

const PURCHASE_DECISIONS: PurchaseDecision[] = ['approve', 'reject'];

const SHOPPING_AGENT_STATUSES: ShoppingAgentStatus[] = [
  'planning',
  'awaiting_approval',
  'approved',
  'purchasing',
  'purchased',
  'rejected',
  'failed',
];

export const shoppingAgentRequestExample =
  'Buy me a kettle and two sets of mugs. Keep it under £100.';

class ShoppingAgentBuyerDto implements OrderBuyer {
  @ApiProperty({ description: 'Buyer email, required for checkout', example: 'ada@example.com' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    description: 'Buyer name. The first word is sent as the first name at checkout.',
    example: 'Ada Lovelace',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}

class ShoppingAgentDemoDto implements ShoppingAgentDemoOptions {
  @ApiPropertyOptional({
    enum: DEMO_SCENARIOS,
    default: 'none',
    description:
      'Demo only. A named failure behaviour for the Shopping Agent, not the Order. `none` runs ' +
      'normally. `ai_service_unavailable` makes the first five attempts of the AI planning ' +
      'Activity fail as if the AI service were unavailable, before OpenAI is called. Temporal ' +
      'retries the Activity automatically and the sixth attempt plans the purchase. Catalogue ' +
      'retrieval is not repeated. Defaults to `none`.',
    example: 'ai_service_unavailable',
  })
  @IsOptional()
  @IsIn(DEMO_SCENARIOS)
  scenario?: DemoScenario;

  @ApiPropertyOptional({
    description:
      'Demo only. Number of inventory reservation attempts that fail for the Order the ' +
      'purchase places. Configured on the checkout before it is completed. Independent of ' +
      '`scenario`.',
    type: 'integer',
    minimum: 0,
    maximum: MAX_INVENTORY_FAILURES,
    example: 2,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_INVENTORY_FAILURES)
  inventoryFailures?: number;
}

export class StartShoppingAgentDto {
  @ApiProperty({
    description: 'Natural-language shopping request, including a budget',
    example: shoppingAgentRequestExample,
    maxLength: MAX_REQUEST_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'request must not be blank' })
  @MaxLength(MAX_REQUEST_LENGTH)
  request: string;

  @ApiProperty({ type: ShoppingAgentBuyerDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => ShoppingAgentBuyerDto)
  buyer: ShoppingAgentBuyerDto;

  @ApiPropertyOptional({
    type: ShoppingAgentDemoDto,
    description: 'Demo-only controls, kept separate from the purchase',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ShoppingAgentDemoDto)
  demo?: ShoppingAgentDemoDto;
}

export class StartShoppingAgentResponseDto {
  @ApiProperty({
    description: 'Shopping Agent Workflow ID',
    example: 'agent_0b6f7c1e-3f0a-4d2b-9a57-2f1c8e0d4b11',
  })
  id: string;
}

export class DecidePurchaseDto {
  @ApiProperty({ enum: PURCHASE_DECISIONS, example: 'approve' })
  @IsIn(PURCHASE_DECISIONS)
  decision: PurchaseDecision;

  @ApiPropertyOptional({ description: 'Who made the decision', example: 'ada@example.com' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  decidedBy?: string;

  @ApiPropertyOptional({ example: 'Looks good', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

// Shopping Agent Workflow state returned by the demo endpoints

class ProposalLineDto implements ProposalLine {
  @ApiProperty({ example: 'sku_kettle' })
  productId: string;

  @ApiProperty({ example: 'Stainless Steel Kettle' })
  title: string;

  @ApiProperty({ type: 'integer', example: 1 })
  quantity: number;

  @ApiProperty({ type: 'integer', description: 'Price in the minor unit', example: 3499 })
  unitPrice: number;

  @ApiProperty({ type: 'integer', description: 'Line total in the minor unit', example: 3499 })
  total: number;
}

class PurchaseProposalDto implements PurchaseProposal {
  @ApiProperty({ type: [ProposalLineDto] })
  lines: ProposalLineDto[];

  @ApiProperty({ example: 'GBP' })
  currency: string;

  @ApiProperty({
    type: 'integer',
    description: 'Total calculated by the worker from catalogue prices, in the minor unit',
    example: 8299,
  })
  total: number;

  @ApiProperty({
    type: 'integer',
    description: 'Budget interpreted from the request, in the minor unit',
    example: 10000,
  })
  budget: number;
}

class PurchaseDecisionRecordDto implements PurchaseDecisionRecord {
  @ApiProperty({ enum: PURCHASE_DECISIONS })
  decision: PurchaseDecision;

  @ApiPropertyOptional()
  decidedBy?: string;

  @ApiPropertyOptional()
  note?: string;

  @ApiProperty({ format: 'date-time' })
  decidedAt: string;
}

export class ShoppingAgentStateDto implements Omit<ShoppingAgent, 'demo'> {
  @ApiProperty({ example: 'agent_0b6f7c1e-3f0a-4d2b-9a57-2f1c8e0d4b11' })
  id: string;

  @ApiProperty({
    enum: SHOPPING_AGENT_STATUSES,
    description:
      '`planning` while the AI agent selects products, `awaiting_approval` until a decision ' +
      'is made, `approved` briefly once approved, `purchasing` while the checkout is created ' +
      'and completed, then `purchased`. `rejected` and `failed` are final.',
  })
  status: ShoppingAgentStatus;

  @ApiProperty({
    description: 'The original request. Absent only if the Workflow ended without state.',
    example: shoppingAgentRequestExample,
  })
  request: string;

  @ApiProperty({
    type: ShoppingAgentBuyerDto,
    description: 'Absent only if the Workflow ended without state',
  })
  buyer: ShoppingAgentBuyerDto;

  @ApiPropertyOptional({
    type: PurchaseProposalDto,
    description: 'The validated purchase, once planned',
  })
  proposal?: PurchaseProposalDto;

  @ApiPropertyOptional({ type: PurchaseDecisionRecordDto })
  decision?: PurchaseDecisionRecordDto;

  @ApiPropertyOptional({ description: 'Why the agent could not satisfy the request' })
  explanation?: string;

  @ApiPropertyOptional({
    description: 'UCP checkout created for the approved purchase',
    example: 'chk_0b6f7c1e-3f0a-4d2b-9a57-2f1c8e0d4b11',
  })
  checkoutId?: string;

  @ApiPropertyOptional({
    description: 'Order placed when the checkout completed',
    example: 'ord_0b6f7c1e-3f0a-4d2b-9a57-2f1c8e0d4b11',
  })
  orderId?: string;

  @ApiPropertyOptional({
    description: 'Buyer-facing Order page',
    example: 'http://localhost:9999/orders/ord_0b6f7c1e-3f0a-4d2b-9a57-2f1c8e0d4b11',
  })
  orderPermalinkUrl?: string;

  @ApiPropertyOptional({ description: 'Why planning or purchasing failed' })
  error?: string;

  @ApiPropertyOptional({ type: ShoppingAgentDemoDto })
  demo?: ShoppingAgentDemoDto;

  @ApiProperty({
    format: 'date-time',
    description: 'Absent only if the Workflow ended without state',
  })
  createdAt: string;
}
