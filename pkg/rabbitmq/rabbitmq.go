package rabbitmq

import (
	"errors"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

const (
	_retryTimes     = 5
	_backOffSeconds = 2
)

type RabbitMQConnStr string

var ErrCannotConnectRabbitMQ = errors.New("cannot connect to rabbit")

func NewRabbitMQConn(rabbitMqURL RabbitMQConnStr, logger Logger) (*amqp.Connection, error) {
	if logger == nil {
		logger = DefaultLogger
	}

	var (
		amqpConn *amqp.Connection
		counts   int64
	)

	for {
		connection, err := amqp.Dial(string(rabbitMqURL))
		if err != nil {
			logger.Error("failed to connect to RabbitMq...", "err", err, "url", rabbitMqURL)
			counts++
		} else {
			amqpConn = connection
			break
		}

		if counts > _retryTimes {
			logger.Error("failed to retry", "err", err)
			return nil, ErrCannotConnectRabbitMQ
		}

		logger.Info("Backing off for 2 seconds...")
		time.Sleep(_backOffSeconds * time.Second)
	}

	logger.Info("📫 connected to rabbitmq 🎉")
	return amqpConn, nil
}
