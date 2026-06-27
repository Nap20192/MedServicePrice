package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/joho/godotenv"
	"github.com/pressly/goose/v3"
	"golang.org/x/exp/slog"

	delivhttp "medprice/internal/api/app/http"
	"medprice/internal/api/repository/postgres"
	"medprice/internal/api/usecase"
	"medprice/internal/platform/database"
	"medprice/pkg/rabbitmq"
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
	appLogger.Info("Connected to PostgreSQL")

	if shouldRunMigrations() {
		if err := runMigrations(db); err != nil {
			log.Fatalf("Failed to run database migrations: %v", err)
		}
		appLogger.Info("Database migrations applied")
	}

	// 2. Initialize Repositories
	sourceRepo := postgres.NewSourceRepository(db)
	clinicRepo := postgres.NewClinicRepository(db)
	adapterRepo := postgres.NewAdapterRepository(db)
	priceRepo := postgres.NewPriceRepository(db)

	// 3. Initialize RabbitMQ
	rabbitURL := "amqp://msp:msp@localhost:5672/"
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
	adapterPublisher := pub.Configure(
		publisher.ExchangeName("medprice.events"),
		publisher.MessageTypeName("event"),
		publisher.WithLogger(appLogger),
	)

	// 4. Initialize UseCases
	sourceUC := usecase.NewSourceUseCase(sourceRepo, clinicRepo, adapterRepo, adapterPublisher)
	priceUC := usecase.NewPriceUseCase(priceRepo)

	// 5. Setup HTTP Server
	router := delivhttp.NewRouter(sourceUC, priceUC)
	httpPort := os.Getenv("PORT")
	if httpPort == "" {
		httpPort = os.Getenv("HTTP_PORT")
	}
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

	// Wait for termination signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	appLogger.Info("Shutting down...")
	if err := server.Shutdown(context.Background()); err != nil {
		appLogger.Error("HTTP server shutdown error", "err", err)
	}
}

func shouldRunMigrations() bool {
	return os.Getenv("RUN_MIGRATIONS") != "0"
}

func runMigrations(db *database.DB) error {
	migrationsDir := os.Getenv("MIGRATIONS_DIR")
	if migrationsDir == "" {
		migrationsDir = "migrations"
	}

	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	return goose.Up(db.DB.DB, migrationsDir)
}
