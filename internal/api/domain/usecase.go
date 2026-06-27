package domain

import (
	"context"

	"github.com/google/uuid"
)

type CreateSourceInput struct {
	URL          string
	ClinicName   string
	City         string
	Address      string
	Phone        string
	WorkingHours string
	FetchNow     bool
}

type SourceCommandResult struct {
	Source         *SourceDetails `json:"source"`
	AdapterQueued  bool           `json:"adapter_queued"`
	FetchQueued    bool           `json:"fetch_queued"`
	AdapterExisted bool           `json:"adapter_existed"`
}

type SourceUseCase interface {
	AddSource(ctx context.Context, input CreateSourceInput) (*SourceCommandResult, error)
	ListSources(ctx context.Context) ([]SourceDetails, error)
	TriggerFetch(ctx context.Context, sourceID uuid.UUID) (*SourceCommandResult, error)
}

type PriceUseCase interface {
	Search(ctx context.Context, query string, city string) ([]AggregatedPrice, error)
}

type ConsumerUseCase interface {
	ProcessAdapterFetch(ctx context.Context, payload []byte) error
}
