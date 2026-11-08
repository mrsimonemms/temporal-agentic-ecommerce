package workflows

import (
	"errors"
	"fmt"
	"time"

	"github.com/mrsimonemms/temporal-ucp-reference-architecture/workers/order/internal/app/activities"
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
	OrderStatusReservingInventory   OrderStatus = "reserving_inventory"
	OrderStatusConfirmed            OrderStatus = "confirmed"
	OrderStatusAwaitingIntervention OrderStatus = "awaiting_intervention"
	OrderStatusFulfilled            OrderStatus = "fulfilled"
)

// inventoryActivityOptions retries the inventory reservation quickly enough to
// be visible in a live demonstration. Attempts are unlimited: the Order waits
// for the inventory service to recover rather than failing.
var inventoryActivityOptions = workflow.ActivityOptions{
	StartToCloseTimeout: 10 * time.Second,
	RetryPolicy: &temporal.RetryPolicy{
		InitialInterval:    time.Second,
		BackoffCoefficient: 2,
		MaximumInterval:    5 * time.Second,
	},
}

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

// DemoOptions are demo-only controls for simulating downstream behaviour.
// They are not part of the commercial Order.
type DemoOptions struct {
	// Number of inventory reservation attempts that fail before succeeding
	InventoryFailures int32 `json:"inventoryFailures,omitempty"`
}

// OrderInput is the protocol-agnostic command to create an Order. Channels
// (eg, UCP) are responsible for mapping into this structure.
type OrderInput struct {
	ID       string       `json:"id"`
	Buyer    Buyer        `json:"buyer"`
	Currency string       `json:"currency"`
	Lines    []OrderLine  `json:"lines"`
	Demo     *DemoOptions `json:"demo,omitempty"`
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
	// Set once inventory has been reserved for every line
	InventoryReservationID string `json:"inventoryReservationId,omitempty"`
	// How the Order is fulfilled, separate from what was purchased
	Fulfilment FulfilmentPlan `json:"fulfilment"`
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
	if i.Demo != nil && i.Demo.InventoryFailures < 0 {
		errs = append(errs, errors.New("demo inventoryFailures cannot be negative"))
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
		Status:    OrderStatusReservingInventory,
		Buyer:     input.Buyer,
		Currency:  input.Currency,
		Lines:     input.Lines,
		Total:     total,
		CreatedAt: workflow.Now(ctx),
	}
}

func reserveInventory(ctx workflow.Context, input *OrderInput) workflow.Future {
	lines := make([]activities.ReservationLine, len(input.Lines))
	for k, l := range input.Lines {
		lines[k] = activities.ReservationLine{LineID: l.ID, ProductID: l.ProductID, Quantity: l.Quantity}
	}

	req := activities.ReserveInventoryInput{OrderID: input.ID, Lines: lines}
	if input.Demo != nil {
		req.SimulatedFailures = input.Demo.InventoryFailures
	}

	var a *activities.Activities
	return workflow.ExecuteActivity(workflow.WithActivityOptions(ctx, inventoryActivityOptions), a.ReserveInventory, req)
}

// OrderWorkflow is an Entity Workflow representing a single Order. It reserves
// inventory, then remains open while the Order is confirmed or awaiting
// intervention, so fulfilment exceptions can be raised and resolved. In this
// demonstration fulfilment is terminal: once the Order is fulfilled the
// Workflow completes successfully and returns the final Order, which remains
// available as the Workflow result. It also ends if cancelled.
func OrderWorkflow(ctx workflow.Context, input *OrderInput) (*Order, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting OrderWorkflow")

	if input == nil {
		return nil, temporal.NewNonRetryableApplicationError("order input is required", errTypeInvalidInput, nil)
	}
	if err := input.validate(); err != nil {
		return nil, temporal.NewNonRetryableApplicationError("invalid order input", errTypeInvalidInput, err)
	}

	order := newOrder(ctx, input)

	if err := workflow.SetQueryHandler(ctx, QueryGetOrder, func() (*Order, error) {
		return order, nil
	}); err != nil {
		return nil, fmt.Errorf("error registering %s query handler: %w", QueryGetOrder, err)
	}

	// Activity retries are handled by Temporal. The future only resolves with an
	// error if the Workflow is cancelled or the error is non-retryable.
	var reservationErr error
	selector := workflow.NewSelector(ctx)
	selector.AddFuture(reserveInventory(ctx, input), func(f workflow.Future) {
		var reservation activities.InventoryReservation
		if reservationErr = f.Get(ctx, &reservation); reservationErr != nil {
			return
		}

		order.Status = OrderStatusConfirmed
		order.InventoryReservationID = reservation.ID
		logger.Info("Inventory reserved", "orderId", order.ID, "reservationId", reservation.ID)
	})
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
	if err := registerFulfilmentExceptionHandlers(ctx, selector, order, logger); err != nil {
		return nil, fmt.Errorf("error registering fulfilment exception handlers: %w", err)
	}
	selector.AddReceive(ctx.Done(), func(workflow.ReceiveChannel, bool) {})

	// Keep processing events until the Order is fulfilled or the Workflow is
	// cancelled. Signals that the current status does not accept are ignored,
	// so they never end the Workflow.
	for ctx.Err() == nil && order.Status != OrderStatusFulfilled {
		selector.Select(ctx)

		if reservationErr != nil && ctx.Err() == nil {
			return nil, fmt.Errorf("error reserving inventory: %w", reservationErr)
		}
	}

	if ctx.Err() != nil {
		logger.Info("OrderWorkflow cancelled", "orderId", order.ID, "status", order.Status)
		return nil, ctx.Err()
	}

	// Let any in-progress Update handler return before completing
	if err := workflow.Await(ctx, func() bool { return workflow.AllHandlersFinished(ctx) }); err != nil {
		return nil, err
	}

	logger.Info("OrderWorkflow completed", "orderId", order.ID)
	return order, nil
}
