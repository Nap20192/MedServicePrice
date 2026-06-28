// Package llm is an OpenAI-compatible (DeepSeek) catalog curator: given a raw
// service name and the closest existing catalog candidates, it decides whether the
// service maps to one of them or should become a new canonical entry. Implements
// domain.LLMMatcher. Best-effort — any failure is returned so the caller can fall
// back to deterministic auto-create.
package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	ndomain "medprice/internal/normalize/domain"
)

// Config is read from env in cmd/normalize.
type Config struct {
	BaseURL   string // e.g. https://api.deepseek.com
	APIKey    string
	Model     string  // e.g. deepseek-chat
	MinConf   float64 // accept suggestion only at/above this confidence
	Timeout   time.Duration
	MaxTokens int
}

type Client struct {
	cfg      Config
	http     *http.Client
	disabled atomic.Bool
}

// New returns a client, or nil if the LLM is not configured (no key/base/model) —
// the caller treats nil as "LLM disabled".
func New(cfg Config) *Client {
	if cfg.APIKey == "" || cfg.BaseURL == "" || cfg.Model == "" {
		return nil
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 20 * time.Second
	}
	if cfg.MaxTokens <= 0 {
		cfg.MaxTokens = 120
	}
	return &Client{cfg: cfg, http: &http.Client{Timeout: cfg.Timeout}}
}

func (c *Client) Disabled() bool {
	return c.disabled.Load()
}

func (c *Client) disable() {
	c.disabled.Store(true)
}

// ---- OpenAI chat wire types ----

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model          string         `json:"model"`
	Messages       []chatMessage  `json:"messages"`
	Temperature    float64        `json:"temperature"`
	MaxTokens      int            `json:"max_tokens,omitempty"`
	ResponseFormat map[string]any `json:"response_format,omitempty"`
}

type chatResponse struct {
	Choices []struct {
		Message chatMessage `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    any    `json:"code"`
	} `json:"error,omitempty"`
}

const curateSystem = `Нормализуй медуслугу. Если raw = один из кандидатов по медицинскому смыслу — match.
Синонимы/аббревиатуры считаются match; другой объём, панель или комплекс — новая услуга.
Категория только: лаборатория, прием врача, диагностика, процедура.
Ответ только JSON:
{"match":true,"index":1,"confidence":0.9}
или
{"match":false,"canonical_name":"...","category":"лаборатория","description":"кратко","confidence":0.9}`

func trimForPrompt(s string, max int) string {
	s = strings.TrimSpace(s)
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max])
}

// extractJSON returns the first {...} object in s (handles models that add prose or
// ```json fences around the JSON). Falls back to the trimmed string.
func extractJSON(s string) string {
	i := strings.Index(s, "{")
	j := strings.LastIndex(s, "}")
	if i >= 0 && j > i {
		return s[i : j+1]
	}
	return strings.TrimSpace(s)
}

// Curate implements domain.LLMMatcher.
func (c *Client) Curate(ctx context.Context, rawName, categoryHint string,
	candidates []ndomain.CatalogEntry) (ndomain.CurateDecision, error) {
	var zero ndomain.CurateDecision
	if c.Disabled() {
		return zero, ndomain.ErrLLMDisabled
	}

	var list strings.Builder
	for i, e := range candidates {
		desc := ""
		if e.Description != nil && *e.Description != "" {
			desc = " — " + trimForPrompt(*e.Description, 80)
		}
		fmt.Fprintf(&list, "%d.%s[%s]%s\n", i+1, trimForPrompt(e.Name, 120), e.Category, desc)
	}
	hint := categoryHint
	if hint == "" {
		hint = "нет"
	}
	user := fmt.Sprintf("raw:%q\nhint:%s\ncandidates:\n%s", trimForPrompt(rawName, 180), hint, list.String())

	reqBody := chatRequest{
		Model:       c.cfg.Model,
		Temperature: 0,
		MaxTokens:   c.cfg.MaxTokens,
		Messages: []chatMessage{
			{Role: "system", Content: curateSystem},
			{Role: "user", Content: user},
		},
		ResponseFormat: map[string]any{"type": "json_object"},
	}
	buf, err := json.Marshal(reqBody)
	if err != nil {
		return zero, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		strings.TrimRight(c.cfg.BaseURL, "/")+"/chat/completions", bytes.NewReader(buf))
	if err != nil {
		return zero, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return zero, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		errText := strings.ToLower(string(body))
		if resp.StatusCode == http.StatusTooManyRequests ||
			resp.StatusCode == http.StatusPaymentRequired ||
			strings.Contains(errText, "quota") ||
			strings.Contains(errText, "insufficient") ||
			strings.Contains(errText, "token") ||
			strings.Contains(errText, "rate limit") {
			c.disable()
			return zero, fmt.Errorf("%w: http %d %s", ndomain.ErrLLMDisabled, resp.StatusCode, strings.TrimSpace(string(body)))
		}
		return zero, fmt.Errorf("llm http %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var cr chatResponse
	if err := json.NewDecoder(resp.Body).Decode(&cr); err != nil {
		return zero, err
	}
	if cr.Error != nil {
		msg := strings.ToLower(cr.Error.Message + " " + cr.Error.Type + " " + fmt.Sprint(cr.Error.Code))
		if strings.Contains(msg, "quota") ||
			strings.Contains(msg, "insufficient") ||
			strings.Contains(msg, "token") ||
			strings.Contains(msg, "rate limit") {
			c.disable()
			return zero, fmt.Errorf("%w: %s", ndomain.ErrLLMDisabled, cr.Error.Message)
		}
		return zero, fmt.Errorf("llm error: %s", cr.Error.Message)
	}
	if len(cr.Choices) == 0 {
		return zero, fmt.Errorf("llm empty choices")
	}

	var d ndomain.CurateDecision
	// Local models (Ollama) sometimes wrap JSON in prose or ```json fences — extract
	// the first {...} object before parsing.
	if err := json.Unmarshal([]byte(extractJSON(cr.Choices[0].Message.Content)), &d); err != nil {
		return zero, fmt.Errorf("parse llm json: %w", err)
	}
	// Low-confidence match is treated as "no decision" by the caller (it keeps the
	// deterministic auto-create), so surface it as a non-match miss.
	if d.Match && d.Confidence < c.cfg.MinConf {
		return ndomain.CurateDecision{Match: false, Confidence: d.Confidence}, nil
	}
	return d, nil
}
