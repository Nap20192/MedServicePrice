package publisher

import (
	"context"
)

type EventPublisher interface {
	Configure(...Option) EventPublisher
	Publish(context.Context, []byte, string) error
	PublishEvents(context.Context, []any) error
}
