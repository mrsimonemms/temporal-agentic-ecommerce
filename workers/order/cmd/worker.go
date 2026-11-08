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

func newWorkerCmd() *cobra.Command {
	opts := struct {
		temporal *temporal.TemporalOpts

		OpenAPIKey  string
		OpenAIModel string
	}{
		temporal: &temporal.TemporalOpts{},
	}

	cmd := &cobra.Command{
		Use:   "worker",
		Short: "Run the Temporal worker",
		PreRunE: func(cmd *cobra.Command, args []string) error {
			if strings.TrimSpace(opts.OpenAPIKey) == "" {
				return gh.FatalError{
					Msg: "OpenAI API key is required: set OPENAI_API_KEY or --openai-api-key",
				}
			}
			if strings.TrimSpace(opts.OpenAIModel) == "" {
				return gh.FatalError{
					Msg: "OpenAI model cannot be empty: set OPENAI_MODEL or --openai-model",
				}
			}
			return nil
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

			acts, err := activities.NewActivities(opts.OpenAPIKey, opts.OpenAIModel)
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
