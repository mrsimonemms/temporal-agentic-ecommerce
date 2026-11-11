package activities_test

import (
	"errors"
	"testing"

	"github.com/mrsimonemms/temporal-agentic-ecommerce/workers/order/internal/app/activities"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"
)

func newInput() activities.ReserveInventoryInput {
	return activities.ReserveInventoryInput{
		OrderID: "order-123",
		Lines: []activities.ReservationLine{
			{LineID: "line-1", ProductID: "sku-kettle", Quantity: 1},
			{LineID: "line-2", ProductID: "sku-mug", Quantity: 4},
		},
	}
}

func TestReserveInventory(t *testing.T) {
	var s testsuite.WorkflowTestSuite
	env := s.NewTestActivityEnvironment()
	env.RegisterActivity(&activities.Activities{})

	input := newInput()
	res, err := env.ExecuteActivity((&activities.Activities{}).ReserveInventory, input)
	require.NoError(t, err)

	var reservation activities.InventoryReservation
	require.NoError(t, res.Get(&reservation))
	assert.Equal(t, activities.InventoryReservation{ID: "res_order-123", Lines: input.Lines}, reservation)
}

func TestReserveInventorySimulatedFailure(t *testing.T) {
	var s testsuite.WorkflowTestSuite
	env := s.NewTestActivityEnvironment()
	env.RegisterActivity(&activities.Activities{})

	input := newInput()
	input.SimulatedFailures = 2

	// The test environment runs a single first attempt
	_, err := env.ExecuteActivity((&activities.Activities{}).ReserveInventory, input)

	var appErr *temporal.ApplicationError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, activities.ErrTypeInventoryUnavailable, appErr.Type())
	assert.False(t, appErr.NonRetryable())
}
