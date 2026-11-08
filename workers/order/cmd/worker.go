package cmd

import (
	"strings"

	gh "github.com/mrsimonemms/golang-helpers"
	"github.com/mrsimonemms/temporal-ucp-reference-architecture/workers/order/internal/app"
	"github.com/mrsimonemms/temporal-ucp-reference-architecture/workers/order/internal/app/activities"
	"github.com/mrsimonemms/temporal-ucp-reference-architecture/workers/order/internal/app/workflows"
	"github.com/rs/zerolog/log"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
	temporal "github.com/zigflow/helpers"
	"go.temporal.io/sdk/contrib/sysinfo"
	"go.temporal.io/sdk/worker"
)

// validateWorkerConfig rejects missing or unusable configuration. Messages
// name the setting but never include its value.
func validateWorkerConfig(openAIKey, openAIModel, commerceAPIURL string) error {
	if _, err := activities.ParseCommerceURL(commerceAPIURL); err != nil {
		return gh.FatalError{
			Msg: "Commerce API URL must be an absolute http or https URL: set COMMERCE_API_URL or --commerce-api-url",
		}
	}
	if strings.TrimSpace(openAIKey) == "" {
		return gh.FatalError{
			Msg: "OpenAI API key is required: set OPENAI_API_KEY or --openai-api-key",
		}
	}
	if strings.TrimSpace(openAIModel) == "" {
		return gh.FatalError{
			Msg: "OpenAI model cannot be empty: set OPENAI_MODEL or --openai-model",
		}
	}
	return nil
}

func newWorkerCmd() *cobra.Command {
	opts := struct {
		temporal *temporal.TemporalOpts

		OpenAPIKey     string
		OpenAIModel    string
		CommerceAPIURL string
	}{
		temporal: &temporal.TemporalOpts{},
	}

	cmd := &cobra.Command{
		Use:   "worker",
		Short: "Run the Temporal worker",
		PreRunE: func(cmd *cobra.Command, args []string) error {
			return validateWorkerConfig(opts.OpenAPIKey, opts.OpenAIModel, opts.CommerceAPIURL)
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := temporal.NewConnection(temporal.ParseCobraOpts(
				opts.temporal,
				temporal.WithZerolog(&log.Logger),
				temporal.WithPrometheusMetrics(opts.temporal.MetricsListenAddress, opts.temporal.MetricsPrefix, nil),
			)...)
			if err != nil {
				return gh.FatalError{
					Cause: err,
					Msg:   "Unable to create client",
				}
			}
			defer func() {
				log.Trace().Msg("Closing Temporal connection")
				c.Close()
				log.Trace().Msg("Temporal connection closed")
			}()

			w := worker.New(c, app.TaskQueue, worker.Options{
				SysInfoProvider: sysinfo.SysInfoProvider(),
			})

			log.Debug().Msg("Registering workflows")
			w.RegisterWorkflow(workflows.OrderWorkflow)
			w.RegisterWorkflow(workflows.ShoppingAgentWorkflow)

			acts, err := activities.NewActivities(opts.OpenAPIKey, opts.OpenAIModel, opts.CommerceAPIURL)
			if err != nil {
				return gh.FatalError{
					Cause: err,
					Msg:   "Unable to create activities",
				}
			}

			log.Debug().Msg("Registering activities")
			w.RegisterActivity(acts)

			log.Debug().Msg("Starting health check server")
			if err := temporal.NewHealthCheck(cmd.Context(), []string{app.TaskQueue}, opts.temporal.HealthListenAddress, c); err != nil {
				return gh.FatalError{
					Cause: err,
					Msg:   "Error starting health check",
				}
			}

			if err := w.Run(worker.InterruptCh()); err != nil {
				return gh.FatalError{
					Cause: err,
					Msg:   "Workflow stopped",
				}
			}

			return nil
		},
	}

	temporal.NewCobraOpts(cmd, opts.temporal)

	viper.SetDefault("commerce_api_url", activities.DefaultCommerceAPIURL)
	cmd.Flags().StringVar(
		&opts.CommerceAPIURL, "commerce-api-url",
		viper.GetString("commerce_api_url"), "Base URL of the commerce API's versioned routes, used for checkout",
	)

	cmd.Flags().StringVar(
		&opts.OpenAPIKey, "openai-api-key",
		viper.GetString("openai_api_key"), "Open API key for the shopping agent",
	)
	gh.HideCommandOutput(cmd, "openai-api-key")

	viper.SetDefault("openai_model", activities.DefaultOpenAIModel)
	cmd.Flags().StringVar(
		&opts.OpenAIModel, "openai-model",
		viper.GetString("openai_model"), "Open AI model for the shopping agent",
	)

	return cmd
}
