package activities

import (
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/responses"
)

const (
	// DefaultOpenAIModel is a low-cost model that supports function calling.
	// Override it with the OPENAI_MODEL environment variable.
	DefaultOpenAIModel = openai.ChatModelGPT5_4Mini

	// DefaultCommerceAPIURL is the commerce API when run locally. Override it
	// with the COMMERCE_API_URL environment variable.
	DefaultCommerceAPIURL = "http://localhost:9999/v1"

	// openAIRequestTimeout bounds each individual model request
	openAIRequestTimeout = 30 * time.Second

	// commerceRequestTimeout bounds each commerce API request. Completion
	// starts the Order Workflow, which the API bounds to a few seconds.
	commerceRequestTimeout = 15 * time.Second
)

type Activities struct {
	responses *responses.ResponseService
	model     string

	// Base URL of the commerce API's versioned routes, eg http://api:9999/v1
	commerceAPI *url.URL
	httpClient  *http.Client
}

// Registers dependencies needed for the activities
func NewActivities(openAPIKey, openAIModel, commerceAPIURL string) (*Activities, error) {
	commerceAPI, err := ParseCommerceURL(commerceAPIURL)
	if err != nil {
		return nil, fmt.Errorf("invalid commerce API URL: %w", err)
	}

	// Temporal owns retries: retrying inside the SDK as well would multiply
	// attempts and hide failures from the Workflow history
	client := openai.NewClient(
		option.WithAPIKey(openAPIKey),
		option.WithMaxRetries(0),
		option.WithRequestTimeout(openAIRequestTimeout),
	)

	a := &Activities{
		responses:   &client.Responses,
		model:       openAIModel,
		commerceAPI: commerceAPI,
		httpClient:  &http.Client{Timeout: commerceRequestTimeout},
	}

	return a, nil
}
