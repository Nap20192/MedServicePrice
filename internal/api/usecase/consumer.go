package usecase

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

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

// AdapterFetchPayload matches the structure in queue/messages.md
type AdapterFetchPayload struct {
	SchemaVersion int       `json:"schema_version"`
	MsgID         string    `json:"msg_id"`
	AdapterID     string    `json:"adapter_id"`
	URL           string    `json:"url"`
	Trigger       string    `json:"trigger"`
	RequestedAt   time.Time `json:"requested_at"`
}

func (uc *consumerUC) ProcessAdapterFetch(ctx context.Context, payload []byte) error {
	var data AdapterFetchPayload
	if err := json.Unmarshal(payload, &data); err != nil {
		return fmt.Errorf("failed to unmarshal adapter.fetch payload: %w", err)
	}

	fmt.Printf("[Consumer] Processing adapter.fetch event: adapter=%s, url=%s\n", data.AdapterID, data.URL)

	// Check if source exists by URL, if not we could create a dummy clinic and source,
	// but for this simplified consumer we just check and log.
	source, err := uc.sourceRepo.GetSourceByURL(ctx, data.URL)
	if err != nil {
		return fmt.Errorf("error finding source: %w", err)
	}

	if source == nil {
		fmt.Printf("[Consumer] Source not found for URL: %s, a new one should be created via adapter.create\n", data.URL)
		return nil
	}

	fmt.Printf("[Consumer] Found source ID=%s for adapter fetch\n", source.ID.String())

	// Here you would trigger actual worker tasks or save the scrape job to the DB.
	return nil
}
