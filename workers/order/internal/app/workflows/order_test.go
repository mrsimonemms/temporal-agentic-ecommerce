package workflows_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/mrsimonemms/temporal-ucp-reference-architecture/workers/order/internal/app/activities"
	"github.com/mrsimonemms/temporal-ucp-reference-architecture/workers/order/internal/app/workflows"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/converter"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"
)

// newEnv returns a test environment with the real Activities registered
func newEnv() *testsuite.TestWorkflowEnvironment {
	var s testsuite.WorkflowTestSuite
	env := s.NewTestWorkflowEnvironment()
	env.RegisterActivity(&activities.Activities{})
	return env
}

// delayReservation replaces the inventory Activity with one that succeeds after
// the given duration, so the Order can be observed while reserving inventory
func delayReservation(env *testsuite.TestWorkflowEnvironment, d time.Duration) {
	var a *activities.Activities
	env.OnActivity(a.ReserveInventory, mock.Anything, mock.Anything).
		After(d).
		Return(&activities.InventoryReservation{ID: "res_order-123"}, nil)
}

const (
	kettleLineID = "line-1"
	mugLineID    = "line-2"
)

func newInput() *workflows.OrderInput {
	return &workflows.OrderInput{
		ID: "order-123",
		Buyer: workflows.Buyer{
			ID:    "buyer-1",
			Name:  "Ada Lovelace",
			Email: "ada@example.com",
		},
		Currency: "GBP",
		Lines: []workflows.OrderLine{
			{ID: kettleLineID, ProductID: "sku-kettle", Title: "Kettle", Quantity: 1, UnitPrice: 2999},
			{ID: mugLineID, ProductID: "sku-mug", Title: "Mug", Quantity: 4, UnitPrice: 650},
		},
	}
}

func queryOrder(t *testing.T, env *testsuite.TestWorkflowEnvironment) *workflows.Order {
	t.Helper()

	res, err := env.QueryWorkflow(workflows.QueryGetOrder)
	require.NoError(t, err)

	var order workflows.Order
	require.NoError(t, res.Get(&order))
	return &order
}

// completedOrder asserts the Workflow completed successfully and returns the
// final Order from its result
func completedOrder(t *testing.T, env *testsuite.TestWorkflowEnvironment) *workflows.Order {
	t.Helper()

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var order workflows.Order
	require.NoError(t, env.GetWorkflowResult(&order))
	return &order
}

func assertCancelled(t *testing.T, env *testsuite.TestWorkflowEnvironment) {
	t.Helper()

	require.True(t, env.IsWorkflowCompleted())
	var canceledErr *temporal.CanceledError
	assert.ErrorAs(t, env.GetWorkflowError(), &canceledErr)
}

func TestOrderWorkflowInitialState(t *testing.T) {
	env := newEnv()
	input := newInput()
	delayReservation(env, 5*time.Minute)

	env.RegisterDelayedCallback(func() {
		order := queryOrder(t, env)

		assert.Equal(t, input.ID, order.ID)
		assert.Equal(t, workflows.OrderStatusReservingInventory, order.Status)
		assert.Empty(t, order.InventoryReservationID)
		assert.False(t, env.IsWorkflowCompleted())
		assert.Equal(t, input.Buyer, order.Buyer)
		assert.Equal(t, input.Currency, order.Currency)
		assert.Equal(t, input.Lines, order.Lines)
		assert.Equal(t, int64(2999+4*650), order.Total)
		assert.False(t, order.CreatedAt.IsZero())
		assert.Nil(t, order.FulfilledAt)
	}, time.Minute)

	env.RegisterDelayedCallback(func() {
		order := queryOrder(t, env)

		assert.Equal(t, workflows.OrderStatusConfirmed, order.Status)
		assert.Equal(t, "res_order-123", order.InventoryReservationID)

		env.CancelWorkflow()
	}, 10*time.Minute)

	env.ExecuteWorkflow(workflows.OrderWorkflow, input)

	assertCancelled(t, env)
}

func TestOrderWorkflowReservesInventory(t *testing.T) {
	env := newEnv()

	var attempts []int32
	env.SetOnActivityStartedListener(func(info *activity.Info, _ context.Context, _ converter.EncodedValues) {
		attempts = append(attempts, info.Attempt)
	})

	env.RegisterDelayedCallback(func() {
		order := queryOrder(t, env)

		assert.Equal(t, workflows.OrderStatusConfirmed, order.Status)
		assert.Equal(t, "res_order-123", order.InventoryReservationID)
		assert.False(t, env.IsWorkflowCompleted())

		env.CancelWorkflow()
	}, time.Minute)

	env.ExecuteWorkflow(workflows.OrderWorkflow, newInput())

	assertCancelled(t, env)
	assert.Equal(t, []int32{1}, attempts)
}

func TestOrderWorkflowRetriesTransientInventoryFailures(t *testing.T) {
	env := newEnv()
	input := newInput()
	input.Demo = &workflows.DemoOptions{InventoryFailures: 2}

	var attempts []int32
	var startedAt []time.Time
	env.SetOnActivityStartedListener(func(info *activity.Info, _ context.Context, _ converter.EncodedValues) {
		attempts = append(attempts, info.Attempt)
		startedAt = append(startedAt, env.Now())
	})

	env.RegisterDelayedCallback(func() {
		order := queryOrder(t, env)

		assert.Equal(t, workflows.OrderStatusConfirmed, order.Status)
		assert.Equal(t, "res_order-123", order.InventoryReservationID)
		assert.False(t, env.IsWorkflowCompleted())

		env.CancelWorkflow()
	}, time.Minute)

	env.ExecuteWorkflow(workflows.OrderWorkflow, input)

	assertCancelled(t, env)
	// Two failed attempts, then success on the third, each retry scheduled by
	// the Activity retry policy
	require.Equal(t, []int32{1, 2, 3}, attempts)
	assert.Equal(t, time.Second, startedAt[1].Sub(startedAt[0]))
	assert.Equal(t, 2*time.Second, startedAt[2].Sub(startedAt[1]))
}

