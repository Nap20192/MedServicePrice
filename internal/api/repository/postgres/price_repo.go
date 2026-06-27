package postgres

import (
	"context"
	"fmt"

	"github.com/jmoiron/sqlx"

	"medprice/internal/api/domain"
	"medprice/internal/platform/database"
)

type priceRepo struct {
	db *sqlx.DB
}

func NewPriceRepository(db *database.DB) domain.PriceRepository {
	return &priceRepo{db: db.DB}
}

func (r *priceRepo) SearchPrices(ctx context.Context, query string, city string) ([]domain.AggregatedPrice, error) {
	// A real implementation would use Postgres FTS or pg_trgm for search.
	// For MVP, we do a simple ILIKE or rely on exact match if we want it simple.
	// We join with parsed_services and clinics.
	sqlQuery := `
		SELECT 
			ps.id AS price_id, 
			c.id AS clinic_id, 
			c.name AS clinic_name, 
			c.city, 
			c.address, 
			ps.service_name_raw, 
			ps.price_kzt, 
			ps.parsed_at 
		FROM parsed_services ps
		JOIN sources s ON ps.source_id = s.id
		JOIN clinics c ON s.clinic_id = c.id
		WHERE ps.is_active = true
	`
	
	args := []interface{}{}
	argIdx := 1
	
	if query != "" {
		sqlQuery += fmt.Sprintf(` AND ps.service_name_raw ILIKE $%d`, argIdx)
		args = append(args, "%"+query+"%")
		argIdx++
	}
	
	if city != "" {
		sqlQuery += fmt.Sprintf(` AND c.city ILIKE $%d`, argIdx)
		args = append(args, "%"+city+"%")
		argIdx++
	}

	sqlQuery += ` ORDER BY ps.price_kzt ASC LIMIT 100`

	var prices []domain.AggregatedPrice
	err := r.db.SelectContext(ctx, &prices, sqlQuery, args...)
	if err != nil {
		return nil, err
	}

	if prices == nil {
		prices = []domain.AggregatedPrice{}
	}

	return prices, nil
}

func (r *priceRepo) UpsertParsedService(ctx context.Context, ps *domain.ParsedService) error {
	query := `
		INSERT INTO parsed_services (
			id, source_id, service_catalog_id, service_name_raw, 
			price_kzt, currency, duration_days, parsed_at, is_active
		) VALUES (
			:id, :source_id, :service_catalog_id, :service_name_raw, 
			:price_kzt, :currency, :duration_days, :parsed_at, :is_active
		)
		ON CONFLICT (id) DO UPDATE SET 
			price_kzt = EXCLUDED.price_kzt,
			parsed_at = EXCLUDED.parsed_at,
			is_active = EXCLUDED.is_active,
			service_catalog_id = COALESCE(EXCLUDED.service_catalog_id, parsed_services.service_catalog_id)
	`
	_, err := r.db.NamedExecContext(ctx, query, ps)
	return err
}
