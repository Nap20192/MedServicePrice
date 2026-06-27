package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
	"golang.org/x/exp/slog"

	"medprice/pkg/rabbitmq"
	"medprice/pkg/rabbitmq/consumer"
	"medprice/pkg/rabbitmq/publisher"
)

// slogWrapper implements rabbitmq.Logger using slog
type slogWrapper struct {
	l *slog.Logger
}

func (w *slogWrapper) Info(msg string, args ...any) {
	w.l.Info(msg, args...)
}

func (w *slogWrapper) Error(msg string, args ...any) {
	w.l.Error(msg, args...)
}

func main() {
	// Configure slog
	baseLogger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(baseLogger)

	// Create our injected logger
	appLogger := &slogWrapper{l: baseLogger}

	rabbitURL := "amqp://guest:guest@localhost:5672/"
	if url := os.Getenv("RABBITMQ_URL"); url != "" {
		rabbitURL = url
	}

	conn, err := rabbitmq.NewRabbitMQConn(rabbitmq.RabbitMQConnStr(rabbitURL), appLogger)
	if err != nil {
		log.Fatalf("Failed to connect to rabbitmq: %v", err)
	}
	defer conn.Close()

	// 1. Start a Consumer for q.price.found (the hot path mentioned in README)
	priceFoundConsumer := consumer.NewConsumer(conn).Configure(
		consumer.QueueName("q.price.found"),
		consumer.ConsumerTag("go-price-consumer"),
		consumer.WorkerPoolSize(10),
		consumer.WithLogger(appLogger),
	)

	go func() {
		err := priceFoundConsumer.StartConsumer(func(ctx context.Context, messages <-chan amqp.Delivery) {
			for msg := range messages {
				appLogger.Info("Received message on q.price.found", "body", string(msg.Body))

				// Simulate processing
				time.Sleep(100 * time.Millisecond)

				// Manual ack after processing (e.g. DB upsert)
				if err := msg.Ack(false); err != nil {
					appLogger.Error("failed to ack message", "err", err)
				}
			}
		})
		if err != nil {
			appLogger.Error("priceFoundConsumer stopped", "err", err)
		}
	}()

	// 2. Start a Publisher for parse.start (Go scheduler -> Python crawler)
	pub, err := publisher.NewPublisher(conn)
	if err != nil {
		log.Fatalf("Failed to create publisher: %v", err)
	}

	parseStartPublisher := pub.Configure(
		publisher.ExchangeName("medprice.events"),
		publisher.BindingKey("parse.start"),
		publisher.MessageTypeName("event"),
		publisher.WithLogger(appLogger),
	)

	// Publish a mock message every 5 seconds
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			mockPayload := map[string]interface{}{
				"schema_version": 1,
				"source_code":    "kdl",
				"trigger":        "schedule",
			}
			appLogger.Info("Publishing parse.start event...")
			if err := parseStartPublisher.PublishEvents(context.Background(), []any{mockPayload}); err != nil {
				appLogger.Error("failed to publish", "err", err)
			}
		}
	}()

	appLogger.Info("RabbitMQ consumers and publishers started. Press Ctrl+C to exit.")

	// Wait for termination signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	appLogger.Info("Shutting down...")
}
