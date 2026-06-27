package publisher

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/pkg/errors"
	amqp "github.com/rabbitmq/amqp091-go"
	"medprice/pkg/rabbitmq"
)

const (
	_publishMandatory = false
	_publishImmediate = false
)

type publisher struct {
	exchangeName    string
	bindingKey      string
	messageTypeName string
	amqpChan        *amqp.Channel
	amqpConn        *amqp.Connection
	logger          rabbitmq.Logger
}

var _ EventPublisher = (*publisher)(nil)

func NewPublisher(amqpConn *amqp.Connection) (EventPublisher, error) {
	ch, err := amqpConn.Channel()
	if err != nil {
		return nil, errors.Wrap(err, "amqpConn.Channel failed")
	}

	pub := &publisher{
		amqpConn:        amqpConn,
		amqpChan:        ch,
		exchangeName:    "medprice.events", // default from topology
		bindingKey:      "",                // MUST be set via options or per message
		messageTypeName: "event",
		logger:          rabbitmq.DefaultLogger,
	}

	return pub, nil
}

func (p *publisher) Configure(opts ...Option) EventPublisher {
	for _, opt := range opts {
		opt(p)
	}
	return p
}

func (p *publisher) PublishEvents(ctx context.Context, events []any) error {
	for _, e := range events {
		b, err := json.Marshal(e)
		if err != nil {
			return errors.Wrap(err, "publisher-json.Marshal")
		}

		err = p.Publish(ctx, b, "application/json")
		if err != nil {
			return errors.Wrap(err, "publisher-pub.Publish")
		}
	}
	return nil
}

// Publish message.
func (p *publisher) Publish(ctx context.Context, body []byte, contentType string) error {
	p.logger.Info("publish message", "exchange", p.exchangeName, "routing_key", p.bindingKey)

	if err := p.amqpChan.PublishWithContext(
		ctx,
		p.exchangeName,
		p.bindingKey,
		_publishMandatory,
		_publishImmediate,
		amqp.Publishing{
			ContentType:  contentType,
			DeliveryMode: amqp.Persistent,
			MessageId:    uuid.New().String(),
			Timestamp:    time.Now(),
			Body:         body,
			Type:         p.messageTypeName,
		},
	); err != nil {
		return errors.Wrap(err, "ch.Publish")
	}

	return nil
}
