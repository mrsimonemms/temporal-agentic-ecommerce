package activities

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
)

// ErrTypeInvalidCatalogue is returned when the commerce API returns a
// catalogue the agent cannot use. It is non-retryable.
const ErrTypeInvalidCatalogue = "InvalidCatalogue"

const (
	// maxCatalogueProducts bounds the snapshot recorded in the Workflow
	// history and sent to the model
	maxCatalogueProducts = 100
	// maxUnitPrice bounds prices so totals cannot overflow
	maxUnitPrice = 1_000_000_000
)

var currencyCode = regexp.MustCompile(`^[A-Z]{3}$`)

// Product is a purchasable item. Prices are in the minor unit of the
// catalogue currency (eg, pence) to avoid floating point rounding.
type Product struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	UnitPrice   int64  `json:"unitPrice"`
}

// Catalogue is a snapshot of the merchant catalogue. The commerce API owns the
// catalogue: the worker holds no product data of its own.
type Catalogue struct {
	Currency string    `json:"currency"`
	Products []Product `json:"products"`
}

func (c *Catalogue) find(id string) (Product, bool) {
	for _, p := range c.Products {
		if p.ID == id {
			return p, true
		}
	}
	return Product{}, false
}

// validate rejects a catalogue that proposals cannot safely be priced from
func (c *Catalogue) validate() error {
	var errs []error
	if !currencyCode.MatchString(c.Currency) {
		errs = append(errs, fmt.Errorf("currency %q is not an ISO 4217 code", c.Currency))
	}
	if len(c.Products) == 0 || len(c.Products) > maxCatalogueProducts {
		errs = append(errs, fmt.Errorf("catalogue must have between 1 and %d products", maxCatalogueProducts))
	}

	seen := map[string]bool{}
	for k, p := range c.Products {
		if p.ID == "" {
			errs = append(errs, fmt.Errorf("product %d: id is required", k))
		} else if seen[p.ID] {
			errs = append(errs, fmt.Errorf("product %d: id %q appears more than once", k, p.ID))
		}
		seen[p.ID] = true
		if p.Title == "" {
			errs = append(errs, fmt.Errorf("product %d: title is required", k))
		}
		if p.UnitPrice < 0 || p.UnitPrice > maxUnitPrice {
			errs = append(errs, fmt.Errorf("product %d: unitPrice must be between 0 and %d", k, maxUnitPrice))
		}
	}
	return errors.Join(errs...)
}

// GetCatalogue retrieves the catalogue from the commerce API. The Workflow
// records the result, so planning uses one consistent snapshot and a retried
// planning attempt does not fetch the catalogue again.
func (a *Activities) GetCatalogue(ctx context.Context) (*Catalogue, error) {
	data, err := a.commerceCall(ctx, http.MethodGet, "catalogue", "", nil)
	if err != nil {
		return nil, err
	}

	var catalogue Catalogue
	if err := json.Unmarshal(data, &catalogue); err != nil {
		return nil, temporal.NewNonRetryableApplicationError("unable to decode catalogue", ErrTypeInvalidCatalogue, err)
	}
	if err := catalogue.validate(); err != nil {
		return nil, temporal.NewNonRetryableApplicationError("invalid catalogue", ErrTypeInvalidCatalogue, err)
	}

	activity.GetLogger(ctx).Info("Catalogue retrieved", "products", len(catalogue.Products), "currency", catalogue.Currency)
	return &catalogue, nil
}
