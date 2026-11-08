import { ApiProperty } from '@nestjs/swagger';

// Merchant catalogue returned by GET /v1/catalogue. Not a UCP resource.

export class CatalogueProductDto {
  @ApiProperty({ description: 'Product ID, used as the UCP line item ID', example: 'sku_kettle' })
  id: string;

  @ApiProperty({ example: 'Stainless Steel Kettle' })
  title: string;

  @ApiProperty({ example: '1.7 litre cordless electric kettle' })
  description: string;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: 'Unit price in the minor unit of the catalogue currency',
    example: 3499,
  })
  unitPrice: number;
}

export class CatalogueDto {
  @ApiProperty({
    description: 'ISO 4217 currency every product is priced in',
    example: 'GBP',
  })
  currency: string;

  @ApiProperty({ type: [CatalogueProductDto] })
  products: CatalogueProductDto[];
}
