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

// SourceInfo returns source metadata. Unknown source -> found=false so the caller skips.
func (r *repository) SourceInfo(ctx context.Context, sourceID uuid.UUID) (*ndomain.SourceInfo, bool, error) {
	var info ndomain.SourceInfo
	err := r.db.GetContext(ctx, &info, `
		SELECT
			s.id,
			s.url,
			s.city::text AS city,
			c.name AS clinic_name
		FROM sources s
		LEFT JOIN clinics c ON c.id = s.clinic_id
		WHERE s.id = $1`, sourceID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return &info, true, nil
}

func (r *repository) PendingSourceIDs(ctx context.Context, limit int) ([]uuid.UUID, error) {
	if limit <= 0 {
		limit = 20
	}
	const q = `
		SELECT source_id
		FROM parsed_services
		WHERE is_active AND normalized_at IS NULL
		GROUP BY source_id
		ORDER BY max(parsed_at) DESC
		LIMIT $1`
	var ids []uuid.UUID
	if err := r.db.SelectContext(ctx, &ids, q, limit); err != nil {
		return nil, err
	}
	return ids, nil
}

func (r *repository) LoadActiveRows(ctx context.Context, sourceID uuid.UUID) ([]ndomain.RawRow, error) {
	const q = `
		SELECT id, service_name_raw, price_kzt, currency, duration_days, category, parsed_at
		FROM parsed_services
		WHERE source_id = $1 AND is_active`
	var rows []ndomain.RawRow
	if err := r.db.SelectContext(ctx, &rows, q, sourceID); err != nil {
		return nil, err
	}
	return rows, nil
}

// Match resolves a raw name to a catalog id. Cascade, most precise first:
//  1. alias  — exact key hit on a known synonym/abbreviation
//  2. catalog — exact key hit on the canonical name
//  3. fuzzy  — pg_trgm similarity above threshold (best candidate)
//
// Keys are computed by msp_name_key() in SQL so both sides normalize identically.
func (r *repository) Match(ctx context.Context, rawName string) (uuid.UUID, string, error) {
	var id uuid.UUID

	err := r.db.GetContext(ctx, &id,
		`SELECT service_catalog_id FROM service_aliases WHERE alias_key = msp_name_key($1) LIMIT 1`, rawName)
	if err == nil {
		return id, ndomain.MatchAlias, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return uuid.Nil, ndomain.MatchNone, err
	}

	err = r.db.GetContext(ctx, &id,
		`SELECT id FROM services_catalog WHERE name_key = msp_name_key($1) LIMIT 1`, rawName)
	if err == nil {
		return id, ndomain.MatchCatalog, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return uuid.Nil, ndomain.MatchNone, err
	}

	// 0.62 (was 0.45): Russian med names share tokens ("анализ крови"), so a loose
	// threshold over-merged distinct services into one catalog entry.
	const fuzzy = `
		SELECT id FROM services_catalog
		WHERE similarity(name_norm, $1) > 0.62
		ORDER BY similarity(name_norm, $1) DESC
		LIMIT 1`
	err = r.db.GetContext(ctx, &id, fuzzy, rawName)
	if err == nil {
		return id, ndomain.MatchFuzzy, nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return uuid.Nil, ndomain.MatchNone, nil
	}
	return uuid.Nil, ndomain.MatchNone, err
}

// TopCatalogCandidates returns up to k catalog entries lexically close to name
// (pg_trgm, above a low floor) — the gray zone the LLM curator arbitrates. Exact /
// high-similarity hits are already handled by Match before this is reached.
func (r *repository) TopCatalogCandidates(ctx context.Context, name string, k int) ([]ndomain.CatalogEntry, error) {
	if k <= 0 {
		k = 8
	}
	const q = `
		SELECT id, name_norm, category, description
		FROM services_catalog
		WHERE similarity(name_norm, $1) > 0.30
		ORDER BY similarity(name_norm, $1) DESC
		LIMIT $2`
	var rows []ndomain.CatalogEntry
	if err := r.db.SelectContext(ctx, &rows, q, name, k); err != nil {
		return nil, err
	}
	return rows, nil
}

func (r *repository) ListCatalog(ctx context.Context) ([]ndomain.CatalogEntry, error) {
	var rows []ndomain.CatalogEntry
	if err := r.db.SelectContext(ctx, &rows,
		`SELECT id, name_norm, category, description FROM services_catalog ORDER BY name_norm`); err != nil {
		return nil, err
	}
	return rows, nil
}

// AddAlias records a learned synonym. alias_key is generated; a clash (same key
// already mapped) is ignored so concurrent/duplicate learning is harmless.
func (r *repository) AddAlias(ctx context.Context, catalogID uuid.UUID, aliasText, origin string) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO service_aliases (service_catalog_id, alias_text, origin)
		 VALUES ($1, $2, $3) ON CONFLICT (alias_key) DO NOTHING`,
		catalogID, aliasText, origin)
	return err
}

// EnsureCatalogEntry inserts a new canonical service, or returns the existing id
// if one with the same name_key already exists. name_key is a generated unique
// column, so ON CONFLICT resolves concurrent/duplicate creation safely.
func (r *repository) EnsureCatalogEntry(ctx context.Context, nameNorm, category, description string) (uuid.UUID, error) {
	var id uuid.UUID
	err := r.db.GetContext(ctx, &id, `
		INSERT INTO services_catalog (name_norm, category, description)
		VALUES ($1, $2::service_category, NULLIF($3, ''))
		ON CONFLICT (name_key) DO UPDATE SET
			description = COALESCE(services_catalog.description, NULLIF(EXCLUDED.description, ''))
		RETURNING id`, nameNorm, category, description)
	return id, err
}

func (r *repository) BindParsed(ctx context.Context, rowID, catalogID uuid.UUID) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE parsed_services SET service_catalog_id = $1 WHERE id = $2`, catalogID, rowID)
	return err
}

