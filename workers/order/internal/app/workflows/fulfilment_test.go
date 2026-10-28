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

var supplierException = workflows.ReportFulfilmentExceptionSignal{
	LineID: mugLineID,
	Reason: "Supplier reports the item is unavailable at the selected warehouse",
}

var alternativeSource = workflows.ResolveFulfilmentExceptionRequest{
	LineID:            mugLineID,
	AlternativeSource: "warehouse-north",
	ApprovedBy:        "ops@example.com",
	Note:              "Same item, ships a day later",
}

// updateResult records the outcome of an Update sent to the test environment
type updateResult struct {
	accepted bool
	rejected error
	order    *workflows.Order
	err      error
}

func resolve(env *testsuite.TestWorkflowEnvironment, req workflows.ResolveFulfilmentExceptionRequest) *updateResult {
	result := &updateResult{}
	env.UpdateWorkflow(workflows.UpdateResolveFulfilmentException, "", &testsuite.TestUpdateCallback{
		OnAccept: func() { result.accepted = true },
		OnReject: func(err error) { result.rejected = err },
		OnComplete: func(v any, err error) {
			result.err = err
			if order, ok := v.(*workflows.Order); ok {
				result.order = order
			}
		},
	}, req)
	return result
}

func raiseException(env *testsuite.TestWorkflowEnvironment, signal workflows.ReportFulfilmentExceptionSignal) {
	env.SignalWorkflow(workflows.SignalReportFulfilmentException, signal)
}

func TestFulfilmentExceptionAwaitsIntervention(t *testing.T) {
	env := newEnv()
	input := newInput()

	env.RegisterDelayedCallback(func() {
		require.Equal(t, workflows.OrderStatusConfirmed, queryOrder(t, env).Status)
		raiseException(env, supplierException)
	}, time.Minute)

	env.RegisterDelayedCallback(func() {
		order := queryOrder(t, env)

		assert.Equal(t, workflows.OrderStatusAwaitingIntervention, order.Status)
		require.NotNil(t, order.Fulfilment.Exception)
		assert.Equal(t, mugLineID, order.Fulfilment.Exception.LineID)
		assert.Equal(t, supplierException.Reason, order.Fulfilment.Exception.Reason)
		assert.False(t, order.Fulfilment.Exception.RaisedAt.IsZero())
		// The exception does not change what was purchased or the reservation
		assert.Equal(t, input.Lines, order.Lines)
		assert.Equal(t, "res_order-123", order.InventoryReservationID)
	}, 2*time.Minute)

	// The Order stays suspended, without timing out, until a decision is made
	env.RegisterDelayedCallback(func() {
		assert.False(t, env.IsWorkflowCompleted())
		assert.Equal(t, workflows.OrderStatusAwaitingIntervention, queryOrder(t, env).Status)

		env.CancelWorkflow()
	}, 30*24*time.Hour)

	env.ExecuteWorkflow(workflows.OrderWorkflow, input)

	assertCancelled(t, env)
}

