package activities_test

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/mrsimonemms/temporal-agentic-ecommerce/workers/order/internal/app/activities"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"
)

const (
	shoppingRequest = "Buy me a kettle and two sets of mugs. Keep it under £100."
	validProposal   = `{"lines":[{"productId":"sku_kettle","quantity":1},{"productId":"sku_mug_set","quantity":2}],` +
		`"currency":"GBP","budget":10000}`
	unsatisfiable = "I could not find a valid purchase for that request."

	errInvalidQuantity  = "quantity must be between 1 and 20"
	errInvalidArguments = "invalid arguments"
	errPositiveBudget   = "budget must be a positive amount"

	// echoedKey is replaced with the configured API key in replies
	echoedKey = "{{key}}"
)

// reply is a scripted response from the fake OpenAI server
type reply struct {
	status int
	body   string
}

// recordedRequest is the subset of a Responses API request the tests inspect
type recordedRequest struct {
	Model              string          `json:"model"`
	Instructions       string          `json:"instructions"`
	Input              json.RawMessage `json:"input"`
	PreviousResponseID string          `json:"previous_response_id"`
	ParallelToolCalls  *bool           `json:"parallel_tool_calls"`
	Tools              []struct {
		Type   string `json:"type"`
		Name   string `json:"name"`
		Strict bool   `json:"strict"`
	} `json:"tools"`

	bearerToken string
}

// fakeOpenAI stands in for the OpenAI Responses API so that tests never
// require credentials or incur charges. It returns scripted replies in order
// and records every request.
type fakeOpenAI struct {
	mu       sync.Mutex
	replies  []reply
	repeat   bool
	apiKey   string
	requests []recordedRequest
}

func (f *fakeOpenAI) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()

	var req recordedRequest
	if r.Method != http.MethodPost || r.URL.Path != "/responses" || json.NewDecoder(r.Body).Decode(&req) != nil {
		http.Error(w, "unexpected request", http.StatusBadRequest)
		return
	}
	req.bearerToken = strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	f.requests = append(f.requests, req)

	i := len(f.requests) - 1
	if f.repeat {
		i = 0
	}
	if i >= len(f.replies) {
		http.Error(w, "no scripted reply", http.StatusTeapot)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(f.replies[i].status)
	_, _ = w.Write([]byte(strings.ReplaceAll(f.replies[i].body, echoedKey, f.apiKey)))
}

func (f *fakeOpenAI) recorded() []recordedRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.requests
}

// startFake starts the fake OpenAI server and points the OpenAI SDK at it.
// openai.NewClient reads OPENAI_BASE_URL itself, so the production
// constructor is used unchanged and no request can reach the real API.
func startFake(t *testing.T, fake *fakeOpenAI) {
	t.Helper()

	srv := httptest.NewServer(fake)
	t.Cleanup(srv.Close)
	t.Setenv("OPENAI_BASE_URL", srv.URL)

	// The SDK also reads OPENAI_API_KEY. Set it to a different value to prove
	// the injected key is the one sent.
	t.Setenv("OPENAI_API_KEY", "sk-from-environment-must-not-be-used")
}

// newAgent constructs the Activities through the production constructor with
// a random API key, which it returns, and the default model
func newAgent(t *testing.T, fake *fakeOpenAI) (acts *activities.Activities, apiKey string) {
	t.Helper()

	startFake(t, fake)
	apiKey = "sk-test-" + rand.Text()
	fake.apiKey = apiKey

	acts, err := activities.NewActivities(apiKey, activities.DefaultOpenAIModel, activities.DefaultCommerceAPIURL)
	require.NoError(t, err)
	return acts, apiKey
}

// kitchenCatalogue is a catalogue snapshot as returned by GetCatalogue. The
// worker holds no catalogue of its own: tests supply it, as the Workflow does.
func kitchenCatalogue() activities.Catalogue {
	return activities.Catalogue{
		Currency: gbp,
		Products: []activities.Product{
			{ID: kettleSKU, Title: kettleTitle, Description: "1.7 litre cordless electric kettle", UnitPrice: 3499},
			{ID: "sku_toaster", Title: "Four-Slice Toaster", Description: "Four-slot electric toaster", UnitPrice: 4999},
			{ID: mugSetSKU, Title: "Stoneware Mug Set (4 pack)", Description: "One set of four stoneware mugs", UnitPrice: 2400},
		},
	}
}

