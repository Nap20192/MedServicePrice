package logger

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"strconv"
	"strings"
	"sync"
)

const (
	timeFormat   = "[15:04:05.000]"
	reset        = "\033[0m"
	black        = 30
	red          = 31
	green        = 32
	yellow       = 33
	blue         = 34
	magenta      = 35
	cyan         = 36
	lightGray    = 37
	darkGray     = 90
	lightRed     = 91
	lightGreen   = 92
	lightYellow  = 93
	lightBlue    = 94
	lightMagenta = 95
	lightCyan    = 96
	white        = 97
)

type Encoder string

const (
	JSON           = Encoder("json")
	defaultEncoder = JSON
)

func colorizer(colorCode int, v string) string {
	return fmt.Sprintf("\033[%sm%s%s", strconv.Itoa(colorCode), v, reset)
}

// Handler is a slog.Handler implementation that outputs human-readable,
// colorized log messages for development use. It wraps the standard
// slog.JSONHandler and transforms its output into a pretty format.
type Handler struct {
	handler slog.Handler
	// Per-handler configuration
	writer          io.Writer
	replaceAttrFunc func([]string, slog.Attr) slog.Attr
	// Shared state across WithAttrs/WithGroup instances for output synchronization.
	// This ensures log lines from related handlers don't get interleaved.
	buffer           *bytes.Buffer
	mutex            *sync.Mutex
	encoder          Encoder
	groups           []string
	colorize         bool
	outputEmptyAttrs bool
}

func (h *Handler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.handler.Enabled(ctx, level)
}

func (h *Handler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &Handler{
		handler:          h.handler.WithAttrs(attrs),
		buffer:           h.buffer,
		encoder:          h.encoder,
		replaceAttrFunc:  h.replaceAttrFunc,
		mutex:            h.mutex,
		writer:           h.writer,
		colorize:         h.colorize,
		outputEmptyAttrs: h.outputEmptyAttrs,
		groups:           h.groups,
	}
}

func (h *Handler) WithGroup(name string) slog.Handler {
	if name == "" {
		return h
	}
	newGroups := make([]string, len(h.groups)+1)
	copy(newGroups, h.groups)
	newGroups[len(h.groups)] = name
	return &Handler{
		handler:          h.handler.WithGroup(name),
		buffer:           h.buffer,
		encoder:          h.encoder,
		replaceAttrFunc:  h.replaceAttrFunc,
		mutex:            h.mutex,
		writer:           h.writer,
		colorize:         h.colorize,
		outputEmptyAttrs: h.outputEmptyAttrs,
		groups:           newGroups,
	}
}

func (h *Handler) computeAttrs(ctx context.Context, r slog.Record) (map[string]any, error) {
	h.mutex.Lock()
	defer func() {
		h.buffer.Reset()
		h.mutex.Unlock()
	}()
	if err := h.handler.Handle(ctx, r); err != nil {
		return nil, fmt.Errorf("error when calling inner handler's Handle: %w", err)
	}
	var attrs map[string]any
	err := json.Unmarshal(h.buffer.Bytes(), &attrs)
	if err != nil {
		return nil, fmt.Errorf("error when unmarshaling inner handler's Handle result: %w", err)
	}
	return attrs, nil
}