func TestResolveFulfilmentExceptionWithAlternativeSource(t *testing.T) {
	env := newEnv()
	input := newInput()
	var result *updateResult

	env.RegisterDelayedCallback(func() { raiseException(env, supplierException) }, time.Minute)
	env.RegisterDelayedCallback(func() { result = resolve(env, alternativeSource) }, 2*time.Minute)

	env.RegisterDelayedCallback(func() {
		require.True(t, result.accepted)
		require.NoError(t, result.err)
		require.NotNil(t, result.order)
		assert.Equal(t, workflows.OrderStatusConfirmed, result.order.Status)

		order := queryOrder(t, env)
		assert.Equal(t, workflows.OrderStatusConfirmed, order.Status)
		assert.Nil(t, order.Fulfilment.Exception)
		assert.Equal(t, []workflows.FulfilmentSource{{LineID: mugLineID, Source: "warehouse-north"}}, order.Fulfilment.Sources)

		require.Len(t, order.Fulfilment.Resolutions, 1)
		resolution := order.Fulfilment.Resolutions[0]
		assert.Equal(t, mugLineID, resolution.LineID)
		assert.Equal(t, supplierException.Reason, resolution.Reason)
		assert.Equal(t, workflows.FulfilmentDecisionAlternativeSource, resolution.Decision)
		assert.Equal(t, "warehouse-north", resolution.AlternativeSource)
		assert.Equal(t, "ops@example.com", resolution.ApprovedBy)
		assert.Equal(t, "Same item, ships a day later", resolution.Note)
		assert.Equal(t, time.Minute, resolution.ResolvedAt.Sub(resolution.RaisedAt))

		// The alternative source changes how the Order is fulfilled, not what was purchased
		assert.Equal(t, input.Lines, order.Lines)
		assert.Equal(t, int64(2999+4*650), order.Total)
		assert.False(t, env.IsWorkflowCompleted())
	}, 3*time.Minute)

	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(workflows.SignalMarkFulfilled, workflows.MarkFulfilledSignal{})
	}, 4*time.Minute)

	env.RegisterDelayedCallback(func() {
		order := queryOrder(t, env)
		assert.Equal(t, workflows.OrderStatusFulfilled, order.Status)
		assert.Len(t, order.Fulfilment.Resolutions, 1)
		assert.False(t, env.IsWorkflowCompleted())

		env.CancelWorkflow()
	}, 5*time.Minute)

	env.ExecuteWorkflow(workflows.OrderWorkflow, input)

	assertCancelled(t, env)
}

func TestResolveFulfilmentExceptionRejectsInvalidResolutions(t *testing.T) {
	tests := map[string]struct {
		raise   bool
		mutate  func(r *workflows.ResolveFulfilmentExceptionRequest)
		message string
	}{
		"not awaiting intervention": {
			raise:   false,
			message: "order is not awaiting intervention: status is confirmed",
		},
		"different line": {
			raise:   true,
			mutate:  func(r *workflows.ResolveFulfilmentExceptionRequest) { r.LineID = kettleLineID },
			message: `line "line-1" is not affected by the exception: line "line-2" is`,
		},
		"unknown line": {
			raise:   true,
			mutate:  func(r *workflows.ResolveFulfilmentExceptionRequest) { r.LineID = "line-99" },
			message: `line "line-99" is not affected by the exception: line "line-2" is`,
		},
		"missing alternative source": {
			raise:   true,
			mutate:  func(r *workflows.ResolveFulfilmentExceptionRequest) { r.AlternativeSource = "" },
			message: "alternativeSource is required",
		},
		"missing approver": {
			raise:   true,
			mutate:  func(r *workflows.ResolveFulfilmentExceptionRequest) { r.ApprovedBy = "" },
			message: "approvedBy is required",
		},
	}

	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			env := newEnv()
			req := alternativeSource
			if test.mutate != nil {
				test.mutate(&req)
			}
			var result *updateResult
			var before *workflows.Order

			if test.raise {
				env.RegisterDelayedCallback(func() { raiseException(env, supplierException) }, time.Minute)
			}
			env.RegisterDelayedCallback(func() {
				before = queryOrder(t, env)
				result = resolve(env, req)
			}, 2*time.Minute)

			env.RegisterDelayedCallback(func() {
				assert.False(t, result.accepted)
				var appErr *temporal.ApplicationError
				require.True(t, errors.As(result.rejected, &appErr), "expected rejection, got %v", result.rejected)
				assert.Equal(t, "InvalidFulfilmentResolution", appErr.Type())
				assert.Equal(t, test.message, appErr.Message())
				assert.True(t, appErr.NonRetryable())

				// A rejected resolution does not change the Order
				assert.Equal(t, before, queryOrder(t, env))

				env.CancelWorkflow()
			}, 3*time.Minute)

			env.ExecuteWorkflow(workflows.OrderWorkflow, newInput())

			assertCancelled(t, env)
		})
	}
}