func TestOrderWorkflowIgnoresFulfilmentWhileReservingInventory(t *testing.T) {
	env := newEnv()
	delayReservation(env, 5*time.Minute)

	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(workflows.SignalMarkFulfilled, workflows.MarkFulfilledSignal{})
	}, time.Minute)

	env.RegisterDelayedCallback(func() {
		order := queryOrder(t, env)

		assert.Equal(t, workflows.OrderStatusConfirmed, order.Status)
		assert.Nil(t, order.FulfilledAt)
		// The ignored Signal does not end the Order
		assert.False(t, env.IsWorkflowCompleted())

		env.CancelWorkflow()
	}, 10*time.Minute)

	env.ExecuteWorkflow(workflows.OrderWorkflow, newInput())

	assertCancelled(t, env)
}

func TestOrderWorkflowRemainsRunningWhileConfirmed(t *testing.T) {
	env := newEnv()

	// Long after confirmation, the Order waits for fulfilment or an exception
	env.RegisterDelayedCallback(func() {
		assert.False(t, env.IsWorkflowCompleted())
		assert.Equal(t, workflows.OrderStatusConfirmed, queryOrder(t, env).Status)

		env.CancelWorkflow()
	}, 30*24*time.Hour)

	env.ExecuteWorkflow(workflows.OrderWorkflow, newInput())

	assertCancelled(t, env)
}

func TestOrderWorkflowFulfilment(t *testing.T) {
	env := newEnv()
	input := newInput()
	var fulfilledAt time.Time

	env.RegisterDelayedCallback(func() {
		assert.Equal(t, workflows.OrderStatusConfirmed, queryOrder(t, env).Status)
		assert.False(t, env.IsWorkflowCompleted())

		fulfilledAt = env.Now()
		env.SignalWorkflow(workflows.SignalMarkFulfilled, workflows.MarkFulfilledSignal{})
	}, time.Minute)

	env.ExecuteWorkflow(workflows.OrderWorkflow, input)

	// Fulfilment is terminal: the Workflow completes rather than being cancelled
	order := completedOrder(t, env)
	assert.Equal(t, input.ID, order.ID)
	assert.Equal(t, workflows.OrderStatusFulfilled, order.Status)
	require.NotNil(t, order.FulfilledAt)
	assert.True(t, fulfilledAt.Equal(*order.FulfilledAt))
	assert.True(t, order.FulfilledAt.After(order.CreatedAt))
	assert.Equal(t, "res_order-123", order.InventoryReservationID)
	assert.Equal(t, input.Buyer, order.Buyer)
	assert.Equal(t, input.Currency, order.Currency)
	assert.Equal(t, input.Lines, order.Lines)
	assert.Equal(t, int64(2999+4*650), order.Total)
	assert.Nil(t, order.Fulfilment.Exception)
}

func TestOrderWorkflowDuplicateFulfilmentIgnored(t *testing.T) {
	env := newEnv()
	var fulfilledAt time.Time

	env.RegisterDelayedCallback(func() {
		fulfilledAt = env.Now()
		env.SignalWorkflow(workflows.SignalMarkFulfilled, workflows.MarkFulfilledSignal{})
		env.SignalWorkflow(workflows.SignalMarkFulfilled, workflows.MarkFulfilledSignal{})
	}, time.Minute)

	env.ExecuteWorkflow(workflows.OrderWorkflow, newInput())

	// The first Signal fulfils and completes the Order. The second changes nothing.
	order := completedOrder(t, env)
	assert.Equal(t, workflows.OrderStatusFulfilled, order.Status)
	require.NotNil(t, order.FulfilledAt)
	assert.True(t, fulfilledAt.Equal(*order.FulfilledAt))
}

func TestOrderWorkflowInvalidInput(t *testing.T) {
	tests := map[string]func(i *workflows.OrderInput){
		"missing id":          func(i *workflows.OrderInput) { i.ID = "" },
		"missing buyer email": func(i *workflows.OrderInput) { i.Buyer.Email = "" },
		"missing currency":    func(i *workflows.OrderInput) { i.Currency = "" },
		"no lines":            func(i *workflows.OrderInput) { i.Lines = nil },
		"zero quantity":       func(i *workflows.OrderInput) { i.Lines[0].Quantity = 0 },
		"negative unit price": func(i *workflows.OrderInput) { i.Lines[0].UnitPrice = -1 },
		"negative inventory failures": func(i *workflows.OrderInput) {
			i.Demo = &workflows.DemoOptions{InventoryFailures: -1}
		},
	}

	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			var s testsuite.WorkflowTestSuite
			env := s.NewTestWorkflowEnvironment()

			input := newInput()
			mutate(input)

			env.ExecuteWorkflow(workflows.OrderWorkflow, input)

			require.True(t, env.IsWorkflowCompleted())
			var appErr *temporal.ApplicationError
			require.True(t, errors.As(env.GetWorkflowError(), &appErr))
			assert.Equal(t, "InvalidOrderInput", appErr.Type())
			assert.True(t, appErr.NonRetryable())
		})
	}
}
