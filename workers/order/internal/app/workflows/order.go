package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/workflow"
)

type OrderInput struct{}

type OrderResult struct{}

func OrderWorkflow(ctx workflow.Context, input *OrderInput) (*OrderResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting OrderWorkflow", "input", input)

	ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
	})

	fmt.Println(ctx)

	return nil, nil
}