func planPurchase(t *testing.T, acts *activities.Activities, request string) (*activities.PurchasePlan, error) {
	t.Helper()
	return planPurchaseFrom(t, acts, request, kitchenCatalogue())
}

func planPurchaseFrom(
	t *testing.T, acts *activities.Activities, request string, catalogue activities.Catalogue,
) (*activities.PurchasePlan, error) {
	t.Helper()

	var s testsuite.WorkflowTestSuite
	env := s.NewTestActivityEnvironment()
	env.RegisterActivity(acts)

	res, err := env.ExecuteActivity(acts.PlanPurchase, &activities.PlanPurchaseInput{Request: request, Catalogue: catalogue})
	if err != nil {
		return nil, err
	}

	var plan activities.PurchasePlan
	require.NoError(t, res.Get(&plan))
	return &plan, nil
}

// outputItem is a Responses API output item: a function call or a message
type outputItem struct {
	Type      string          `json:"type"`
	ID        string          `json:"id"`
	Status    string          `json:"status"`
	CallID    string          `json:"call_id,omitempty"`
	Name      string          `json:"name,omitempty"`
	Arguments string          `json:"arguments,omitempty"`
	Role      string          `json:"role,omitempty"`
	Content   []outputContent `json:"content,omitempty"`
}

type outputContent struct {
	Type        string `json:"type"`
	Text        string `json:"text"`
	Annotations []any  `json:"annotations"`
}

func response(id, status string, output ...outputItem) reply {
	b, err := json.Marshal(struct {
		ID     string       `json:"id"`
		Object string       `json:"object"`
		Status string       `json:"status"`
		Model  string       `json:"model"`
		Output []outputItem `json:"output"`
	}{ID: id, Object: "response", Status: status, Model: activities.DefaultOpenAIModel, Output: append([]outputItem{}, output...)})
	if err != nil {
		panic(err)
	}
	return reply{status: http.StatusOK, body: string(b)}
}

func functionCall(callID, name, args string) outputItem {
	return outputItem{Type: "function_call", ID: "fc_" + callID, Status: "completed", CallID: callID, Name: name, Arguments: args}
}

func message(text string) outputItem {
	return outputItem{
		Type:    "message",
		ID:      "msg_1",
		Status:  "completed",
		Role:    "assistant",
		Content: []outputContent{{Type: "output_text", Text: text, Annotations: []any{}}},
	}
}

func listProducts(id string) reply {
	return response(id, "completed", functionCall("call_list_"+id, "list_products", "{}"))
}

func proposePurchase(id, args string) reply {
	return response(id, "completed", functionCall("call_propose_"+id, "propose_purchase", args))
}

func explain(id, text string) reply {
	return response(id, "completed", message(text))
}

// functionOutput returns the single function call output sent in a request
func functionOutput(t *testing.T, req *recordedRequest) (callID, output string) {
	t.Helper()

	var input []struct {
		Type   string `json:"type"`
		CallID string `json:"call_id"`
		Output string `json:"output"`
	}
	require.NoError(t, json.Unmarshal(req.Input, &input), "input should be a list of items")
	require.Len(t, input, 1)
	assert.Equal(t, "function_call_output", input[0].Type)
	return input[0].CallID, input[0].Output
}

func assertAppError(t *testing.T, err error, errType string, nonRetryable bool) {
	t.Helper()

	var appErr *temporal.ApplicationError
	require.True(t, errors.As(err, &appErr), "expected an application error, got %v", err)
	assert.Equal(t, errType, appErr.Type())
	assert.Equal(t, nonRetryable, appErr.NonRetryable())
}

