// Minimal, deterministic product catalogue standing in for real product and
// pricing systems. Prices are in the currency's minor unit (pence).
export const CATALOGUE_CURRENCY = 'GBP';

export interface CatalogueProduct {
  id: string;
  title: string;
  price: number;
}

const products: CatalogueProduct[] = [
  { id: 'sku_kettle', title: 'Stainless Steel Kettle', price: 3499 },
  { id: 'sku_toaster', title: 'Four-Slice Toaster', price: 4999 },
  { id: 'sku_mug_set', title: 'Stoneware Mug Set (4 pack)', price: 2400 },
];

export function findProduct(id: string): CatalogueProduct | undefined {
  return products.find((product) => product.id === id);
}
