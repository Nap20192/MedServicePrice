package postgres

import (
	"context"
	"database/sql"
	"errors"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"

	"medprice/internal/api/domain"
	"medprice/internal/platform/database"
)

type sourceRepo struct {
	db *sqlx.DB
}

func NewSourceRepository(db *database.DB) domain.SourceRepository {
	return &sourceRepo{db: db.DB}
}

func (r *sourceRepo) CreateSource(ctx context.Context, source *domain.Source) error {
	query := `INSERT INTO sources (id, clinic_id, url) VALUES (:id, :clinic_id, :url)`
	_, err := r.db.NamedExecContext(ctx, query, source)
	return err
}

func (r *sourceRepo) GetSourceByID(ctx context.Context, id uuid.UUID) (*domain.SourceDetails, error) {
	var s domain.SourceDetails
	query := `
		SELECT
			s.id,
			s.clinic_id,
			s.url,
			c.name AS clinic_name,
			c.city,
			c.address,
			c.phone,
			c.working_hours,
			a.adapter_id
		FROM sources s
		JOIN clinics c ON c.id = s.clinic_id
		LEFT JOIN adapters a ON a.source_id = s.id
		WHERE s.id = $1`
	err := r.db.GetContext(ctx, &s, query, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &s, nil
}

func (r *sourceRepo) GetSourceByURL(ctx context.Context, url string) (*domain.Source, error) {
	var s domain.Source
	query := `SELECT id, clinic_id, url FROM sources WHERE url = $1`
	err := r.db.GetContext(ctx, &s, query, url)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil // or define a domain.ErrNotFound
		}
		return nil, err
	}
	return &s, nil
}

func (r *sourceRepo) ListSources(ctx context.Context) ([]domain.SourceDetails, error) {
	var sources []domain.SourceDetails
	query := `
		SELECT
			s.id,
			s.clinic_id,
			s.url,
			c.name AS clinic_name,
			c.city,
			c.address,
			c.phone,
			c.working_hours,
			a.adapter_id
		FROM sources s
		JOIN clinics c ON c.id = s.clinic_id
		LEFT JOIN adapters a ON a.source_id = s.id
		ORDER BY c.name, s.url`
	if err := r.db.SelectContext(ctx, &sources, query); err != nil {
		return nil, err
	}
	if sources == nil {
		sources = []domain.SourceDetails{}
	}
	return sources, nil
}

type adapterRepo struct {
	db *sqlx.DB
}

func NewAdapterRepository(db *database.DB) domain.AdapterRepository {
	return &adapterRepo{db: db.DB}
}

func (r *adapterRepo) GetAdapterByID(ctx context.Context, adapterID string) (*domain.Adapter, error) {
	var a domain.Adapter
	query := `SELECT adapter_id, domain, source_id, base_url FROM adapters WHERE adapter_id = $1`
	err := r.db.GetContext(ctx, &a, query, adapterID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &a, nil
}

type clinicRepo struct {
	db *sqlx.DB
}

func NewClinicRepository(db *database.DB) domain.ClinicRepository {
	return &clinicRepo{db: db.DB}
}

func (r *clinicRepo) CreateClinic(ctx context.Context, clinic *domain.Clinic) error {
	query := `INSERT INTO clinics (id, name, city, address, phone, working_hours) 
		VALUES (:id, :name, :city, :address, :phone, :working_hours)`
	_, err := r.db.NamedExecContext(ctx, query, clinic)
	return err
}

func (r *clinicRepo) GetClinicByID(ctx context.Context, id uuid.UUID) (*domain.Clinic, error) {
	var c domain.Clinic
	query := `SELECT id, name, city, address, phone, working_hours FROM clinics WHERE id = $1`
	err := r.db.GetContext(ctx, &c, query, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &c, nil
}

func (r *clinicRepo) FindClinicByNameAndCity(ctx context.Context, name, city string) (*domain.Clinic, error) {
	var c domain.Clinic
	query := `SELECT id, name, city, address, phone, working_hours FROM clinics WHERE name = $1 AND city = $2 LIMIT 1`
	err := r.db.GetContext(ctx, &c, query, name, city)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &c, nil
}
