package rabbitmq

// Logger is the interface used by the rabbitmq package for logging.
type Logger interface {
	Info(msg string, args ...any)
	Error(msg string, args ...any)
}

type noopLogger struct{}

func (noopLogger) Info(msg string, args ...any)  {}
func (noopLogger) Error(msg string, args ...any) {}

// DefaultLogger is used if no logger is provided.
var DefaultLogger Logger = noopLogger{}
