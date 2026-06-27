package usecase

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"medprice/internal/domain"
)

type sourceUC struct {
	sourceRepo domain.SourceRepository
	clinicRepo domain.ClinicRepository
	publisher  domain.EventPublisher
}

func NewSourceUseCase(sr domain.SourceRepository, cr domain.ClinicRepository, pub domain.EventPublisher) domain.SourceUseCase {
	return &sourceUC{
		sourceRepo: sr,
		clinicRepo: cr,
		publisher:  pub,
	}
}

func (uc *sourceUC) AddSource(ctx context.Context, url string, clinicName string) (*domain.Source, error) {
	// Check if source already exists
	existing, err := uc.sourceRepo.GetSourceByURL(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("failed to check existing source: %w", err)
	}
	if existing != nil {
		return existing, nil
	}

	// For simplicity, create a dummy clinic if not passed, or use a default one.
	// Normally, we'd look up the clinic or create a new one.
	if clinicName == "" {
		clinicName = "Unknown Clinic"
	}

	clinicID := uuid.New()
	newClinic := &domain.Clinic{
		ID:   clinicID,
		Name: clinicName,
	}

	if err := uc.clinicRepo.CreateClinic(ctx, newClinic); err != nil {
		return nil, fmt.Errorf("failed to create clinic: %w", err)
	}

	newSource := &domain.Source{
		ID:       uuid.New(),
		ClinicID: clinicID,
		URL:      url,
	}

	if err := uc.sourceRepo.CreateSource(ctx, newSource); err != nil {
		return nil, fmt.Errorf("failed to create source: %w", err)
	}

	// Publish adapter.create event
	event := map[string]interface{}{
		"schema_version": 1,
		"msg_id":         uuid.New().String(),
		"adapter_id":     newSource.ID.String(),
		"name":           clinicName,
		"base_url":       url,
		"config": map[string]interface{}{
			"rate_limit_ms": 2000,
			"max_depth":     3,
		},
	}

	if err := uc.publisher.PublishEvents(ctx, []any{event}); err != nil {
		// Log error but don't fail the request
		fmt.Printf("failed to publish adapter.create event: %v\n", err)
	}

	return newSource, nil
}
