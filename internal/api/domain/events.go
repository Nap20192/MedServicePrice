package domain

import "context"

type EventPublisher interface {
	PublishEvents(ctx context.Context, events []any) error
}
