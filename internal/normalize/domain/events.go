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

type SourceInfo struct {
	ID         uuid.UUID `db:"id"`
	URL        string    `db:"url"`
	City       *string   `db:"city"`
	ClinicName *string   `db:"clinic_name"`
}

// RawRow is an active parsed_services row (the raw layer) for one source.
type RawRow struct {
	ID           uuid.UUID `db:"id"`
	Name         string    `db:"service_name_raw"`
	PriceKZT     float64   `db:"price_kzt"`
	Currency     string    `db:"currency"`
	DurationDays *int      `db:"duration_days"`
	Category     *string   `db:"category"`
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
	MatchLLM     = "llm"
	MatchNew     = "new" // no existing entry — created a new canonical catalog row
	MatchNone    = "none"
)

// CatalogEntry is one справочник row, used to prompt the LLM matcher.
type CatalogEntry struct {
	ID       uuid.UUID `db:"id"`
	Name     string    `db:"name_norm"`
	Category string    `db:"category"`
}

// LLMMatcher suggests a catalog id for a raw name that deterministic matching
// missed. Returns uuid.Nil if no entry fits. Best-effort: errors must not fail
// the whole batch (caller falls back to the unmatched queue).
type LLMMatcher interface {
	Suggest(ctx context.Context, rawName string, catalog []CatalogEntry) (uuid.UUID, float64, error)
}

// Repository is the persistence port the usecase depends on. The normalize
// service is the only reader of parsed_services (raw); it publishes into
// service_offers (gold), which the API reads.
type Repository interface {
	// SourceInfo returns source metadata for logs and offer city. A missing source
	// means nothing to normalize — caller skips.
	SourceInfo(ctx context.Context, sourceID uuid.UUID) (*SourceInfo, bool, error)
	// PendingSourceIDs returns sources with active raw rows not yet seen by normalize.
	PendingSourceIDs(ctx context.Context, limit int) ([]uuid.UUID, error)
	// LoadActiveRows returns the source's active raw rows.
	LoadActiveRows(ctx context.Context, sourceID uuid.UUID) ([]RawRow, error)
	// Match resolves a raw name to a catalog id via alias -> exact -> fuzzy.
	// Returns uuid.Nil + MatchNone on a miss.
	Match(ctx context.Context, rawName string) (uuid.UUID, string, error)
	// BindParsed links a raw row to its catalog id (traceability in the raw layer).
	BindParsed(ctx context.Context, rowID, catalogID uuid.UUID) error
	// MarkNormalized stamps normalized_at on every active row of a source, so the
	// raw layer records that normalize has seen them (matched or not).
	MarkNormalized(ctx context.Context, sourceID uuid.UUID) error
	// RecordUnmatched upserts a miss into the review queue.
	RecordUnmatched(ctx context.Context, sourceID uuid.UUID, rawName string) error
	// PublishOffers atomically rebuilds the source's live gold offers, stamped with city.
	PublishOffers(ctx context.Context, sourceID uuid.UUID, city *string, offers []Offer) error
	// ListCatalog returns all catalog entries (for the LLM prompt).
	ListCatalog(ctx context.Context) ([]CatalogEntry, error)
	// AddAlias records a learned synonym so the next fetch matches without the LLM.
	AddAlias(ctx context.Context, catalogID uuid.UUID, aliasText, origin string) error
	// EnsureCatalogEntry returns the catalog id for a service name, creating a new
	// canonical entry when none exists. Lets the catalog grow to cover real data
	// instead of squashing thousands of services into a tiny seed catalog.
	EnsureCatalogEntry(ctx context.Context, nameNorm, category string) (uuid.UUID, error)
}