func TestPlanPurchaseProposesValidatedPurchase(t *testing.T) {
	fake := &fakeOpenAI{replies: []reply{
		listProducts("resp_1"),
		proposePurchase("resp_2", validProposal),
	}}
	acts, apiKey := newAgent(t, fake)

	plan, err := planPurchase(t, acts, shoppingRequest)
	require.NoError(t, err)

	assert.Empty(t, plan.Explanation)
	assert.Equal(t, &activities.PurchaseProposal{
		Lines: []activities.ProposalLine{
			{ProductID: kettleSKU, Title: kettleTitle, Quantity: 1, UnitPrice: 3499, Total: 3499},
			{ProductID: "sku_mug_set", Title: "Stoneware Mug Set (4 pack)", Quantity: 2, UnitPrice: 2400, Total: 4800},
		},
		Currency: "GBP",
		Total:    8299,
		Budget:   10000,
	}, plan.Proposal)

	requests := fake.recorded()
	require.Len(t, requests, 2, "an accepted proposal should end the loop without another model call")

	// The first request offers both tools and the buyer's request
	first := requests[0]
	assert.Equal(t, apiKey, first.bearerToken)
	assert.Equal(t, activities.DefaultOpenAIModel, first.Model)
	assert.JSONEq(t, fmt.Sprintf("%q", shoppingRequest), string(first.Input))
	assert.NotEmpty(t, first.Instructions)
	require.NotNil(t, first.ParallelToolCalls)
	assert.False(t, *first.ParallelToolCalls)
	var names []string
	for _, tool := range first.Tools {
		assert.Equal(t, "function", tool.Type)
		assert.True(t, tool.Strict)
		names = append(names, tool.Name)
	}
	assert.Equal(t, []string{"list_products", "propose_purchase"}, names)

	// The catalogue is returned to the model as the list_products output
	second := requests[1]
	assert.Equal(t, "resp_1", second.PreviousResponseID)
	assert.Equal(t, first.Instructions, second.Instructions)
	callID, output := functionOutput(t, &second)
	assert.Equal(t, "call_list_resp_1", callID)

	// list_products returns exactly the supplied snapshot
	var listed activities.Catalogue
	require.NoError(t, json.Unmarshal([]byte(output), &listed))
	assert.Equal(t, kitchenCatalogue(), listed)
}

func TestPlanPurchaseValidatesAgainstTheSuppliedCatalogue(t *testing.T) {
	// A different catalogue: the kettle costs more, the mug set is not sold
	// and a teapot is. Nothing is priced from data held by the worker.
	catalogue := activities.Catalogue{
		Currency: "EUR",
		Products: []activities.Product{
			{ID: kettleSKU, Title: "Copper Kettle", UnitPrice: 5999},
			{ID: "sku_teapot", Title: "Cast Iron Teapot", UnitPrice: 2750},
		},
	}
	fake := &fakeOpenAI{replies: []reply{
		listProducts("resp_1"),
		// Valid for the kitchen catalogue, but not for this one
		proposePurchase("resp_2", validProposal),
		proposePurchase("resp_3", `{"lines":[{"productId":"sku_kettle","quantity":1},{"productId":"sku_teapot","quantity":2}],`+
			`"currency":"EUR","budget":12000}`),
	}}
	acts, _ := newAgent(t, fake)

	plan, err := planPurchaseFrom(t, acts, "Buy me a kettle and two teapots for under €120", catalogue)
	require.NoError(t, err)

	requests := fake.recorded()
	require.Len(t, requests, 3)
	_, listing := functionOutput(t, &requests[1])
	var listed activities.Catalogue
	require.NoError(t, json.Unmarshal([]byte(listing), &listed))
	assert.Equal(t, catalogue, listed)

	_, rejection := functionOutput(t, &requests[2])
	assert.Contains(t, rejection, `currency \"GBP\" is not supported: the catalogue is priced in EUR`)
	assert.Contains(t, rejection, `product \"sku_mug_set\" is not in the catalogue`)

	assert.Equal(t, &activities.PurchaseProposal{
		Lines: []activities.ProposalLine{
			{ProductID: kettleSKU, Title: "Copper Kettle", Quantity: 1, UnitPrice: 5999, Total: 5999},
			{ProductID: "sku_teapot", Title: "Cast Iron Teapot", Quantity: 2, UnitPrice: 2750, Total: 5500},
		},
		Currency: "EUR",
		Total:    11499,
		Budget:   12000,
	}, plan.Proposal)
}

func TestPlanPurchaseRejectsAnInvalidCatalogue(t *testing.T) {
	tests := map[string]activities.Catalogue{
		"empty":             {Currency: gbp},
		"missing currency":  {Products: kitchenCatalogue().Products},
		"duplicate product": {Currency: gbp, Products: append(kitchenCatalogue().Products, kitchenCatalogue().Products[0])},
		"negative price": {Currency: gbp, Products: []activities.Product{
			{ID: kettleSKU, Title: kettleTitle, UnitPrice: -1},
		}},
	}

	for name, catalogue := range tests {
		t.Run(name, func(t *testing.T) {
			fake := &fakeOpenAI{}
			acts, _ := newAgent(t, fake)

			_, err := planPurchaseFrom(t, acts, shoppingRequest, catalogue)
			assertAppError(t, err, activities.ErrTypeInvalidPlanInput, true)
			// No model tokens are spent on an unusable catalogue
			assert.Empty(t, fake.recorded())
		})
	}
}

