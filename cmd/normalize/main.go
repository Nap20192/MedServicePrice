// normalize service — maps parsed_services rows onto services_catalog.
//
// Consumes q.parse.completed (emitted by the ai-crawler worker after a fetch loads
// rows). Topology is server-declared from queue/definitions.json; this binary does not
// declare anything. Manual ack with DLX on failure.
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/joho/godotenv"
	"golang.org/x/exp/slog"

	normapp "medprice/internal/normalize/app"
	normpg "medprice/internal/normalize/repository/postgres"
	normuc "medprice/internal/normalize/usecase"
	"medprice/internal/platform/database"
	"medprice/pkg/rabbitmq"
	"medprice/pkg/rabbitmq/consumer"
)

type slogWrapper struct{ l *slog.Logger }

func (w *slogWrapper) Info(msg string, args ...any)  { w.l.Info(msg, args...) }
func (w *slogWrapper) Error(msg string, args ...any) { w.l.Error(msg, args...) }

func main() {
	godotenv.Load()

	base := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(base)
	appLogger := &slogWrapper{l: base}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://msp:msp@localhost:55432/msp?sslmode=disable"
	}
	db, err := database.NewDB(dbURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()
	if err := db.Ping(context.Background()); err != nil {
		log.Fatalf("Failed to ping database: %v", err)
	}
	appLogger.Info("normalize connected to PostgreSQL")

	rabbitURL := "amqp://msp:msp@localhost:5672/"
	if url := os.Getenv("RABBITMQ_URL"); url != "" {
		rabbitURL = url
	}
	conn, err := rabbitmq.NewRabbitMQConn(rabbitmq.RabbitMQConnStr(rabbitURL), appLogger)
	if err != nil {
		log.Fatalf("Failed to connect to rabbitmq: %v", err)
	}
	defer conn.Close()

	repo := normpg.NewRepository(db)
	svc := normuc.NewService(repo, appLogger)
	cons := normapp.NewConsumer(svc, appLogger)

	c := consumer.NewConsumer(conn).Configure(
		consumer.QueueName("q.parse.completed"),
		consumer.ConsumerTag("go-normalize-consumer"),
		consumer.WorkerPoolSize(5),
		consumer.WithLogger(appLogger),
	)

	go func() {
		appLogger.Info("normalize consuming q.parse.completed")
		if err := c.StartConsumer(cons.Handler); err != nil {
			appLogger.Error("normalize consumer stopped", "err", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	appLogger.Info("normalize shutting down")
}
