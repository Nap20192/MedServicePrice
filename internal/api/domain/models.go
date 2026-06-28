package domain

import (
	"time"

	"github.com/google/uuid"
)

type Clinic struct {
	ID            uuid.UUID  `json:"id" db:"id"`
	Name          string     `json:"name" db:"name"`
	SourceID      *uuid.UUID `json:"source_id,omitempty" db:"source_id"`
	City          *string    `json:"city,omitempty" db:"city"`
	Address       *string    `json:"address,omitempty" db:"address"`
	Phone         *string    `json:"phone,omitempty" db:"phone"`
	WorkingHours  *string    `json:"working_hours,omitempty" db:"working_hours"`
	URL           *string    `json:"url,omitempty" db:"url"`
	GooglePlaceID *string    `json:"google_place_id,omitempty" db:"google_place_id"`
	Lat           *float64   `json:"lat,omitempty" db:"lat"`
	Lng           *float64   `json:"lng,omitempty" db:"lng"`
	Rating        *float64   `json:"rating,omitempty" db:"rating"`
	ReviewsCount  *int       `json:"reviews_count,omitempty" db:"reviews_count"`
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
	ClinicURL    *string    `json:"clinic_url,omitempty" db:"clinic_url"`
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

type GooglePlaceClinicCandidate struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	City         string   `json:"city,omitempty"`
	Address      string   `json:"address,omitempty"`
	Phone        string   `json:"phone,omitempty"`
	WorkingHours string   `json:"working_hours,omitempty"`
	URL          string   `json:"url,omitempty"`
	Lat          *float64 `json:"lat,omitempty"`
	Lng          *float64 `json:"lng,omitempty"`
	Rating       *float64 `json:"rating,omitempty"`
	ReviewsCount *int     `json:"reviews_count,omitempty"`
	Raw          []byte   `json:"-"`
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
	Phone           *string   `db:"phone" json:"phone,omitempty"`
	WorkingHours    *string   `db:"working_hours" json:"working_hours,omitempty"`
	Lat             *float64  `db:"lat" json:"lat,omitempty"`
	Lng             *float64  `db:"lng" json:"lng,omitempty"`
	Rating          *float64  `db:"rating" json:"rating,omitempty"`
	ReviewsCount    *int      `db:"reviews_count" json:"reviews_count,omitempty"`
	ServiceNameNorm string    `db:"service_name_norm" json:"service_name_norm"`
	Category        string    `db:"category" json:"category"`
	PriceKZT        float64   `db:"price_kzt" json:"price_kzt"`
	Currency        string    `db:"currency" json:"currency"`
	DurationDays    *int      `db:"duration_days" json:"duration_days,omitempty"`
	ParsedAt        time.Time `db:"parsed_at" json:"parsed_at"`
}

// PriceSearch holds every search filter so pagination is computed server-side over
// the full filtered set (not just one page).
type PriceSearch struct {
	Query     string
	ClinicID  string
	City      string
	Category  string
	Sort      string
	MinPrice  float64
	MaxPrice  float64 // 0 = no upper bound
	RatingMin float64
	Limit     int
	Offset    int
}

// SearchResult is a paginated, de-duplicated price search response.
type SearchResult struct {
	Items  []AggregatedPrice `json:"items"`
	Total  int               `json:"total"`
	Limit  int               `json:"limit"`
	Offset int               `json:"offset"`
}
