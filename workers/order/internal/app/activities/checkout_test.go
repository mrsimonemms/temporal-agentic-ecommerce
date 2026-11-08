package activities_test

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/mrsimonemms/temporal-ucp-reference-architecture/workers/order/internal/app/activities"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/testsuite"
)

const (
	createKey   = "agent_123:create-checkout"
	completeKey = "agent_123:complete-checkout"
	checkoutID  = "chk_123"
	orderID     = "ord_123"
	handlerID   = "gpay"
	ucpVersion  = "2026-08-25"
	adaEmail    = "ada@example.com"
	gbp         = "GBP"
	kettleSKU   = "sku_kettle"
	mugSetSKU   = "sku_mug_set"
	kettleTitle = "Stainless Steel Kettle"
	unavailable = "unavailable"
)

func newCreateInput() *activities.CreateCheckoutInput {
	return &activities.CreateCheckoutInput{
		IdempotencyKey: createKey,
		Buyer:          activities.CheckoutBuyer{Email: adaEmail, FirstName: "Ada", LastName: "Lovelace"},
		Lines: []activities.CheckoutLine{
			{ProductID: kettleSKU, Quantity: 1},
			{ProductID: mugSetSKU, Quantity: 2},
		},
		Currency:      gbp,
		ExpectedTotal: 8299,
	}
}

var completeInput = activities.CompleteCheckoutInput{
	IdempotencyKey:   completeKey,
	CheckoutID:       checkoutID,
	PaymentHandlerID: handlerID,
	InstrumentID:     "pi_agent_123",
}

// commerceRequest is a request received by the fake commerce API
type commerceRequest struct {
	method         string
	path           string
	idempotencyKey string
	body           string
}

// fakeCommerce stands in for the commerce API. Each request is answered by
// respond, and every request is recorded.
type fakeCommerce struct {
	mu       sync.Mutex
	respond  func(req commerceRequest) (int, any)
	requests []commerceRequest
}

func (f *fakeCommerce) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()

	data, _ := io.ReadAll(r.Body)
	req := commerceRequest{method: r.Method, path: r.URL.Path, idempotencyKey: r.Header.Get("Idempotency-Key"), body: string(data)}
	f.requests = append(f.requests, req)

	status, body := f.respond(req)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if raw, ok := body.(rawBody); ok {
		_, _ = w.Write([]byte(raw))
		return
	}
	_ = json.NewEncoder(w).Encode(body)
}

// rawBody is written as-is, so tests can return malformed JSON
type rawBody string

func (f *fakeCommerce) recorded() []commerceRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.requests
}

func newCommerceAgent(t *testing.T, fake *fakeCommerce) *activities.Activities {
	t.Helper()

	srv := httptest.NewServer(fake)
	t.Cleanup(srv.Close)

	acts, err := activities.NewActivities("sk-test-unused", activities.DefaultOpenAIModel, srv.URL+"/v1")
	require.NoError(t, err)
	return acts
}

func execute(t *testing.T, acts *activities.Activities, fn, input, out any) error {
	t.Helper()

	var s testsuite.WorkflowTestSuite
	env := s.NewTestActivityEnvironment()
	env.RegisterActivity(acts)

	res, err := env.ExecuteActivity(fn, input)
	if err != nil {
		return err
	}
	if out != nil {
		require.NoError(t, res.Get(out))
	}
	return nil
}

// UCP response fixtures returned by the fake commerce API

type ucpHandler struct {
	ID string `json:"id"`
}

type ucpMeta struct {
	Version         string                  `json:"version"`
	Status          string                  `json:"status,omitempty"`
	PaymentHandlers map[string][]ucpHandler `json:"payment_handlers,omitempty"`
}

type ucpTotal struct {
	Type   string `json:"type"`
	Amount int64  `json:"amount"`
}

type ucpMessage struct {
	Type     string `json:"type"`
	Code     string `json:"code"`
	Content  string `json:"content"`
	Severity string `json:"severity"`
}

type ucpOrder struct {
	ID           string `json:"id"`
	PermalinkURL string `json:"permalink_url"`
}

type ucpCheckout struct {
	UCP      ucpMeta      `json:"ucp"`
	ID       string       `json:"id,omitempty"`
	Status   string       `json:"status,omitempty"`
	Currency string       `json:"currency,omitempty"`
	Totals   []ucpTotal   `json:"totals,omitempty"`
	Messages []ucpMessage `json:"messages,omitempty"`
	Order    *ucpOrder    `json:"order,omitempty"`
}

// protocolError is the code/content body of a UCP protocol error
type protocolError struct {
	Code    string `json:"code"`
	Content string `json:"content"`
}

