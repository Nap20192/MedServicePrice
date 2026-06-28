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
	// Reads the published gold table only. parsed_services (raw) is never touched
	// here — the normalize service owns that layer.
	sqlQuery := `
		SELECT
			o.id AS price_id,
			c.id AS clinic_id,
			c.name AS clinic_name,
			c.url AS clinic_url,
			o.city,
			c.address,
			sc.name_norm AS service_name_norm,
			sc.category,
			o.price_kzt,
			o.parsed_at
		FROM service_offers o
		JOIN sources s ON o.source_id = s.id
		JOIN clinics c ON s.clinic_id = c.id
		JOIN services_catalog sc ON o.service_catalog_id = sc.id
		WHERE o.is_active = true
	`

	args := []interface{}{}
	argIdx := 1

	if query != "" {
		sqlQuery += fmt.Sprintf(` AND sc.name_norm ILIKE $%d`, argIdx)
		args = append(args, "%"+query+"%")
		argIdx++
	}

	if city != "" {
		sqlQuery += fmt.Sprintf(` AND o.city::text ILIKE $%d`, argIdx)
		args = append(args, "%"+city+"%")
		argIdx++
	}

	sqlQuery += ` ORDER BY o.price_kzt ASC LIMIT 100`

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
