package workflows_test

import (
	"errors"
	"testing"
	"time"

	"github.com/mrsimonemms/temporal-ucp-reference-architecture/workers/order/internal/app/activities"
	"github.com/mrsimonemms/temporal-ucp-reference-architecture/workers/order/internal/app/workflows"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"
)

var proposed = &activities.PurchasePlan{Proposal: kettleAndMugs}

// newCatalogueEnv returns a test environment without planning mocks, so each
// test controls how catalogue retrieval and planning behave
func newCatalogueEnv() *testsuite.TestWorkflowEnvironment {
	env := newEnv()
	env.SetStartWorkflowOptions(client.StartWorkflowOptions{ID: agentWorkflowID})
	return env
}

// cancelOnceAwaitingApproval ends the Workflow after planning so the test can
// inspect the planning Activities
func cancelOnceAwaitingApproval(t *testing.T, env *testsuite.TestWorkflowEnvironment) {
	env.RegisterDelayedCallback(func() {
		assert.Equal(t, workflows.ShoppingAgentStatusAwaitingApproval, queryAgent(t, env).Status)
		env.CancelWorkflow()
	}, time.Hour)
}

func TestShoppingAgentRetrievesCatalogueBeforePlanning(t *testing.T) {
	env := newAgentEnv(time.Second, proposed, nil)
	started := recordActivities(env)
	cancelOnceAwaitingApproval(t, env)

	env.ExecuteWorkflow(workflows.ShoppingAgentWorkflow, newAgentInput())

	assertCancelled(t, env)
	assert.Equal(t, []string{actGetCatalogue, actPlanPurchase}, started.names())

	// Planning receives the recorded snapshot rather than fetching its own
	var input activities.PlanPurchaseInput
	started.input(t, actPlanPurchase, &input)
	assert.Equal(t, *planningInput(), input)
}

func TestShoppingAgentPlanningRetryDoesNotRetrieveCatalogueAgain(t *testing.T) {
	env := newCatalogueEnv()
	var a *activities.Activities
	env.OnActivity(a.GetCatalogue, mock.Anything).Return(catalogue, nil)
	env.OnActivity(a.PlanPurchase, mock.Anything, planningInput()).
		Return(nil, temporal.NewApplicationError("OpenAI request failed with status 503", activities.ErrTypeOpenAIUnavailable)).Once()
	env.OnActivity(a.PlanPurchase, mock.Anything, planningInput()).Return(proposed, nil).Once()
	started := recordActivities(env)
	cancelOnceAwaitingApproval(t, env)

	env.ExecuteWorkflow(workflows.ShoppingAgentWorkflow, newAgentInput())

	assertCancelled(t, env)
	assert.Equal(t, 1, started.count(actGetCatalogue))
	assert.Equal(t, 2, started.count(actPlanPurchase))
}

func TestShoppingAgentCatalogueRetryDoesNotPlanUntilRetrieved(t *testing.T) {
	env := newCatalogueEnv()
	var a *activities.Activities
	unavailable := temporal.NewApplicationError("commerce API unavailable", activities.ErrTypeCommerceUnavailable)
	env.OnActivity(a.GetCatalogue, mock.Anything).Return(nil, unavailable).Times(2)
	env.OnActivity(a.GetCatalogue, mock.Anything).Return(catalogue, nil).Once()
	env.OnActivity(a.PlanPurchase, mock.Anything, planningInput()).Return(proposed, nil)
	started := recordActivities(env)

	env.RegisterDelayedCallback(func() {
		// Still planning while the catalogue is unavailable, without calling OpenAI
		if started.count(actGetCatalogue) < 3 {
			assert.Equal(t, workflows.ShoppingAgentStatusPlanning, queryAgent(t, env).Status)
			assert.Zero(t, started.count(actPlanPurchase))
		}
	}, 2*time.Second)
	cancelOnceAwaitingApproval(t, env)

	env.ExecuteWorkflow(workflows.ShoppingAgentWorkflow, newAgentInput())

	assertCancelled(t, env)
	assert.Equal(t, 3, started.count(actGetCatalogue))
	assert.Equal(t, 1, started.count(actPlanPurchase))
	assert.Equal(t, actGetCatalogue, started.names()[0])
	assert.Equal(t, actPlanPurchase, started.names()[3])
}

func TestShoppingAgentDoesNotPlanWithAnInvalidCatalogue(t *testing.T) {
	env := newCatalogueEnv()
	var a *activities.Activities
	invalid := temporal.NewNonRetryableApplicationError("invalid catalogue", activities.ErrTypeInvalidCatalogue, nil)
	env.OnActivity(a.GetCatalogue, mock.Anything).Return(nil, invalid)
	env.OnActivity(a.PlanPurchase, mock.Anything, mock.Anything).Return(proposed, nil)
	started := recordActivities(env)

	env.ExecuteWorkflow(workflows.ShoppingAgentWorkflow, newAgentInput())

	require.True(t, env.IsWorkflowCompleted())
	var appErr *temporal.ApplicationError
	require.True(t, errors.As(env.GetWorkflowError(), &appErr))
	assert.Equal(t, "PurchasePlanningFailed", appErr.Type())

	// Non-retryable, and no model tokens are spent
	assert.Equal(t, []string{actGetCatalogue}, started.names())

	agent := failureState(t, appErr)
	assert.Equal(t, workflows.ShoppingAgentStatusFailed, agent.Status)
	assert.Equal(t, "invalid catalogue", agent.Error)
	assert.Nil(t, agent.Proposal)
}
