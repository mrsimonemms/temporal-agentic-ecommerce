import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

// Upper bound of the Go int32 field the value is passed to
const MAX_INVENTORY_FAILURES = 2_147_483_647;

export class InventoryFailuresDto {
  @ApiProperty({
    description:
      'Number of inventory reservation attempts that fail before reservation succeeds. ' +
      '`0` disables simulated failures.',
    type: 'integer',
    minimum: 0,
    maximum: MAX_INVENTORY_FAILURES,
    example: 2,
  })
  @IsInt()
  @Min(0)
  @Max(MAX_INVENTORY_FAILURES)
  failures: number;
}

export class InventoryFailuresResponseDto {
  @ApiProperty({ example: 'chk_0b6f7c1e-3f0a-4d2b-9a57-2f1c8e0d4b11' })
  checkoutId: string;

  @ApiProperty({ type: 'integer', minimum: 0, example: 2 })
  failures: number;
}
