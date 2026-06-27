package consumer

import "medprice/pkg/rabbitmq"

type Option func(*consumer)

func QueueName(queueName string) Option {
	return func(p *consumer) {
		p.queueName = queueName
	}
}

func ConsumerTag(consumerTag string) Option {
	return func(p *consumer) {
		p.consumerTag = consumerTag
	}
}

func WorkerPoolSize(workerPoolSize int) Option {
	return func(p *consumer) {
		p.workerPoolSize = workerPoolSize
	}
}

func WithLogger(logger rabbitmq.Logger) Option {
	return func(p *consumer) {
		if logger != nil {
			p.logger = logger
		}
	}
}
