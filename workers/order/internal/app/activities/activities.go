package activities

type Activities struct{}

// Registers dependencies needed for the activities
func NewActivities() (*Activities, error) {
	return &Activities{}, nil
}