func TestPlanPurchaseUsesInjectedModel(t *testing.T) {
	fake := &fakeOpenAI{replies: []reply{listProducts("resp_1"), proposePurchase("resp_2", validProposal)}}
	startFake(t, fake)

	acts, err := activities.NewActivities("sk-test-model", "gpt-test-model", activities.DefaultCommerceAPIURL)
	require.NoError(t, err)

	_, err = planPurchase(t, acts, shoppingRequest)
	require.NoError(t, err)

	requests := fake.recorded()
	require.Len(t, requests, 2)
	for _, req := range requests {
		assert.Equal(t, "gpt-test-model", req.Model)
		assert.Equal(t, "sk-test-model", req.bearerToken)
	}
}

func TestPlanPurchaseRejectsInvalidProposals(t *testing.T) {
	tests := map[string]struct {
		args          string
		expectedError string
	}{
		"unknown product": {
			args:          `{"lines":[{"productId":"sku_teapot","quantity":1}],"currency":"GBP","budget":10000}`,
			expectedError: `product \"sku_teapot\" is not in the catalogue`,
		},
		"zero quantity": {
			args:          `{"lines":[{"productId":"sku_kettle","quantity":0}],"currency":"GBP","budget":10000}`,
			expectedError: errInvalidQuantity,
		},
		"negative quantity": {
			args:          `{"lines":[{"productId":"sku_kettle","quantity":-1}],"currency":"GBP","budget":10000}`,
			expectedError: errInvalidQuantity,
		},
		"excessive quantity": {
			args:          `{"lines":[{"productId":"sku_mug_set","quantity":21}],"currency":"GBP","budget":1000000}`,
			expectedError: errInvalidQuantity,
		},
		"fractional quantity": {
			args:          `{"lines":[{"productId":"sku_kettle","quantity":1.5}],"currency":"GBP","budget":10000}`,
			expectedError: errInvalidArguments,
		},
		"duplicate lines": {
			args: `{"lines":[{"productId":"sku_mug_set","quantity":1},{"productId":"sku_mug_set","quantity":1}],` +
				`"currency":"GBP","budget":10000}`,
			expectedError: `product \"sku_mug_set\" appears more than once`,
		},
		"no lines": {
			args:          `{"lines":[],"currency":"GBP","budget":10000}`,
			expectedError: "at least one line is required",
		},
		"unsupported currency": {
			args:          `{"lines":[{"productId":"sku_kettle","quantity":1}],"currency":"USD","budget":10000}`,
			expectedError: `currency \"USD\" is not supported`,
		},
		"zero budget": {
			args:          `{"lines":[{"productId":"sku_kettle","quantity":1}],"currency":"GBP","budget":0}`,
			expectedError: errPositiveBudget,
		},
		"negative budget": {
			args:          `{"lines":[{"productId":"sku_kettle","quantity":1}],"currency":"GBP","budget":-100}`,
			expectedError: errPositiveBudget,
		},
		"over budget": {
			args: `{"lines":[{"productId":"sku_kettle","quantity":1},{"productId":"sku_mug_set","quantity":2}],` +
				`"currency":"GBP","budget":8298}`,
			expectedError: "total of GBP 82.99 exceeds the budget of GBP 82.98",
		},
		"malformed arguments": {
			args:          `{"lines":`,
			expectedError: errInvalidArguments,
		},
		"model-supplied price": {
			args: `{"lines":[{"productId":"sku_kettle","quantity":1,"unitPrice":1}],` +
				`"currency":"GBP","budget":10000}`,
			expectedError: errInvalidArguments,
		},
	}

	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			fake := &fakeOpenAI{replies: []reply{
				listProducts("resp_1"),
				proposePurchase("resp_2", test.args),
				explain("resp_3", unsatisfiable),
			}}
			acts, _ := newAgent(t, fake)

			plan, err := planPurchase(t, acts, shoppingRequest)
			require.NoError(t, err)

			// The invalid proposal is never returned
			assert.Nil(t, plan.Proposal)
			assert.Equal(t, unsatisfiable, plan.Explanation)

			// The validation error is returned to the model so it can explain or correct it
			requests := fake.recorded()
			require.Len(t, requests, 3)
			callID, output := functionOutput(t, &requests[2])
			assert.Equal(t, "call_propose_resp_2", callID)
			assert.Contains(t, output, `"error"`)
			assert.Contains(t, output, test.expectedError)
		})
	}
}

