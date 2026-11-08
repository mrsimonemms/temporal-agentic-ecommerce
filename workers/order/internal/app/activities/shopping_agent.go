package activities

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/responses"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
)

const (
	// ErrTypeOpenAIRequestRejected is returned when OpenAI rejects a request,
	// eg, due to invalid credentials or an unknown model. It is non-retryable.
	ErrTypeOpenAIRequestRejected = "OpenAIRequestRejected"
	// ErrTypeOpenAIUnavailable is returned for rate limiting, server and
	// network errors. It is retryable.
	ErrTypeOpenAIUnavailable = "OpenAIUnavailable"
	// ErrTypeInvalidModelResponse is returned when a model response cannot be
	// used. It is non-retryable.
	ErrTypeInvalidModelResponse = "InvalidModelResponse"
	// ErrTypeAgentLimitExceeded is returned when the agent does not reach a
	// conclusion within its model turn or tool call limits. It is non-retryable.
	ErrTypeAgentLimitExceeded = "AgentLimitExceeded"
	// ErrTypeInvalidPlanInput is returned for an invalid Activity input. It is
	// non-retryable.
	ErrTypeInvalidPlanInput = "InvalidPlanInput"
)

const (
	toolListProducts    = "list_products"
	toolProposePurchase = "propose_purchase"

	// maxModelTurns bounds the number of model requests in a single attempt
	maxModelTurns = 6
	// maxToolCalls bounds the number of tools executed in a single attempt
	maxToolCalls = 8
	// maxOutputTokens bounds each model response, including any reasoning
	maxOutputTokens = 2048
	// maxLineQuantity guards against runaway quantities from the model
	maxLineQuantity = 20
	// maxExplanationLength bounds the model's explanation held in Workflow state
	maxExplanationLength = 500
)

const agentInstructions = `You are a shopping agent for a UK homeware retailer. You select products
from the retailer's catalogue to satisfy the buyer's request. A human approves every purchase.

Rules:
- Always call list_products first. Only use product IDs returned by list_products.
- Interpret the requested quantity of each product. "Two sets of mugs" means quantity 2 of a mug set product.
- The buyer must state a maximum budget. Convert it to minor units (pence): £100 is 10000.
- Call propose_purchase once with every requested product, the budget and its ISO 4217 currency code.
- Do not substitute a product unless it clearly matches what the buyer asked for.
- Do not drop requested items, reduce quantities or add unrequested items to meet the budget.
- If propose_purchase returns an error caused by a mistake, correct it and try again.
- If the request cannot be satisfied (an item is not sold, the total exceeds the budget, no budget
  was given, or the budget is not in the catalogue currency), do not propose a purchase. Instead,
  reply with one or two sentences explaining why.`

// PlanPurchaseInput is the natural-language request to plan a purchase from
// and the catalogue snapshot to select products from
type PlanPurchaseInput struct {
	Request   string    `json:"request"`
	Catalogue Catalogue `json:"catalogue"`
}

// ProposalLine is a product and quantity selected by the agent. Prices come
// from the catalogue, never from the model.
type ProposalLine struct {
	ProductID string `json:"productId"`
	Title     string `json:"title"`
	Quantity  int64  `json:"quantity"`
	UnitPrice int64  `json:"unitPrice"`
	Total     int64  `json:"total"`
}

// PurchaseProposal is a validated purchase within the buyer's budget. Amounts
// are in the minor unit of the currency.
type PurchaseProposal struct {
	Lines    []ProposalLine `json:"lines"`
	Currency string         `json:"currency"`
	Total    int64          `json:"total"`
	Budget   int64          `json:"budget"`
}

// PurchasePlan is the outcome of planning. Exactly one of Proposal or
// Explanation is set.
type PurchasePlan struct {
	Proposal *PurchaseProposal `json:"proposal,omitempty"`
	// Why the agent could not satisfy the request
	Explanation string `json:"explanation,omitempty"`
}

// proposePurchaseArgs are the untrusted arguments the model passes to propose_purchase
type proposePurchaseArgs struct {
	Lines []struct {
		ProductID string `json:"productId"`
		Quantity  int64  `json:"quantity"`
	} `json:"lines"`
	Currency string `json:"currency"`
	Budget   int64  `json:"budget"`
}

// agentTools are the only operations available to the model. Neither tool has
// side effects: the purchase is only proposed for human approval.
var agentTools = []responses.ToolUnionParam{
	functionTool(
		toolListProducts,
		"List every product in the catalogue with its ID, title, description and unit price in minor units.",
		objectSchema(map[string]any{}),
	),
	functionTool(
		toolProposePurchase,
		"Propose a purchase for human approval. The total is calculated and checked against the budget.",
		objectSchema(map[string]any{
			"lines": arraySchema("One line per product. Each product may appear only once.", objectSchema(map[string]any{
				"productId": schemaField("string", "Product ID from list_products"),
				"quantity":  schemaField("integer", "Number of units, at least 1"),
			})),
			"currency": schemaField("string", "ISO 4217 currency code of the budget, eg GBP"),
			"budget":   schemaField("integer", "Maximum total spend in minor units, eg 10000 for £100"),
		}),
	),
}

