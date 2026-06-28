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
	"strconv"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"golang.org/x/exp/slog"

	normapp "medprice/internal/normalize/app"
	"medprice/internal/normalize/domain"
	"medprice/internal/normalize/llm"
	normpg "medprice/internal/normalize/repository/postgres"
	normuc "medprice/internal/normalize/usecase"
	"medprice/internal/platform/database"
	"medprice/pkg/rabbitmq"
	"medprice/pkg/rabbitmq/consumer"
)

// buildLLM returns an LLM matcher from env, or nil if not configured.
func buildLLM(log rabbitmq.Logger) domain.LLMMatcher {
	minConf := 0.7
	if v, err := strconv.ParseFloat(os.Getenv("LLM_MIN_CONFIDENCE"), 64); err == nil {
		minConf = v
	}
	timeout := 20 * time.Second
	if v, err := strconv.Atoi(os.Getenv("LLM_TIMEOUT_S")); err == nil && v > 0 {
		timeout = time.Duration(v) * time.Second
	}
	maxTokens := 120
	if v, err := strconv.Atoi(os.Getenv("LLM_MAX_TOKENS")); err == nil && v > 0 {
		maxTokens = v
	}
	c := llm.New(llm.Config{
		BaseURL:   os.Getenv("LLM_BASE_URL"),
		APIKey:    os.Getenv("LLM_API_KEY"),
		Model:     os.Getenv("LLM_MODEL"),
		MinConf:   minConf,
		Timeout:   timeout,
		MaxTokens: maxTokens,
	})
	if c == nil {
		log.Info("LLM fallback disabled (set LLM_BASE_URL/LLM_API_KEY/LLM_MODEL to enable)")
		return nil
	}
	log.Info("LLM fallback enabled for normalize",
		"model", os.Getenv("LLM_MODEL"),
		"confidence_threshold", minConf,
		"max_tokens", maxTokens)
	return c
}

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
		log.Fatalf("normalize could not connect to PostgreSQL: %v", err)
	}
	defer db.Close()
	if err := db.Ping(context.Background()); err != nil {
		log.Fatalf("normalize could not reach PostgreSQL: %v", err)
	}
	appLogger.Info("normalize connected to PostgreSQL")

	rabbitURL := "amqp://msp:msp@localhost:5672/"
	if url := os.Getenv("RABBITMQ_URL"); url != "" {
		rabbitURL = url
	}
	conn, err := rabbitmq.NewRabbitMQConn(rabbitmq.RabbitMQConnStr(rabbitURL), appLogger)
	if err != nil {
		log.Fatalf("normalize could not connect to RabbitMQ: %v", err)
	}
	defer conn.Close()

	repo := normpg.NewRepository(db)
	svc := normuc.NewService(repo, buildLLM(appLogger), appLogger, normuc.Options{
		MaxLLMCallsPerSource: intEnv("LLM_MAX_CALLS_PER_SOURCE", 80),
		SourceWorkers:        intEnv("NORMALIZE_SOURCE_WORKERS", 2),
	})
	cons := normapp.NewConsumer(svc, appLogger)

	c := consumer.NewConsumer(conn).Configure(
		consumer.QueueName("q.parse.completed"),
		consumer.ConsumerTag("go-normalize-consumer"),
		consumer.WorkerPoolSize(intEnv("NORMALIZE_WORKERS", 1)),
		consumer.WithLogger(appLogger),
	)

	go func() {
		appLogger.Info("normalize started consuming completed parse events")
		if err := c.StartConsumer(cons.Handler); err != nil {
			appLogger.Error("normalize consumer stopped", "err", err)
		}
	}()

	go runPendingSweep(context.Background(), svc, appLogger)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	appLogger.Info("normalize shutting down")
}

func intEnv(name string, fallback int) int {
	v, err := strconv.Atoi(os.Getenv(name))
	if err != nil || v < 0 {
		return fallback
	}
	return v
}

func runPendingSweep(ctx context.Context, svc *normuc.Service, log rabbitmq.Logger) {
	interval := 5 * time.Minute
	if v, err := strconv.Atoi(os.Getenv("NORMALIZE_SWEEP_INTERVAL_S")); err == nil {
		if v <= 0 {
			log.Info("normalize pending sweep disabled")
			return
		}
		interval = time.Duration(v) * time.Second
	}
	limit := 20
	if v, err := strconv.Atoi(os.Getenv("NORMALIZE_SWEEP_LIMIT")); err == nil && v > 0 {
		limit = v
	}

	run := func() {
		processed, err := svc.ProcessPending(ctx, limit)
		if err != nil {
			log.Error("normalize pending sweep failed", "err", err)
			return
		}
		if processed > 0 {
			log.Info("normalize pending sweep completed", "processed_sources", processed)
		}
	}

	run()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			run()
		}
	}
}
