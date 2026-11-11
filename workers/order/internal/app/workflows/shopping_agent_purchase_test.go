package workflows_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/mrsimonemms/temporal-agentic-ecommerce/workers/order/internal/app/activities"
	"github.com/mrsimonemms/temporal-agentic-ecommerce/workers/order/internal/app/workflows"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/converter"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"
)

// Activity type names, as recorded when each Activity starts
const (
	actGetCatalogue       = "GetCatalogue"
	actPlanPurchase       = "PlanPurchase"
	actCreateCheckout     = "CreateCheckout"
	actConfigureInventory = "ConfigureInventoryFailures"
	actCompleteCheckout   = "CompleteCheckout"
)

var checkoutCreated = &activities.CreatedCheckout{ID: "chk_123", PaymentHandlerID: "gpay"}

var checkoutCompleted = &activities.CompletedCheckout{
	OrderID:           "ord_123",
	OrderPermalinkURL: "http://localhost:9999/orders/ord_123",
}

// mockPurchase replaces the checkout Activities with successful ones. Checkout
// creation takes the given duration so the purchase can be observed.
func mockPurchase(env *testsuite.TestWorkflowEnvironment, createDelay time.Duration) {
	var a *activities.Activities
	env.OnActivity(a.CreateCheckout, mock.Anything, mock.Anything).After(createDelay).Return(checkoutCreated, nil)
	env.OnActivity(a.ConfigureInventoryFailures, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(a.CompleteCheckout, mock.Anything, mock.Anything).Return(checkoutCompleted, nil)
}

// startedActivity is an Activity attempt and its input
type startedActivity struct {
	name    string
	attempt int32
	args    converter.EncodedValues
}

type startedActivities struct {
	list []startedActivity
}

// recordActivities records every Activity attempt, in order
func recordActivities(env *testsuite.TestWorkflowEnvironment) *startedActivities {
	started := &startedActivities{}
	env.SetOnActivityStartedListener(func(info *activity.Info, _ context.Context, args converter.EncodedValues) {
		started.list = append(started.list, startedActivity{name: info.ActivityType.Name, attempt: info.Attempt, args: args})
	})
	return started
}

func (s *startedActivities) names() []string {
	names := make([]string, len(s.list))
	for i, a := range s.list {
		names[i] = a.name
	}
	return names
}

func (s *startedActivities) count(name string) int {
	n := 0
	for _, a := range s.list {
		if a.name == name {
			n++
		}
	}
	return n
}

// input decodes the input of the first attempt of the named Activity
func (s *startedActivities) input(t *testing.T, name string, v any) {
	t.Helper()
	for _, a := range s.list {
		if a.name == name {
			require.NoError(t, a.args.Get(v))
			return
		}
	}
	t.Fatalf("activity %s was not started", name)
}

// failureState decodes the Shopping Agent state carried by a Workflow failure
func failureState(t *testing.T, appErr *temporal.ApplicationError) *workflows.ShoppingAgent {
	t.Helper()

	var agent workflows.ShoppingAgent
	require.True(t, appErr.HasDetails())
	require.NoError(t, appErr.Details(&agent))
	return &agent
}

// approveImmediately approves the proposal as soon as it is awaiting approval
func approveImmediately(env *testsuite.TestWorkflowEnvironment) {
	env.RegisterDelayedCallback(func() { decide(env, approve) }, time.Minute)
}

func TestShoppingAgentPurchasesThroughCheckout(t *testing.T) {
	env := newAgentEnv(time.Second, &activities.PurchasePlan{Proposal: kettleAndMugs}, nil)
	mockPurchase(env, 0)
	started := recordActivities(env)
	approveImmediately(env)

	env.ExecuteWorkflow(workflows.ShoppingAgentWorkflow, newAgentInput())

	require.NoError(t, env.GetWorkflowError())
	// No inventory failures were requested, so none are configured
	assert.Equal(t, []string{actGetCatalogue, actPlanPurchase, actCreateCheckout, actCompleteCheckout}, started.names())

	var create activities.CreateCheckoutInput
	started.input(t, actCreateCheckout, &create)
	assert.Equal(t, activities.CreateCheckoutInput{
		IdempotencyKey: agentWorkflowID + ":create-checkout",
		Buyer:          activities.CheckoutBuyer{Email: buyerEmail, FirstName: "Ada", LastName: "Lovelace"},
		Lines: []activities.CheckoutLine{
			{ProductID: kettleAndMugs.Lines[0].ProductID, Quantity: 1},
			{ProductID: kettleAndMugs.Lines[1].ProductID, Quantity: 2},
		},
		Currency:      kettleAndMugs.Currency,
		ExpectedTotal: 8299,
	}, create)

	var complete activities.CompleteCheckoutInput
	started.input(t, actCompleteCheckout, &complete)
	assert.Equal(t, activities.CompleteCheckoutInput{
		IdempotencyKey:   agentWorkflowID + ":complete-checkout",
		CheckoutID:       checkoutCreated.ID,
		PaymentHandlerID: checkoutCreated.PaymentHandlerID,
		InstrumentID:     "pi_" + agentWorkflowID,
	}, complete)

	var agent workflows.ShoppingAgent
	require.NoError(t, env.GetWorkflowResult(&agent))
	assert.Equal(t, workflows.ShoppingAgentStatusPurchased, agent.Status)
	assert.Equal(t, "chk_123", agent.CheckoutID)
	assert.Equal(t, "ord_123", agent.OrderID)
}

func TestShoppingAgentConfiguresInventoryFailuresBeforeCompletion(t *testing.T) {
	for _, failures := range []int32{1, 2} {
		env := newAgentEnv(time.Second, &activities.PurchasePlan{Proposal: kettleAndMugs}, nil)
		mockPurchase(env, 0)
		started := recordActivities(env)
		approveImmediately(env)

		input := newAgentInput()
		input.Demo = &workflows.ShoppingAgentDemoOptions{InventoryFailures: failures}
		env.ExecuteWorkflow(workflows.ShoppingAgentWorkflow, input)

		require.NoError(t, env.GetWorkflowError())
		// Completion starts the Order, so the setting must be applied first
		assert.Equal(t,
			[]string{actGetCatalogue, actPlanPurchase, actCreateCheckout, actConfigureInventory, actCompleteCheckout},
			started.names(),
		)

		var configure activities.ConfigureInventoryFailuresInput
		started.input(t, actConfigureInventory, &configure)
		assert.Equal(t, activities.ConfigureInventoryFailuresInput{CheckoutID: "chk_123", Failures: failures}, configure)

		// The setting is not part of the purchase
		var create activities.CreateCheckoutInput
		started.input(t, actCreateCheckout, &create)
		assert.Equal(t, int64(8299), create.ExpectedTotal)
	}
}

func TestShoppingAgentRetriesOnlyTheFailedCheckoutOperation(t *testing.T) {
	unavailable := temporal.NewApplicationError("commerce API unavailable", activities.ErrTypeCommerceUnavailable)

	tests := map[string]struct {
		failing  string
		mockFunc func(env *testsuite.TestWorkflowEnvironment)
	}{
		"create checkout": {
			failing: actCreateCheckout,
			mockFunc: func(env *testsuite.TestWorkflowEnvironment) {
				var a *activities.Activities
				env.OnActivity(a.CreateCheckout, mock.Anything, mock.Anything).Return(nil, unavailable).Times(2)
				env.OnActivity(a.CreateCheckout, mock.Anything, mock.Anything).Return(checkoutCreated, nil).Once()
				env.OnActivity(a.ConfigureInventoryFailures, mock.Anything, mock.Anything).Return(nil)
				env.OnActivity(a.CompleteCheckout, mock.Anything, mock.Anything).Return(checkoutCompleted, nil)
			},
		},
		"configure inventory failures": {
			failing: actConfigureInventory,
			mockFunc: func(env *testsuite.TestWorkflowEnvironment) {
				var a *activities.Activities
				env.OnActivity(a.CreateCheckout, mock.Anything, mock.Anything).Return(checkoutCreated, nil)
				env.OnActivity(a.ConfigureInventoryFailures, mock.Anything, mock.Anything).Return(unavailable).Times(2)
				env.OnActivity(a.ConfigureInventoryFailures, mock.Anything, mock.Anything).Return(nil).Once()
				env.OnActivity(a.CompleteCheckout, mock.Anything, mock.Anything).Return(checkoutCompleted, nil)
			},
		},
		"complete checkout": {
			failing: actCompleteCheckout,
			mockFunc: func(env *testsuite.TestWorkflowEnvironment) {
				var a *activities.Activities
				inProgress := temporal.NewApplicationError("completion in progress", activities.ErrTypeCheckoutInProgress)
				env.OnActivity(a.CreateCheckout, mock.Anything, mock.Anything).Return(checkoutCreated, nil)
				env.OnActivity(a.ConfigureInventoryFailures, mock.Anything, mock.Anything).Return(nil)
				env.OnActivity(a.CompleteCheckout, mock.Anything, mock.Anything).Return(nil, unavailable).Once()
				env.OnActivity(a.CompleteCheckout, mock.Anything, mock.Anything).Return(nil, inProgress).Once()
				env.OnActivity(a.CompleteCheckout, mock.Anything, mock.Anything).Return(checkoutCompleted, nil).Once()
			},
		},
	}

	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			env := newAgentEnv(time.Second, &activities.PurchasePlan{Proposal: kettleAndMugs}, nil)
			test.mockFunc(env)
			started := recordActivities(env)
			approveImmediately(env)

			input := newAgentInput()
			input.Demo = &workflows.ShoppingAgentDemoOptions{InventoryFailures: 1}
			env.ExecuteWorkflow(workflows.ShoppingAgentWorkflow, input)

			require.NoError(t, env.GetWorkflowError())
			var agent workflows.ShoppingAgent
			require.NoError(t, env.GetWorkflowResult(&agent))
			assert.Equal(t, workflows.ShoppingAgentStatusPurchased, agent.Status)

			// The failed operation is retried until it succeeds. Completed
			// work, including catalogue retrieval and AI planning, is not repeated.
			for _, name := range []string{actGetCatalogue, actPlanPurchase, actCreateCheckout, actConfigureInventory, actCompleteCheckout} {
				expected := 1
				if name == test.failing {
					expected = 3
				}
				assert.Equal(t, expected, started.count(name), name)
			}
		})
	}
}

