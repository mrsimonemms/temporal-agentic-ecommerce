package activities

import (
	"time"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/responses"
)

const (
	// DefaultOpenAIModel is a low-cost model that supports function calling.
	// Override it with the OPENAI_MODEL environment variable.
	DefaultOpenAIModel = openai.ChatModelGPT5_4Mini

	// openAIRequestTimeout bounds each individual model request
	openAIRequestTimeout = 30 * time.Second
)

type Activities struct {
	responses *responses.ResponseService
	model     string
}

// Registers dependencies needed for the activities
func NewActivities(openAPIKey, openAIModel string) (*Activities, error) {
	// Temporal owns retries: retrying inside the SDK as well would multiply
	// attempts and hide failures from the Workflow history
	client := openai.NewClient(
		option.WithAPIKey(openAPIKey),
		option.WithMaxRetries(0),
		option.WithRequestTimeout(openAIRequestTimeout),
	)

	a := &Activities{
		responses: &client.Responses,
		model:     openAIModel,
	}

	return a, nil
}
