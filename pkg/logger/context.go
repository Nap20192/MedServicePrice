package logger

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"unicode/utf8"
)

const payloadPreviewLimit = 120

type contextKey struct{}

type contextFields struct {
	attrs []slog.Attr
}

// ContextHandler enriches every slog record with attributes stored in context.
type ContextHandler struct {
	next slog.Handler
}

func NewContextHandler(next slog.Handler) *ContextHandler {
	return &ContextHandler{next: next}
}

func (h *ContextHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.next.Enabled(ctx, level)
}

func (h *ContextHandler) Handle(ctx context.Context, rec slog.Record) error {
	for _, attr := range ContextAttrs(ctx) {
		rec.AddAttrs(attr)
	}
	return h.next.Handle(ctx, rec)
}

func (h *ContextHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &ContextHandler{next: h.next.WithAttrs(attrs)}
}

func (h *ContextHandler) WithGroup(name string) slog.Handler {
	return &ContextHandler{next: h.next.WithGroup(name)}
}

func WithAttrs(ctx context.Context, attrs ...slog.Attr) context.Context {
	if len(attrs) == 0 {
		return ctx
	}
	fields := contextFields{}
	if existing, ok := ctx.Value(contextKey{}).(contextFields); ok {
		fields.attrs = append(fields.attrs, existing.attrs...)
	}
	fields.attrs = append(fields.attrs, attrs...)
	return context.WithValue(ctx, contextKey{}, fields)
}

func ContextAttrs(ctx context.Context) []slog.Attr {
	fields, ok := ctx.Value(contextKey{}).(contextFields)
	if !ok || len(fields.attrs) == 0 {
		return nil
	}
	attrs := make([]slog.Attr, len(fields.attrs))
	copy(attrs, fields.attrs)
	return attrs
}

func WithTelegramUser(ctx context.Context, userID int64, username string) context.Context {
	attrs := []slog.Attr{slog.Int64("telegram_user_id", userID)}
	if username != "" {
		attrs = append(attrs, slog.String("telegram_username", username))
	}
	return WithAttrs(ctx, attrs...)
}

func WithPayload(ctx context.Context, payload Payload) context.Context {
	return WithAttrs(ctx, payload.Attr())
}

func WithOrderNumber(ctx context.Context, number string) context.Context {
	if strings.TrimSpace(number) == "" {
		return ctx
	}
	return WithAttrs(ctx, slog.String("order_number", strings.TrimSpace(number)))
}

func WithProductCode(ctx context.Context, code string) context.Context {
	if strings.TrimSpace(code) == "" {
		return ctx
	}
	return WithAttrs(ctx, slog.String("product_code", strings.TrimSpace(code)))
}

type Payload struct {
	Kind           string
	Command        string
	ArgsCount      int
	TextPreview    string
	TextRunes      int
	LineCount      int
	CallbackUnique string
	CallbackData   string
}

func MessagePayload(text string) Payload {
	trimmed := strings.TrimSpace(text)
	payload := Payload{
		Kind:      "message",
		TextRunes: utf8.RuneCountInString(text),
		LineCount: lineCount(text),
	}
	if strings.HasPrefix(trimmed, "/") {
		fields := strings.Fields(trimmed)
		if len(fields) > 0 {
			payload.Command = fields[0]
			payload.ArgsCount = len(fields) - 1
		}
		payload.TextPreview = commandPreview(payload.Command, payload.ArgsCount)
		return payload
	}
	payload.TextPreview = truncateForLog(trimmed, payloadPreviewLimit)
	return payload
}

func CallbackPayload(unique string, data string) Payload {
	return Payload{
		Kind:           "callback",
		CallbackUnique: strings.TrimSpace(unique),
		CallbackData:   truncateForLog(strings.TrimSpace(data), payloadPreviewLimit),
	}
}

func UpdatePayload() Payload {
	return Payload{Kind: "update"}
}

func (p Payload) Attr() slog.Attr {
	attrs := []slog.Attr{slog.String("kind", p.Kind)}
	if p.Command != "" {
		attrs = append(attrs, slog.String("command", p.Command), slog.Int("args_count", p.ArgsCount))
	}
	if p.TextRunes > 0 {
		attrs = append(attrs, slog.Int("text_runes", p.TextRunes), slog.Int("line_count", p.LineCount))
	}
	if p.TextPreview != "" {
		attrs = append(attrs, slog.String("preview", p.TextPreview))
	}
	if p.CallbackUnique != "" {
		attrs = append(attrs, slog.String("callback", p.CallbackUnique))
	}
	if p.CallbackData != "" {
		attrs = append(attrs, slog.String("callback_data", p.CallbackData))
	}
	return slog.Group("payload", attrsToAny(attrs)...)
}

type ErrorWithContext struct {
	err   error
	attrs []slog.Attr
}

func WrapError(ctx context.Context, err error) error {
	if err == nil {
		return nil
	}
	return &ErrorWithContext{err: err, attrs: ContextAttrs(ctx)}
}

func ErrorContext(ctx context.Context, err error) context.Context {
	var withCtx *ErrorWithContext
	if errors.As(err, &withCtx) {
		return WithAttrs(ctx, withCtx.attrs...)
	}
	return ctx
}

func (e *ErrorWithContext) Error() string {
	return e.err.Error()
}

func (e *ErrorWithContext) Unwrap() error {
	return e.err
}

func attrsToAny(attrs []slog.Attr) []any {
	values := make([]any, 0, len(attrs))
	for _, attr := range attrs {
		values = append(values, attr)
	}
	return values
}

func commandPreview(command string, argsCount int) string {
	if command == "" {
		return ""
	}
	if isSensitiveCommand(command) && argsCount > 0 {
		return command + " <redacted>"
	}
	return command
}

func isSensitiveCommand(command string) bool {
	switch strings.ToLower(strings.TrimSpace(command)) {
	case "/login", "/adduser":
		return true
	default:
		return false
	}
}

func lineCount(text string) int {
	if text == "" {
		return 0
	}
	return strings.Count(text, "\n") + 1
}

func truncateForLog(value string, limit int) string {
	value = strings.NewReplacer("\r", "\\r", "\n", "\\n", "\t", " ").Replace(value)
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	runes := []rune(value)
	return string(runes[:limit]) + "..."
}
