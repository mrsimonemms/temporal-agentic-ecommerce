package activities

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
)

// The checkout Activities use the commerce API's UCP checkout REST binding.
// The API owns checkout validation, persistence and starting the Order
// Workflow: these Activities only make the requests, so the agent buys
// through the same interface as any other UCP client.

const (
	// ErrTypeCommerceUnavailable is returned for network errors, timeouts,
	// rate limiting and server errors from the commerce API. It is retryable.
	ErrTypeCommerceUnavailable = "CommerceUnavailable"
	// ErrTypeCheckoutRejected is returned when the commerce API rejects a
	// checkout operation for a reason that retrying cannot fix. It is
	// non-retryable.
	ErrTypeCheckoutRejected = "CheckoutRejected"
	// ErrTypeCheckoutInProgress is returned when checkout completion was
	// accepted but the Order has not yet been recorded. Repeating the request
	// resumes placement, so it is retryable.
	ErrTypeCheckoutInProgress = "CheckoutInProgress"
)

const (
	checkoutStatusReady      = "ready_for_complete"
	checkoutStatusInProgress = "complete_in_progress"
	checkoutStatusCompleted  = "completed"

	// ucpError marks UCP error responses and error messages
	ucpError = "error"

	// maxResponseBytes bounds how much of a commerce API response is read
	maxResponseBytes = 1 << 20
)

// CheckoutBuyer is the buyer sent with the checkout
type CheckoutBuyer struct {
	Email     string `json:"email"`
	FirstName string `json:"firstName,omitempty"`
	LastName  string `json:"lastName,omitempty"`
}

// CheckoutLine is a product and quantity to purchase
type CheckoutLine struct {
	ProductID string `json:"productId"`
	Quantity  int64  `json:"quantity"`
}

// CreateCheckoutInput creates a checkout for an approved purchase
type CreateCheckoutInput struct {
	// Identifies this purchase, so retries return the same checkout
	IdempotencyKey string         `json:"idempotencyKey"`
	Buyer          CheckoutBuyer  `json:"buyer"`
	Lines          []CheckoutLine `json:"lines"`
	// The approved total. The checkout is rejected if the merchant prices it
	// differently, so the buyer is never charged more than they approved.
	Currency      string `json:"currency"`
	ExpectedTotal int64  `json:"expectedTotal"`
}

// CreatedCheckout is a checkout ready for completion
type CreatedCheckout struct {
	ID string `json:"id"`
	// A payment handler advertised by the merchant for this checkout
	PaymentHandlerID string `json:"paymentHandlerId"`
}

// ConfigureInventoryFailuresInput is a demo-only setting applied to the Order
// placed when the checkout completes
type ConfigureInventoryFailuresInput struct {
	CheckoutID string `json:"checkoutId"`
	Failures   int32  `json:"failures"`
}

// CompleteCheckoutInput completes a checkout with the stubbed payment handler
type CompleteCheckoutInput struct {
	// Identifies this purchase, so retries do not place another Order
	IdempotencyKey   string `json:"idempotencyKey"`
	CheckoutID       string `json:"checkoutId"`
	PaymentHandlerID string `json:"paymentHandlerId"`
	InstrumentID     string `json:"instrumentId"`
}

// CompletedCheckout references the Order placed by the checkout
type CompletedCheckout struct {
	OrderID           string `json:"orderId"`
	OrderPermalinkURL string `json:"orderPermalinkUrl"`
}

// UCP request and response fields used by the Activities. Only fields defined
// by the UCP checkout schemas are sent.

type ucpBuyer struct {
	Email     string `json:"email"`
	FirstName string `json:"first_name,omitempty"`
	LastName  string `json:"last_name,omitempty"`
}

type ucpLineItem struct {
	Item struct {
		ID string `json:"id"`
	} `json:"item"`
	Quantity int64 `json:"quantity"`
}

type ucpCreateCheckoutRequest struct {
	Buyer     ucpBuyer      `json:"buyer"`
	LineItems []ucpLineItem `json:"line_items"`
}

type ucpPaymentInstrument struct {
	ID         string `json:"id"`
	HandlerID  string `json:"handler_id"`
	Type       string `json:"type"`
	Selected   bool   `json:"selected"`
	Credential struct {
		Type string `json:"type"`
	} `json:"credential"`
}

type ucpCompleteCheckoutRequest struct {
	Payment struct {
		Instruments []ucpPaymentInstrument `json:"instruments"`
	} `json:"payment"`
}

type ucpMessage struct {
	Type    string `json:"type"`
	Code    string `json:"code"`
	Content string `json:"content"`
}

