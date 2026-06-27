package domain

import (
	"context"

	"github.com/google/uuid"
)

type CreateSourceInput struct {
	URL      string
	FetchNow bool
}

type CreateClinicInput struct {
	Name         string
	City         string
	Address      string
	Phone        string
	WorkingHours string
	SourceIDs    []uuid.UUID
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
	CreateClinic(ctx context.Context, input CreateClinicInput) (*Clinic, error)
	ListClinics(ctx context.Context) ([]Clinic, error)
	TriggerFetch(ctx context.Context, sourceID uuid.UUID) (*SourceCommandResult, error)
	TriggerFetchAll(ctx context.Context, trigger string) (int, error)
}

type SchedulerUseCase interface {
	GetSettings(ctx context.Context) (*SchedulerSettings, error)
	UpdateFetchInterval(ctx context.Context, hours int) (*SchedulerSettings, error)
	Start(ctx context.Context)
}

type PriceUseCase interface {
	Search(ctx context.Context, query string, city string) ([]AggregatedPrice, error)
}

type ConsumerUseCase interface {
	ProcessAdapterFetch(ctx context.Context, payload []byte) error
}
