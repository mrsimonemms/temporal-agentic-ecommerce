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
			{ID: "line-1", ProductID: "sku-kettle", Title: "Kettle", Quantity: 1, UnitPrice: 2999},
			{ID: "line-2", ProductID: "sku-mug", Title: "Mug", Quantity: 4, UnitPrice: 650},
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

		env.CancelWorkflow()
	}, 10*time.Minute)

	env.ExecuteWorkflow(workflows.OrderWorkflow, newInput())

	assertCancelled(t, env)
}

func TestOrderWorkflowFulfilment(t *testing.T) {
	env := newEnv()

	env.RegisterDelayedCallback(func() {
		assert.Equal(t, workflows.OrderStatusConfirmed, queryOrder(t, env).Status)

		env.SignalWorkflow(workflows.SignalMarkFulfilled, workflows.MarkFulfilledSignal{})
	}, time.Minute)

	env.RegisterDelayedCallback(func() {
		order := queryOrder(t, env)

		assert.Equal(t, workflows.OrderStatusFulfilled, order.Status)
		require.NotNil(t, order.FulfilledAt)
		assert.True(t, order.FulfilledAt.After(order.CreatedAt))
	}, 2*time.Minute)

	// Long after fulfilment, the Order remains open and queryable
	env.RegisterDelayedCallback(func() {
		assert.False(t, env.IsWorkflowCompleted())
		assert.Equal(t, workflows.OrderStatusFulfilled, queryOrder(t, env).Status)

		env.CancelWorkflow()
	}, 30*24*time.Hour)

	env.ExecuteWorkflow(workflows.OrderWorkflow, newInput())

	assertCancelled(t, env)
}

func TestOrderWorkflowDuplicateFulfilmentIgnored(t *testing.T) {
	env := newEnv()

	var firstFulfilledAt time.Time

	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(workflows.SignalMarkFulfilled, workflows.MarkFulfilledSignal{})
	}, time.Minute)

	env.RegisterDelayedCallback(func() {
		order := queryOrder(t, env)
		require.NotNil(t, order.FulfilledAt)
		firstFulfilledAt = *order.FulfilledAt

		env.SignalWorkflow(workflows.SignalMarkFulfilled, workflows.MarkFulfilledSignal{})
	}, 2*time.Minute)

	env.RegisterDelayedCallback(func() {
		order := queryOrder(t, env)
		assert.Equal(t, workflows.OrderStatusFulfilled, order.Status)
		require.NotNil(t, order.FulfilledAt)
		assert.True(t, firstFulfilledAt.Equal(*order.FulfilledAt))

		env.CancelWorkflow()
	}, 3*time.Minute)

	env.ExecuteWorkflow(workflows.OrderWorkflow, newInput())

	assertCancelled(t, env)
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
