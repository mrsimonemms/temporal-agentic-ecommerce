package cmd

import (
	gh "github.com/mrsimonemms/golang-helpers"
	"github.com/mrsimonemms/temporal-ucp-reference-architecture/workers/order/internal/app"
	"github.com/mrsimonemms/temporal-ucp-reference-architecture/workers/order/internal/app/activities"
	"github.com/mrsimonemms/temporal-ucp-reference-architecture/workers/order/internal/app/workflows"
	"github.com/rs/zerolog/log"
	"github.com/spf13/cobra"
	temporal "github.com/zigflow/helpers"
	"go.temporal.io/sdk/contrib/sysinfo"
	"go.temporal.io/sdk/worker"
)

func newWorkerCmd() *cobra.Command {
	opts := struct {
		temporal *temporal.TemporalOpts
	}{
		temporal: &temporal.TemporalOpts{},
	}

	cmd := &cobra.Command{
		Use:   "worker",
		Short: "Run the Temporal worker",
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

			// @todo(sje): register workflows
			log.Debug().Msg("Registering workflows")
			w.RegisterWorkflow(workflows.OrderWorkflow)

			acts, err := activities.NewActivities()
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

	return cmd
}
