package workflows

import (
	"errors"
	"fmt"
	"slices"
	"time"

	"go.temporal.io/sdk/log"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const (
	// SignalReportFulfilmentException reports a business problem that prevents
	// an Order line being fulfilled as planned
	SignalReportFulfilmentException = "reportFulfilmentException"
	// UpdateResolveFulfilmentException resolves the current fulfilment exception
	UpdateResolveFulfilmentException = "resolveFulfilmentException"
)

const errTypeInvalidResolution = "InvalidFulfilmentResolution"

// FulfilmentDecision is the action taken to resolve a fulfilment exception
type FulfilmentDecision string

const FulfilmentDecisionAlternativeSource FulfilmentDecision = "alternative_source"

// FulfilmentPlan describes how the merchant currently intends to fulfil the
// Order. Changing the plan does not change what was purchased.
type FulfilmentPlan struct {
	// Approved alternative sources for individual lines. Lines without an entry
	// are fulfilled from their originally selected source.
	Sources []FulfilmentSource `json:"sources,omitempty"`
	// Unresolved business problem that must be resolved before fulfilment
	Exception *FulfilmentException `json:"exception,omitempty"`
	// Decisions taken to resolve previous exceptions
	Resolutions []FulfilmentResolution `json:"resolutions,omitempty"`
}

// FulfilmentSource is the source an Order line is fulfilled from
type FulfilmentSource struct {
	LineID string `json:"lineId"`
	Source string `json:"source"`
}

// FulfilmentException is a business problem affecting a single Order line
type FulfilmentException struct {
	LineID   string    `json:"lineId"`
	Reason   string    `json:"reason"`
	RaisedAt time.Time `json:"raisedAt"`
}

// FulfilmentResolution records how a fulfilment exception was resolved
type FulfilmentResolution struct {
	LineID            string             `json:"lineId"`
	Reason            string             `json:"reason"`
	Decision          FulfilmentDecision `json:"decision"`
	AlternativeSource string             `json:"alternativeSource"`
	ApprovedBy        string             `json:"approvedBy"`
	Note              string             `json:"note,omitempty"`
	RaisedAt          time.Time          `json:"raisedAt"`
	ResolvedAt        time.Time          `json:"resolvedAt"`
}

// ReportFulfilmentExceptionSignal is the payload of the
// SignalReportFulfilmentException Signal
type ReportFulfilmentExceptionSignal struct {
	LineID string `json:"lineId"`
	Reason string `json:"reason"`
}

// ResolveFulfilmentExceptionRequest approves an alternative fulfilment source
// for the line affected by the current exception. This is the only supported
// resolution.
type ResolveFulfilmentExceptionRequest struct {
	LineID            string `json:"lineId"`
	AlternativeSource string `json:"alternativeSource"`
	ApprovedBy        string `json:"approvedBy"`
	Note              string `json:"note,omitempty"`
}

func (o *Order) hasLine(id string) bool {
	return slices.ContainsFunc(o.Lines, func(l OrderLine) bool { return l.ID == id })
}

// raiseFulfilmentException suspends a confirmed Order until a decision is made.
// Exceptions are only accepted once inventory is reserved and before
// fulfilment, and only one may be outstanding at a time.
func (o *Order) raiseFulfilmentException(signal ReportFulfilmentExceptionSignal, now time.Time) error {
	if o.Status != OrderStatusConfirmed {
		return fmt.Errorf("order status is %s", o.Status)
	}
	if !o.hasLine(signal.LineID) {
		return fmt.Errorf("unknown line %q", signal.LineID)
	}
	if signal.Reason == "" {
		return errors.New("reason is required")
	}

	o.Status = OrderStatusAwaitingIntervention
	o.Fulfilment.Exception = &FulfilmentException{
		LineID:   signal.LineID,
		Reason:   signal.Reason,
		RaisedAt: now,
	}
	return nil
}

// validateResolution must not change state: it is the Update validator
func (o *Order) validateResolution(req ResolveFulfilmentExceptionRequest) error {
	// Retrying the same resolution cannot succeed, so rejections are non-retryable
	invalid := func(msg string) error {
		return temporal.NewNonRetryableApplicationError(msg, errTypeInvalidResolution, nil)
	}

	exception := o.Fulfilment.Exception
	if o.Status != OrderStatusAwaitingIntervention || exception == nil {
		return invalid(fmt.Sprintf("order is not awaiting intervention: status is %s", o.Status))
	}
	if req.LineID != exception.LineID {
		return invalid(fmt.Sprintf("line %q is not affected by the exception: line %q is", req.LineID, exception.LineID))
	}
	if req.AlternativeSource == "" {
		return invalid("alternativeSource is required")
	}
	if req.ApprovedBy == "" {
		return invalid("approvedBy is required")
	}
	return nil
}

// resolveFulfilmentException records the decision and returns the Order to
// confirmed. The line is fulfilled from the alternative source; what was
// purchased is unchanged.
func (o *Order) resolveFulfilmentException(req ResolveFulfilmentExceptionRequest, now time.Time) {
	exception := o.Fulfilment.Exception

	source := FulfilmentSource{LineID: req.LineID, Source: req.AlternativeSource}
	if i := slices.IndexFunc(o.Fulfilment.Sources, func(s FulfilmentSource) bool { return s.LineID == req.LineID }); i >= 0 {
		o.Fulfilment.Sources[i] = source
	} else {
		o.Fulfilment.Sources = append(o.Fulfilment.Sources, source)
	}

	o.Fulfilment.Resolutions = append(o.Fulfilment.Resolutions, FulfilmentResolution{
		LineID:            exception.LineID,
		Reason:            exception.Reason,
		Decision:          FulfilmentDecisionAlternativeSource,
		AlternativeSource: req.AlternativeSource,
		ApprovedBy:        req.ApprovedBy,
		Note:              req.Note,
		RaisedAt:          exception.RaisedAt,
		ResolvedAt:        now,
	})

	o.Fulfilment.Exception = nil
	o.Status = OrderStatusConfirmed
}

// registerFulfilmentExceptionHandlers receives exceptions on the selector and
// registers the Update used by operators to resolve them
func registerFulfilmentExceptionHandlers(ctx workflow.Context, selector workflow.Selector, order *Order, logger log.Logger) error {
	selector.AddReceive(workflow.GetSignalChannel(ctx, SignalReportFulfilmentException), func(c workflow.ReceiveChannel, _ bool) {
		var signal ReportFulfilmentExceptionSignal
		c.Receive(ctx, &signal)

		// Signals cannot be rejected, so invalid exceptions are logged and ignored
		if err := order.raiseFulfilmentException(signal, workflow.Now(ctx)); err != nil {
			logger.Warn("Ignoring fulfilment exception", "orderId", order.ID, "lineId", signal.LineID, "error", err)
			return
		}
		logger.Info("Order awaiting intervention", "orderId", order.ID, "lineId", signal.LineID, "reason", signal.Reason)
	})

	return workflow.SetUpdateHandlerWithOptions(
		ctx,
		UpdateResolveFulfilmentException,
		func(ctx workflow.Context, req ResolveFulfilmentExceptionRequest) (*Order, error) {
			order.resolveFulfilmentException(req, workflow.Now(ctx))
			logger.Info("Fulfilment exception resolved", "orderId", order.ID, "lineId", req.LineID, "source", req.AlternativeSource)
			return order, nil
		},
		workflow.UpdateHandlerOptions{
			Validator: func(req ResolveFulfilmentExceptionRequest) error {
				return order.validateResolution(req)
			},
		},
	)
}
