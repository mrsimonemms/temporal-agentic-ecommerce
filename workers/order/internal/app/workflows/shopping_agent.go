package workflows

import (
	"errors"
	"fmt"
	"strings"
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
	errTypePurchaseFailed            = "PurchaseFailed"

	maxShoppingRequestLength = 1000
	// The demo simulates at most two inventory reservation failures
	maxInventoryFailures = 2
)

// ShoppingAgentStatus is the lifecycle status of the Shopping Agent
type ShoppingAgentStatus string

const (
	ShoppingAgentStatusPlanning         ShoppingAgentStatus = "planning"
	ShoppingAgentStatusAwaitingApproval ShoppingAgentStatus = "awaiting_approval"
	ShoppingAgentStatusApproved         ShoppingAgentStatus = "approved"
	ShoppingAgentStatusPurchasing       ShoppingAgentStatus = "purchasing"
	ShoppingAgentStatusPurchased        ShoppingAgentStatus = "purchased"
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
// Transient failures are retried one to two seconds apart, quickly enough to
// watch during a live demonstration. Attempts are bounded: the
// ai_service_unavailable scenario uses five, leaving room for real transient
// OpenAI errors. Permanent OpenAI errors are non-retryable and fail at once.
var planPurchaseActivityOptions = workflow.ActivityOptions{
	StartToCloseTimeout: 4 * time.Minute,
	RetryPolicy: &temporal.RetryPolicy{
		InitialInterval:    time.Second,
		BackoffCoefficient: 2.0,
		MaximumInterval:    2 * time.Second,
		MaximumAttempts:    10,
	},
}

// commerceActivityOptions apply to the catalogue and checkout Activities. They
// retry transient commerce API failures quickly enough to be visible in a live
// demonstration. Attempts are unlimited: the agent waits for the commerce API
// to recover rather than failing. Rejections and invalid responses are
// non-retryable and fail immediately. Each operation is a separate Activity,
// so only the failed operation is retried.
var commerceActivityOptions = workflow.ActivityOptions{
	StartToCloseTimeout: 30 * time.Second,
	RetryPolicy: &temporal.RetryPolicy{
		InitialInterval:    time.Second,
		BackoffCoefficient: 2.0,
		MaximumInterval:    10 * time.Second,
	},
}

// ShoppingAgentDemoOptions are demo-only controls for the Order the purchase
// places. They are not part of the purchase proposal or the checkout.
type ShoppingAgentDemoOptions struct {
	// Named failure behaviour for the Shopping Agent's AI planning
	Scenario activities.DemoScenario `json:"scenario,omitempty"`
	// Number of inventory reservation attempts that fail before succeeding
	InventoryFailures int32 `json:"inventoryFailures,omitempty"`
}

// ShoppingAgentInput is the command to start a Shopping Agent
type ShoppingAgentInput struct {
	// Natural-language shopping request, eg "Buy me a kettle. Keep it under £50."
	Request string `json:"request"`
	// Who the purchase is for, used for the checkout
	Buyer Buyer                     `json:"buyer"`
	Demo  *ShoppingAgentDemoOptions `json:"demo,omitempty"`
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
	// Set once the checkout is created and completed
	CheckoutID        string `json:"checkoutId,omitempty"`
	OrderID           string `json:"orderId,omitempty"`
	OrderPermalinkURL string `json:"orderPermalinkUrl,omitempty"`
	// Why planning or purchasing failed
	Error     string                    `json:"error,omitempty"`
	Demo      *ShoppingAgentDemoOptions `json:"demo,omitempty"`
	CreatedAt time.Time                 `json:"createdAt"`
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
	if i.Demo != nil && (i.Demo.InventoryFailures < 0 || i.Demo.InventoryFailures > maxInventoryFailures) {
		errs = append(errs, fmt.Errorf("demo inventoryFailures must be between 0 and %d", maxInventoryFailures))
	}
	if i.Demo != nil && !i.Demo.Scenario.Valid() {
		errs = append(errs, fmt.Errorf("demo scenario %q is not supported", i.Demo.Scenario))
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

// getCatalogue retrieves the catalogue from the commerce API. Its result is
// recorded in the history, so a retried or replayed planning step reuses the
// same snapshot rather than fetching it again.
func getCatalogue(ctx workflow.Context) (*activities.Catalogue, error) {
	var a *activities.Activities
	var catalogue activities.Catalogue
	err := workflow.ExecuteActivity(
		workflow.WithActivityOptions(ctx, commerceActivityOptions),
		a.GetCatalogue,
	).Get(ctx, &catalogue)
	return &catalogue, err
}

func planPurchase(
	ctx workflow.Context, request string, catalogue *activities.Catalogue, scenario activities.DemoScenario,
) (*activities.PurchasePlan, error) {
	var a *activities.Activities
	var plan activities.PurchasePlan
	err := workflow.ExecuteActivity(
		workflow.WithActivityOptions(ctx, planPurchaseActivityOptions),
		a.PlanPurchase,
		&activities.PlanPurchaseInput{Request: request, Catalogue: *catalogue, Scenario: scenario},
	).Get(ctx, &plan)
	return &plan, err
}

// checkoutBuyer maps the buyer onto the checkout. The name is split at the
// first space, which the commerce API joins again for the Order.
func checkoutBuyer(b Buyer) activities.CheckoutBuyer {
	first, last, _ := strings.Cut(strings.TrimSpace(b.Name), " ")
	return activities.CheckoutBuyer{Email: b.Email, FirstName: first, LastName: strings.TrimSpace(last)}
}

// purchase buys the approved proposal through the commerce API's UCP checkout.
// Each step is a separate Activity, so a failure retries only that step and
// never repeats the AI planning. Idempotency keys are derived from the
// Workflow ID so a retried request cannot create a second checkout or Order.
// The commerce API starts the independent Order Workflow when the checkout
// completes: the Shopping Agent never starts it directly.
func purchase(ctx workflow.Context, agent *ShoppingAgent) error {
	ctx = workflow.WithActivityOptions(ctx, commerceActivityOptions)
	var a *activities.Activities

	lines := make([]activities.CheckoutLine, len(agent.Proposal.Lines))
	for k, l := range agent.Proposal.Lines {
		lines[k] = activities.CheckoutLine{ProductID: l.ProductID, Quantity: l.Quantity}
	}

	var checkout activities.CreatedCheckout
	if err := workflow.ExecuteActivity(ctx, a.CreateCheckout, &activities.CreateCheckoutInput{
		IdempotencyKey: agent.ID + ":create-checkout",
		Buyer:          checkoutBuyer(agent.Buyer),
		Lines:          lines,
		Currency:       agent.Proposal.Currency,
		ExpectedTotal:  agent.Proposal.Total,
	}).Get(ctx, &checkout); err != nil {
		return fmt.Errorf("error creating checkout: %w", err)
	}
	agent.CheckoutID = checkout.ID

	// Configured before completion, because completion starts the Order
	if agent.Demo != nil && agent.Demo.InventoryFailures > 0 {
		if err := workflow.ExecuteActivity(ctx, a.ConfigureInventoryFailures, activities.ConfigureInventoryFailuresInput{
			CheckoutID: checkout.ID,
			Failures:   agent.Demo.InventoryFailures,
		}).Get(ctx, nil); err != nil {
			return fmt.Errorf("error configuring inventory failures: %w", err)
		}
	}

	var completed activities.CompletedCheckout
	if err := workflow.ExecuteActivity(ctx, a.CompleteCheckout, activities.CompleteCheckoutInput{
		IdempotencyKey:   agent.ID + ":complete-checkout",
		CheckoutID:       checkout.ID,
		PaymentHandlerID: checkout.PaymentHandlerID,
		InstrumentID:     "pi_" + agent.ID,
	}).Get(ctx, &completed); err != nil {
		return fmt.Errorf("error completing checkout: %w", err)
	}
	agent.OrderID = completed.OrderID
	agent.OrderPermalinkURL = completed.OrderPermalinkURL
	return nil
}

// fail records a failure and returns it with the final state as its details,
// so the state remains available from the Workflow's failure once it closes
func (s *ShoppingAgent) fail(msg, errType string, err error) error {
	s.Status = ShoppingAgentStatusFailed
	s.Error = msg
	if appErr, ok := errors.AsType[*temporal.ApplicationError](err); ok {
		s.Error = appErr.Message()
	}
	return temporal.NewNonRetryableApplicationError(msg, errType, err, s)
}

// ShoppingAgentWorkflow plans a purchase from a natural-language request using
// an AI agent, then waits durably for a human to approve or reject it. A
// rejected purchase completes the Workflow. An approved purchase is bought
// through the commerce API's UCP checkout and the Workflow completes with the
// checkout and Order references. The Order then continues independently in
// its own Workflow. The final state is the Workflow result.
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
		Demo:      input.Demo,
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
			// A snapshot of the state when the decision was recorded: the
			// Workflow continues to change the state as it purchases
			snapshot := *agent
			return &snapshot, nil
		},
		workflow.UpdateHandlerOptions{Validator: agent.validateDecision},
	); err != nil {
		return nil, fmt.Errorf("error registering %s update handler: %w", UpdateDecidePurchase, err)
	}

	// Separate Activities, so a catalogue failure costs no model tokens and a
	// planning retry does not fetch the catalogue again
	catalogue, err := getCatalogue(ctx)
	if err != nil {
		return nil, agent.fail("unable to retrieve catalogue", errTypePlanningFailed, err)
	}

	var scenario activities.DemoScenario
	if input.Demo != nil {
		scenario = input.Demo.Scenario
	}
	plan, err := planPurchase(ctx, input.Request, catalogue, scenario)
	if err != nil {
		return nil, agent.fail("unable to plan purchase", errTypePlanningFailed, err)
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

	// Let the Update handler return its result before continuing
	if err := workflow.Await(ctx, func() bool { return workflow.AllHandlersFinished(ctx) }); err != nil {
		return nil, err
	}

	if agent.Status == ShoppingAgentStatusRejected {
		logger.Info("Purchase rejected", "agentId", agent.ID)
		return agent, nil
	}

	logger.Info("Purchase approved", "agentId", agent.ID)
	agent.Status = ShoppingAgentStatusPurchasing
	if err := purchase(ctx, agent); err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, agent.fail("unable to complete purchase", errTypePurchaseFailed, err)
	}

	agent.Status = ShoppingAgentStatusPurchased
	logger.Info("Purchase completed", "agentId", agent.ID, "checkoutId", agent.CheckoutID, "orderId", agent.OrderID)
	return agent, nil
}
