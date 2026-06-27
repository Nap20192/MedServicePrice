package usecase

import (
	"context"
	"fmt"
	"time"

	"medprice/internal/api/domain"
)

type fetchAllUseCase interface {
	TriggerFetchAll(ctx context.Context, trigger string) (int, error)
}

type fetchScheduler struct {
	repo     domain.SchedulerRepository
	sources  fetchAllUseCase
	interval chan struct{}
}

func NewFetchScheduler(repo domain.SchedulerRepository, sources fetchAllUseCase) domain.SchedulerUseCase {
	return &fetchScheduler{
		repo:     repo,
		sources:  sources,
		interval: make(chan struct{}, 1),
	}
}

func (s *fetchScheduler) GetSettings(ctx context.Context) (*domain.SchedulerSettings, error) {
	return s.repo.GetSettings(ctx)
}

func (s *fetchScheduler) UpdateFetchInterval(ctx context.Context, hours int) (*domain.SchedulerSettings, error) {
	if hours <= 0 {
		return nil, fmt.Errorf("fetch_interval_hours must be positive")
	}
	settings, err := s.repo.UpdateFetchInterval(ctx, hours)
	if err != nil {
		return nil, err
	}
	select {
	case s.interval <- struct{}{}:
	default:
	}
	return settings, nil
}

func (s *fetchScheduler) Start(ctx context.Context) {
	go s.loop(ctx)
}

func (s *fetchScheduler) loop(ctx context.Context) {
	for {
		settings, err := s.repo.GetSettings(ctx)
		hours := 24
		if err == nil && settings != nil && settings.FetchIntervalHours > 0 {
			hours = settings.FetchIntervalHours
		}

		timer := time.NewTimer(time.Duration(hours) * time.Hour)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-s.interval:
			timer.Stop()
			continue
		case <-timer.C:
			_, _ = s.sources.TriggerFetchAll(ctx, "schedule")
		}
	}
}
