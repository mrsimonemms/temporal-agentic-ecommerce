package activities_test

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/mrsimonemms/temporal-agentic-ecommerce/workers/order/internal/app/activities"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/testsuite"
)

const errDecodeCatalogue = "unable to decode catalogue"

func getCatalogue(t *testing.T, acts *activities.Activities) (*activities.Catalogue, error) {
	t.Helper()

	var s testsuite.WorkflowTestSuite
	env := s.NewTestActivityEnvironment()
	env.RegisterActivity(acts)

	res, err := env.ExecuteActivity(acts.GetCatalogue)
	if err != nil {
		return nil, err
	}

	var catalogue activities.Catalogue
	require.NoError(t, res.Get(&catalogue))
	return &catalogue, nil
}

func serveCatalogue(status int, body any) *fakeCommerce {
	return &fakeCommerce{respond: func(commerceRequest) (int, any) { return status, body }}
}

func TestGetCatalogue(t *testing.T) {
	fake := serveCatalogue(http.StatusOK, kitchenCatalogue())
	acts := newCommerceAgent(t, fake)

	catalogue, err := getCatalogue(t, acts)
	require.NoError(t, err)
	assert.Equal(t, kitchenCatalogue(), *catalogue)

	requests := fake.recorded()
	require.Len(t, requests, 1)
	assert.Equal(t, http.MethodGet, requests[0].method)
	assert.Equal(t, "/v1/catalogue", requests[0].path)
	assert.Empty(t, requests[0].body)
	assert.Empty(t, requests[0].idempotencyKey)
}

func TestGetCatalogueIgnoresAdditionalFields(t *testing.T) {
	// The commerce API may add product information the agent does not use
	acts := newCommerceAgent(t, serveCatalogue(http.StatusOK, rawBody(`{
		"currency": "GBP",
		"products": [{"id": "sku_kettle", "title": "Kettle", "unitPrice": 3499, "imageUrl": "/kettle.png"}],
		"updatedAt": "2026-11-08T12:00:00Z"
	}`)))

	catalogue, err := getCatalogue(t, acts)
	require.NoError(t, err)
	assert.Equal(t, []activities.Product{{ID: kettleSKU, Title: "Kettle", UnitPrice: 3499}}, catalogue.Products)
}

func TestGetCatalogueTransientFailuresAreRetryable(t *testing.T) {
	for _, status := range []int{
		http.StatusRequestTimeout,
		http.StatusTooManyRequests,
		http.StatusInternalServerError,
		http.StatusServiceUnavailable,
	} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			acts := newCommerceAgent(t, serveCatalogue(status, httpError{StatusCode: status, Message: unavailable}))

			_, err := getCatalogue(t, acts)
			assertAppError(t, err, activities.ErrTypeCommerceUnavailable, false)
		})
	}

	t.Run("network error", func(t *testing.T) {
		acts, err := activities.NewActivities("sk-test-unused", activities.DefaultOpenAIModel, "http://127.0.0.1:1/v1")
		require.NoError(t, err)

		_, err = getCatalogue(t, acts)
		assertAppError(t, err, activities.ErrTypeCommerceUnavailable, false)
	})
}

func TestGetCataloguePermanentFailuresAreNotRetried(t *testing.T) {
	for _, status := range []int{http.StatusBadRequest, http.StatusUnauthorized, http.StatusNotFound} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			acts := newCommerceAgent(t, serveCatalogue(status, httpError{StatusCode: status, Message: "Cannot GET /v1/catalogue"}))

			_, err := getCatalogue(t, acts)
			assertAppError(t, err, activities.ErrTypeCheckoutRejected, true)
			assert.Contains(t, err.Error(), fmt.Sprintf("status %d", status))
		})
	}
}

func TestGetCatalogueRejectsInvalidResponses(t *testing.T) {
	product := func(id string, price int64) activities.Product {
		return activities.Product{ID: id, Title: "Product " + id, UnitPrice: price}
	}
	tooMany := make([]activities.Product, 101)
	for i := range tooMany {
		tooMany[i] = product(fmt.Sprintf("sku_%d", i), 100)
	}

	tests := map[string]struct {
		body     any
		expected string
	}{
		"malformed JSON": {body: rawBody(`{"currency":`), expected: errDecodeCatalogue},
		"not an object":  {body: rawBody(`[]`), expected: errDecodeCatalogue},
		"string price": {
			body:     rawBody(`{"currency":"GBP","products":[{"id":"a","title":"A","unitPrice":"34.99"}]}`),
			expected: errDecodeCatalogue,
		},
		"no products":       {body: activities.Catalogue{Currency: gbp}, expected: "between 1 and 100 products"},
		"too many products": {body: activities.Catalogue{Currency: gbp, Products: tooMany}, expected: "between 1 and 100 products"},
		"missing currency": {
			body:     activities.Catalogue{Products: []activities.Product{product("a", 1)}},
			expected: "ISO 4217",
		},
		"lowercase currency": {
			body:     activities.Catalogue{Currency: "gbp", Products: []activities.Product{product("a", 1)}},
			expected: "ISO 4217",
		},
		"missing id": {
			body:     activities.Catalogue{Currency: gbp, Products: []activities.Product{product("", 1)}},
			expected: "id is required",
		},
		"duplicate id": {
			body:     activities.Catalogue{Currency: gbp, Products: []activities.Product{product("a", 1), product("a", 2)}},
			expected: `id "a" appears more than once`,
		},
		"missing title": {
			body:     activities.Catalogue{Currency: gbp, Products: []activities.Product{{ID: "a", UnitPrice: 1}}},
			expected: "title is required",
		},
		"negative price": {
			body:     activities.Catalogue{Currency: gbp, Products: []activities.Product{product("a", -1)}},
			expected: "unitPrice must be between 0",
		},
		"excessive price": {
			body:     activities.Catalogue{Currency: gbp, Products: []activities.Product{product("a", 1_000_000_001)}},
			expected: "unitPrice must be between 0",
		},
	}

	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			acts := newCommerceAgent(t, serveCatalogue(http.StatusOK, test.body))

			_, err := getCatalogue(t, acts)
			assertAppError(t, err, activities.ErrTypeInvalidCatalogue, true)
			assert.Contains(t, err.Error(), test.expected)
		})
	}
}
