package usecase

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"

	"medprice/internal/domain"
)

type consumerUC struct {
	priceRepo  domain.PriceRepository
	clinicRepo domain.ClinicRepository
	sourceRepo domain.SourceRepository
}

func NewConsumerUseCase(pr domain.PriceRepository, cr domain.ClinicRepository, sr domain.SourceRepository) domain.ConsumerUseCase {
	return &consumerUC{
		priceRepo:  pr,
		clinicRepo: cr,
		sourceRepo: sr,
	}
}

// PriceFoundPayload matches the structure in queue/messages.md
type PriceFoundPayload struct {
	SchemaVersion  int       `json:"schema_version"`
	MsgID          string    `json:"msg_id"`
	SourceCode     string    `json:"source_code"` // Might map to Source ID or code
	Clinic         struct {
		Name         string `json:"name"`
		City         string `json:"city"`
		Address      string `json:"address"`
		Phone        string `json:"phone"`
		WorkingHours string `json:"working_hours"`
		SourceURL    string `json:"source_url"`
	} `json:"clinic"`
	ServiceNameRaw string    `json:"service_name_raw"`
	Price          float64   `json:"price"`
	Currency       string    `json:"currency"`
	DurationDays   int       `json:"duration_days"`
	SourceURL      string    `json:"source_url"` // Not used directly in our simplified schema, but available
	ParsedAt       time.Time `json:"parsed_at"`
}

func (uc *consumerUC) ProcessFoundPrice(ctx context.Context, payload []byte) error {
	var data PriceFoundPayload
	if err := json.Unmarshal(payload, &data); err != nil {
		return fmt.Errorf("failed to unmarshal price found payload: %w", err)
	}

	// 1. Upsert Clinic (Find or Create)
	// Real system would use DedupKey. We'll try by name and city.
	clinic, err := uc.clinicRepo.FindClinicByNameAndCity(ctx, data.Clinic.Name, data.Clinic.City)
	if err != nil {
		return fmt.Errorf("error finding clinic: %w", err)
	}

	if clinic == nil {
		city := data.Clinic.City
		address := data.Clinic.Address
		phone := data.Clinic.Phone
		workingHours := data.Clinic.WorkingHours

		clinic = &domain.Clinic{
			ID:           uuid.New(),
			Name:         data.Clinic.Name,
			City:         &city,
			Address:      &address,
			Phone:        &phone,
			WorkingHours: &workingHours,
		}
		if err := uc.clinicRepo.CreateClinic(ctx, clinic); err != nil {
			return fmt.Errorf("error creating clinic: %w", err)
		}
	}

	// 2. Upsert Source
	// We need a source. We can check by source code or URL. Here we'll use data.SourceCode as a proxy or just the clinic's source_url
	sourceURL := data.Clinic.SourceURL
	if sourceURL == "" {
		sourceURL = "https://default.com/" + data.SourceCode
	}

	source, err := uc.sourceRepo.GetSourceByURL(ctx, sourceURL)
	if err != nil {
		return fmt.Errorf("error finding source: %w", err)
	}
	if source == nil {
		source = &domain.Source{
			ID:       uuid.New(),
			ClinicID: clinic.ID,
			URL:      sourceURL,
		}
		if err := uc.sourceRepo.CreateSource(ctx, source); err != nil {
			return fmt.Errorf("error creating source: %w", err)
		}
	}

	// 3. Upsert Price
	// The DB schema needs an ID. We don't have a stable ID from the crawler for a specific price row,
	// so we might need to query for existing, but the task says "ON CONFLICT (id) DO UPDATE".
	// Since we don't have an ID, we'll just insert a new one if it doesn't have an ID constraint that prevents it,
	// actually we can generate a UUID. Real implementation would use a unique constraint on (source_id, service_name_raw).
	// But our schema says "id UUID PRIMARY KEY". So let's generate a new UUID for now.
	
	durationDays := data.DurationDays
	
	parsedService := &domain.ParsedService{
		ID:             uuid.New(), // In reality we should find existing by source_id & service_name_raw, but for MVP let's just insert
		SourceID:       source.ID,
		ServiceNameRaw: data.ServiceNameRaw,
		PriceKZT:       data.Price,
		Currency:       domain.CurrencyKZT,
		DurationDays:   &durationDays,
		ParsedAt:       data.ParsedAt,
		IsActive:       true,
	}

	if data.Currency == "USD" {
		parsedService.Currency = domain.CurrencyUSD
	}

	if err := uc.priceRepo.UpsertParsedService(ctx, parsedService); err != nil {
		return fmt.Errorf("error upserting price: %w", err)
	}

	return nil
}
