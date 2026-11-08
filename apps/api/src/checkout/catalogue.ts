// Minimal, deterministic product catalogue standing in for real product and
// pricing systems. Prices are in the currency's minor unit (pence).
//
// This is the only source of catalogue data: checkout prices from it and the
// Shopping Agent discovers products through GET /v1/catalogue.
export const CATALOGUE_CURRENCY = 'GBP';

export interface CatalogueProduct {
  id: string;
  title: string;
  description: string;
  price: number;
}

const products: CatalogueProduct[] = [
  {
    id: 'sku_kettle',
    title: 'Stainless Steel Kettle',
    description: '1.7 litre cordless electric kettle',
    price: 3499,
  },
  {
    id: 'sku_toaster',
    title: 'Four-Slice Toaster',
    description: 'Four-slot electric toaster',
    price: 4999,
  },
  {
    id: 'sku_mug_set',
    title: 'Stoneware Mug Set (4 pack)',
    description: 'One set of four stoneware mugs',
    price: 2400,
  },
];

export function findProduct(id: string): CatalogueProduct | undefined {
  return products.find((product) => product.id === id);
}

// Every product, as copies so callers cannot change the catalogue
export function listProducts(): CatalogueProduct[] {
  return products.map((product) => ({ ...product }));
}
