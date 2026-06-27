package publisher

import (
	"context"
)

type EventPublisher interface {
	Configure(...Option) EventPublisher
	Publish(context.Context, []byte, string) error
	PublishEvent(context.Context, string, any) error
	PublishEvents(context.Context, []any) error
}
