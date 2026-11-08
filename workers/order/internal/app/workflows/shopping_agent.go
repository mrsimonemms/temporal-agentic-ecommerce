package workflows

import (
	"errors"
	"fmt"
	"time"
	"unicode/utf8"

	"github.com/mrsimonemms/temporal-ucp-reference-architecture/workers/order/internal/app/activities"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const (
	// QueryGetShoppingAgent returns the current Shopping Agent state
	QueryGetShoppingAgent = "getShoppingAgent"
	// UpdateDecidePurchase approves or rejects the proposed purchase
	UpdateDecidePurchase = "decidePurchase"
)

const (
	errTypeInvalidShoppingAgentInput = "InvalidShoppingAgentInput"
	errTypeInvalidPurchaseDecision   = "InvalidPurchaseDecision"
	errTypePlanningFailed            = "PurchasePlanningFailed"

	maxShoppingRequestLength = 1000
)

// ShoppingAgentStatus is the lifecycle status of the Shopping Agent
type ShoppingAgentStatus string

const (
	ShoppingAgentStatusPlanning         ShoppingAgentStatus = "planning"
	ShoppingAgentStatusAwaitingApproval ShoppingAgentStatus = "awaiting_approval"
	ShoppingAgentStatusApproved         ShoppingAgentStatus = "approved"
	ShoppingAgentStatusRejected         ShoppingAgentStatus = "rejected"
	ShoppingAgentStatusFailed           ShoppingAgentStatus = "failed"
)

// PurchaseDecision is the human decision on a proposed purchase
type PurchaseDecision string

const (
	PurchaseDecisionApprove PurchaseDecision = "approve"
	PurchaseDecisionReject  PurchaseDecision = "reject"
)

// planPurchaseActivityOptions bound the model interaction. Each attempt is
// itself bounded by the Activity's model turn and request timeout limits.
var planPurchaseActivityOptions = workflow.ActivityOptions{
	StartToCloseTimeout: 4 * time.Minute,
	RetryPolicy: &temporal.RetryPolicy{
		InitialInterval:    2 * time.Second,
		BackoffCoefficient: 2,
		MaximumInterval:    30 * time.Second,
		MaximumAttempts:    3,
	},
}

// ShoppingAgentInput is the command to start a Shopping Agent
type ShoppingAgentInput struct {
	// Natural-language shopping request, eg "Buy me a kettle. Keep it under £50."
	Request string `json:"request"`
	// Who the purchase is for, used for the eventual checkout
	Buyer Buyer `json:"buyer"`
}

// DecidePurchaseRequest is the payload of the UpdateDecidePurchase Update
type DecidePurchaseRequest struct {
	Decision  PurchaseDecision `json:"decision"`
	DecidedBy string           `json:"decidedBy,omitempty"`
	Note      string           `json:"note,omitempty"`
}

// PurchaseDecisionRecord is an accepted human decision
type PurchaseDecisionRecord struct {
	Decision  PurchaseDecision `json:"decision"`
	DecidedBy string           `json:"decidedBy,omitempty"`
	Note      string           `json:"note,omitempty"`
	DecidedAt time.Time        `json:"decidedAt"`
}

// ShoppingAgent is the current state of the Shopping Agent held by the Workflow
type ShoppingAgent struct {
	ID      string              `json:"id"`
	Status  ShoppingAgentStatus `json:"status"`
	Request string              `json:"request"`
	Buyer   Buyer               `json:"buyer"`
	// The validated purchase, including the total and budget
	Proposal *activities.PurchaseProposal `json:"proposal,omitempty"`
	Decision *PurchaseDecisionRecord      `json:"decision,omitempty"`
	// Why the agent could not satisfy the request
	Explanation string `json:"explanation,omitempty"`
	// Why planning failed
	Error     string    `json:"error,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

func (i *ShoppingAgentInput) validate() error {
	var errs []error
	if i.Request == "" {
		errs = append(errs, errors.New("request is required"))
	}
	if utf8.RuneCountInString(i.Request) > maxShoppingRequestLength {
		errs = append(errs, fmt.Errorf("request cannot exceed %d characters", maxShoppingRequestLength))
	}
	if i.Buyer.Email == "" {
		errs = append(errs, errors.New("buyer email is required"))
	}
	return errors.Join(errs...)
}

// validateDecision must not change state: it is the Update validator
func (s *ShoppingAgent) validateDecision(req DecidePurchaseRequest) error {
	// Retrying the same decision cannot succeed, so rejections are non-retryable
	invalid := func(msg string) error {
		return temporal.NewNonRetryableApplicationError(msg, errTypeInvalidPurchaseDecision, nil)
	}

	if s.Status != ShoppingAgentStatusAwaitingApproval {
		return invalid(fmt.Sprintf("shopping agent is not awaiting approval: status is %s", s.Status))
	}
	if req.Decision != PurchaseDecisionApprove && req.Decision != PurchaseDecisionReject {
		return invalid(fmt.Sprintf("decision must be %q or %q", PurchaseDecisionApprove, PurchaseDecisionReject))
	}
	return nil
}

func (s *ShoppingAgent) decide(req DecidePurchaseRequest, now time.Time) {
	s.Decision = &PurchaseDecisionRecord{
		Decision:  req.Decision,
		DecidedBy: req.DecidedBy,
		Note:      req.Note,
		DecidedAt: now,
	}
	if req.Decision == PurchaseDecisionApprove {
		s.Status = ShoppingAgentStatusApproved
	} else {
		s.Status = ShoppingAgentStatusRejected
	}
}

func planPurchase(ctx workflow.Context, request string) (*activities.PurchasePlan, error) {
	var a *activities.Activities
	var plan activities.PurchasePlan
	err := workflow.ExecuteActivity(
		workflow.WithActivityOptions(ctx, planPurchaseActivityOptions),
		a.PlanPurchase,
		activities.PlanPurchaseInput{Request: request},
	).Get(ctx, &plan)
	return &plan, err
}

// ShoppingAgentWorkflow plans a purchase from a natural-language request using
// an AI agent, then waits durably for a human to approve or reject it. A
// rejected purchase completes the Workflow. An approved purchase remains open
// so that checkout can be added as the next step.
func ShoppingAgentWorkflow(ctx workflow.Context, input *ShoppingAgentInput) (*ShoppingAgent, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting ShoppingAgentWorkflow")

	if input == nil {
		return nil, temporal.NewNonRetryableApplicationError("shopping agent input is required", errTypeInvalidShoppingAgentInput, nil)
	}
	if err := input.validate(); err != nil {
		return nil, temporal.NewNonRetryableApplicationError("invalid shopping agent input", errTypeInvalidShoppingAgentInput, err)
	}

	agent := &ShoppingAgent{
		ID:        workflow.GetInfo(ctx).WorkflowExecution.ID,
		Status:    ShoppingAgentStatusPlanning,
		Request:   input.Request,
		Buyer:     input.Buyer,
		CreatedAt: workflow.Now(ctx),
	}

	if err := workflow.SetQueryHandler(ctx, QueryGetShoppingAgent, func() (*ShoppingAgent, error) {
		return agent, nil
	}); err != nil {
		return nil, fmt.Errorf("error registering %s query handler: %w", QueryGetShoppingAgent, err)
	}

	if err := workflow.SetUpdateHandlerWithOptions(
		ctx,
		UpdateDecidePurchase,
		func(ctx workflow.Context, req DecidePurchaseRequest) (*ShoppingAgent, error) {
			agent.decide(req, workflow.Now(ctx))
			logger.Info("Purchase decision recorded", "agentId", agent.ID, "decision", req.Decision)
			return agent, nil
		},
		workflow.UpdateHandlerOptions{Validator: agent.validateDecision},
	); err != nil {
		return nil, fmt.Errorf("error registering %s update handler: %w", UpdateDecidePurchase, err)
	}

	plan, err := planPurchase(ctx, input.Request)
	if err != nil {
		agent.Status = ShoppingAgentStatusFailed
		agent.Error = "unable to plan purchase"
		if appErr, ok := errors.AsType[*temporal.ApplicationError](err); ok {
			agent.Error = appErr.Message()
		}
		return nil, temporal.NewNonRetryableApplicationError("unable to plan purchase", errTypePlanningFailed, err)
	}

	if plan.Proposal == nil {
		agent.Status = ShoppingAgentStatusFailed
		agent.Explanation = plan.Explanation
		logger.Info("Shopping agent could not satisfy request", "agentId", agent.ID)
		return agent, nil
	}

	agent.Proposal = plan.Proposal
	agent.Status = ShoppingAgentStatusAwaitingApproval
	logger.Info("Purchase awaiting approval", "agentId", agent.ID, "total", agent.Proposal.Total)

	// Suspend durably until a decision is made. There is deliberately no timeout.
	if err := workflow.Await(ctx, func() bool {
		return agent.Status != ShoppingAgentStatusAwaitingApproval
	}); err != nil {
		return nil, err
	}

	if agent.Status == ShoppingAgentStatusRejected {
		// Let the Update handler return its result before completing
		if err := workflow.Await(ctx, func() bool { return workflow.AllHandlersFinished(ctx) }); err != nil {
			return nil, err
		}
		logger.Info("Purchase rejected", "agentId", agent.ID)
		return agent, nil
	}

	// Approved: remain open, without polling, until checkout is integrated.
	// Only cancellation ends the Workflow for now.
	logger.Info("Purchase approved", "agentId", agent.ID)
	ctx.Done().Receive(ctx, nil)

	logger.Info("ShoppingAgentWorkflow cancelled", "agentId", agent.ID, "status", agent.Status)
	return nil, ctx.Err()
}
