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

// UnmappedRow is a parsed_services row awaiting a catalog binding.
type UnmappedRow struct {
	ID   uuid.UUID `db:"id"`
	Name string    `db:"service_name_raw"`
}

// Repository is the persistence port the usecase depends on.
type Repository interface {
	// LoadUnmapped returns active rows of a source with service_catalog_id IS NULL.
	LoadUnmapped(ctx context.Context, sourceID uuid.UUID) ([]UnmappedRow, error)
	// MatchCatalog returns the catalog id for a raw name, or uuid.Nil if no match.
	MatchCatalog(ctx context.Context, rawName string) (uuid.UUID, error)
	// BindCatalog sets parsed_services.service_catalog_id for one row.
	BindCatalog(ctx context.Context, rowID, catalogID uuid.UUID) error
}
