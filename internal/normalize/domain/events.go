// Package domain holds the normalize service's types and ports (interfaces).
package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// ParseCompletedPayload mirrors queue/messages.md §3 (Worker -> Normalize).
type ParseCompletedPayload struct {
	SchemaVersion int       `json:"schema_version"`
	MsgID         string    `json:"msg_id"`
	AdapterID     string    `json:"adapter_id"`
	SourceID      string    `json:"source_id"`
	RowsWritten   int       `json:"rows_written"`
	ParsedAt      time.Time `json:"parsed_at"`
}

// RawRow is an active parsed_services row (the raw layer) for one source.
type RawRow struct {
	ID           uuid.UUID `db:"id"`
	Name         string    `db:"service_name_raw"`
	PriceKZT     float64   `db:"price_kzt"`
	Currency     string    `db:"currency"`
	DurationDays *int      `db:"duration_days"`
	ParsedAt     time.Time `db:"parsed_at"`
}

// Offer is a normalized, catalog-bound price ready to publish to the gold table.
type Offer struct {
	CatalogID    uuid.UUID
	PriceKZT     float64
	Currency     string
	DurationDays *int
	ParsedAt     time.Time
}

// Match methods, for logging/telemetry.
const (
	MatchAlias   = "alias"
	MatchCatalog = "catalog"
	MatchFuzzy   = "fuzzy"
	MatchNone    = "none"
)

// Repository is the persistence port the usecase depends on. The normalize
// service is the only reader of parsed_services (raw); it publishes into
// service_offers (gold), which the API reads.
type Repository interface {
	// SourceCity returns the source's city (nil if unset) and whether the source
	// exists. A missing source means nothing to normalize — caller skips.
	SourceCity(ctx context.Context, sourceID uuid.UUID) (city *string, found bool, err error)
	// LoadActiveRows returns the source's active raw rows.
	LoadActiveRows(ctx context.Context, sourceID uuid.UUID) ([]RawRow, error)
	// Match resolves a raw name to a catalog id via alias -> exact -> fuzzy.
	// Returns uuid.Nil + MatchNone on a miss.
	Match(ctx context.Context, rawName string) (uuid.UUID, string, error)
	// BindParsed links a raw row to its catalog id (traceability in the raw layer).
	BindParsed(ctx context.Context, rowID, catalogID uuid.UUID) error
	// RecordUnmatched upserts a miss into the review queue.
	RecordUnmatched(ctx context.Context, sourceID uuid.UUID, rawName string) error
	// PublishOffers atomically rebuilds the source's live gold offers, stamped with city.
	PublishOffers(ctx context.Context, sourceID uuid.UUID, city *string, offers []Offer) error
}
