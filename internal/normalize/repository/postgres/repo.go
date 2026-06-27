package postgres

import (
	"context"
	"database/sql"
	"errors"

	"github.com/google/uuid"

	ndomain "medprice/internal/normalize/domain"
	"medprice/internal/platform/database"
)

type repository struct {
	db *database.DB
}

func NewRepository(db *database.DB) ndomain.Repository {
	return &repository{db: db}
}

func (r *repository) LoadUnmapped(ctx context.Context, sourceID uuid.UUID) ([]ndomain.UnmappedRow, error) {
	const q = `
		SELECT id, service_name_raw
		FROM parsed_services
		WHERE source_id = $1 AND is_active AND service_catalog_id IS NULL`
	var rows []ndomain.UnmappedRow
	if err := r.db.SelectContext(ctx, &rows, q, sourceID); err != nil {
		return nil, err
	}
	return rows, nil
}

// MatchCatalog is a STUB: exact, case-insensitive lookup on services_catalog.name_norm.
// TODO: trigram/fuzzy similarity + synonyms + optional Ollama fallback for misses.
func (r *repository) MatchCatalog(ctx context.Context, rawName string) (uuid.UUID, error) {
	const q = `SELECT id FROM services_catalog WHERE lower(name_norm) = lower($1) LIMIT 1`
	var id uuid.UUID
	err := r.db.GetContext(ctx, &id, q, rawName)
	if errors.Is(err, sql.ErrNoRows) {
		return uuid.Nil, nil
	}
	if err != nil {
		return uuid.Nil, err
	}
	return id, nil
}

func (r *repository) BindCatalog(ctx context.Context, rowID, catalogID uuid.UUID) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE parsed_services SET service_catalog_id = $1 WHERE id = $2`, catalogID, rowID)
	return err
}
