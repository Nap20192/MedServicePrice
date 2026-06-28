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
	log  rabbitmq.Logger
}

func NewService(repo ndomain.Repository, log rabbitmq.Logger) *Service {
	return &Service{repo: repo, log: log}
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

	// Dedup raw rows that collapse to the same catalog service: keep the cheapest.
	offers := make(map[uuid.UUID]ndomain.Offer)
	matched, unmatched := 0, 0
	for _, row := range rows {
		catalogID, method, err := s.repo.Match(ctx, row.Name)
		if err != nil {
			return errors.Wrapf(err, "match %q", row.Name)
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

	s.log.Info("normalize completed",
		"source_id", p.SourceID, "rows", len(rows),
		"matched", matched, "unmatched", unmatched, "offers", len(list))
	return nil
}
