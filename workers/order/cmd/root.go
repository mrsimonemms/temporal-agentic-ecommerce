package cmd

import (
	"os"

	gh "github.com/mrsimonemms/golang-helpers"
	"github.com/rs/zerolog"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

func newRootCmd() *cobra.Command {
	viper.AutomaticEnv()

	var opts struct {
		LogLevel string
	}

	rootCmd := &cobra.Command{
		Use:           "app",
		Short:         "Temporal order management system reference",
		SilenceUsage:  true,
		SilenceErrors: true,
		Version:       Version,
		PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
			level, err := zerolog.ParseLevel(opts.LogLevel)
			if err != nil {
				return err
			}
			zerolog.SetGlobalLevel(level)

			return nil
		},
	}

	viper.SetDefault("log_level", zerolog.InfoLevel.String())
	rootCmd.PersistentFlags().StringVarP(
		&opts.LogLevel, "log-level", "l",
		viper.GetString("log_level"), "Set log level",
	)

	rootCmd.AddCommand(
		newVersionCmd(),
		newWorkerCmd(),
	)

	return rootCmd
}

func Execute() {
	if err := newRootCmd().Execute(); err != nil {
		os.Exit(gh.HandleFatalError(err))
	}
}
