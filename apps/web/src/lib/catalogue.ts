// Products offered by the demo catalogue in apps/api/src/checkout/catalogue.ts.
// The API does not expose its catalogue, so the IDs are mirrored here for
// selection only. Prices are deliberately omitted: they come from the
// checkout response, which is the source of truth.
export interface CatalogueItem {
  id: string;
  title: string;
}

export const CATALOGUE: CatalogueItem[] = [
  { id: 'sku_kettle', title: 'Stainless Steel Kettle' },
  { id: 'sku_toaster', title: 'Four-Slice Toaster' },
  { id: 'sku_mug_set', title: 'Stoneware Mug Set (4 pack)' },
];
