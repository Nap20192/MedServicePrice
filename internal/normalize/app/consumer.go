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
		if err := c.svc.ProcessParseCompleted(ctx, msg.Body); err != nil {
			c.log.Error("normalize failed — dead-lettering", "err", err)
			_ = msg.Nack(false, false)
			continue
		}
		if err := msg.Ack(false); err != nil {
			c.log.Error("ack failed", "err", err)
		}
	}
}
