package activities

// CatalogueCurrency is the only currency the catalogue is priced in
const CatalogueCurrency = "GBP"

// Product is a purchasable item. Prices are in the minor unit of the
// catalogue currency (eg, pence) to avoid floating point rounding.
type Product struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	UnitPrice   int64  `json:"unitPrice"`
}

// catalogue mirrors the fixed demo catalogue in apps/api/src/checkout/catalogue.ts.
// It stands in for a real product and pricing system and must be kept in step
// with the API until the agent is integrated with a shared catalogue.
var catalogue = []Product{
	{ID: "sku_kettle", Title: "Stainless Steel Kettle", Description: "1.7 litre cordless electric kettle", UnitPrice: 3499},
	{ID: "sku_toaster", Title: "Four-Slice Toaster", Description: "Four-slot electric toaster", UnitPrice: 4999},
	{ID: "sku_mug_set", Title: "Stoneware Mug Set (4 pack)", Description: "One set of four stoneware mugs", UnitPrice: 2400},
}

func findProduct(id string) (Product, bool) {
	for _, p := range catalogue {
		if p.ID == id {
			return p, true
		}
	}
	return Product{}, false
}
