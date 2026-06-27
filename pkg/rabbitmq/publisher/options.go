package publisher

import "medprice/pkg/rabbitmq"

type Option func(*publisher)

func ExchangeName(exchangeName string) Option {
	return func(p *publisher) {
		p.exchangeName = exchangeName
	}
}

func BindingKey(bindingKey string) Option {
	return func(p *publisher) {
		p.bindingKey = bindingKey
	}
}

func MessageTypeName(messageTypeName string) Option {
	return func(p *publisher) {
		p.messageTypeName = messageTypeName
	}
}

func WithLogger(logger rabbitmq.Logger) Option {
	return func(p *publisher) {
		if logger != nil {
			p.logger = logger
		}
	}
}
