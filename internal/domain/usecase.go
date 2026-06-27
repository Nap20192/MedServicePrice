package domain

import (
	"context"
)

type SourceUseCase interface {
	AddSource(ctx context.Context, url string, clinicName string) (*Source, error)
}

type PriceUseCase interface {
	Search(ctx context.Context, query string, city string) ([]AggregatedPrice, error)
}

type ConsumerUseCase interface {
	ProcessAdapterFetch(ctx context.Context, payload []byte) error
}