func TestShoppingAgentDoesNotRetryCheckoutRejections(t *testing.T) {
	rejected := temporal.NewNonRetryableApplicationError(
		"checkout chk_123 was not completed: payment_failed: Payment handler \"gpay\" is not supported",
		activities.ErrTypeCheckoutRejected, nil,
	)
	env := newAgentEnv(time.Second, &activities.PurchasePlan{Proposal: kettleAndMugs}, nil)
	var a *activities.Activities
	env.OnActivity(a.CreateCheckout, mock.Anything, mock.Anything).Return(checkoutCreated, nil)
	env.OnActivity(a.CompleteCheckout, mock.Anything, mock.Anything).Return(nil, rejected)
	started := recordActivities(env)
	approveImmediately(env)

	env.ExecuteWorkflow(workflows.ShoppingAgentWorkflow, newAgentInput())

	require.True(t, env.IsWorkflowCompleted())
	var appErr *temporal.ApplicationError
	require.True(t, errors.As(env.GetWorkflowError(), &appErr))
	assert.Equal(t, "PurchaseFailed", appErr.Type())
	assert.Equal(t, 1, started.count(actCompleteCheckout))

	// The final state, including the decision and checkout, is carried by the failure
	agent := failureState(t, appErr)
	assert.Equal(t, workflows.ShoppingAgentStatusFailed, agent.Status)
	assert.Equal(t, rejected.Error(), agent.Error+" (type: CheckoutRejected, retryable: false)")
	assert.Equal(t, "chk_123", agent.CheckoutID)
	assert.Empty(t, agent.OrderID)
	require.NotNil(t, agent.Decision)
	assert.Equal(t, workflows.PurchaseDecisionApprove, agent.Decision.Decision)
	assert.Equal(t, kettleAndMugs, agent.Proposal)
}
