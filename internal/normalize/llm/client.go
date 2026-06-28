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
	"net/http"
	"strings"
	"time"

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

const curateSystem = `Ты ведёшь справочник медицинских услуг. Тебе дают сырое название услуги
с сайта клиники и список похожих канонических услуг из справочника. Реши: это та же
услуга, что одна из них, или принципиально новая.

Та же = тот же медицинский смысл (например "ОАК", "Общий анализ крови", "CBC",
"Клинический анализ крови" — одна услуга). Разный объём/панель/комплекс = разные услуги.

Категории строго одна из: лаборатория, прием врача, диагностика, процедура.

Отвечай ТОЛЬКО JSON:
{"match": true, "index": <номер из списка>, "confidence": <0..1>}
или
{"match": false, "canonical_name": "<чистое каноническое имя новой услуги>",
 "category": "<одна из категорий>",
 "description": "<1-2 предложения: что это за услуга, чтобы потом отличать от похожих>",
 "confidence": <0..1>}`

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

	var list strings.Builder
	for i, e := range candidates {
		desc := ""
		if e.Description != nil && *e.Description != "" {
			desc = " — " + *e.Description
		}
		fmt.Fprintf(&list, "%d. %s [%s]%s\n", i+1, e.Name, e.Category, desc)
	}
	hint := categoryHint
	if hint == "" {
		hint = "нет"
	}
	user := fmt.Sprintf("Сырое название:\n%q\nПодсказка категории от парсера: %s\n\n"+
		"Похожие услуги справочника:\n%s", rawName, hint, list.String())

	reqBody := chatRequest{
		Model:       c.cfg.Model,
		Temperature: 0,
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
		return zero, fmt.Errorf("llm http %d", resp.StatusCode)
	}

	var cr chatResponse
	if err := json.NewDecoder(resp.Body).Decode(&cr); err != nil {
		return zero, err
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