func (r *repository) MarkNormalized(ctx context.Context, sourceID uuid.UUID) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE parsed_services SET normalized_at = now() WHERE source_id = $1 AND is_active`, sourceID)
	return err
}

func (r *repository) RecordUnmatched(ctx context.Context, sourceID uuid.UUID, rawName string) error {
	const q = `
		INSERT INTO unmatched_services (source_id, raw_name, name_key)
		VALUES ($1, $2::text, msp_name_key($2::text))
		ON CONFLICT (source_id, name_key) DO UPDATE SET
			occurrences = unmatched_services.occurrences + 1,
			last_seen   = CURRENT_TIMESTAMP,
			raw_name    = EXCLUDED.raw_name`
	_, err := r.db.ExecContext(ctx, q, sourceID, rawName)
	return err
}

// PublishOffers atomically rebuilds a source's live gold offers: deactivate all,
// then upsert the current set as active. Mirrors the worker's freshness model so
// services a clinic dropped fall out of the API's view.
func (r *repository) PublishOffers(ctx context.Context, sourceID uuid.UUID, city *string, offers []ndomain.Offer) error {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx,
		`UPDATE service_offers SET is_active = false WHERE source_id = $1`, sourceID); err != nil {
		return err
	}

	const upsert = `
		INSERT INTO service_offers
			(source_id, service_catalog_id, city, price_kzt, currency, duration_days, parsed_at, updated_at, is_active)
		VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, true)
		ON CONFLICT (source_id, service_catalog_id) DO UPDATE SET
			city          = EXCLUDED.city,
			price_kzt     = EXCLUDED.price_kzt,
			currency      = EXCLUDED.currency,
			duration_days = EXCLUDED.duration_days,
			parsed_at     = EXCLUDED.parsed_at,
			updated_at    = CURRENT_TIMESTAMP,
			is_active     = true`
	for _, o := range offers {
		if _, err := tx.ExecContext(ctx, upsert,
			sourceID, o.CatalogID, city, o.PriceKZT, o.Currency, o.DurationDays, o.ParsedAt); err != nil {
			return err
		}
	}
	return tx.Commit()
}