func TestFulfilmentBlockedWhileAwaitingIntervention(t *testing.T) {
	env := newEnv()

	env.RegisterDelayedCallback(func() { raiseException(env, supplierException) }, time.Minute)
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(workflows.SignalMarkFulfilled, workflows.MarkFulfilledSignal{})
	}, 2*time.Minute)

	env.RegisterDelayedCallback(func() {
		order := queryOrder(t, env)

		assert.Equal(t, workflows.OrderStatusAwaitingIntervention, order.Status)
		assert.Nil(t, order.FulfilledAt)
		assert.NotNil(t, order.Fulfilment.Exception)

		env.CancelWorkflow()
	}, 3*time.Minute)

	env.ExecuteWorkflow(workflows.OrderWorkflow, newInput())

	assertCancelled(t, env)
}

func TestFulfilmentExceptionIgnoredWhenInvalid(t *testing.T) {
	tests := map[string]struct {
		// Signals sent in order, one minute apart, after the Order is confirmed
		signals []func(env *testsuite.TestWorkflowEnvironment)
		status  workflows.OrderStatus
		reason  string
	}{
		"unknown line": {
			signals: []func(*testsuite.TestWorkflowEnvironment){
				func(env *testsuite.TestWorkflowEnvironment) {
					raiseException(env, workflows.ReportFulfilmentExceptionSignal{LineID: "line-99", Reason: "Unavailable"})
				},
			},
			status: workflows.OrderStatusConfirmed,
		},
		"missing reason": {
			signals: []func(*testsuite.TestWorkflowEnvironment){
				func(env *testsuite.TestWorkflowEnvironment) {
					raiseException(env, workflows.ReportFulfilmentExceptionSignal{LineID: mugLineID})
				},
			},
			status: workflows.OrderStatusConfirmed,
		},
		"already fulfilled": {
			signals: []func(*testsuite.TestWorkflowEnvironment){
				func(env *testsuite.TestWorkflowEnvironment) {
					env.SignalWorkflow(workflows.SignalMarkFulfilled, workflows.MarkFulfilledSignal{})
				},
				func(env *testsuite.TestWorkflowEnvironment) { raiseException(env, supplierException) },
			},
			status: workflows.OrderStatusFulfilled,
		},
		"exception already outstanding": {
			signals: []func(*testsuite.TestWorkflowEnvironment){
				func(env *testsuite.TestWorkflowEnvironment) { raiseException(env, supplierException) },
				func(env *testsuite.TestWorkflowEnvironment) {
					raiseException(env, workflows.ReportFulfilmentExceptionSignal{LineID: kettleLineID, Reason: "Damaged"})
				},
			},
			status: workflows.OrderStatusAwaitingIntervention,
			reason: supplierException.Reason,
		},
	}

	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			env := newEnv()

			for k, signal := range test.signals {
				env.RegisterDelayedCallback(func() { signal(env) }, time.Duration(k+1)*time.Minute)
			}

			env.RegisterDelayedCallback(func() {
				order := queryOrder(t, env)

				assert.Equal(t, test.status, order.Status)
				if test.reason == "" {
					assert.Nil(t, order.Fulfilment.Exception)
				} else {
					require.NotNil(t, order.Fulfilment.Exception)
					assert.Equal(t, test.reason, order.Fulfilment.Exception.Reason)
				}

				env.CancelWorkflow()
			}, time.Hour)

			env.ExecuteWorkflow(workflows.OrderWorkflow, newInput())

			assertCancelled(t, env)
		})
	}
}

func TestFulfilmentExceptionIgnoredWhileReservingInventory(t *testing.T) {
	env := newEnv()
	delayReservation(env, 5*time.Minute)

	env.RegisterDelayedCallback(func() { raiseException(env, supplierException) }, time.Minute)

	env.RegisterDelayedCallback(func() {
		order := queryOrder(t, env)

		assert.Equal(t, workflows.OrderStatusConfirmed, order.Status)
		assert.Nil(t, order.Fulfilment.Exception)

		env.CancelWorkflow()
	}, 10*time.Minute)

	env.ExecuteWorkflow(workflows.OrderWorkflow, newInput())

	assertCancelled(t, env)
}
