package logger

import (
	"context"
	"fmt"
	"log/slog"
	"os"
)

func InitLogger(level string, pretty bool, logDir string) (*slog.Logger, error) {
	logLevel := slog.LevelInfo

	switch level {
	case "DEBUG":
		logLevel = slog.LevelDebug
	case "INFO":
		logLevel = slog.LevelInfo
	case "WARN":
		logLevel = slog.LevelWarn
	case "ERROR":
		logLevel = slog.LevelError
	default:
		fmt.Printf("Unknown log level %s, defaulting to INFO\n", level)
	}
	opts := &slog.HandlerOptions{
		Level: logLevel,
	}

	var TerminalHandler slog.Handler

	if pretty {
		TerminalHandler = NewHandler(WithColor(true), WithLevel(logLevel), WithEncoder(JSON), WithWriter(os.Stdout))
	} else {
		TerminalHandler = slog.NewJSONHandler(os.Stdout, opts)
	}
	var fileHandler slog.Handler

	if logDir != "" {
		if _, err := os.Stat(logDir); os.IsNotExist(err) {
			if err := os.MkdirAll(logDir, 0o750); err != nil {
				return nil, fmt.Errorf("failed to create log directory: %w", err)
			}
		}
		logFile := fmt.Sprintf("%s/shipment_service.log", logDir)
		f, err := os.OpenFile(logFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600) //nolint:gosec // log file path comes from service configuration.
		if err != nil {
			return nil, fmt.Errorf("failed to open log file: %w", err)
		}
		fileHandler = slog.NewJSONHandler(f, opts)
	} else {
		return slog.New(NewContextHandler(TerminalHandler)), nil
	}
	log := newMultiHandler(TerminalHandler, fileHandler)

	return slog.New(NewContextHandler(log)), nil
}

type multiHandler struct {
	handlers []slog.Handler
}

func newMultiHandler(handlers ...slog.Handler) slog.Handler {
	return multiHandler{handlers: handlers}
}

func (h multiHandler) Enabled(ctx context.Context, level slog.Level) bool {
	for _, handler := range h.handlers {
		if handler.Enabled(ctx, level) {
			return true
		}
	}
	return false
}

func (h multiHandler) Handle(ctx context.Context, record slog.Record) error {
	for _, handler := range h.handlers {
		if err := handler.Handle(ctx, record.Clone()); err != nil {
			return err
		}
	}
	return nil
}

func (h multiHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	handlers := make([]slog.Handler, 0, len(h.handlers))
	for _, handler := range h.handlers {
		handlers = append(handlers, handler.WithAttrs(attrs))
	}
	return multiHandler{handlers: handlers}
}

func (h multiHandler) WithGroup(name string) slog.Handler {
	handlers := make([]slog.Handler, 0, len(h.handlers))
	for _, handler := range h.handlers {
		handlers = append(handlers, handler.WithGroup(name))
	}
	return multiHandler{handlers: handlers}
}
