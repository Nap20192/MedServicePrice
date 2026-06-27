package rabbitmq

import (
	"context"
	"fmt"
	"medprice/internal/domain"

	amqp "github.com/rabbitmq/amqp091-go"
)

type Consumer struct {
	usecase domain.ConsumerUseCase
}

func NewConsumer(usecase domain.ConsumerUseCase) *Consumer {
	return &Consumer{
		usecase: usecase,
	}
}

// Handler is the func that signature matches consumer.StartConsumer
func (c *Consumer) Handler(ctx context.Context, messages <-chan amqp.Delivery) {
	for msg := range messages {
		// Process message
		err := c.usecase.ProcessFoundPrice(ctx, msg.Body)
		if err != nil {
			fmt.Printf("Error processing message: %v\n", err)
			// Nack and requeue or dead letter (using false, false for now which just discards if no redelivery is needed, 
			// but properly it should be msg.Nack(false, true) to requeue)
			msg.Nack(false, true)
		} else {
			// Ack message
			if err := msg.Ack(false); err != nil {
				fmt.Printf("Failed to ack message: %v\n", err)
			}
		}
	}
}
