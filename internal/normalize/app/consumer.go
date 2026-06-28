// Package app is the normalize service's delivery layer (RabbitMQ consumer).
package app

import (
	"context"

	amqp "github.com/rabbitmq/amqp091-go"

	"medprice/internal/normalize/usecase"
	"medprice/pkg/rabbitmq"
)

// Consumer adapts the usecase onto the pkg/rabbitmq consumer worker signature.
type Consumer struct {
	svc *usecase.Service
	log rabbitmq.Logger
}

func NewConsumer(svc *usecase.Service, log rabbitmq.Logger) *Consumer {
	return &Consumer{svc: svc, log: log}
}

// Handler matches consumer.StartConsumer's worker type. Manual ack: ack on success,
// Nack(requeue=false) on failure so the message dead-letters via q.parse.completed's DLX.
func (c *Consumer) Handler(ctx context.Context, messages <-chan amqp.Delivery) {
	for msg := range messages {
		c.log.Info("normalize delivery received",
			"routing_key", msg.RoutingKey,
			"message_id", msg.MessageId,
			"type", msg.Type,
			"bytes", len(msg.Body))
		if err := c.svc.ProcessParseCompleted(ctx, msg.Body); err != nil {
			c.log.Error("normalize failed — dead-lettering",
				"message_id", msg.MessageId,
				"routing_key", msg.RoutingKey,
				"err", err)
			_ = msg.Nack(false, false)
			continue
		}
		if err := msg.Ack(false); err != nil {
			c.log.Error("normalize ack failed",
				"message_id", msg.MessageId,
				"err", err)
			continue
		}
		c.log.Info("normalize delivery acked",
			"message_id", msg.MessageId,
			"routing_key", msg.RoutingKey)
	}
}