// ucpCheckoutResponse is a UCP checkout or, when ucp.status is "error", an
// error response
type ucpCheckoutResponse struct {
	UCP struct {
		Status          string                           `json:"status"`
		PaymentHandlers map[string][]struct{ ID string } `json:"payment_handlers"`
	} `json:"ucp"`
	ID       string `json:"id"`
	Status   string `json:"status"`
	Currency string `json:"currency"`
	Totals   []struct {
		Type   string `json:"type"`
		Amount int64  `json:"amount"`
	} `json:"totals"`
	Messages []ucpMessage `json:"messages"`
	Order    *struct {
		ID           string `json:"id"`
		PermalinkURL string `json:"permalink_url"`
	} `json:"order"`
}

func (r *ucpCheckoutResponse) total() (int64, bool) {
	for _, t := range r.Totals {
		if t.Type == "total" {
			return t.Amount, true
		}
	}
	return 0, false
}

func (r *ucpCheckoutResponse) errorMessages() string {
	var msgs []string
	for _, m := range r.Messages {
		if m.Type == ucpError {
			msgs = append(msgs, fmt.Sprintf("%s: %s", m.Code, m.Content))
		}
	}
	return strings.Join(msgs, "; ")
}

// paymentHandlerID returns the first advertised payment handler, in a stable order
func (r *ucpCheckoutResponse) paymentHandlerID() string {
	names := make([]string, 0, len(r.UCP.PaymentHandlers))
	for name := range r.UCP.PaymentHandlers {
		names = append(names, name)
	}
	slices.Sort(names)
	for _, name := range names {
		for _, h := range r.UCP.PaymentHandlers[name] {
			if h.ID != "" {
				return h.ID
			}
		}
	}
	return ""
}

// CreateCheckout creates a UCP checkout for an approved purchase. The
// Idempotency-Key makes retries safe: if an earlier attempt created the
// checkout but its response was lost, the same checkout is returned.
func (a *Activities) CreateCheckout(ctx context.Context, input *CreateCheckoutInput) (*CreatedCheckout, error) {
	logger := activity.GetLogger(ctx)

	req := ucpCreateCheckoutRequest{
		Buyer: ucpBuyer{Email: input.Buyer.Email, FirstName: input.Buyer.FirstName, LastName: input.Buyer.LastName},
	}
	for _, l := range input.Lines {
		var item ucpLineItem
		item.Item.ID = l.ProductID
		item.Quantity = l.Quantity
		req.LineItems = append(req.LineItems, item)
	}

	var res ucpCheckoutResponse
	if err := a.commerceRequest(ctx, http.MethodPost, "checkout-sessions", input.IdempotencyKey, req, &res); err != nil {
		return nil, err
	}
	if res.UCP.Status == ucpError || res.ID == "" {
		return nil, checkoutRejected("checkout was not created: %s", res.errorMessages())
	}
	if res.Status != checkoutStatusReady {
		return nil, checkoutRejected("checkout %s is %s, not %s: %s", res.ID, res.Status, checkoutStatusReady, res.errorMessages())
	}

	total, ok := res.total()
	if !ok || total != input.ExpectedTotal || res.Currency != input.Currency {
		return nil, checkoutRejected("checkout %s total of %d %s does not match the approved total of %d %s",
			res.ID, total, res.Currency, input.ExpectedTotal, input.Currency)
	}

	handlerID := res.paymentHandlerID()
	if handlerID == "" {
		return nil, checkoutRejected("checkout %s advertises no payment handler", res.ID)
	}

	logger.Info("Checkout created", "checkoutId", res.ID)
	return &CreatedCheckout{ID: res.ID, PaymentHandlerID: handlerID}, nil
}

// ConfigureInventoryFailures sets the demo-only number of inventory
// reservation failures for the Order the checkout will place. Setting the
// same value again has no further effect, so it is safe to retry.
func (a *Activities) ConfigureInventoryFailures(ctx context.Context, input ConfigureInventoryFailuresInput) error {
	path := "demo/checkout-sessions/" + url.PathEscape(input.CheckoutID) + "/inventory-failures"
	body := map[string]int32{"failures": input.Failures}
	if err := a.commerceRequest(ctx, http.MethodPut, path, "", body, nil); err != nil {
		return err
	}

	activity.GetLogger(ctx).Info("Inventory failures configured", "checkoutId", input.CheckoutID, "failures", input.Failures)
	return nil
}

