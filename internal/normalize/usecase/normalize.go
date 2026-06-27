// Package usecase holds the normalize business logic: bind unmapped parsed_services
// rows to services_catalog entries.
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

// ProcessParseCompleted binds every unmapped, active row of one source to a catalog id.
func (s *Service) ProcessParseCompleted(ctx context.Context, body []byte) error {
	var p ndomain.ParseCompletedPayload
	if err := json.Unmarshal(body, &p); err != nil {
		return errors.Wrap(err, "unmarshal parse.completed")
	}
	sourceID, err := uuid.Parse(p.SourceID)
	if err != nil {
		return errors.Wrapf(err, "bad source_id %q", p.SourceID)
	}

	rows, err := s.repo.LoadUnmapped(ctx, sourceID)
	if err != nil {
		return errors.Wrap(err, "load unmapped rows")
	}

	matched, unmatched := 0, 0
	for _, row := range rows {
		catalogID, err := s.repo.MatchCatalog(ctx, row.Name)
		if err != nil {
			return errors.Wrap(err, "match")
		}
		if catalogID == uuid.Nil {
			unmatched++
			// TODO: enqueue row into an unmatched-queue table for manual labeling.
			continue
		}
		if err := s.repo.BindCatalog(ctx, row.ID, catalogID); err != nil {
			return errors.Wrap(err, "bind catalog id")
		}
		matched++
	}
	s.log.Info("normalize completed",
		"source_id", p.SourceID, "rows", len(rows), "matched", matched, "unmatched", unmatched)
	return nil
}
