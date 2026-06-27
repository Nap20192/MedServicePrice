package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/joho/godotenv"
	"golang.org/x/exp/slog"

	delivhttp "medprice/internal/delivery/http"
	delivrmq "medprice/internal/delivery/rabbitmq"
	"medprice/internal/repository/postgres"
	"medprice/internal/usecase"
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
	godotenv.Load()

	// Configure slog
	baseLogger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(baseLogger)
	appLogger := &slogWrapper{l: baseLogger}

	// 1. Initialize Database
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:postgres@localhost:5432/medprice?sslmode=disable"
	}
	db, err := postgres.NewDB(dbURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()
	if err := db.Ping(context.Background()); err != nil {
		log.Fatalf("Failed to ping database: %v", err)
	}
	appLogger.Info("Connected to PostgreSQL")

	// 2. Initialize Repositories
	sourceRepo := postgres.NewSourceRepository(db)
	clinicRepo := postgres.NewClinicRepository(db)
	priceRepo := postgres.NewPriceRepository(db)

	// 3. Initialize RabbitMQ
	rabbitURL := "amqp://guest:guest@localhost:5672/"
	if url := os.Getenv("RABBITMQ_URL"); url != "" {
		rabbitURL = url
	}
	conn, err := rabbitmq.NewRabbitMQConn(rabbitmq.RabbitMQConnStr(rabbitURL), appLogger)
	if err != nil {
		log.Fatalf("Failed to connect to rabbitmq: %v", err)
	}
	defer conn.Close()

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

	// 4. Initialize UseCases
	sourceUC := usecase.NewSourceUseCase(sourceRepo, clinicRepo, parseStartPublisher)
	priceUC := usecase.NewPriceUseCase(priceRepo)
	consumerUC := usecase.NewConsumerUseCase(priceRepo, clinicRepo, sourceRepo)

	// 5. Setup HTTP Server
	router := delivhttp.NewRouter(sourceUC, priceUC)
	httpPort := os.Getenv("HTTP_PORT")
	if httpPort == "" {
		httpPort = "8080"
	}

	server := &http.Server{
		Addr:    ":" + httpPort,
		Handler: router,
	}

	go func() {
		appLogger.Info("Starting HTTP server on port " + httpPort)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP server error: %v", err)
		}
	}()

	// 6. Setup RabbitMQ Consumer
	priceConsumerHandler := delivrmq.NewConsumer(consumerUC)
	priceFoundConsumer := consumer.NewConsumer(conn).Configure(
		consumer.QueueName("q.price.found"),
		consumer.ConsumerTag("go-price-consumer"),
		consumer.WorkerPoolSize(10),
		consumer.WithLogger(appLogger),
	)

	go func() {
		appLogger.Info("Starting RabbitMQ consumer")
		err := priceFoundConsumer.StartConsumer(priceConsumerHandler.Handler)
		if err != nil {
			appLogger.Error("priceFoundConsumer stopped", "err", err)
		}
	}()

	// Wait for termination signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	appLogger.Info("Shutting down...")
	if err := server.Shutdown(context.Background()); err != nil {
		appLogger.Error("HTTP server shutdown error", "err", err)
	}
}
