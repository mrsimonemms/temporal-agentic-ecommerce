package cmd

import (
	"bytes"
	"crypto/rand"
	"errors"
	"net"
	"sync/atomic"
	"testing"

	gh "github.com/mrsimonemms/golang-helpers"
	"github.com/mrsimonemms/temporal-ucp-reference-architecture/workers/order/internal/app/activities"
	"github.com/spf13/cobra"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	errMissingKey   = "OpenAI API key is required"
	errEmptyModel   = "OpenAI model cannot be empty"
	errCommerceURL  = "Commerce API URL must be an absolute http or https URL"
	envModel        = "gpt-from-environment"
	flagModel       = "gpt-from-flag"
	modelFlagOption = "--openai-model"
	workerCommand   = "worker"
	composeAPIURL   = "http://api:9999/v1"
)

// newWorker builds the command tree as the binary does, so configuration is
// read through the same root command and environment binding
func newWorker(t *testing.T) (root, worker *cobra.Command) {
	t.Helper()

	root = newRootCmd()
	worker, _, err := root.Find([]string{workerCommand})
	require.NoError(t, err)
	return root, worker
}

// openAIConfig returns the OpenAI configuration the worker will inject into
// the Activities
func openAIConfig(t *testing.T, cmd *cobra.Command) (apiKey, model string) {
	t.Helper()

	keyFlag := cmd.Flags().Lookup("openai-api-key")
	modelFlag := cmd.Flags().Lookup("openai-model")
	require.NotNil(t, keyFlag)
	require.NotNil(t, modelFlag)
	return keyFlag.Value.String(), modelFlag.Value.String()
}

func TestWorkerOpenAIConfigFromEnvironment(t *testing.T) {
	apiKey := "sk-test-" + rand.Text()
	t.Setenv("OPENAI_API_KEY", apiKey)
	t.Setenv("OPENAI_MODEL", "gpt-test-model")

	_, worker := newWorker(t)
	key, model := openAIConfig(t, worker)

	assert.Equal(t, apiKey, key)
	assert.Equal(t, "gpt-test-model", model)
}

func TestWorkerOpenAIModelDefault(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "")
	t.Setenv("OPENAI_MODEL", "")

	_, worker := newWorker(t)
	key, model := openAIConfig(t, worker)

	assert.Equal(t, activities.DefaultOpenAIModel, model)
	// There is no default key: it must be supplied
	assert.Empty(t, key)
}

func TestWorkerOpenAIFlagsOverrideEnvironment(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "sk-from-environment")
	t.Setenv("OPENAI_MODEL", envModel)

	_, worker := newWorker(t)
	require.NoError(t, worker.ParseFlags([]string{
		"--openai-api-key", "sk-from-flag",
		modelFlagOption, flagModel,
	}))
	key, model := openAIConfig(t, worker)

	assert.Equal(t, "sk-from-flag", key)
	assert.Equal(t, flagModel, model)
}

func TestWorkerHelpRedactsOpenAIAPIKey(t *testing.T) {
	apiKey := "sk-test-" + rand.Text()
	t.Setenv("OPENAI_API_KEY", apiKey)

	root, _ := newWorker(t)
	var out bytes.Buffer
	root.SetOut(&out)
	root.SetErr(&out)
	root.SetArgs([]string{workerCommand, "--help"})

	require.NoError(t, root.Execute())
	// The key is the only flag whose default is masked
	assert.Contains(t, out.String(), `(default "***")`)
	assert.NotContains(t, out.String(), apiKey)
}

// fakeTemporal is a TCP listener standing in for the Temporal server. It
// records connection attempts so tests can prove none were made.
func fakeTemporal(t *testing.T) (address string, connections *atomic.Int32) {
	t.Helper()

	var lc net.ListenConfig
	l, err := lc.Listen(t.Context(), "tcp", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = l.Close() })

	connections = &atomic.Int32{}
	go func() {
		for {
			conn, err := l.Accept()
			if err != nil {
				return
			}
			connections.Add(1)
			_ = conn.Close()
		}
	}()
	return l.Addr().String(), connections
}