// httpError is the default NestJS error body
type httpError struct {
	StatusCode int    `json:"statusCode"`
	Message    string `json:"message"`
}

func checkout(status string, total int64) *ucpCheckout {
	return &ucpCheckout{
		UCP: ucpMeta{
			Version:         ucpVersion,
			PaymentHandlers: map[string][]ucpHandler{"com.google.pay": {{ID: handlerID}}},
		},
		ID:       checkoutID,
		Status:   status,
		Currency: gbp,
		Totals:   []ucpTotal{{Type: "subtotal", Amount: total}, {Type: "total", Amount: total}},
	}
}

func errorMessage(code, content string) ucpMessage {
	return ucpMessage{Type: "error", Code: code, Content: content, Severity: "unrecoverable"}
}

func ucpErrorResponse(code, content string) *ucpCheckout {
	return &ucpCheckout{
		UCP:      ucpMeta{Version: ucpVersion, Status: "error"},
		Messages: []ucpMessage{errorMessage(code, content)},
	}
}

func completedCheckout() *ucpCheckout {
	c := checkout("completed", 8299)
	c.Order = &ucpOrder{ID: orderID, PermalinkURL: "http://localhost:9999/orders/" + orderID}
	return c
}

func TestCreateCheckout(t *testing.T) {
	fake := &fakeCommerce{respond: func(commerceRequest) (int, any) {
		return http.StatusCreated, checkout("ready_for_complete", 8299)
	}}
	acts := newCommerceAgent(t, fake)

	var created activities.CreatedCheckout
	require.NoError(t, execute(t, acts, acts.CreateCheckout, newCreateInput(), &created))

	assert.Equal(t, activities.CreatedCheckout{ID: checkoutID, PaymentHandlerID: handlerID}, created)

	requests := fake.recorded()
	require.Len(t, requests, 1)
	assert.Equal(t, http.MethodPost, requests[0].method)
	assert.Equal(t, "/v1/checkout-sessions", requests[0].path)
	assert.Equal(t, createKey, requests[0].idempotencyKey)
	// Only UCP checkout fields are sent: prices come from the merchant
	assert.JSONEq(t, `{
		"buyer": {"email": "ada@example.com", "first_name": "Ada", "last_name": "Lovelace"},
		"line_items": [
			{"item": {"id": "sku_kettle"}, "quantity": 1},
			{"item": {"id": "sku_mug_set"}, "quantity": 2}
		]
	}`, requests[0].body)
}

func TestCreateCheckoutOmitsAbsentBuyerNames(t *testing.T) {
	fake := &fakeCommerce{respond: func(commerceRequest) (int, any) {
		return http.StatusCreated, checkout("ready_for_complete", 8299)
	}}
	acts := newCommerceAgent(t, fake)

	input := newCreateInput()
	input.Buyer = activities.CheckoutBuyer{Email: adaEmail}
	require.NoError(t, execute(t, acts, acts.CreateCheckout, input, nil))

	var sent struct {
		Buyer json.RawMessage `json:"buyer"`
	}
	require.NoError(t, json.Unmarshal([]byte(fake.recorded()[0].body), &sent))
	assert.JSONEq(t, `{"email": "ada@example.com"}`, string(sent.Buyer))
}

func TestCreateCheckoutRepeatedReusesTheCheckout(t *testing.T) {
	// The commerce API returns the original checkout for a repeated key
	created := map[string]string{}
	fake := &fakeCommerce{respond: func(req commerceRequest) (int, any) {
		if _, ok := created[req.idempotencyKey]; !ok {
			created[req.idempotencyKey] = fmt.Sprintf("chk_%d", len(created)+1)
		}
		c := checkout("ready_for_complete", 8299)
		c.ID = created[req.idempotencyKey]
		return http.StatusCreated, c
	}}
	acts := newCommerceAgent(t, fake)

	var first, second activities.CreatedCheckout
	require.NoError(t, execute(t, acts, acts.CreateCheckout, newCreateInput(), &first))
	require.NoError(t, execute(t, acts, acts.CreateCheckout, newCreateInput(), &second))

	assert.Equal(t, first.ID, second.ID)
	requests := fake.recorded()
	require.Len(t, requests, 2)
	// Each attempt sends the same key and body
	assert.Equal(t, requests[0], requests[1])
}

