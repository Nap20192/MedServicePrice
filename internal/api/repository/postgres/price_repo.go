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

var priceSortSQL = map[string]string{
	"price_asc":  "d.price_kzt ASC",
	"price_desc": "d.price_kzt DESC",
	"date_desc":  "d.parsed_at DESC",
}

func (r *priceRepo) SearchPrices(ctx context.Context, p domain.PriceSearch) ([]domain.AggregatedPrice, int, error) {
	// Reads the published gold table only. parsed_services (raw) is never touched
	// here — the normalize service owns that layer.
	//
	// DISTINCT ON (clinic, service): one row per clinic+service (the cheapest), so a
	// clinic that maps a service from several sources/cities is not shown twice.
	args := []any{}
	where := "WHERE o.is_active = true"
	argIdx := 1
	if p.Query != "" {
		where += fmt.Sprintf(` AND sc.name_norm ILIKE $%d`, argIdx)
		args = append(args, "%"+p.Query+"%")
		argIdx++
	}
	if p.ClinicID != "" {
		where += fmt.Sprintf(` AND COALESCE(c.id, s.id)::text = $%d`, argIdx)
		args = append(args, p.ClinicID)
		argIdx++
	}
	if p.City != "" {
		where += fmt.Sprintf(` AND o.city::text ILIKE $%d`, argIdx)
		args = append(args, "%"+p.City+"%")
		argIdx++
	}
	if p.Category != "" {
		where += fmt.Sprintf(` AND sc.category::text = $%d`, argIdx)
		args = append(args, p.Category)
		argIdx++
	}
	if p.MinPrice > 0 {
		where += fmt.Sprintf(` AND o.price_kzt >= $%d`, argIdx)
		args = append(args, p.MinPrice)
		argIdx++
	}
	if p.MaxPrice > 0 {
		where += fmt.Sprintf(` AND o.price_kzt <= $%d`, argIdx)
		args = append(args, p.MaxPrice)
		argIdx++
	}
	if p.RatingMin > 0 {
		where += fmt.Sprintf(` AND c.rating >= $%d`, argIdx)
		args = append(args, p.RatingMin)
		argIdx++
	}

	// Network model: branch clinics share a source (clinics.source_id, M:1). An offer
	// (source + city) belongs to the source's branches in that city. LEFT JOIN so a
	// source with no registered branch still shows (clinic falls back to the source).
	// DISTINCT ON (branch-or-source, service): one cheapest row per branch+service.
	dedup := `
		SELECT DISTINCT ON (COALESCE(c.id, s.id), sc.id)
			o.id AS price_id,
			COALESCE(c.id, s.id) AS clinic_id,
			COALESCE(c.name, s.url) AS clinic_name,
			COALESCE(c.url, s.url) AS clinic_url,
			o.city,
			c.address,
			c.phone,
			c.working_hours,
			c.lat,
			c.lng,
			c.rating,
			c.reviews_count,
			sc.name_norm AS service_name_norm,
			sc.category,
			o.price_kzt,
			o.currency,
			o.duration_days,
			o.parsed_at
		FROM service_offers o
		JOIN sources s ON o.source_id = s.id
		LEFT JOIN clinics c ON c.source_id = s.id
			AND (c.city IS NULL OR o.city IS NULL OR c.city = o.city::text)
		JOIN services_catalog sc ON o.service_catalog_id = sc.id
		` + where + `
		ORDER BY COALESCE(c.id, s.id), sc.id, o.price_kzt ASC`

	var total int
	if err := r.db.GetContext(ctx, &total, `SELECT count(*) FROM (`+dedup+`) d`, args...); err != nil {
		return nil, 0, err
	}

	orderBy, ok := priceSortSQL[p.Sort]
	if !ok {
		orderBy = priceSortSQL["price_asc"]
	}
	pageQuery := `SELECT * FROM (` + dedup + `) d ORDER BY ` + orderBy +
		fmt.Sprintf(` LIMIT $%d OFFSET $%d`, argIdx, argIdx+1)
	args = append(args, p.Limit, p.Offset)

	prices := []domain.AggregatedPrice{}
	if err := r.db.SelectContext(ctx, &prices, pageQuery, args...); err != nil {
		return nil, 0, err
	}
	return prices, total, nil
}
