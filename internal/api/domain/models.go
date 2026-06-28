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

// AggregatedPrice is a published, normalized price for search results. It is built
// from service_offers JOIN services_catalog JOIN clinics — never from raw
// parsed_services, so the API never exposes raw service names.
type AggregatedPrice struct {
	PriceID         uuid.UUID `db:"price_id" json:"price_id"`
	ClinicID        uuid.UUID `db:"clinic_id" json:"clinic_id"`
	ClinicName      string    `db:"clinic_name" json:"clinic_name"`
	ClinicURL       *string   `db:"clinic_url" json:"clinic_url,omitempty"`
	City            *string   `db:"city" json:"city,omitempty"`
	Address         *string   `db:"address" json:"address,omitempty"`
	ServiceNameNorm string    `db:"service_name_norm" json:"service_name_norm"`
	Category        string    `db:"category" json:"category"`
	PriceKZT        float64   `db:"price_kzt" json:"price_kzt"`
	ParsedAt        time.Time `db:"parsed_at" json:"parsed_at"`
}