func TestCreateCheckoutRejections(t *testing.T) {
	tests := map[string]struct {
		status   int
		body     any
		expected string
	}{
		"unavailable item": {
			status:   http.StatusOK,
			body:     ucpErrorResponse("item_unavailable", `Item "sku_teapot" is not available for purchase`),
			expected: "item_unavailable",
		},
		"incomplete checkout": {
			status:   http.StatusCreated,
			body:     checkout("incomplete", 8299),
			expected: "is incomplete, not ready_for_complete",
		},
		"price mismatch": {
			status:   http.StatusCreated,
			body:     checkout("ready_for_complete", 9999),
			expected: "does not match the approved total of 8299 GBP",
		},
		"no payment handler": {
			status: http.StatusCreated,
			body: func() *ucpCheckout {
				c := checkout("ready_for_complete", 8299)
				c.UCP.PaymentHandlers = nil
				return c
			}(),
			expected: "advertises no payment handler",
		},
		"invalid request": {
			status:   http.StatusBadRequest,
			body:     protocolError{Code: "invalid_request", Content: "$.line_items: Required"},
			expected: "status 400: $.line_items: Required",
		},
		"idempotency key reused": {
			status:   http.StatusConflict,
			body:     protocolError{Code: "idempotency_key_reused", Content: "The Idempotency-Key was already used"},
			expected: "status 409",
		},
	}

	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			acts := newCommerceAgent(t, &fakeCommerce{respond: func(commerceRequest) (int, any) {
				return test.status, test.body
			}})

			err := execute(t, acts, acts.CreateCheckout, newCreateInput(), nil)
			assertAppError(t, err, activities.ErrTypeCheckoutRejected, true)
			assert.Contains(t, err.Error(), test.expected)
		})
	}
}

func TestCheckoutTransientFailuresAreRetryable(t *testing.T) {
	for _, status := range []int{
		http.StatusRequestTimeout,
		http.StatusTooManyRequests,
		http.StatusInternalServerError,
		http.StatusBadGateway,
		http.StatusServiceUnavailable,
	} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			acts := newCommerceAgent(t, &fakeCommerce{respond: func(commerceRequest) (int, any) {
				return status, httpError{StatusCode: status, Message: unavailable}
			}})

			err := execute(t, acts, acts.CreateCheckout, newCreateInput(), nil)
			assertAppError(t, err, activities.ErrTypeCommerceUnavailable, false)

			err = execute(t, acts, acts.CompleteCheckout, completeInput, nil)
			assertAppError(t, err, activities.ErrTypeCommerceUnavailable, false)
		})
	}
}

func TestCheckoutNetworkFailureIsRetryable(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	url := srv.URL
	srv.Close()

	acts, err := activities.NewActivities("sk-test-unused", activities.DefaultOpenAIModel, url+"/v1")
	require.NoError(t, err)

	err = execute(t, acts, acts.CreateCheckout, newCreateInput(), nil)
	assertAppError(t, err, activities.ErrTypeCommerceUnavailable, false)
}

func TestCompleteCheckout(t *testing.T) {
	fake := &fakeCommerce{respond: func(commerceRequest) (int, any) {
		return http.StatusOK, completedCheckout()
	}}
	acts := newCommerceAgent(t, fake)

	var completed activities.CompletedCheckout
	require.NoError(t, execute(t, acts, acts.CompleteCheckout, completeInput, &completed))

	assert.Equal(t, activities.CompletedCheckout{
		OrderID:           orderID,
		OrderPermalinkURL: "http://localhost:9999/orders/" + orderID,
	}, completed)

	requests := fake.recorded()
	require.Len(t, requests, 1)
	assert.Equal(t, http.MethodPost, requests[0].method)
	assert.Equal(t, "/v1/checkout-sessions/chk_123/complete", requests[0].path)
	assert.Equal(t, completeKey, requests[0].idempotencyKey)
	assert.JSONEq(t, `{
		"payment": {
			"instruments": [{
				"id": "pi_agent_123",
				"handler_id": "gpay",
				"type": "card",
				"selected": true,
				"credential": {"type": "PAYMENT_GATEWAY"}
			}]
		}
	}`, requests[0].body)
}

func TestCompleteCheckoutRepeatedDoesNotPlaceAnotherOrder(t *testing.T) {
	// The commerce API places one Order per checkout and returns it again
	orders := 0
	fake := &fakeCommerce{respond: func(commerceRequest) (int, any) {
		if orders == 0 {
			orders++
		}
		return http.StatusOK, completedCheckout()
	}}
	acts := newCommerceAgent(t, fake)

	var first, second activities.CompletedCheckout
	require.NoError(t, execute(t, acts, acts.CompleteCheckout, completeInput, &first))
	require.NoError(t, execute(t, acts, acts.CompleteCheckout, completeInput, &second))

	assert.Equal(t, first, second)
	assert.Equal(t, 1, orders)
	requests := fake.recorded()
	require.Len(t, requests, 2)
	assert.Equal(t, requests[0], requests[1])
}