func TestWorkerRejectsInvalidConfigBeforeConnecting(t *testing.T) {
	apiKey := "sk-test-" + rand.Text()

	tests := map[string]struct {
		envKey         string
		envModel       string
		envCommerceURL string
		args           []string
		expected       string
	}{
		"missing API key": {
			expected: errMissingKey,
		},
		"empty API key flag": {
			envKey:   apiKey,
			args:     []string{"--openai-api-key", ""},
			expected: errMissingKey,
		},
		"whitespace-only API key": {
			envKey:   " \t ",
			expected: errMissingKey,
		},
		"empty model flag": {
			envKey:   apiKey,
			args:     []string{modelFlagOption, ""},
			expected: errEmptyModel,
		},
		"whitespace-only model": {
			envKey:   apiKey,
			envModel: "   ",
			expected: errEmptyModel,
		},
		"empty commerce API URL flag": {
			envKey:   apiKey,
			args:     []string{"--commerce-api-url", ""},
			expected: errCommerceURL,
		},
		"relative commerce API URL": {
			envKey:         apiKey,
			envCommerceURL: "localhost:9999/v1",
			expected:       errCommerceURL,
		},
		"unsupported commerce API URL scheme": {
			envKey:         apiKey,
			envCommerceURL: "ftp://api.example.com/v1",
			expected:       errCommerceURL,
		},
	}

	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			t.Setenv("OPENAI_API_KEY", test.envKey)
			t.Setenv("OPENAI_MODEL", test.envModel)
			t.Setenv("COMMERCE_API_URL", test.envCommerceURL)
			address, connections := fakeTemporal(t)

			root, _ := newWorker(t)
			var out bytes.Buffer
			root.SetOut(&out)
			root.SetErr(&out)
			root.SetArgs(append([]string{
				workerCommand,
				"--temporal-address", address,
				"--health-listen-address", "127.0.0.1:0",
				"--metrics-listen-address", "127.0.0.1:0",
			}, test.args...))

			err := root.Execute()
			require.Error(t, err)

			var fatal gh.FatalError
			require.True(t, errors.As(err, &fatal))
			assert.Contains(t, err.Error(), test.expected)
			assert.Zero(t, connections.Load(), "no Temporal connection should be attempted")

			// Validation errors never expose the configured key
			assert.NotContains(t, err.Error(), apiKey)
			assert.NotContains(t, out.String(), apiKey)
		})
	}
}

func TestWorkerAcceptsValidOpenAIConfig(t *testing.T) {
	tests := map[string]struct {
		envModel      string
		args          []string
		expectedModel string
	}{
		"default model": {
			expectedModel: activities.DefaultOpenAIModel,
		},
		"model from environment": {
			envModel:      envModel,
			expectedModel: envModel,
		},
		"model from flag": {
			envModel:      envModel,
			args:          []string{modelFlagOption, flagModel},
			expectedModel: flagModel,
		},
	}

	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			t.Setenv("OPENAI_API_KEY", "sk-test-"+rand.Text())
			t.Setenv("OPENAI_MODEL", test.envModel)

			_, worker := newWorker(t)
			require.NoError(t, worker.ParseFlags(test.args))

			require.NoError(t, worker.PreRunE(worker, nil))
			_, model := openAIConfig(t, worker)
			assert.Equal(t, test.expectedModel, model)
		})
	}
}

func TestWorkerCommerceAPIURLConfig(t *testing.T) {
	tests := map[string]struct {
		env      string
		args     []string
		expected string
	}{
		"default": {
			expected: activities.DefaultCommerceAPIURL,
		},
		"from environment": {
			env:      composeAPIURL,
			expected: composeAPIURL,
		},
		"flag overrides environment": {
			env:      composeAPIURL,
			args:     []string{"--commerce-api-url", "https://commerce.example.com/v1"},
			expected: "https://commerce.example.com/v1",
		},
	}

	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			t.Setenv("OPENAI_API_KEY", "sk-test-"+rand.Text())
			t.Setenv("OPENAI_MODEL", "")
			t.Setenv("COMMERCE_API_URL", test.env)

			_, worker := newWorker(t)
			require.NoError(t, worker.ParseFlags(test.args))

			require.NoError(t, worker.PreRunE(worker, nil))
			assert.Equal(t, test.expected, worker.Flags().Lookup("commerce-api-url").Value.String())
		})
	}
}