func TestPlanPurchaseAcceptsTotalEqualToBudget(t *testing.T) {
	args := `{"lines":[{"productId":"sku_kettle","quantity":1},{"productId":"sku_mug_set","quantity":2}],"currency":"GBP","budget":8299}`
	acts, _ := newAgent(t, &fakeOpenAI{replies: []reply{listProducts("resp_1"), proposePurchase("resp_2", args)}})

	plan, err := planPurchase(t, acts, shoppingRequest)
	require.NoError(t, err)
	require.NotNil(t, plan.Proposal)
	assert.Equal(t, int64(8299), plan.Proposal.Total)
}

func TestPlanPurchaseAllowsModelToCorrectMistakes(t *testing.T) {
	fake := &fakeOpenAI{replies: []reply{
		listProducts("resp_1"),
		proposePurchase("resp_2", `{"lines":[{"productId":"kettle","quantity":1}],"currency":"GBP","budget":10000}`),
		proposePurchase("resp_3", validProposal),
	}}
	acts, _ := newAgent(t, fake)

	plan, err := planPurchase(t, acts, shoppingRequest)
	require.NoError(t, err)
	require.NotNil(t, plan.Proposal)
	assert.Equal(t, int64(8299), plan.Proposal.Total)
	assert.Len(t, fake.recorded(), 3)
}

func TestPlanPurchaseRequiresCatalogueDiscovery(t *testing.T) {
	fake := &fakeOpenAI{replies: []reply{
		proposePurchase("resp_1", validProposal),
		listProducts("resp_2"),
		proposePurchase("resp_3", validProposal),
	}}
	acts, _ := newAgent(t, fake)

	plan, err := planPurchase(t, acts, shoppingRequest)
	require.NoError(t, err)
	require.NotNil(t, plan.Proposal)

	requests := fake.recorded()
	require.Len(t, requests, 3)
	_, output := functionOutput(t, &requests[1])
	assert.Contains(t, output, "call list_products before proposing a purchase")
}

func TestPlanPurchaseExplainsUnsatisfiableRequest(t *testing.T) {
	explanation := "The catalogue does not include a blender, so I cannot complete this purchase."
	fake := &fakeOpenAI{replies: []reply{listProducts("resp_1"), explain("resp_2", explanation)}}
	acts, _ := newAgent(t, fake)

	plan, err := planPurchase(t, acts, "Buy me a blender under £50")
	require.NoError(t, err)
	assert.Nil(t, plan.Proposal)
	assert.Equal(t, explanation, plan.Explanation)
}

func TestPlanPurchaseTruncatesLongExplanation(t *testing.T) {
	acts, _ := newAgent(t, &fakeOpenAI{replies: []reply{explain("resp_1", strings.Repeat("a", 2000))}})

	plan, err := planPurchase(t, acts, shoppingRequest)
	require.NoError(t, err)
	assert.Equal(t, strings.Repeat("a", 500)+"…", plan.Explanation)
}

func TestPlanPurchaseReturnsUnknownToolErrorToModel(t *testing.T) {
	fake := &fakeOpenAI{replies: []reply{
		response("resp_1", "completed", functionCall("call_1", "create_checkout", "{}")),
		explain("resp_2", "I cannot do that."),
	}}
	acts, _ := newAgent(t, fake)

	plan, err := planPurchase(t, acts, shoppingRequest)
	require.NoError(t, err)
	assert.Nil(t, plan.Proposal)

	_, output := functionOutput(t, &fake.recorded()[1])
	assert.Contains(t, output, `unknown tool \"create_checkout\"`)
}

