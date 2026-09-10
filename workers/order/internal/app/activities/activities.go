package activities

import "context"

type Activities struct{}

// @todo(sje): remove when we have a real activity
func (a *Activities) Stub(_ context.Context) error {
	return nil
}

// Registers dependencies needed for the activities
func NewActivities() (*Activities, error) {
	return &Activities{}, nil
}
