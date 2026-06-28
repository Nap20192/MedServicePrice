package usecase

import (
	"context"
	"fmt"
	"strings"

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

func (uc *priceUC) Search(ctx context.Context, p domain.PriceSearch) (*domain.SearchResult, error) {
	if p.Limit <= 0 || p.Limit > 100 {
		p.Limit = 20
	}
	if p.Offset < 0 {
		p.Offset = 0
	}
	// The catalog enum uses 'прием врача' (no ё); the UI sends 'приём врача'. Normalize
	// ё→е so the category filter actually matches.
	p.Category = strings.ReplaceAll(p.Category, "ё", "е")

	items, total, err := uc.priceRepo.SearchPrices(ctx, p)
	if err != nil {
		return nil, fmt.Errorf("failed to search prices: %w", err)
	}
	return &domain.SearchResult{Items: items, Total: total, Limit: p.Limit, Offset: p.Offset}, nil
}