func TestPlanPurchaseMalformedModelResponses(t *testing.T) {
	tests := map[string]struct {
		reply        reply
		errType      string // defaults to ErrTypeInvalidModelResponse, which is non-retryable
		nonRetryable bool
	}{
		"empty output":        {reply: response("resp_1", "completed")},
		"empty message":       {reply: explain("resp_1", "   ")},
		"incomplete response": {reply: response("resp_1", "incomplete", message("partial"))},
		"failed response":     {reply: response("resp_1", "failed")},
		// The SDK cannot decode the body, which may be a transient upstream fault
		"unparseable response": {reply: reply{status: http.StatusOK, body: `{"id":`}, errType: activities.ErrTypeOpenAIUnavailable},
	}

	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			acts, _ := newAgent(t, &fakeOpenAI{replies: []reply{test.reply}})
			if test.errType == "" {
				test.errType, test.nonRetryable = activities.ErrTypeInvalidModelResponse, true
			}

			_, err := planPurchase(t, acts, shoppingRequest)
			assertAppError(t, err, test.errType, test.nonRetryable)
		})
	}
}

func TestPlanPurchaseRequiresRequest(t *testing.T) {
	fake := &fakeOpenAI{}
	acts, _ := newAgent(t, fake)

	_, err := planPurchase(t, acts, "  ")
	assertAppError(t, err, activities.ErrTypeInvalidPlanInput, true)
	assert.Empty(t, fake.recorded())
}

func TestPlanPurchaseBoundsModelTurns(t *testing.T) {
	// The model never concludes
	fake := &fakeOpenAI{replies: []reply{listProducts("resp_loop")}, repeat: true}
	acts, _ := newAgent(t, fake)

	_, err := planPurchase(t, acts, shoppingRequest)
	assertAppError(t, err, activities.ErrTypeAgentLimitExceeded, true)
	assert.Len(t, fake.recorded(), activities.MaxModelTurns)
}

func TestPlanPurchaseBoundsToolCalls(t *testing.T) {
	calls := make([]outputItem, activities.MaxToolCalls+1)
	for i := range calls {
		calls[i] = functionCall(fmt.Sprintf("call_%d", i), "list_products", "{}")
	}
	fake := &fakeOpenAI{replies: []reply{response("resp_1", "completed", calls...)}}
	acts, _ := newAgent(t, fake)

	_, err := planPurchase(t, acts, shoppingRequest)
	assertAppError(t, err, activities.ErrTypeAgentLimitExceeded, true)
	assert.Len(t, fake.recorded(), 1)
}

func TestPlanPurchaseAPIErrors(t *testing.T) {
	// OpenAI echoes the supplied key in authentication errors
	body := `{"error":{"message":"Incorrect API key provided: ` + echoedKey + `","type":"invalid_request_error","code":"invalid_api_key"}}`

	tests := map[string]struct {
		status       int
		errType      string
		nonRetryable bool
	}{
		"unauthorised":  {status: http.StatusUnauthorized, errType: activities.ErrTypeOpenAIRequestRejected, nonRetryable: true},
		"bad request":   {status: http.StatusBadRequest, errType: activities.ErrTypeOpenAIRequestRejected, nonRetryable: true},
		"not found":     {status: http.StatusNotFound, errType: activities.ErrTypeOpenAIRequestRejected, nonRetryable: true},
		"rate limited":  {status: http.StatusTooManyRequests, errType: activities.ErrTypeOpenAIUnavailable},
		"server error":  {status: http.StatusInternalServerError, errType: activities.ErrTypeOpenAIUnavailable},
		"bad gateway":   {status: http.StatusBadGateway, errType: activities.ErrTypeOpenAIUnavailable},
		"unavailable":   {status: http.StatusServiceUnavailable, errType: activities.ErrTypeOpenAIUnavailable},
		"gateway error": {status: http.StatusGatewayTimeout, errType: activities.ErrTypeOpenAIUnavailable},
	}

	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			fake := &fakeOpenAI{replies: []reply{{status: test.status, body: body}}}
			acts, apiKey := newAgent(t, fake)

			_, err := planPurchase(t, acts, shoppingRequest)
			assertAppError(t, err, test.errType, test.nonRetryable)
			assert.Contains(t, err.Error(), fmt.Sprintf("status %d", test.status))
			assert.NotContains(t, err.Error(), apiKey)

			// Temporal owns retries, so the SDK makes a single request
			assert.Len(t, fake.recorded(), 1)
		})
	}
}
