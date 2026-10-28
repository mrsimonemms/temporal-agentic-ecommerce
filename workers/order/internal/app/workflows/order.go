package workflows

import (
	"errors"
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const (
	// QueryGetOrder returns the current Order state
	QueryGetOrder = "getOrder"
	// SignalMarkFulfilled marks the Order as fulfilled
	SignalMarkFulfilled = "markFulfilled"
)

// OrderStatus is the commercial lifecycle status of the Order. This is
// deliberately independent of payment and individual fulfilment operations.
type OrderStatus string

const (
	OrderStatusConfirmed OrderStatus = "confirmed"
	OrderStatusFulfilled OrderStatus = "fulfilled"
)

const errTypeInvalidInput = "InvalidOrderInput"

// Buyer identifies who placed the Order
type Buyer struct {
	ID    string `json:"id,omitempty"`
	Name  string `json:"name,omitempty"`
	Email string `json:"email"`
}

// OrderLine is a single purchased item. Prices are in the minor unit of the
// Order currency (eg, pence) to avoid floating point rounding.
type OrderLine struct {
	ID        string `json:"id"`
	ProductID string `json:"productId"`
	Title     string `json:"title,omitempty"`
	Quantity  int64  `json:"quantity"`
	UnitPrice int64  `json:"unitPrice"`
}

// OrderInput is the protocol-agnostic command to create an Order. Channels
// (eg, UCP) are responsible for mapping into this structure.
type OrderInput struct {
	ID       string      `json:"id"`
	Buyer    Buyer       `json:"buyer"`
	Currency string      `json:"currency"`
	Lines    []OrderLine `json:"lines"`
}

// Order is the current state of the Order held by the Workflow
type Order struct {
	ID          string      `json:"id"`
	Status      OrderStatus `json:"status"`
	Buyer       Buyer       `json:"buyer"`
	Currency    string      `json:"currency"`
	Lines       []OrderLine `json:"lines"`
	Total       int64       `json:"total"`
	CreatedAt   time.Time   `json:"createdAt"`
	FulfilledAt *time.Time  `json:"fulfilledAt,omitempty"`
}

// MarkFulfilledSignal is the payload of the SignalMarkFulfilled Signal
type MarkFulfilledSignal struct{}

func (i *OrderInput) validate() error {
	var errs []error
	if i.ID == "" {
		errs = append(errs, errors.New("id is required"))
	}
	if i.Buyer.Email == "" {
		errs = append(errs, errors.New("buyer email is required"))
	}
	if i.Currency == "" {
		errs = append(errs, errors.New("currency is required"))
	}
	if len(i.Lines) == 0 {
		errs = append(errs, errors.New("at least one line is required"))
	}
	for k, l := range i.Lines {
		if l.ID == "" {
			errs = append(errs, fmt.Errorf("line %d: id is required", k))
		}
		if l.ProductID == "" {
			errs = append(errs, fmt.Errorf("line %d: productId is required", k))
		}
		if l.Quantity <= 0 {
			errs = append(errs, fmt.Errorf("line %d: quantity must be positive", k))
		}
		if l.UnitPrice < 0 {
			errs = append(errs, fmt.Errorf("line %d: unitPrice cannot be negative", k))
		}
	}
	return errors.Join(errs...)
}

func newOrder(ctx workflow.Context, input *OrderInput) *Order {
	var total int64
	for _, l := range input.Lines {
		total += l.Quantity * l.UnitPrice
	}

	return &Order{
		ID:        input.ID,
		Status:    OrderStatusConfirmed,
		Buyer:     input.Buyer,
		Currency:  input.Currency,
		Lines:     input.Lines,
		Total:     total,
		CreatedAt: workflow.Now(ctx),
	}
}

// OrderWorkflow is an Entity Workflow representing a single Order. It remains
// open after fulfilment because an Order may later be subject to returns,
// refunds or amendments. It only completes if cancelled.
func OrderWorkflow(ctx workflow.Context, input *OrderInput) error {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting OrderWorkflow")

	if input == nil {
		return temporal.NewNonRetryableApplicationError("order input is required", errTypeInvalidInput, nil)
	}
	if err := input.validate(); err != nil {
		return temporal.NewNonRetryableApplicationError("invalid order input", errTypeInvalidInput, err)
	}

	order := newOrder(ctx, input)

	if err := workflow.SetQueryHandler(ctx, QueryGetOrder, func() (*Order, error) {
		return order, nil
	}); err != nil {
		return fmt.Errorf("error registering %s query handler: %w", QueryGetOrder, err)
	}

	selector := workflow.NewSelector(ctx)
	selector.AddReceive(workflow.GetSignalChannel(ctx, SignalMarkFulfilled), func(c workflow.ReceiveChannel, _ bool) {
		var signal MarkFulfilledSignal
		c.Receive(ctx, &signal)

		if order.Status != OrderStatusConfirmed {
			logger.Warn("Ignoring fulfilment signal", "orderId", order.ID, "status", order.Status)
			return
		}

		now := workflow.Now(ctx)
		order.Status = OrderStatusFulfilled
		order.FulfilledAt = &now
		logger.Info("Order fulfilled", "orderId", order.ID)
	})
	selector.AddReceive(ctx.Done(), func(workflow.ReceiveChannel, bool) {})

	// Keep processing events until the Workflow is cancelled
	for ctx.Err() == nil {
		selector.Select(ctx)
	}

	logger.Info("OrderWorkflow cancelled", "orderId", order.ID, "status", order.Status)
	return ctx.Err()
}