func TestCompleteCheckoutAcceptsAnAlreadyCompletedCheckout(t *testing.T) {
	// Without a matching key the API reports that a completed checkout cannot
	// be completed again. The Order exists, so the purchase has succeeded.
	acts := newCommerceAgent(t, &fakeCommerce{respond: func(commerceRequest) (int, any) {
		c := completedCheckout()
		c.Messages = []ucpMessage{errorMessage("operation_not_allowed", "Checkout cannot be completed")}
		return http.StatusOK, c
	}})

	var completed activities.CompletedCheckout
	require.NoError(t, execute(t, acts, acts.CompleteCheckout, completeInput, &completed))
	assert.Equal(t, orderID, completed.OrderID)
}

func TestCompleteCheckoutInProgressIsRetryable(t *testing.T) {
	acts := newCommerceAgent(t, &fakeCommerce{respond: func(commerceRequest) (int, any) {
		return http.StatusOK, checkout("complete_in_progress", 8299)
	}})

	err := execute(t, acts, acts.CompleteCheckout, completeInput, nil)
	assertAppError(t, err, activities.ErrTypeCheckoutInProgress, false)
}

func TestCompleteCheckoutRejections(t *testing.T) {
	tests := map[string]struct {
		status   int
		body     any
		expected string
	}{
		"unknown checkout": {
			status:   http.StatusOK,
			body:     ucpErrorResponse("not_found", `Checkout "chk_123" was not found`),
			expected: "not_found",
		},
		"payment failed": {
			status: http.StatusOK,
			body: func() *ucpCheckout {
				c := checkout("ready_for_complete", 8299)
				c.Messages = []ucpMessage{errorMessage("payment_failed", `Payment handler "gpay" is not supported`)}
				return c
			}(),
			expected: "payment_failed",
		},
		"incomplete checkout": {
			status:   http.StatusOK,
			body:     checkout("incomplete", 8299),
			expected: "status is incomplete",
		},
		"idempotency key reused": {
			status:   http.StatusConflict,
			body:     protocolError{Code: "idempotency_key_reused", Content: "The Idempotency-Key was already used"},
			expected: "status 409",
		},
	}

	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			acts := newCommerceAgent(t, &fakeCommerce{respond: func(commerceRequest) (int, any) {
				return test.status, test.body
			}})

			err := execute(t, acts, acts.CompleteCheckout, completeInput, nil)
			assertAppError(t, err, activities.ErrTypeCheckoutRejected, true)
			assert.Contains(t, err.Error(), test.expected)
		})
	}
}

func TestConfigureInventoryFailures(t *testing.T) {
	fake := &fakeCommerce{respond: func(commerceRequest) (int, any) {
		return http.StatusOK, struct {
			CheckoutID string `json:"checkoutId"`
			Failures   int    `json:"failures"`
		}{CheckoutID: checkoutID, Failures: 2}
	}}
	acts := newCommerceAgent(t, fake)

	input := activities.ConfigureInventoryFailuresInput{CheckoutID: checkoutID, Failures: 2}
	require.NoError(t, execute(t, acts, acts.ConfigureInventoryFailures, input, nil))

	requests := fake.recorded()
	require.Len(t, requests, 1)
	assert.Equal(t, http.MethodPut, requests[0].method)
	assert.Equal(t, "/v1/demo/checkout-sessions/chk_123/inventory-failures", requests[0].path)
	assert.JSONEq(t, `{"failures": 2}`, requests[0].body)
}

func TestConfigureInventoryFailuresRejections(t *testing.T) {
	for _, status := range []int{http.StatusBadRequest, http.StatusNotFound, http.StatusConflict} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			acts := newCommerceAgent(t, &fakeCommerce{respond: func(commerceRequest) (int, any) {
				return status, httpError{StatusCode: status, Message: "Checkout completion has started"}
			}})

			input := activities.ConfigureInventoryFailuresInput{CheckoutID: checkoutID, Failures: 1}
			err := execute(t, acts, acts.ConfigureInventoryFailures, input, nil)
			assertAppError(t, err, activities.ErrTypeCheckoutRejected, true)
			assert.Contains(t, err.Error(), "Checkout completion has started")
		})
	}
}

func TestNewActivitiesRejectsInvalidCommerceURL(t *testing.T) {
	for _, raw := range []string{"", "   ", "localhost:9999", "ftp://example.com/v1", "http://"} {
		_, err := activities.NewActivities("sk-test-unused", activities.DefaultOpenAIModel, raw)
		assert.Error(t, err, raw)
	}
}
