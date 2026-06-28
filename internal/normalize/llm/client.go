// Package llm is an OpenAI-compatible (DeepSeek) matcher: given a raw service
// name and the catalog, it asks the model which catalog entry fits. It implements
// domain.LLMMatcher. Best-effort — any failure returns uuid.Nil so the caller
// falls back to the unmatched queue.
package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	ndomain "medprice/internal/normalize/domain"
)

// Config is read from env in cmd/normalize.
type Config struct {
	BaseURL string  // e.g. https://api.deepseek.com
	APIKey  string
	Model   string  // e.g. deepseek-chat
	MinConf float64 // accept suggestion only at/above this confidence
	Timeout time.Duration
}

type Client struct {
	cfg  Config
	http *http.Client
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
	return &Client{cfg: cfg, http: &http.Client{Timeout: cfg.Timeout}}
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
	ResponseFormat map[string]any `json:"response_format,omitempty"`
}

type chatResponse struct {
	Choices []struct {
		Message chatMessage `json:"message"`
	} `json:"choices"`
}

// The model returns a 1-based index into the catalog list (0 = no fit).
type suggestion struct {
	Index      int     `json:"index"`
	Confidence float64 `json:"confidence"`
}

// Suggest implements domain.LLMMatcher.
func (c *Client) Suggest(ctx context.Context, rawName string, catalog []ndomain.CatalogEntry) (uuid.UUID, float64, error) {
	if len(catalog) == 0 {
		return uuid.Nil, 0, nil
	}

	var list strings.Builder
	for i, e := range catalog {
		fmt.Fprintf(&list, "%d. %s [%s]\n", i+1, e.Name, e.Category)
	}
	user := fmt.Sprintf(
		"Сырое название медицинской услуги с сайта клиники:\n%q\n\n"+
			"Справочник канонических услуг:\n%s\n"+
			"Выбери ОДНУ услугу из справочника, которой соответствует сырое название. "+
			"Если ни одна не подходит — верни index 0. "+
			`Ответь строго JSON: {"index": <номер из списка или 0>, "confidence": <число 0..1>}.`,
		rawName, list.String())

	reqBody := chatRequest{
		Model:       c.cfg.Model,
		Temperature: 0,
		Messages: []chatMessage{
			{Role: "system", Content: "Ты сопоставляешь названия медицинских услуг с каноническим справочником. Отвечаешь только JSON."},
			{Role: "user", Content: user},
		},
		ResponseFormat: map[string]any{"type": "json_object"},
	}
	buf, err := json.Marshal(reqBody)
	if err != nil {
		return uuid.Nil, 0, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		strings.TrimRight(c.cfg.BaseURL, "/")+"/chat/completions", bytes.NewReader(buf))
	if err != nil {
		return uuid.Nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return uuid.Nil, 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return uuid.Nil, 0, fmt.Errorf("llm http %d", resp.StatusCode)
	}

	var cr chatResponse
	if err := json.NewDecoder(resp.Body).Decode(&cr); err != nil {
		return uuid.Nil, 0, err
	}
	if len(cr.Choices) == 0 {
		return uuid.Nil, 0, nil
	}

	var s suggestion
	if err := json.Unmarshal([]byte(cr.Choices[0].Message.Content), &s); err != nil {
		return uuid.Nil, 0, fmt.Errorf("parse llm json: %w", err)
	}
	if s.Index < 1 || s.Index > len(catalog) || s.Confidence < c.cfg.MinConf {
		return uuid.Nil, s.Confidence, nil
	}
	return catalog[s.Index-1].ID, s.Confidence, nil
}
