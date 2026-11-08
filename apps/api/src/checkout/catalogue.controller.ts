import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CATALOGUE_CURRENCY, listProducts } from './catalogue';
import { CatalogueDto } from './catalogue.dto';

// Read-only merchant catalogue. Checkout prices line items from the same
// catalogue, so this is a view of the authoritative data rather than a copy.
@ApiTags('Catalogue')
@Controller('catalogue')
export class CatalogueController {
  @Get()
  @ApiOperation({
    summary: 'List the product catalogue',
    description:
      'Returns every product that can be purchased, with unit prices in the minor unit of the ' +
      'catalogue currency. This is a merchant catalogue endpoint, not a UCP operation, and is ' +
      'not advertised in the UCP profile. Checkout prices line items from the same catalogue ' +
      'when the checkout is created, so a price shown here is not a guarantee.',
  })
  @ApiOkResponse({
    description: 'The catalogue',
    type: CatalogueDto,
    example: {
      currency: 'GBP',
      products: [
        {
          id: 'sku_kettle',
          title: 'Stainless Steel Kettle',
          description: '1.7 litre cordless electric kettle',
          unitPrice: 3499,
        },
        {
          id: 'sku_toaster',
          title: 'Four-Slice Toaster',
          description: 'Four-slot electric toaster',
          unitPrice: 4999,
        },
        {
          id: 'sku_mug_set',
          title: 'Stoneware Mug Set (4 pack)',
          description: 'One set of four stoneware mugs',
          unitPrice: 2400,
        },
      ],
    },
  })
  getCatalogue(): CatalogueDto {
    return {
      currency: CATALOGUE_CURRENCY,
      products: listProducts().map(({ id, title, description, price }) => ({
        id,
        title,
        description,
        unitPrice: price,
      })),
    };
  }
}
