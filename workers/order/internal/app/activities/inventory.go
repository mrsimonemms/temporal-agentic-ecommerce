package activities

import (
	"context"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
)

// ErrTypeInventoryUnavailable is the error type returned when the simulated
// inventory service is unavailable. It is retryable.
const ErrTypeInventoryUnavailable = "InventoryUnavailable"

// ReservationLine is a quantity of a product to reserve
type ReservationLine struct {
	LineID    string `json:"lineId"`
	ProductID string `json:"productId"`
	Quantity  int64  `json:"quantity"`
}

// ReserveInventoryInput is the request to the inventory service
type ReserveInventoryInput struct {
	OrderID string            `json:"orderId"`
	Lines   []ReservationLine `json:"lines"`
	// Demo-only: the number of attempts that fail as if the inventory
	// service were temporarily unavailable before the reservation succeeds
	SimulatedFailures int32 `json:"simulatedFailures,omitempty"`
}

// InventoryReservation is the result of a successful reservation
type InventoryReservation struct {
	ID    string            `json:"id"`
	Lines []ReservationLine `json:"lines"`
}

// ReserveInventory simulates reserving stock in an external inventory service.
// Every line is reserved in full. The reservation ID is derived from the Order
// ID so repeated attempts produce the same reservation.
func (a *Activities) ReserveInventory(ctx context.Context, input ReserveInventoryInput) (*InventoryReservation, error) {
	logger := activity.GetLogger(ctx)
	attempt := activity.GetInfo(ctx).Attempt

	if attempt <= input.SimulatedFailures {
		logger.Warn("Simulated inventory service failure", "orderId", input.OrderID, "attempt", attempt)
		return nil, temporal.NewApplicationError("inventory service temporarily unavailable", ErrTypeInventoryUnavailable)
	}

	logger.Info("Inventory reserved", "orderId", input.OrderID, "attempt", attempt)

	return &InventoryReservation{
		ID:    "res_" + input.OrderID,
		Lines: input.Lines,
	}, nil
}
