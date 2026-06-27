package domain

import "context"

type EventPublisher interface {
	PublishEvents(ctx context.Context, events []any) error
	PublishEvent(ctx context.Context, routingKey string, event any) error
}
