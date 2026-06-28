// Package usecase holds the normalize business logic: read a source's raw
// parsed_services rows, bind them to the catalog, and publish normalized offers
// into the gold table the API reads.
package usecase

import (
	"context"
	"encoding/json"

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

// NewService wires the normalize usecase. llm may be nil (deterministic matching only).
func NewService(repo ndomain.Repository, llm ndomain.LLMMatcher, log rabbitmq.Logger) *Service {
	return &Service{repo: repo, llm: llm, log: log}
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

	city, found, err := s.repo.SourceCity(ctx, sourceID)
	if err != nil {
		return errors.Wrap(err, "resolve source city")
	}
	if !found {
		// Unknown source — registration missing/not yet committed. Skip (ack) instead
		// of dead-lettering; a retry can't help and would only spam the DLX.
		s.log.Info("skip parse.completed: unknown source", "source_id", p.SourceID)
		return nil
	}

	rows, err := s.repo.LoadActiveRows(ctx, sourceID)
	if err != nil {
		return errors.Wrap(err, "load active rows")
	}

	// Catalog snapshot for the LLM prompt — loaded once, only if LLM is enabled.
	var catalog []ndomain.CatalogEntry
	if s.llm != nil {
		if catalog, err = s.repo.ListCatalog(ctx); err != nil {
			return errors.Wrap(err, "list catalog")
		}
	}

	// Dedup raw rows that collapse to the same catalog service: keep the cheapest.
	offers := make(map[uuid.UUID]ndomain.Offer)
	matched, unmatched := 0, 0
	for _, row := range rows {
		catalogID, method, err := s.repo.Match(ctx, row.Name)
		if err != nil {
			return errors.Wrapf(err, "match %q", row.Name)
		}

		// Deterministic miss → LLM fallback (best-effort). A hit is learned as an
		// alias so the next fetch matches without the LLM.
		if catalogID == uuid.Nil && s.llm != nil {
			if id, conf, lerr := s.llm.Suggest(ctx, row.Name, catalog); lerr != nil {
				s.log.Error("llm suggest failed", "raw", row.Name, "err", lerr)
			} else if id != uuid.Nil {
				if aerr := s.repo.AddAlias(ctx, id, row.Name, "llm"); aerr != nil {
					return errors.Wrap(aerr, "add llm alias")
				}
				catalogID, method = id, ndomain.MatchLLM
				s.log.Info("llm matched", "raw", row.Name, "confidence", conf)
			}
		}

		if catalogID == uuid.Nil {
			unmatched++
			if err := s.repo.RecordUnmatched(ctx, sourceID, row.Name); err != nil {
				return errors.Wrap(err, "record unmatched")
			}
			continue
		}
		matched++
		if err := s.repo.BindParsed(ctx, row.ID, catalogID); err != nil {
			return errors.Wrap(err, "bind parsed row")
		}
		s.log.Info("matched", "raw", row.Name, "method", method)

		if cur, ok := offers[catalogID]; !ok || row.PriceKZT < cur.PriceKZT {
			offers[catalogID] = ndomain.Offer{
				CatalogID:    catalogID,
				PriceKZT:     row.PriceKZT,
				Currency:     row.Currency,
				DurationDays: row.DurationDays,
				ParsedAt:     row.ParsedAt,
			}
		}
	}

	list := make([]ndomain.Offer, 0, len(offers))
	for _, o := range offers {
		list = append(list, o)
	}
	if err := s.repo.PublishOffers(ctx, sourceID, city, list); err != nil {
		return errors.Wrap(err, "publish offers")
	}

	// Stamp the raw layer: these rows have now been seen by normalize.
	if err := s.repo.MarkNormalized(ctx, sourceID); err != nil {
		return errors.Wrap(err, "mark normalized")
	}

	s.log.Info("normalize completed",
		"source_id", p.SourceID, "rows", len(rows),
		"matched", matched, "unmatched", unmatched, "offers", len(list))
	return nil
}