// CompleteCheckout completes the checkout using the merchant's stubbed payment
// handler. Completion starts the Order Workflow in the commerce API. The
// Idempotency-Key makes retries safe: a repeated request returns the original
// outcome and never places another Order.
func (a *Activities) CompleteCheckout(ctx context.Context, input CompleteCheckoutInput) (*CompletedCheckout, error) {
	logger := activity.GetLogger(ctx)

	var req ucpCompleteCheckoutRequest
	instrument := ucpPaymentInstrument{ID: input.InstrumentID, HandlerID: input.PaymentHandlerID, Type: "card", Selected: true}
	// Payment is stubbed by the commerce API: no credential is processed
	instrument.Credential.Type = "PAYMENT_GATEWAY"
	req.Payment.Instruments = []ucpPaymentInstrument{instrument}

	path := "checkout-sessions/" + url.PathEscape(input.CheckoutID) + "/complete"
	var res ucpCheckoutResponse
	if err := a.commerceRequest(ctx, http.MethodPost, path, input.IdempotencyKey, req, &res); err != nil {
		return nil, err
	}

	switch {
	case res.UCP.Status == ucpError || res.ID == "":
		return nil, checkoutRejected("checkout %s was not completed: %s", input.CheckoutID, res.errorMessages())
	case res.Status == checkoutStatusInProgress:
		return nil, temporal.NewApplicationError(
			fmt.Sprintf("checkout %s completion is in progress: the Order has not been recorded yet", res.ID),
			ErrTypeCheckoutInProgress,
		)
	case res.Status != checkoutStatusCompleted || res.Order == nil || res.Order.ID == "":
		return nil, checkoutRejected("checkout %s was not completed: status is %s: %s", res.ID, res.Status, res.errorMessages())
	}

	logger.Info("Checkout completed", "checkoutId", res.ID, "orderId", res.Order.ID)
	return &CompletedCheckout{OrderID: res.Order.ID, OrderPermalinkURL: res.Order.PermalinkURL}, nil
}

// commerceRequest sends a JSON request to the commerce API and decodes a
// successful response into out. Failures are classified as retryable
// infrastructure errors or non-retryable rejections.
func (a *Activities) commerceRequest(ctx context.Context, method, path, idempotencyKey string, body, out any) error {
	data, err := a.commerceCall(ctx, method, path, idempotencyKey, body)
	if err != nil {
		return err
	}

	if out == nil {
		return nil
	}
	if err := json.Unmarshal(data, out); err != nil {
		// A successful status with an unreadable body is unexpected but may be
		// a transient proxy fault, and the checkout operations are safe to repeat
		return temporal.NewApplicationErrorWithCause("unable to decode commerce API response", ErrTypeCommerceUnavailable, err)
	}
	return nil
}

// commerceCall sends a request to the commerce API, with a JSON body unless
// body is nil, and returns the body of a successful response. Network errors,
// timeouts, 408, 429 and 5xx responses are retryable. Other failures are not.
func (a *Activities) commerceCall(ctx context.Context, method, path, idempotencyKey string, body any) ([]byte, error) {
	var payload io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, temporal.NewNonRetryableApplicationError("unable to encode request", ErrTypeCheckoutRejected, err)
		}
		payload = bytes.NewReader(encoded)
	}

	req, err := http.NewRequestWithContext(ctx, method, a.commerceAPI.JoinPath(path).String(), payload)
	if err != nil {
		return nil, temporal.NewNonRetryableApplicationError("unable to build request", ErrTypeCheckoutRejected, err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	if idempotencyKey != "" {
		req.Header.Set("Idempotency-Key", idempotencyKey)
	}

	res, err := a.httpClient.Do(req)
	if err != nil {
		return nil, temporal.NewApplicationErrorWithCause(
			fmt.Sprintf("commerce API request %s %s failed", method, path), ErrTypeCommerceUnavailable, err,
		)
	}
	defer func() { _ = res.Body.Close() }()

	data, err := io.ReadAll(io.LimitReader(res.Body, maxResponseBytes))
	if err != nil {
		return nil, temporal.NewApplicationErrorWithCause("unable to read commerce API response", ErrTypeCommerceUnavailable, err)
	}

	if res.StatusCode < 200 || res.StatusCode > 299 {
		return nil, commerceHTTPError(method, path, res.StatusCode, data)
	}
	return data, nil
}

func commerceHTTPError(method, path string, status int, body []byte) error {
	// Both UCP protocol errors and NestJS errors carry a human-readable reason
	var detail struct {
		Content string `json:"content"`
		Message any    `json:"message"`
	}
	reason := http.StatusText(status)
	if json.Unmarshal(body, &detail) == nil {
		switch {
		case detail.Content != "":
			reason = detail.Content
		case detail.Message != nil:
			reason = fmt.Sprint(detail.Message)
		}
	}

	msg := fmt.Sprintf("commerce API request %s %s failed with status %d: %s", method, path, status, reason)
	if status == http.StatusRequestTimeout || status == http.StatusTooManyRequests || status >= http.StatusInternalServerError {
		return temporal.NewApplicationError(msg, ErrTypeCommerceUnavailable)
	}
	return temporal.NewNonRetryableApplicationError(msg, ErrTypeCheckoutRejected, nil)
}

func checkoutRejected(format string, args ...any) error {
	return temporal.NewNonRetryableApplicationError(fmt.Sprintf(format, args...), ErrTypeCheckoutRejected, nil)
}

// errCommerceURL is returned for an unusable commerce API URL
var errCommerceURL = errors.New("commerce API URL must be an absolute http or https URL")

// ParseCommerceURL validates the base URL of the commerce API's versioned
// routes, eg http://localhost:9999/v1
func ParseCommerceURL(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, errCommerceURL
	}
	return u, nil
}
