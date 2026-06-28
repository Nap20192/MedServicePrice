// Package domain holds the normalize service's types and ports (interfaces).
package domain

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

var ErrLLMDisabled = errors.New("llm disabled")

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
	ID           uuid.UUID  `db:"id"`
	CatalogID    *uuid.UUID `db:"service_catalog_id"`
	Name         string     `db:"service_name_raw"`
	PriceKZT     float64    `db:"price_kzt"`
	Currency     string     `db:"currency"`
	DurationDays *int       `db:"duration_days"`
	Category     *string    `db:"category"`
	ParsedAt     time.Time  `db:"parsed_at"`
}

// BatchMatch is one result of MatchBatch: a raw name and its deterministic match
// (CatalogID nil = no match).
type BatchMatch struct {
	Name      string     `db:"name"`
	CatalogID *uuid.UUID `db:"id"`
	Method    *string    `db:"method"`
}

// BindPair links a raw row to a catalog id for bulk binding.
type BindPair struct {
	RowID     uuid.UUID
	CatalogID uuid.UUID
}

// Offer is a normalized, catalog-bound price ready to publish to the gold table.
type Offer struct {
	CatalogID    uuid.UUID
	NameRaw      string // raw name of the (cheapest) source row behind this offer
	PriceKZT     float64
	Currency     string
	DurationDays *int
	ParsedAt     time.Time
}

// Match methods, for logging/telemetry.
const (
	MatchBound   = "bound"
	MatchAlias   = "alias"
	MatchCatalog = "catalog"
	MatchFuzzy   = "fuzzy"
	MatchLLM     = "llm"
	MatchNew     = "new" // no existing entry — created a new canonical catalog row
	MatchNone    = "none"
)

// CatalogEntry is one справочник row, used to prompt the LLM curator. Description
// is the AI's note on what the service is, to disambiguate close names.
type CatalogEntry struct {
	ID          uuid.UUID `db:"id"`
	Name        string    `db:"name_norm"`
	Category    string    `db:"category"`
	Description *string   `db:"description"`
}

// CurateDecision is the LLM's call on a raw service that deterministic matching
// missed: either it's the same as one of the offered catalog candidates (Match,
// Index 1-based), or it's a genuinely new service to add (CanonicalName + Category).
type CurateDecision struct {
	Match         bool    `json:"match"`
	Index         int     `json:"index"`          // 1-based into candidates, when Match
	CanonicalName string  `json:"canonical_name"` // clean name for the new entry, when !Match
	Category      string  `json:"category"`       // one of the 4 service_category values
	Description   string  `json:"description"`    // short note on what the service is, when !Match
	Confidence    float64 `json:"confidence"`
}

// LLMMatcher lets an LLM curate the catalog: given a raw service name and the
// closest existing catalog candidates, decide whether it maps to one of them or
// should become a new canonical entry. Best-effort: errors must not fail the batch.
type LLMMatcher interface {
	Curate(ctx context.Context, rawName, categoryHint string, candidates []CatalogEntry) (CurateDecision, error)
	Disabled() bool
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
	// MatchBatch resolves many raw names in a single round-trip (deterministic cascade
	// only). A name with no match comes back with a nil CatalogID.
	MatchBatch(ctx context.Context, names []string) ([]BatchMatch, error)
	// BindParsed links a raw row to its catalog id (traceability in the raw layer).
	BindParsed(ctx context.Context, rowID, catalogID uuid.UUID) error
	// BulkBindParsed binds many rows in one statement (replaces N per-row updates).
	BulkBindParsed(ctx context.Context, pairs []BindPair) error
	// MarkNormalized stamps normalized_at on every active row of a source, so the
	// raw layer records that normalize has seen them (matched or not).
	MarkNormalized(ctx context.Context, sourceID uuid.UUID) error
	// RecordUnmatched upserts a miss into the review queue.
	RecordUnmatched(ctx context.Context, sourceID uuid.UUID, rawName string) error
	// PublishOffers atomically rebuilds the source's live gold offers, stamped with city.
	PublishOffers(ctx context.Context, sourceID uuid.UUID, city *string, offers []Offer) error
	// IsRetryable reports transient database errors such as deadlocks/serialization failures.
	IsRetryable(err error) bool
	// ListCatalog returns all catalog entries (for the LLM prompt).
	ListCatalog(ctx context.Context) ([]CatalogEntry, error)
	// AddAlias records a learned synonym so the next fetch matches without the LLM.
	AddAlias(ctx context.Context, catalogID uuid.UUID, aliasText, origin string) error
	// EnsureCatalogEntry returns the catalog id for a service name, creating a new
	// canonical entry when none exists. Lets the catalog grow to cover real data
	// instead of squashing thousands of services into a tiny seed catalog.
	EnsureCatalogEntry(ctx context.Context, nameNorm, category, description string) (uuid.UUID, error)
	// TopCatalogCandidates returns the closest existing catalog entries (pg_trgm),
	// for the LLM curator to anchor its match-or-create decision on.
	TopCatalogCandidates(ctx context.Context, name string, k int) ([]CatalogEntry, error)
}
