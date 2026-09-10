package cmd

import (
	"fmt"

	gh "github.com/mrsimonemms/golang-helpers"
	"github.com/spf13/cobra"
)

var (
	GitCommit = ""
	Version   = gh.Development
)

func newVersionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Displays version information",
		Long: `Print version information for the CLI.

The output includes the version number and Git commit hash used to build the
binary, which can be helpful for debugging and support purposes.`,
		Run: func(cmd *cobra.Command, args []string) {
			fmt.Printf("Version: %s\nGit commit: %s\n", Version, GitCommit)
		},
	}
}
