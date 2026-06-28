// Package usecase holds the normalize business logic: read a source's raw
// parsed_services rows, bind them to the catalog, and publish normalized offers
// into the gold table the API reads.
package usecase

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/pkg/errors"

	ndomain "medprice/internal/normalize/domain"
	"medprice/pkg/rabbitmq"
)

type Service struct {
	repo ndomain.Repository
	llm  ndomain.LLMMatcher // optional; nil = LLM fallback disabled
	log  rabbitmq.Logger
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
			return i, errors.Wrapf(err, "normalize pending source %s", sourceID)
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
	sourceID, err := uuid.Parse(p.SourceID)
	if err != nil {
		return errors.Wrapf(err, "bad source_id %q", p.SourceID)
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
	s.log.Info("normalize task received",
		"trigger", meta.Trigger,
		"msg_id", meta.MsgID,
		"adapter_id", meta.AdapterID,
		"source_id", sourceID.String(),
		"worker_rows_written", meta.RowsWritten,
		"worker_parsed_at", parsedAt)

	source, found, err := s.repo.SourceInfo(ctx, sourceID)
	if err != nil {
		return errors.Wrap(err, "resolve source info")
	}
	if !found {
		// Unknown source — registration missing/not yet committed. Skip (ack) instead
		// of dead-lettering; a retry can't help and would only spam the DLX.
		s.log.Info("normalize skipped unknown source",
			"source_id", sourceID.String(),
			"msg_id", meta.MsgID)
		return nil
	}

	rows, err := s.repo.LoadActiveRows(ctx, sourceID)
	if err != nil {
		return errors.Wrap(err, "load active rows")
	}
	s.log.Info("normalize loaded raw rows",
		"source_id", sourceID.String(),
		"source_url", source.URL,
		"clinic", valueOr(source.ClinicName, "unassigned"),
		"city", valueOr(source.City, "unknown"),
		"active_rows", len(rows))

	// Catalog snapshot for the LLM prompt — loaded once, only if LLM is enabled.
	var catalog []ndomain.CatalogEntry
	if s.llm != nil {
		if catalog, err = s.repo.ListCatalog(ctx); err != nil {
			return errors.Wrap(err, "list catalog")
		}
		s.log.Info("normalize loaded catalog for llm",
			"entries", len(catalog),
			"source_id", sourceID.String())
	}

	// Dedup raw rows that collapse to the same catalog service: keep the cheapest.
	offers := make(map[uuid.UUID]ndomain.Offer)
	matched, unmatched := 0, 0
	methodCounts := map[string]int{
		ndomain.MatchAlias:   0,
		ndomain.MatchCatalog: 0,
		ndomain.MatchFuzzy:   0,
		ndomain.MatchLLM:     0,
		ndomain.MatchNone:    0,
	}
	categoryCounts := map[string]int{}
	llmErrors := 0
	aliasesLearned := 0
	for i, row := range rows {
		catalogID, method, err := s.repo.Match(ctx, row.Name)
		if err != nil {
			return errors.Wrapf(err, "match %q", row.Name)
		}

		// Deterministic miss → LLM fallback (best-effort). A hit is learned as an
		// alias so the next fetch matches without the LLM.
		if catalogID == uuid.Nil && s.llm != nil {
			if id, conf, lerr := s.llm.Suggest(ctx, row.Name, catalog); lerr != nil {
				llmErrors++
				if llmErrors <= 3 {
					s.log.Error("normalize llm suggest failed", "raw", row.Name, "err", lerr)
				}
			} else if id != uuid.Nil {
				if aerr := s.repo.AddAlias(ctx, id, row.Name, "llm"); aerr != nil {
					return errors.Wrap(aerr, "add llm alias")
				}
				catalogID, method = id, ndomain.MatchLLM
				aliasesLearned++
				if aliasesLearned <= 5 {
					s.log.Info("normalize llm matched",
						"raw", row.Name,
						"confidence", conf)
				}
			}
		}

		if catalogID == uuid.Nil {
			unmatched++
			methodCounts[ndomain.MatchNone]++
			if err := s.repo.RecordUnmatched(ctx, sourceID, row.Name); err != nil {
				return errors.Wrap(err, "record unmatched")
			}
			if unmatched <= 5 {
				s.log.Info("normalize unmatched sample",
					"source_id", sourceID.String(),
					"raw", row.Name)
			}
			progressLog(s.log, sourceID.String(), i+1, len(rows), matched, unmatched, offers, started)
			continue
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
		progressLog(s.log, sourceID.String(), i+1, len(rows), matched, unmatched, offers, started)
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
		"source_id", sourceID.String(),
		"source_url", source.URL,
		"clinic", valueOr(source.ClinicName, "unassigned"),
		"city", valueOr(source.City, "unknown"),
		"raw_rows", len(rows),
		"worker_rows_written", meta.RowsWritten,
		"matched", matched,
		"unmatched", unmatched,
		"gold_offers", len(list),
		"deduped_matches", matched-len(list),
		"aliases_learned", aliasesLearned,
		"llm_errors", llmErrors,
		"methods", methodCounts,
		"raw_categories", categoryCounts,
		"duration_s", time.Since(started).Seconds())
	return nil
}

func progressLog(log rabbitmq.Logger, sourceID string, done, total, matched, unmatched int, offers map[uuid.UUID]ndomain.Offer, started time.Time) {
	if total < 500 {
		return
	}
	if done != total && done%500 != 0 {
		return
	}
	log.Info("normalize progress",
		"source_id", sourceID,
		"done", done,
		"total", total,
		"matched", matched,
		"unmatched", unmatched,
		"gold_offers_so_far", len(offers),
		"duration_s", time.Since(started).Seconds())
}

func valueOr(value *string, fallback string) string {
	if value == nil || *value == "" {
		return fallback
	}
	return *value
}
