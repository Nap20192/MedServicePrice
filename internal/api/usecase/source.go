package usecase

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"medprice/internal/api/domain"
)

type sourceUC struct {
	sourceRepo  domain.SourceRepository
	clinicRepo  domain.ClinicRepository
	adapterRepo domain.AdapterRepository
	publisher   domain.EventPublisher
}

func NewSourceUseCase(sr domain.SourceRepository, cr domain.ClinicRepository, ar domain.AdapterRepository, pub domain.EventPublisher) domain.SourceUseCase {
	return &sourceUC{
		sourceRepo:  sr,
		clinicRepo:  cr,
		adapterRepo: ar,
		publisher:   pub,
	}
}

func (uc *sourceUC) AddSource(ctx context.Context, input domain.CreateSourceInput) (*domain.SourceCommandResult, error) {
	// Check if source already exists
	existing, err := uc.sourceRepo.GetSourceByURL(ctx, input.URL)
	if err != nil {
		return nil, fmt.Errorf("failed to check existing source: %w", err)
	}
	if existing != nil {
		result, err := uc.buildResult(ctx, existing.ID)
		if err != nil {
			return nil, err
		}
		if input.FetchNow {
			return uc.TriggerFetch(ctx, existing.ID)
		}
		return result, nil
	}

	newSource := &domain.Source{
		ID:  uuid.New(),
		URL: input.URL,
	}

	if err := uc.sourceRepo.CreateSource(ctx, newSource); err != nil {
		return nil, fmt.Errorf("failed to create source: %w", err)
	}

	details, err := uc.sourceRepo.GetSourceByID(ctx, newSource.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to reload source: %w", err)
	}
	if details == nil {
		return nil, fmt.Errorf("source %s not found after create", newSource.ID)
	}

	result := &domain.SourceCommandResult{
		Source:         details,
		AdapterQueued:  true,
		FetchQueued:    false,
		AdapterExisted: false,
	}
	if input.FetchNow {
		if err := uc.publishAdapterFetch(ctx, details, "manual"); err != nil {
			return nil, err
		}
		result.FetchQueued = true
		return result, nil
	}

	if err := uc.publishAdapterCreate(ctx, details); err != nil {
		return nil, err
	}

	return result, nil
}

func (uc *sourceUC) ListSources(ctx context.Context) ([]domain.SourceDetails, error) {
	return uc.sourceRepo.ListSources(ctx)
}

func (uc *sourceUC) CreateClinic(ctx context.Context, input domain.CreateClinicInput) (*domain.Clinic, error) {
	if input.Name == "" {
		return nil, fmt.Errorf("clinic name is required")
	}
	clinic := &domain.Clinic{
		ID:           uuid.New(),
		Name:         input.Name,
		City:         optionalString(input.City),
		Address:      optionalString(input.Address),
		Phone:        optionalString(input.Phone),
		WorkingHours: optionalString(input.WorkingHours),
	}
	if err := uc.clinicRepo.CreateClinic(ctx, clinic); err != nil {
		return nil, fmt.Errorf("failed to create clinic: %w", err)
	}
	if err := uc.sourceRepo.AttachSourcesToClinic(ctx, clinic.ID, input.SourceIDs); err != nil {
		return nil, fmt.Errorf("failed to attach sources to clinic: %w", err)
	}
	return clinic, nil
}

func (uc *sourceUC) ListClinics(ctx context.Context) ([]domain.Clinic, error) {
	return uc.clinicRepo.ListClinics(ctx)
}

func (uc *sourceUC) TriggerFetch(ctx context.Context, sourceID uuid.UUID) (*domain.SourceCommandResult, error) {
	details, err := uc.sourceRepo.GetSourceByID(ctx, sourceID)
	if err != nil {
		return nil, fmt.Errorf("failed to load source: %w", err)
	}
	if details == nil {
		return nil, fmt.Errorf("source %s not found", sourceID)
	}

	adapterID := details.ID.String()
	adapter, err := uc.adapterRepo.GetAdapterByID(ctx, adapterID)
	if err != nil {
		return nil, fmt.Errorf("failed to load adapter: %w", err)
	}

	adapterQueued := false
	if adapter == nil {
		adapterQueued = true
	}

	if err := uc.publishAdapterFetch(ctx, details, "manual"); err != nil {
		return nil, err
	}

	return &domain.SourceCommandResult{
		Source:         details,
		AdapterQueued:  adapterQueued,
		FetchQueued:    true,
		AdapterExisted: adapter != nil,
	}, nil
}

func (uc *sourceUC) TriggerFetchAll(ctx context.Context, trigger string) (int, error) {
	sources, err := uc.sourceRepo.ListFetchableSources(ctx)
	if err != nil {
		return 0, fmt.Errorf("failed to list sources: %w", err)
	}
	queued := 0
	for i := range sources {
		source := sources[i]
		if err := uc.publishAdapterFetch(ctx, &source, trigger); err != nil {
			return queued, err
		}
		queued++
	}
	return queued, nil
}

func (uc *sourceUC) buildResult(ctx context.Context, sourceID uuid.UUID) (*domain.SourceCommandResult, error) {
	details, err := uc.sourceRepo.GetSourceByID(ctx, sourceID)
	if err != nil {
		return nil, fmt.Errorf("failed to load source: %w", err)
	}
	if details == nil {
		return nil, fmt.Errorf("source %s not found", sourceID)
	}
	return &domain.SourceCommandResult{Source: details}, nil
}

func (uc *sourceUC) publishAdapterCreate(ctx context.Context, source *domain.SourceDetails) error {
	event := uc.adapterEventBase(source)
	event["created_at"] = time.Now().UTC().Format(time.RFC3339)
	if err := uc.publisher.PublishEvent(ctx, "adapter.create", event); err != nil {
		return fmt.Errorf("failed to publish adapter.create event: %w", err)
	}
	return nil
}

func (uc *sourceUC) publishAdapterFetch(ctx context.Context, source *domain.SourceDetails, trigger string) error {
	event := uc.adapterEventBase(source)
	event["url"] = source.URL
	event["trigger"] = trigger
	event["requested_at"] = time.Now().UTC().Format(time.RFC3339)
	if err := uc.publisher.PublishEvent(ctx, "adapter.fetch", event); err != nil {
		return fmt.Errorf("failed to publish adapter.fetch event: %w", err)
	}
	return nil
}

func (uc *sourceUC) adapterEventBase(source *domain.SourceDetails) map[string]any {
	name := "source"
	if source.ClinicName != nil && *source.ClinicName != "" {
		name = *source.ClinicName
	}
	return map[string]any{
		"schema_version": 1,
		"msg_id":         uuid.New().String(),
		"adapter_id":     source.ID.String(),
		"source_id":      source.ID.String(),
		"name":           name,
		"base_url":       source.URL,
		"config": map[string]any{
			"rate_limit_ms":             500,
			"max_depth":                 7,
			"max_pages":                 3000,
			"agent_batch_size":          12,
			"agent_links_per_page":      90,
			"fetch_concurrency":         24,
			"page_timeout_ms":           60000,
			"adapter_compact":           false,
			"llm_schema_gen":            true,
			"schema_gen_max_per_domain": 8,
		},
	}
}

func optionalString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
