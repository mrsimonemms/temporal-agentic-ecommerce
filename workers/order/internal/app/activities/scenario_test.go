package activities_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/mrsimonemms/temporal-ucp-reference-architecture/workers/order/internal/app/activities"
	"github.com/mrsimonemms/temporal-ucp-reference-architecture/workers/order/internal/app/workflows"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/converter"
	"go.temporal.io/sdk/testsuite"
)

func planWithScenario(t *testing.T, acts *activities.Activities, scenario activities.DemoScenario) (*activities.PurchasePlan, error) {
	t.Helper()

	var s testsuite.WorkflowTestSuite
	env := s.NewTestActivityEnvironment()
	env.RegisterActivity(acts)

	// The Activity test environment always runs the first attempt
	res, err := env.ExecuteActivity(acts.PlanPurchase, &activities.PlanPurchaseInput{
		Request:   shoppingRequest,
		Catalogue: kitchenCatalogue(),
		Scenario:  scenario,
	})
	if err != nil {
		return nil, err
	}

	var plan activities.PurchasePlan
	require.NoError(t, res.Get(&plan))
	return &plan, nil
}

func TestDemoScenarioValid(t *testing.T) {
	for scenario, valid := range map[activities.DemoScenario]bool{
		"":                       true,
		"none":                   true,
		"ai_service_unavailable": true,
		"AI_SERVICE_UNAVAILABLE": false,
		"payment_declined":       false,
	} {
		assert.Equal(t, valid, scenario.Valid(), scenario)
	}
}

func TestPlanPurchaseNoneScenarioSucceedsFirstTime(t *testing.T) {
	fake := &fakeOpenAI{replies: []reply{listProducts("resp_1"), proposePurchase("resp_2", validProposal)}}
	acts, _ := newAgent(t, fake)

	plan, err := planWithScenario(t, acts, activities.ScenarioNone)
	require.NoError(t, err)
	require.NotNil(t, plan.Proposal)
	assert.Equal(t, int64(8299), plan.Proposal.Total)
	assert.Len(t, fake.recorded(), 2)
}

func TestPlanPurchaseSimulatesAIServiceUnavailable(t *testing.T) {
	fake := &fakeOpenAI{replies: []reply{listProducts("resp_1"), proposePurchase("resp_2", validProposal)}}
	acts, _ := newAgent(t, fake)

	_, err := planWithScenario(t, acts, activities.ScenarioAIServiceUnavailable)

	// Retryable, and distinct from a real OpenAI failure
	assertAppError(t, err, activities.ErrTypeSimulatedAIUnavailable, false)
	assert.Contains(t, err.Error(), "Simulated AI service unavailable (attempt 1 of 5)")
	// No tokens are spent on a simulated failure
	assert.Empty(t, fake.recorded())
}

func TestPlanPurchaseRejectsUnknownScenario(t *testing.T) {
	fake := &fakeOpenAI{}
	acts, _ := newAgent(t, fake)

	_, err := planWithScenario(t, acts, "payment_declined")

	assertAppError(t, err, activities.ErrTypeInvalidPlanInput, true)
	assert.Contains(t, err.Error(), `unknown demo scenario "payment_declined"`)
	assert.Empty(t, fake.recorded())
}

// Runs the Shopping Agent Workflow with the real planning Activity against the
// fake OpenAI server, so Temporal's retry policy drives the attempts. The
// commerce API Activities are mocked.
func TestShoppingAgentRecoversFromSimulatedAIOutage(t *testing.T) {
	fake := &fakeOpenAI{replies: []reply{listProducts("resp_1"), proposePurchase("resp_2", validProposal)}}
	acts, _ := newAgent(t, fake)

	var s testsuite.WorkflowTestSuite
	env := s.NewTestWorkflowEnvironment()
	env.SetStartWorkflowOptions(client.StartWorkflowOptions{ID: "agent_outage"})
	env.RegisterActivity(acts)
	catalogue := kitchenCatalogue()
	env.OnActivity(acts.GetCatalogue, mock.Anything).Return(&catalogue, nil)
	env.OnActivity(acts.CreateCheckout, mock.Anything, mock.Anything).
		Return(&activities.CreatedCheckout{ID: "chk_1", PaymentHandlerID: "gpay"}, nil)
	env.OnActivity(acts.CompleteCheckout, mock.Anything, mock.Anything).
		Return(&activities.CompletedCheckout{OrderID: "ord_1"}, nil)

	type start struct {
		name           string
		attempt        int32
		at             time.Time
		openAIRequests int
	}
	var starts []start
	env.SetOnActivityStartedListener(func(info *activity.Info, _ context.Context, _ converter.EncodedValues) {
		starts = append(starts, start{info.ActivityType.Name, info.Attempt, env.Now(), len(fake.recorded())})
	})

	env.RegisterDelayedCallback(func() {
		env.UpdateWorkflow(workflows.UpdateDecidePurchase, "", &testsuite.TestUpdateCallback{
			OnAccept: func() {}, OnReject: func(error) {}, OnComplete: func(any, error) {},
		}, workflows.DecidePurchaseRequest{Decision: workflows.PurchaseDecisionApprove})
	}, time.Minute)

	env.ExecuteWorkflow(workflows.ShoppingAgentWorkflow, &workflows.ShoppingAgentInput{
		Request: shoppingRequest,
		Buyer:   workflows.Buyer{Email: adaEmail},
		Demo:    &workflows.ShoppingAgentDemoOptions{Scenario: activities.ScenarioAIServiceUnavailable},
	})

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	var agent workflows.ShoppingAgent
	require.NoError(t, env.GetWorkflowResult(&agent))
	assert.Equal(t, workflows.ShoppingAgentStatusPurchased, agent.Status)
	require.NotNil(t, agent.Proposal)
	assert.Equal(t, int64(8299), agent.Proposal.Total)
	assert.Equal(t, activities.ScenarioAIServiceUnavailable, agent.Demo.Scenario)

	var planning []start
	catalogueStarts := 0
	for _, s := range starts {
		switch s.name {
		case "PlanPurchase":
			planning = append(planning, s)
		case "GetCatalogue":
			catalogueStarts++
		}
	}

	// The catalogue is retrieved once, then planning is retried by Temporal
	assert.Equal(t, 1, catalogueStarts)
	require.Len(t, planning, 6)
	for i, s := range planning {
		assert.Equal(t, int32(i+1), s.attempt)
		// No OpenAI request was made before the sixth attempt started
		assert.Zero(t, s.openAIRequests, "attempt %d", s.attempt)
		if i > 0 {
			gap := s.at.Sub(planning[i-1].at)
			assert.GreaterOrEqual(t, gap, time.Second, "attempt %d", s.attempt)
			assert.LessOrEqual(t, gap, 2*time.Second, "attempt %d", s.attempt)
		}
	}

	// The sixth attempt used the existing function-calling loop
	requests := fake.recorded()
	require.Len(t, requests, 2)
	assert.Equal(t, shoppingRequest, mustString(t, &requests[0]))
	callID, _ := functionOutput(t, &requests[1])
	assert.Equal(t, "call_list_resp_1", callID)
}

func mustString(t *testing.T, req *recordedRequest) string {
	t.Helper()
	var s string
	require.NoError(t, json.Unmarshal(req.Input, &s))
	return s
}
