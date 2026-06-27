package domain

import (
	"context"

	"github.com/google/uuid"
)

type SourceRepository interface {
	CreateSource(ctx context.Context, source *Source) error
	GetSourceByURL(ctx context.Context, url string) (*Source, error)
}

type ClinicRepository interface {
	CreateClinic(ctx context.Context, clinic *Clinic) error
	GetClinicByID(ctx context.Context, id uuid.UUID) (*Clinic, error)
	// We might need to find clinic by dedup key in real app, but for now name/city is a proxy
	FindClinicByNameAndCity(ctx context.Context, name, city string) (*Clinic, error)
}

type PriceRepository interface {
	SearchPrices(ctx context.Context, query string, city string) ([]AggregatedPrice, error)
	UpsertParsedService(ctx context.Context, ps *ParsedService) error
}
