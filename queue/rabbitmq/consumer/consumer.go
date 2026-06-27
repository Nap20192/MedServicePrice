package consumer

import (
	"context"

	"github.com/pkg/errors"
	amqp "github.com/rabbitmq/amqp091-go"
	"golang.org/x/exp/slog"
)

const (
	_prefetchCount  = 50
	_prefetchSize   = 0
	_prefetchGlobal = false

	_consumeAutoAck   = false
	_consumeExclusive = false
	_consumeNoLocal   = false
	_consumeNoWait    = false

	_workerPoolSize = 10
)

type consumer struct {
	queueName      string
	consumerTag    string
	workerPoolSize int
	amqpConn       *amqp.Connection
}

var _ EventConsumer = (*consumer)(nil)

func NewConsumer(amqpConn *amqp.Connection) EventConsumer {
	return &consumer{
		amqpConn:       amqpConn,
		queueName:      "", // MUST be set via options
		consumerTag:    "default-consumer",
		workerPoolSize: _workerPoolSize,
	}
}

func (c *consumer) Configure(opts ...Option) EventConsumer {
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// StartConsumer Start new rabbitmq consumer.
func (c *consumer) StartConsumer(fn worker) error {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	ch, err := c.createChannel()
	if err != nil {
		return errors.Wrap(err, "CreateChannel")
	}
	defer ch.Close()

	deliveries, err := ch.Consume(
		c.queueName,
		c.consumerTag,
		_consumeAutoAck,
		_consumeExclusive,
		_consumeNoLocal,
		_consumeNoWait,
		nil,
	)
	if err != nil {
		return errors.Wrap(err, "Consume")
	}

	forever := make(chan bool)

	for i := 0; i < c.workerPoolSize; i++ {
		go fn(ctx, deliveries)
	}

	chanErr := <-ch.NotifyClose(make(chan *amqp.Error))
	slog.Error("rabbitmq channel closed", "err", chanErr)
	<-forever

	return chanErr
}

// createChannel configures QoS and returns the channel. Topology is expected to be provisioned.
func (c *consumer) createChannel() (*amqp.Channel, error) {
	ch, err := c.amqpConn.Channel()
	if err != nil {
		return nil, errors.Wrap(err, "amqpConn.Channel")
	}

	err = ch.Qos(
		_prefetchCount,  // prefetch count
		_prefetchSize,   // prefetch size
		_prefetchGlobal, // global
	)
	if err != nil {
		return nil, errors.Wrap(err, "ch.Qos")
	}

	return ch, nil
}
