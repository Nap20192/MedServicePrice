// Package usecase holds the normalize business logic: read a source's raw
// parsed_services rows, bind them to the catalog, and publish normalized offers
// into the gold table the API reads.
package usecase

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/pkg/errors"

	ndomain "medprice/internal/normalize/domain"
	"medprice/pkg/rabbitmq"
)

// Real service names are short; longer strings are crawler mis-extractions
// (descriptions) and must not become catalog entries (catalog name_norm is varchar(255)).
const maxCatalogNameLen = 200

type Service struct {
	repo ndomain.Repository
	llm  ndomain.LLMMatcher // optional; nil = LLM fallback disabled
	log  rabbitmq.Logger
}

// truncRunes caps a string to n runes (safe for varchar limits + Cyrillic).
func truncRunes(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

type TaskMeta struct {
	MsgID       string
	AdapterID   string
	RowsWritten int
	ParsedAt    time.Time
	Trigger     string
}

// NewService wires the normalize usecase. llm may be nil (deterministic matching only).
func NewService(repo ndomain.Repository, llm ndomain.LLMMatcher, log rabbitmq.Logger) *Service {
	return &Service{repo: repo, llm: llm, log: log}
}

func (s *Service) ProcessPending(ctx context.Context, limit int) (int, error) {
	ids, err := s.repo.PendingSourceIDs(ctx, limit)
	if err != nil {
		return 0, errors.Wrap(err, "load pending sources")
	}
	if len(ids) == 0 {
		s.log.Info("normalize sweep no pending sources")
		return 0, nil
	}
	s.log.Info("normalize sweep found pending sources", "count", len(ids))
	for i, sourceID := range ids {
		if err := s.ProcessSource(ctx, sourceID, TaskMeta{Trigger: "sweep"}); err != nil {
			return i, errors.Wrap(err, "normalize pending source")
		}
	}
	return len(ids), nil
}

// ProcessParseCompleted normalizes one source end-to-end: every active raw row is
// matched to the catalog; matched rows become gold offers (published atomically),
// misses go to the review queue.
func (s *Service) ProcessParseCompleted(ctx context.Context, body []byte) error {
	var p ndomain.ParseCompletedPayload
	if err := json.Unmarshal(body, &p); err != nil {
		return errors.Wrap(err, "unmarshal parse.completed")
	}
	if p.SourceID == "" {
		return errors.New("parse.completed missing source_id")
	}
	sourceID, err := uuid.Parse(p.SourceID)
	if err != nil {
		return errors.Wrap(err, "bad source_id in parse.completed")
	}

	return s.ProcessSource(ctx, sourceID, TaskMeta{
		MsgID:       p.MsgID,
		AdapterID:   p.AdapterID,
		RowsWritten: p.RowsWritten,
		ParsedAt:    p.ParsedAt,
		Trigger:     "event",
	})
}

func (s *Service) ProcessSource(ctx context.Context, sourceID uuid.UUID, meta TaskMeta) error {
	started := time.Now()
	parsedAt := ""
	if !meta.ParsedAt.IsZero() {
		parsedAt = meta.ParsedAt.Format(time.RFC3339)
	}

	source, found, err := s.repo.SourceInfo(ctx, sourceID)
	if err != nil {
		return errors.Wrap(err, "resolve source info")
	}
	if !found {
		// Unknown source — registration missing/not yet committed. Skip (ack) instead
		// of dead-lettering; a retry can't help and would only spam the DLX.
		s.log.Info("normalize skipped unknown source record", "trigger", meta.Trigger)
		return nil
	}

	s.log.Info("normalize task received",
		"trigger", meta.Trigger,
		"source_url", source.URL,
		"clinic", valueOr(source.ClinicName, "unassigned"),
		"city", valueOr(source.City, "unknown"),
		"worker_rows_written", meta.RowsWritten,
		"worker_parsed_at", parsedAt)

	rows, err := s.repo.LoadActiveRows(ctx, sourceID)
	if err != nil {
		return errors.Wrap(err, "load active rows")
	}
	s.log.Info("normalize loaded raw rows",
		"source_url", source.URL,
		"clinic", valueOr(source.ClinicName, "unassigned"),
		"city", valueOr(source.City, "unknown"),
		"active_rows", len(rows))

	// Dedup raw rows that collapse to the same catalog service: keep the cheapest.
	offers := make(map[uuid.UUID]ndomain.Offer)
	matched, created := 0, 0
	methodCounts := map[string]int{
		ndomain.MatchAlias:   0,
		ndomain.MatchCatalog: 0,
		ndomain.MatchFuzzy:   0,
		ndomain.MatchNew:     0,
		ndomain.MatchNone:    0,
	}
	categoryCounts := map[string]int{}
	for i, row := range rows {
		catalogID, method, err := s.repo.Match(ctx, row.Name)
		if err != nil {
			return errors.Wrapf(err, "match %q", row.Name)
		}

		// Deterministic miss → grow the catalog: create a new canonical entry from
		// this service. Previously this fell to an LLM that was forced to pick from a
		// tiny 10-row catalog and squashed thousands of distinct services into a
		// handful of entries (e.g. 720 different services → "Биохимический анализ
		// крови"), so service_offers ended up nearly empty.
		if catalogID == uuid.Nil {
			name := strings.TrimSpace(row.Name)
			// Real service names are short. An empty or paragraph-length "name" is a
			// crawler mis-extraction (description text) — don't pollute the catalog;
			// send it to the review queue instead.
			if name == "" || len([]rune(name)) > maxCatalogNameLen {
				methodCounts[ndomain.MatchNone]++
				if err := s.repo.RecordUnmatched(ctx, sourceID, truncRunes(row.Name, 480)); err != nil {
					return errors.Wrap(err, "record unmatched")
				}
				continue
			}
			id, cerr := s.repo.EnsureCatalogEntry(ctx, name, categoryEnum(row))
			if cerr != nil {
				return errors.Wrapf(cerr, "ensure catalog entry %q", name)
			}
			catalogID, method = id, ndomain.MatchNew
			created++
		}
		matched++
		methodCounts[method]++
		if row.Category != nil && *row.Category != "" {
			categoryCounts[*row.Category]++
		}
		if err := s.repo.BindParsed(ctx, row.ID, catalogID); err != nil {
			return errors.Wrap(err, "bind parsed row")
		}

		if cur, ok := offers[catalogID]; !ok || row.PriceKZT < cur.PriceKZT {
			offers[catalogID] = ndomain.Offer{
				CatalogID:    catalogID,
				PriceKZT:     row.PriceKZT,
				Currency:     row.Currency,
				DurationDays: row.DurationDays,
				ParsedAt:     row.ParsedAt,
			}
		}
		progressLog(s.log, source.URL, i+1, len(rows), matched, created, offers, started)
	}

	list := make([]ndomain.Offer, 0, len(offers))
	for _, o := range offers {
		list = append(list, o)
	}
	if err := s.repo.PublishOffers(ctx, sourceID, source.City, list); err != nil {
		return errors.Wrap(err, "publish offers")
	}

	// Stamp the raw layer: these rows have now been seen by normalize.
	if err := s.repo.MarkNormalized(ctx, sourceID); err != nil {
		return errors.Wrap(err, "mark normalized")
	}

	s.log.Info("RESULT normalize completed",
		"trigger", meta.Trigger,
		"source_url", source.URL,
		"clinic", valueOr(source.ClinicName, "unassigned"),
		"city", valueOr(source.City, "unknown"),
		"raw_rows", len(rows),
		"worker_rows_written", meta.RowsWritten,
		"matched", matched,
		"created_catalog_entries", created,
		"gold_offers", len(list),
		"deduped_matches", matched-len(list),
		"methods", methodCounts,
		"raw_categories", categoryCounts,
		"duration_s", time.Since(started).Seconds())
	return nil
}

func progressLog(log rabbitmq.Logger, sourceLabel string, done, total, matched, unmatched int, offers map[uuid.UUID]ndomain.Offer, started time.Time) {
	if total < 500 {
		return
	}
	if done != total && done%500 != 0 {
		return
	}
	log.Info("normalize progress",
		"source_url", sourceLabel,
		"done", done,
		"total", total,
		"matched", matched,
		"unmatched", unmatched,
		"gold_offers_so_far", len(offers),
		"duration_s", time.Since(started).Seconds())
}

// categoryEnum maps a raw row to a valid service_category enum value. The crawler's
// category hint is freeform/English, so we keyword-classify name + hint, defaulting
// to 'лаборатория' (labs dominate the data).
func categoryEnum(row ndomain.RawRow) string {
	hint := ""
	if row.Category != nil {
		hint = *row.Category
	}
	s := strings.ToLower(hint + " " + row.Name)
	switch {
	case containsAny(s, "узи", "мрт", "кт ", "рентген", "ренгрен", "экг", "ээг", "эхо",
		"диагност", "эндоскоп", "гастроскоп", "колоноскоп", "флюорограф", "маммограф",
		"томограф", "densitomet", "radiology", "ultrasound", "x-ray", "mri"):
		return "диагностика"
	case containsAny(s, "прием", "приём", "консультац", "осмотр", "врач", "doctor",
		"specialist", "consult"):
		return "прием врача"
	case containsAny(s, "процедур", "инъекц", "укол", "массаж", "капельниц", "перевязк",
		"манипул", "удален", "биопси", "пункци", "вакцин", "прививк", "procedure"):
		return "процедура"
	default:
		return "лаборатория"
	}
}

func containsAny(s string, subs ...string) bool {
	for _, sub := range subs {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}

func valueOr(value *string, fallback string) string {
	if value == nil || *value == "" {
		return fallback
	}
	return *value
}
