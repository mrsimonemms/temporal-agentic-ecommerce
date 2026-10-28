package workflows_test

import (
	"errors"
	"testing"
	"time"

	"github.com/mrsimonemms/temporal-ucp-reference-architecture/workers/order/internal/app/workflows"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"
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
	var s testsuite.WorkflowTestSuite
	env := s.NewTestWorkflowEnvironment()
	input := newInput()

	env.RegisterDelayedCallback(func() {
		order := queryOrder(t, env)

		assert.Equal(t, input.ID, order.ID)
		assert.Equal(t, workflows.OrderStatusConfirmed, order.Status)
		assert.Equal(t, input.Buyer, order.Buyer)
		assert.Equal(t, input.Currency, order.Currency)
		assert.Equal(t, input.Lines, order.Lines)
		assert.Equal(t, int64(2999+4*650), order.Total)
		assert.False(t, order.CreatedAt.IsZero())
		assert.Nil(t, order.FulfilledAt)

		env.CancelWorkflow()
	}, time.Minute)

	env.ExecuteWorkflow(workflows.OrderWorkflow, input)

	assertCancelled(t, env)
}

func TestOrderWorkflowFulfilment(t *testing.T) {
	var s testsuite.WorkflowTestSuite
	env := s.NewTestWorkflowEnvironment()

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
	var s testsuite.WorkflowTestSuite
	env := s.NewTestWorkflowEnvironment()

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
