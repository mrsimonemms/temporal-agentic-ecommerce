package activities

import (
	"context"
	"fmt"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
)

// DemoScenario is a demo-only, named failure behaviour for the Shopping Agent.
// It is not part of the purchase. Add new behaviours as further values and
// cases in simulateScenario.
type DemoScenario string

const (
	// ScenarioNone runs normally, without simulated failures
	ScenarioNone DemoScenario = "none"
	// ScenarioAIServiceUnavailable fails the first planning attempts as if the
	// AI service were unavailable, so Temporal's retries are visible
	ScenarioAIServiceUnavailable DemoScenario = "ai_service_unavailable"
)

// ErrTypeSimulatedAIUnavailable is returned by a simulated AI service outage.
// It is retryable, and distinct from real OpenAI errors.
const ErrTypeSimulatedAIUnavailable = "SimulatedAIServiceUnavailable"

// simulatedAIFailures is the number of planning attempts that fail in the
// ai_service_unavailable scenario. Attempt simulatedAIFailures+1 calls OpenAI.
const simulatedAIFailures = 5

// Valid reports whether the scenario is supported. An empty scenario is
// treated as ScenarioNone, so requests without one behave as before.
func (s DemoScenario) Valid() bool {
	switch s {
	case "", ScenarioNone, ScenarioAIServiceUnavailable:
		return true
	default:
		return false
	}
}

// simulateScenario returns the failure the scenario injects into this attempt,
// or nil to run normally. It uses Temporal's attempt number rather than any
// in-memory counter, so it behaves the same on every worker and after restarts.
func simulateScenario(ctx context.Context, scenario DemoScenario) error {
	switch scenario {
	case "", ScenarioNone:
		return nil
	case ScenarioAIServiceUnavailable:
		attempt := activity.GetInfo(ctx).Attempt
		if attempt > simulatedAIFailures {
			return nil
		}
		activity.GetLogger(ctx).Warn("Simulated AI service unavailable", "attempt", attempt)
		return temporal.NewApplicationError(
			fmt.Sprintf("Simulated AI service unavailable (attempt %d of %d)", attempt, simulatedAIFailures),
			ErrTypeSimulatedAIUnavailable,
		)
	default:
		return temporal.NewNonRetryableApplicationError(
			fmt.Sprintf("unknown demo scenario %q", scenario), ErrTypeInvalidPlanInput, nil,
		)
	}
}
