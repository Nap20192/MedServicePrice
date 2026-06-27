package usecase

import (
	"context"
	"fmt"

	"medprice/internal/api/domain"
)

type priceUC struct {
	priceRepo domain.PriceRepository
}

func NewPriceUseCase(pr domain.PriceRepository) domain.PriceUseCase {
	return &priceUC{
		priceRepo: pr,
	}
}

func (uc *priceUC) Search(ctx context.Context, query string, city string) ([]domain.AggregatedPrice, error) {
	prices, err := uc.priceRepo.SearchPrices(ctx, query, city)
	if err != nil {
		return nil, fmt.Errorf("failed to search prices: %w", err)
	}
	return prices, nil
}