// functionTool defines a strict function tool, so the model's arguments must
// match the schema. Arguments are still validated as untrusted input.
func functionTool(name, description string, parameters map[string]any) responses.ToolUnionParam {
	return responses.ToolUnionParam{OfFunction: &responses.FunctionToolParam{
		Name:        name,
		Description: openai.String(description),
		Strict:      openai.Bool(true),
		Parameters:  parameters,
	}}
}

// objectSchema is a JSON schema object where every property is required and
// no other properties are allowed, as strict function calling requires
func objectSchema(properties map[string]any) map[string]any {
	required := make([]string, 0, len(properties))
	for name := range properties {
		required = append(required, name)
	}
	slices.Sort(required)

	return map[string]any{
		"type":                 "object",
		"properties":           properties,
		"required":             required,
		"additionalProperties": false,
	}
}

func schemaField(typ, description string) map[string]any {
	return map[string]any{"type": typ, "description": description}
}

func arraySchema(description string, items map[string]any) map[string]any {
	field := schemaField("array", description)
	field["items"] = items
	return field
}

// PlanPurchase uses an OpenAI model with function calling to select products
// from the supplied catalogue snapshot. The catalogue is not fetched here, so
// a retried attempt repeats only the model interaction. The model only selects
// products: the proposal is validated and totalled against the snapshot, and is
// never trusted as returned by the model. The loop is bounded by maxModelTurns
// and maxToolCalls.
func (a *Activities) PlanPurchase(ctx context.Context, input *PlanPurchaseInput) (*PurchasePlan, error) {
	logger := activity.GetLogger(ctx)

	if strings.TrimSpace(input.Request) == "" {
		return nil, temporal.NewNonRetryableApplicationError("request is required", ErrTypeInvalidPlanInput, nil)
	}
	if err := input.Catalogue.validate(); err != nil {
		return nil, temporal.NewNonRetryableApplicationError("invalid catalogue", ErrTypeInvalidPlanInput, err)
	}

	params := responses.ResponseNewParams{
		Model:             a.model,
		Instructions:      openai.String(agentInstructions),
		Input:             responses.ResponseNewParamsInputUnion{OfString: openai.String(input.Request)},
		Tools:             agentTools,
		ParallelToolCalls: openai.Bool(false),
		MaxOutputTokens:   openai.Int(maxOutputTokens),
	}
	session := &agentSession{catalogue: &input.Catalogue}

	for turn := 1; turn <= maxModelTurns; turn++ {
		res, err := a.responses.New(ctx, params)
		if err != nil {
			return nil, openAIError(err)
		}
		if res.Status != responses.ResponseStatusCompleted {
			return nil, invalidModelResponse(fmt.Sprintf("response status is %q", res.Status))
		}

		var outputs []responses.ResponseInputItemUnionParam
		for i := range res.Output {
			if res.Output[i].Type != "function_call" {
				continue
			}
			call := res.Output[i].AsFunctionCall()

			session.toolCalls++
			if session.toolCalls > maxToolCalls {
				return nil, temporal.NewNonRetryableApplicationError(
					fmt.Sprintf("agent exceeded %d tool calls", maxToolCalls), ErrTypeAgentLimitExceeded, nil,
				)
			}

			logger.Info("Executing agent tool", "tool", call.Name, "turn", turn)
			output, proposal := session.execute(&call)
			if proposal != nil {
				logger.Info("Agent proposed purchase", "lines", len(proposal.Lines), "total", proposal.Total, "budget", proposal.Budget)
				return &PurchasePlan{Proposal: proposal}, nil
			}

			outputs = append(outputs, responses.ResponseInputItemUnionParam{
				OfFunctionCallOutput: &responses.ResponseInputItemFunctionCallOutputParam{
					CallID: openai.String(call.CallID),
					Output: responses.ResponseInputItemFunctionCallOutputOutputUnionParam{OfString: openai.String(output)},
				},
			})
		}

		// No tool calls means the model has concluded without a valid proposal
		if len(outputs) == 0 {
			explanation := strings.TrimSpace(res.OutputText())
			if explanation == "" {
				return nil, invalidModelResponse("response contains neither a tool call nor an explanation")
			}
			logger.Info("Agent could not satisfy request", "turn", turn)
			return &PurchasePlan{Explanation: truncate(explanation, maxExplanationLength)}, nil
		}

		params.PreviousResponseID = openai.String(res.ID)
		params.Input = responses.ResponseNewParamsInputUnion{OfInputItemList: outputs}
	}

	return nil, temporal.NewNonRetryableApplicationError(
		fmt.Sprintf("agent did not conclude within %d model turns", maxModelTurns), ErrTypeAgentLimitExceeded, nil,
	)
}