func (h *Handler) Handle(ctx context.Context, r slog.Record) error {
	colorize := func(code int, value string) string {
		return value
	}
	if h.colorize {
		colorize = colorizer
	}
	var level string
	levelAttr := slog.Attr{
		Key:   slog.LevelKey,
		Value: slog.AnyValue(r.Level),
	}
	if h.replaceAttrFunc != nil {
		levelAttr = h.replaceAttrFunc([]string{}, levelAttr)
	}
	if !levelAttr.Equal(slog.Attr{}) {
		level = levelAttr.Value.String() + ":"
		if r.Level <= slog.LevelDebug {
			level = colorize(magenta, level)
		} else if r.Level <= slog.LevelInfo {
			level = colorize(green, level)
		} else if r.Level < slog.LevelWarn {
			level = colorize(lightBlue, level)
		} else if r.Level < slog.LevelError {
			level = colorize(yellow, level)
		} else if r.Level == slog.LevelError {
			level = colorize(lightRed, level)
		} else {
			level = colorize(lightMagenta, level)
		}
	}
	var timestamp string
	timeAttr := slog.Attr{
		Key:   slog.TimeKey,
		Value: slog.StringValue(r.Time.Format(timeFormat)),
	}
	if h.replaceAttrFunc != nil {
		timeAttr = h.replaceAttrFunc([]string{}, timeAttr)
	}
	if !timeAttr.Equal(slog.Attr{}) {
		timestamp = colorize(lightGray, timeAttr.Value.String())
	}
	var msg string
	msgAttr := slog.Attr{
		Key:   slog.MessageKey,
		Value: slog.StringValue(r.Message),
	}
	if h.replaceAttrFunc != nil {
		msgAttr = h.replaceAttrFunc([]string{}, msgAttr)
	}
	if !msgAttr.Equal(slog.Attr{}) {
		msg = colorize(cyan, msgAttr.Value.String())
	}
	// Add group prefix to message when groups exist
	var groupPrefix string
	if len(h.groups) > 0 {
		groupPrefix = colorize(magenta, "["+strings.Join(h.groups, ".")+"]")
	}
	attrs, err := h.computeAttrs(ctx, r)
	if err != nil {
		return err
	}
	var attrsAsBytes []byte
	if h.outputEmptyAttrs || len(attrs) > 0 {
		switch h.encoder {
		case JSON:
			attrsAsBytes, err = json.MarshalIndent(attrs, "", "  ")
		default:
			return fmt.Errorf("unsupported encoder %q", h.encoder)
		}
		if err != nil {
			return fmt.Errorf("error when marshaling attrs: %w", err)
		}
	}
	var parts []string
	if len(timestamp) > 0 {
		parts = append(parts, timestamp)
	}
	if len(level) > 0 {
		parts = append(parts, level)
	}
	if len(groupPrefix) > 0 {
		parts = append(parts, groupPrefix)
	}
	if len(msg) > 0 {
		parts = append(parts, msg)
	}
	if len(attrsAsBytes) > 0 {
		parts = append(parts, colorize(darkGray, string(attrsAsBytes)))
	}
	out := strings.Join(parts, " ")
	if h.writer != nil {
		_, err = io.WriteString(h.writer, out+"\n")
		if err != nil {
			return err
		}
	}
	return nil
}

func suppressDefaults(
	next func([]string, slog.Attr) slog.Attr,
) func([]string, slog.Attr) slog.Attr {
	return func(groups []string, a slog.Attr) slog.Attr {
		if a.Key == slog.TimeKey ||
			a.Key == slog.LevelKey ||
			a.Key == slog.MessageKey {
			return slog.Attr{}
		}
		if next == nil {
			return a
		}
		return next(groups, a)
	}
}

type handlerOptions struct {
	slog.HandlerOptions
	writer           io.Writer
	encoder          Encoder
	colorize         bool
	outputEmptyAttrs bool
}

func NewHandler(options ...Option) *Handler {
	config := handlerOptions{
		writer:  io.Discard,
		encoder: defaultEncoder,
	}
	for _, opt := range options {
		if opt != nil {
			opt(&config)
		}
	}
	buf := &bytes.Buffer{}
	handler := &Handler{
		buffer:           buf,
		writer:           config.writer,
		encoder:          config.encoder,
		colorize:         config.colorize,
		outputEmptyAttrs: config.outputEmptyAttrs,
		handler: slog.NewJSONHandler(buf, &slog.HandlerOptions{
			Level:       config.Level,
			AddSource:   config.AddSource,
			ReplaceAttr: suppressDefaults(config.ReplaceAttr),
		}),
		replaceAttrFunc: config.ReplaceAttr,
		mutex:           &sync.Mutex{},
	}
	return handler
}

type Option func(h *handlerOptions)

func WithWriter(writer io.Writer) Option {
	return func(h *handlerOptions) {
		h.writer = writer
	}
}

func WithColor(x ...bool) Option {
	return func(h *handlerOptions) {
		for i := range x {
			h.colorize = x[i]
		}
	}
}

func WithOutputEmptyAttrs(x ...bool) Option {
	return func(h *handlerOptions) {
		for i := range x {
			h.outputEmptyAttrs = x[i]
		}
	}
}

func WithEncoder(e Encoder) Option {
	return func(h *handlerOptions) {
		switch e {
		case JSON:
			h.encoder = e
		default:
			panic(fmt.Sprintf("slogging: unsupported encoder %q", e))
		}
	}
}

func WithLevel(lvl slog.Leveler) Option {
	return func(h *handlerOptions) {
		h.Level = lvl
	}
}
