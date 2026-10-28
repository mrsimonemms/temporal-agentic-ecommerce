import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

import type {
  FulfilmentDecision,
  FulfilmentException,
  FulfilmentPlan,
  FulfilmentResolution,
  FulfilmentSource,
  Order,
  OrderBuyer,
  OrderLine,
  OrderStatus,
  ReportFulfilmentExceptionSignal,
  ResolveFulfilmentExceptionRequest,
} from '../temporal/order-workflow';

// Request bodies match the Order Workflow payloads. Only their shape is
// validated here: rules that depend on the Order are applied by the Workflow.

export class ReportFulfilmentExceptionDto implements ReportFulfilmentExceptionSignal {
  @ApiProperty({ description: 'ID of the affected Order line', example: 'li_2' })
  @IsString()
  @IsNotEmpty()
  lineId: string;

  @ApiProperty({
    description: 'Human-readable description of the problem',
    example: 'Supplier reports the item is unavailable at the selected warehouse',
  })
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class ResolveFulfilmentExceptionDto implements ResolveFulfilmentExceptionRequest {
  @ApiProperty({ description: 'ID of the line affected by the exception', example: 'li_2' })
  @IsString()
  @IsNotEmpty()
  lineId: string;

  @ApiProperty({
    description: 'Approved alternative source to fulfil the line from',
    example: 'warehouse-north',
  })
  @IsString()
  @IsNotEmpty()
  alternativeSource: string;

  @ApiProperty({ description: 'Who approved the decision', example: 'ops@example.com' })
  @IsString()
  @IsNotEmpty()
  approvedBy: string;

  @ApiPropertyOptional({ example: 'Same item, ships a day later' })
  @IsOptional()
  @IsString()
  note?: string;
}

// Order Workflow state returned by the demo endpoints. This is the internal
// representation, not a UCP Order.

class OrderBuyerDto implements OrderBuyer {
  @ApiPropertyOptional()
  id?: string;

  @ApiPropertyOptional()
  name?: string;

  @ApiProperty()
  email: string;
}

class OrderLineDto implements OrderLine {
  @ApiProperty()
  id: string;

  @ApiProperty()
  productId: string;

  @ApiPropertyOptional()
  title?: string;

  @ApiProperty({ type: 'integer' })
  quantity: number;

  @ApiProperty({ type: 'integer', description: 'Price in the minor unit of the currency' })
  unitPrice: number;
}

class FulfilmentSourceDto implements FulfilmentSource {
  @ApiProperty()
  lineId: string;

  @ApiProperty()
  source: string;
}

class FulfilmentExceptionDto implements FulfilmentException {
  @ApiProperty()
  lineId: string;

  @ApiProperty()
  reason: string;

  @ApiProperty({ format: 'date-time' })
  raisedAt: string;
}

class FulfilmentResolutionDto implements FulfilmentResolution {
  @ApiProperty()
  lineId: string;

  @ApiProperty()
  reason: string;

  @ApiProperty({ enum: ['alternative_source'] satisfies FulfilmentDecision[] })
  decision: FulfilmentDecision;

  @ApiProperty()
  alternativeSource: string;

  @ApiProperty()
  approvedBy: string;

  @ApiPropertyOptional()
  note?: string;

  @ApiProperty({ format: 'date-time' })
  raisedAt: string;

  @ApiProperty({ format: 'date-time' })
  resolvedAt: string;
}

class FulfilmentPlanDto implements FulfilmentPlan {
  @ApiPropertyOptional({
    type: [FulfilmentSourceDto],
    description: 'Approved alternative sources. Other lines use their original source.',
  })
  sources?: FulfilmentSourceDto[];

  @ApiPropertyOptional({
    type: FulfilmentExceptionDto,
    description: 'Unresolved exception preventing fulfilment',
  })
  exception?: FulfilmentExceptionDto;

  @ApiPropertyOptional({ type: [FulfilmentResolutionDto] })
  resolutions?: FulfilmentResolutionDto[];
}

export class OrderStateDto implements Order {
  @ApiProperty({ example: 'ord_0b6f7c1e-3f0a-4d2b-9a57-2f1c8e0d4b11' })
  id: string;

  @ApiProperty({
    enum: [
      'reserving_inventory',
      'confirmed',
      'awaiting_intervention',
      'fulfilled',
    ] satisfies OrderStatus[],
  })
  status: OrderStatus;

  @ApiProperty({ type: OrderBuyerDto })
  buyer: OrderBuyerDto;

  @ApiProperty()
  currency: string;

  @ApiProperty({ type: [OrderLineDto] })
  lines: OrderLineDto[];

  @ApiProperty({ type: 'integer' })
  total: number;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiPropertyOptional({ format: 'date-time' })
  fulfilledAt?: string;

  @ApiPropertyOptional()
  inventoryReservationId?: string;

  @ApiProperty({ type: FulfilmentPlanDto })
  fulfilment: FulfilmentPlanDto;
}