// agentSession holds the state of the tool calls in a single Activity attempt
type agentSession struct {
	catalogue       *Catalogue
	toolCalls       int
	catalogueListed bool
}

// execute runs a tool requested by the model. It returns the tool output for
// the model and, if propose_purchase succeeded, the validated proposal.
func (s *agentSession) execute(call *responses.ResponseFunctionToolCall) (string, *PurchaseProposal) {
	switch call.Name {
	case toolListProducts:
		s.catalogueListed = true
		return toolResult(s.catalogue), nil
	case toolProposePurchase:
		if !s.catalogueListed {
			return toolError(errors.New("call list_products before proposing a purchase")), nil
		}

		var args proposePurchaseArgs
		dec := json.NewDecoder(bytes.NewReader([]byte(call.Arguments)))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&args); err != nil {
			return toolError(fmt.Errorf("invalid arguments: %w", err)), nil
		}

		proposal, err := buildProposal(&args, s.catalogue)
		if err != nil {
			return toolError(err), nil
		}
		return "", proposal
	default:
		return toolError(fmt.Errorf("unknown tool %q", call.Name)), nil
	}
}

// buildProposal validates the model's selection against the catalogue
// snapshot and calculates the total in minor units. The proposal keeps the
// titles and prices from the snapshot, which are what the human approves.
func buildProposal(args *proposePurchaseArgs, catalogue *Catalogue) (*PurchaseProposal, error) {
	var errs []error
	if args.Currency != catalogue.Currency {
		errs = append(errs, fmt.Errorf("currency %q is not supported: the catalogue is priced in %s", args.Currency, catalogue.Currency))
	}
	if args.Budget <= 0 {
		errs = append(errs, errors.New("budget must be a positive amount in minor units"))
	}
	if len(args.Lines) == 0 {
		errs = append(errs, errors.New("at least one line is required"))
	}

	proposal := &PurchaseProposal{Currency: catalogue.Currency, Budget: args.Budget}
	seen := map[string]bool{}
	for k, l := range args.Lines {
		product, ok := catalogue.find(l.ProductID)
		if !ok {
			errs = append(errs, fmt.Errorf("line %d: product %q is not in the catalogue", k, l.ProductID))
			continue
		}
		if seen[l.ProductID] {
			errs = append(errs, fmt.Errorf("line %d: product %q appears more than once", k, l.ProductID))
			continue
		}
		seen[l.ProductID] = true
		if l.Quantity < 1 || l.Quantity > maxLineQuantity {
			errs = append(errs, fmt.Errorf("line %d: quantity must be between 1 and %d", k, maxLineQuantity))
			continue
		}

		total := l.Quantity * product.UnitPrice
		proposal.Lines = append(proposal.Lines, ProposalLine{
			ProductID: product.ID,
			Title:     product.Title,
			Quantity:  l.Quantity,
			UnitPrice: product.UnitPrice,
			Total:     total,
		})
		proposal.Total += total
	}
	if err := errors.Join(errs...); err != nil {
		return nil, err
	}

	if proposal.Total > proposal.Budget {
		return nil, fmt.Errorf("total of %s exceeds the budget of %s",
			formatMinor(proposal.Total, proposal.Currency), formatMinor(proposal.Budget, proposal.Currency))
	}

	return proposal, nil
}

// openAIError converts an OpenAI client error into a Temporal error. Upstream
// messages are not included because they may echo part of the API key.
func openAIError(err error) error {
	if apiErr, ok := errors.AsType[*openai.Error](err); ok {
		msg := fmt.Sprintf("OpenAI request failed with status %d", apiErr.StatusCode)
		if apiErr.Code != "" {
			msg += ": " + apiErr.Code
		}
		if apiErr.StatusCode == http.StatusTooManyRequests || apiErr.StatusCode >= http.StatusInternalServerError {
			return temporal.NewApplicationError(msg, ErrTypeOpenAIUnavailable)
		}
		return temporal.NewNonRetryableApplicationError(msg, ErrTypeOpenAIRequestRejected, nil)
	}

	// Network errors and timeouts may be transient
	return temporal.NewApplicationErrorWithCause("OpenAI request failed", ErrTypeOpenAIUnavailable, err)
}

func invalidModelResponse(msg string) error {
	return temporal.NewNonRetryableApplicationError("invalid model response: "+msg, ErrTypeInvalidModelResponse, nil)
}

func toolResult(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return toolError(err)
	}
	return string(b)
}

func toolError(err error) string {
	return toolResult(map[string]string{"error": err.Error()})
}

func formatMinor(amount int64, currency string) string {
	return fmt.Sprintf("%s %d.%02d", currency, amount/100, amount%100)
}

func truncate(s string, maxLen int) string {
	r := []rune(s)
	if len(r) <= maxLen {
		return s
	}
	return string(r[:maxLen]) + "…"
}
