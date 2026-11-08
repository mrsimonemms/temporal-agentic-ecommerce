package workflows_test

import (
	"errors"
	"strings"
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

const (
	agentWorkflowID = "shopping-agent-123"
	buyerEmail      = "ada@example.com"
)

var kettleAndMugs = &activities.PurchaseProposal{
	Lines: []activities.ProposalLine{
		{ProductID: "sku_kettle", Title: "Stainless Steel Kettle", Quantity: 1, UnitPrice: 3499, Total: 3499},
		{ProductID: "sku_mug_set", Title: "Stoneware Mug Set (4 pack)", Quantity: 2, UnitPrice: 2400, Total: 4800},
	},
	Currency: "GBP",
	Total:    8299,
	Budget:   10000,
}

var approve = workflows.DecidePurchaseRequest{
	Decision:  workflows.PurchaseDecisionApprove,
	DecidedBy: buyerEmail,
	Note:      "Looks good",
}

var reject = workflows.DecidePurchaseRequest{
	Decision:  workflows.PurchaseDecisionReject,
	DecidedBy: buyerEmail,
	Note:      "Too expensive",
}

func newAgentInput() *workflows.ShoppingAgentInput {
	return &workflows.ShoppingAgentInput{
		Request: "Buy me a kettle and two sets of mugs. Keep it under £100.",
		Buyer:   workflows.Buyer{ID: "buyer-1", Name: "Ada Lovelace", Email: buyerEmail},
	}
}

// newAgentEnv returns a test environment where planning takes the given
// duration and returns the given plan or error. OpenAI is never called.
func newAgentEnv(d time.Duration, plan *activities.PurchasePlan, err error) *testsuite.TestWorkflowEnvironment {
	env := newEnv()
	env.SetStartWorkflowOptions(client.StartWorkflowOptions{ID: agentWorkflowID})

	var a *activities.Activities
	env.OnActivity(a.PlanPurchase, mock.Anything, activities.PlanPurchaseInput{Request: newAgentInput().Request}).
		After(d).
		Return(plan, err)
	return env
}

func queryAgent(t *testing.T, env *testsuite.TestWorkflowEnvironment) *workflows.ShoppingAgent {
	t.Helper()

	res, err := env.QueryWorkflow(workflows.QueryGetShoppingAgent)
	require.NoError(t, err)

	var agent workflows.ShoppingAgent
	require.NoError(t, res.Get(&agent))
	return &agent
}

// decisionResult records the outcome of a decidePurchase Update
type decisionResult = updateResult[workflows.ShoppingAgent]

func decide(env *testsuite.TestWorkflowEnvironment, req workflows.DecidePurchaseRequest) *decisionResult {
	return sendUpdate[workflows.ShoppingAgent](env, workflows.UpdateDecidePurchase, req)
}

func assertDecisionRejected(t *testing.T, result *decisionResult) {
	t.Helper()

	assert.False(t, result.accepted)
	var appErr *temporal.ApplicationError
	require.True(t, errors.As(result.rejected, &appErr), "expected the decision to be rejected")
	assert.Equal(t, "InvalidPurchaseDecision", appErr.Type())
	assert.True(t, appErr.NonRetryable())
}

func TestShoppingAgentInitialState(t *testing.T) {
	env := newAgentEnv(5*time.Minute, &activities.PurchasePlan{Proposal: kettleAndMugs}, nil)
	input := newAgentInput()

	var early *decisionResult
	env.RegisterDelayedCallback(func() {
		agent := queryAgent(t, env)

		assert.Equal(t, agentWorkflowID, agent.ID)
		assert.Equal(t, workflows.ShoppingAgentStatusPlanning, agent.Status)
		assert.Equal(t, input.Request, agent.Request)
		assert.Equal(t, input.Buyer, agent.Buyer)
		assert.Nil(t, agent.Proposal)
		assert.Nil(t, agent.Decision)
		assert.False(t, agent.CreatedAt.IsZero())

		// Decisions are not accepted while planning
		early = decide(env, approve)
	}, time.Minute)

	env.RegisterDelayedCallback(func() {
		assertDecisionRejected(t, early)
		assert.Equal(t, workflows.ShoppingAgentStatusPlanning, queryAgent(t, env).Status)
	}, 2*time.Minute)

	env.RegisterDelayedCallback(func() {
		agent := queryAgent(t, env)
		assert.Equal(t, workflows.ShoppingAgentStatusAwaitingApproval, agent.Status)
		assert.Nil(t, agent.Decision)
		env.CancelWorkflow()
	}, 10*time.Minute)

	env.ExecuteWorkflow(workflows.ShoppingAgentWorkflow, input)

	assertCancelled(t, env)
}

func TestShoppingAgentAwaitsApproval(t *testing.T) {
	env := newAgentEnv(time.Second, &activities.PurchasePlan{Proposal: kettleAndMugs}, nil)

	env.RegisterDelayedCallback(func() {
		agent := queryAgent(t, env)

		assert.Equal(t, workflows.ShoppingAgentStatusAwaitingApproval, agent.Status)
		assert.Equal(t, kettleAndMugs, agent.Proposal)
		assert.Nil(t, agent.Decision)
		assert.Empty(t, agent.Error)
		assert.Empty(t, agent.Explanation)
	}, time.Minute)

	// The proposal waits durably, without timing out, until a decision is made
	env.RegisterDelayedCallback(func() {
		assert.False(t, env.IsWorkflowCompleted())
		assert.Equal(t, workflows.ShoppingAgentStatusAwaitingApproval, queryAgent(t, env).Status)
		env.CancelWorkflow()
	}, 90*24*time.Hour)

	env.ExecuteWorkflow(workflows.ShoppingAgentWorkflow, newAgentInput())

	assertCancelled(t, env)
}

func TestShoppingAgentApproval(t *testing.T) {
	env := newAgentEnv(time.Second, &activities.PurchasePlan{Proposal: kettleAndMugs}, nil)

	var result *decisionResult
	env.RegisterDelayedCallback(func() {
		result = decide(env, approve)
	}, time.Minute)

	env.RegisterDelayedCallback(func() {
		require.True(t, result.accepted)
		require.NoError(t, result.err)
		require.NotNil(t, result.value)
		assert.Equal(t, workflows.ShoppingAgentStatusApproved, result.value.Status)

		agent := queryAgent(t, env)
		assert.Equal(t, workflows.ShoppingAgentStatusApproved, agent.Status)
		assert.Equal(t, kettleAndMugs, agent.Proposal)
		require.NotNil(t, agent.Decision)
		assert.Equal(t, workflows.PurchaseDecisionApprove, agent.Decision.Decision)
		assert.Equal(t, approve.DecidedBy, agent.Decision.DecidedBy)
		assert.Equal(t, approve.Note, agent.Decision.Note)
		assert.False(t, agent.Decision.DecidedAt.IsZero())
		assert.Equal(t, result.value, agent)
	}, 2*time.Minute)

	// The approved Workflow remains open and queryable, awaiting checkout
	env.RegisterDelayedCallback(func() {
		assert.False(t, env.IsWorkflowCompleted())
		assert.Equal(t, workflows.ShoppingAgentStatusApproved, queryAgent(t, env).Status)
		env.CancelWorkflow()
	}, 30*24*time.Hour)

	env.ExecuteWorkflow(workflows.ShoppingAgentWorkflow, newAgentInput())

	assertCancelled(t, env)
}

func TestShoppingAgentRejection(t *testing.T) {
	env := newAgentEnv(time.Second, &activities.PurchasePlan{Proposal: kettleAndMugs}, nil)

	var result *decisionResult
	env.RegisterDelayedCallback(func() {
		result = decide(env, reject)
	}, time.Minute)

	env.ExecuteWorkflow(workflows.ShoppingAgentWorkflow, newAgentInput())

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	require.True(t, result.accepted)
	require.NoError(t, result.err)
	require.NotNil(t, result.value)
	assert.Equal(t, workflows.ShoppingAgentStatusRejected, result.value.Status)

	var agent workflows.ShoppingAgent
	require.NoError(t, env.GetWorkflowResult(&agent))
	assert.Equal(t, workflows.ShoppingAgentStatusRejected, agent.Status)
	assert.Equal(t, kettleAndMugs, agent.Proposal)
	require.NotNil(t, agent.Decision)
	assert.Equal(t, workflows.PurchaseDecisionReject, agent.Decision.Decision)
	assert.Equal(t, reject.Note, agent.Decision.Note)

	// The completed Workflow remains queryable
	assert.Equal(t, workflows.ShoppingAgentStatusRejected, queryAgent(t, env).Status)
}

func TestShoppingAgentRejectsInvalidDecisions(t *testing.T) {
	env := newAgentEnv(time.Second, &activities.PurchasePlan{Proposal: kettleAndMugs}, nil)

	var results []*decisionResult
	env.RegisterDelayedCallback(func() {
		for _, decision := range []workflows.PurchaseDecision{"", "maybe", "APPROVE"} {
			results = append(results, decide(env, workflows.DecidePurchaseRequest{Decision: decision}))
		}
	}, time.Minute)

	// Invalid decisions are rejected without changing state
	env.RegisterDelayedCallback(func() {
		require.Len(t, results, 3)
		for _, result := range results {
			assertDecisionRejected(t, result)
		}

		agent := queryAgent(t, env)
		assert.Equal(t, workflows.ShoppingAgentStatusAwaitingApproval, agent.Status)
		assert.Nil(t, agent.Decision)
		env.CancelWorkflow()
	}, 2*time.Minute)

	env.ExecuteWorkflow(workflows.ShoppingAgentWorkflow, newAgentInput())

	assertCancelled(t, env)
}

func TestShoppingAgentRejectsDuplicateDecisions(t *testing.T) {
	env := newAgentEnv(time.Second, &activities.PurchasePlan{Proposal: kettleAndMugs}, nil)

	var first, again, reversed *decisionResult
	env.RegisterDelayedCallback(func() {
		first = decide(env, approve)
	}, time.Minute)

	env.RegisterDelayedCallback(func() {
		again = decide(env, approve)
		reversed = decide(env, reject)
	}, 2*time.Minute)

	// The original decision stands
	env.RegisterDelayedCallback(func() {
		require.True(t, first.accepted)
		assertDecisionRejected(t, again)
		assertDecisionRejected(t, reversed)

		agent := queryAgent(t, env)
		assert.Equal(t, workflows.ShoppingAgentStatusApproved, agent.Status)
		require.NotNil(t, agent.Decision)
		assert.Equal(t, workflows.PurchaseDecisionApprove, agent.Decision.Decision)
		env.CancelWorkflow()
	}, 3*time.Minute)

	env.ExecuteWorkflow(workflows.ShoppingAgentWorkflow, newAgentInput())

	assertCancelled(t, env)
}

func TestShoppingAgentCannotSatisfyRequest(t *testing.T) {
	explanation := "The catalogue does not include a blender."
	env := newAgentEnv(time.Second, &activities.PurchasePlan{Explanation: explanation}, nil)

	env.ExecuteWorkflow(workflows.ShoppingAgentWorkflow, newAgentInput())

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var agent workflows.ShoppingAgent
	require.NoError(t, env.GetWorkflowResult(&agent))
	assert.Equal(t, workflows.ShoppingAgentStatusFailed, agent.Status)
	assert.Equal(t, explanation, agent.Explanation)
	assert.Nil(t, agent.Proposal)
}

func TestShoppingAgentPlanningFailure(t *testing.T) {
	planErr := temporal.NewNonRetryableApplicationError(
		"OpenAI request failed with status 401: invalid_api_key", activities.ErrTypeOpenAIRequestRejected, nil,
	)
	env := newAgentEnv(time.Second, nil, planErr)

	env.ExecuteWorkflow(workflows.ShoppingAgentWorkflow, newAgentInput())

	require.True(t, env.IsWorkflowCompleted())
	var appErr *temporal.ApplicationError
	require.True(t, errors.As(env.GetWorkflowError(), &appErr))
	assert.Equal(t, "PurchasePlanningFailed", appErr.Type())

	agent := queryAgent(t, env)
	assert.Equal(t, workflows.ShoppingAgentStatusFailed, agent.Status)
	assert.Equal(t, "OpenAI request failed with status 401: invalid_api_key", agent.Error)
	assert.Nil(t, agent.Proposal)
}

func TestShoppingAgentInvalidInput(t *testing.T) {
	tests := map[string]*workflows.ShoppingAgentInput{
		"nil input":      nil,
		"empty request":  {Buyer: workflows.Buyer{Email: buyerEmail}},
		"missing email":  {Request: "Buy me a kettle under £50"},
		"overlong input": {Request: strings.Repeat("a", 1001), Buyer: workflows.Buyer{Email: buyerEmail}},
	}

	for name, input := range tests {
		t.Run(name, func(t *testing.T) {
			env := newEnv()
			env.ExecuteWorkflow(workflows.ShoppingAgentWorkflow, input)

			require.True(t, env.IsWorkflowCompleted())
			var appErr *temporal.ApplicationError
			require.True(t, errors.As(env.GetWorkflowError(), &appErr))
			assert.Equal(t, "InvalidShoppingAgentInput", appErr.Type())
			assert.True(t, appErr.NonRetryable())
		})
	}
}
