package domain

import (
	"time"

	"github.com/google/uuid"
)

type Clinic struct {
	ID           uuid.UUID `json:"id" db:"id"`
	Name         string    `json:"name" db:"name"`
	City         *string   `json:"city,omitempty" db:"city"`
	Address      *string   `json:"address,omitempty" db:"address"`
	Phone        *string   `json:"phone,omitempty" db:"phone"`
	WorkingHours *string   `json:"working_hours,omitempty" db:"working_hours"`
}

type Source struct {
	ID       uuid.UUID  `json:"id" db:"id"`
	ClinicID *uuid.UUID `json:"clinic_id,omitempty" db:"clinic_id"`
	URL      string     `json:"url" db:"url"`
}

type SourceDetails struct {
	ID           uuid.UUID  `json:"id" db:"id"`
	ClinicID     *uuid.UUID `json:"clinic_id,omitempty" db:"clinic_id"`
	URL          string     `json:"url" db:"url"`
	ClinicName   *string    `json:"clinic_name,omitempty" db:"clinic_name"`
	City         *string    `json:"city,omitempty" db:"city"`
	Address      *string    `json:"address,omitempty" db:"address"`
	Phone        *string    `json:"phone,omitempty" db:"phone"`
	WorkingHours *string    `json:"working_hours,omitempty" db:"working_hours"`
	AdapterID    *string    `json:"adapter_id,omitempty" db:"adapter_id"`
}

type Adapter struct {
	AdapterID string    `json:"adapter_id" db:"adapter_id"`
	Domain    string    `json:"domain" db:"domain"`
	SourceID  uuid.UUID `json:"source_id" db:"source_id"`
	BaseURL   string    `json:"base_url" db:"base_url"`
}

type SchedulerSettings struct {
	FetchIntervalHours int       `json:"fetch_interval_hours" db:"fetch_interval_hours"`
	UpdatedAt          time.Time `json:"updated_at" db:"updated_at"`
}

type ServiceCategory string

const (
	CategoryLab       ServiceCategory = "лаборатория"
	CategoryDoctor    ServiceCategory = "прием врача"
	CategoryDiagnosis ServiceCategory = "диагностика"
	CategoryProcedure ServiceCategory = "процедура"
)

type ServiceCatalog struct {
	ID       uuid.UUID       `json:"id" db:"id"`
	NameNorm string          `json:"name_norm" db:"name_norm"`
	Category ServiceCategory `json:"category" db:"category"`
}

type Currency string

const (
	CurrencyKZT Currency = "KZT"
	CurrencyUSD Currency = "USD"
)

type ParsedService struct {
	ID               uuid.UUID  `json:"id" db:"id"`
	SourceID         uuid.UUID  `json:"source_id" db:"source_id"`
	ServiceCatalogID *uuid.UUID `json:"service_catalog_id,omitempty" db:"service_catalog_id"`
	ServiceNameRaw   string     `json:"service_name_raw" db:"service_name_raw"`
	PriceKZT         float64    `json:"price_kzt" db:"price_kzt"`
	Currency         Currency   `json:"currency" db:"currency"`
	DurationDays     *int       `json:"duration_days,omitempty" db:"duration_days"`
	ParsedAt         time.Time  `json:"parsed_at" db:"parsed_at"`
	IsActive         bool       `json:"is_active" db:"is_active"`
}

// AggregatedPrice represents a join between ParsedService and Clinic for search results
type AggregatedPrice struct {
	PriceID        uuid.UUID `db:"price_id" json:"price_id"`
	ClinicID       uuid.UUID `db:"clinic_id" json:"clinic_id"`
	ClinicName     string    `db:"clinic_name" json:"clinic_name"`
	City           *string   `db:"city" json:"city,omitempty"`
	Address        *string   `db:"address" json:"address,omitempty"`
	ServiceNameRaw string    `db:"service_name_raw" json:"service_name_raw"`
	PriceKZT       float64   `db:"price_kzt" json:"price_kzt"`
	ParsedAt       time.Time `db:"parsed_at" json:"parsed_at"`
}
