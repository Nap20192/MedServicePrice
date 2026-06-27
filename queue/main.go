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

	"medprice/queue/rabbitmq"
	"medprice/queue/rabbitmq/consumer"
	"medprice/queue/rabbitmq/publisher"
)

func main() {
	// Configure slog
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))

	rabbitURL := "amqp://guest:guest@localhost:5672/"
	if url := os.Getenv("RABBITMQ_URL"); url != "" {
		rabbitURL = url
	}

	conn, err := rabbitmq.NewRabbitMQConn(rabbitmq.RabbitMQConnStr(rabbitURL))
	if err != nil {
		log.Fatalf("Failed to connect to rabbitmq: %v", err)
	}
	defer conn.Close()

	// 1. Start a Consumer for q.price.found (the hot path mentioned in README)
	priceFoundConsumer := consumer.NewConsumer(conn).Configure(
		consumer.QueueName("q.price.found"),
		consumer.ConsumerTag("go-price-consumer"),
		consumer.WorkerPoolSize(10),
	)

	go func() {
		err := priceFoundConsumer.StartConsumer(func(ctx context.Context, messages <-chan amqp.Delivery) {
			for msg := range messages {
				slog.Info("Received message on q.price.found", "body", string(msg.Body))

				// Simulate processing
				time.Sleep(100 * time.Millisecond)

				// Manual ack after processing (e.g. DB upsert)
				if err := msg.Ack(false); err != nil {
					slog.Error("failed to ack message", "err", err)
				}
			}
		})
		if err != nil {
			slog.Error("priceFoundConsumer stopped", "err", err)
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
			slog.Info("Publishing parse.start event...")
			if err := parseStartPublisher.PublishEvents(context.Background(), []any{mockPayload}); err != nil {
				slog.Error("failed to publish", "err", err)
			}
		}
	}()

	slog.Info("RabbitMQ consumers and publishers started. Press Ctrl+C to exit.")

	// Wait for termination signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("Shutting down...")
}
