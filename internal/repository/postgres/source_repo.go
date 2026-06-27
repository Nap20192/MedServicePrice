package postgres

import (
	"context"
	"database/sql"
	"errors"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"

	"medprice/internal/domain"
)

type sourceRepo struct {
	db *sqlx.DB
}

func NewSourceRepository(db *DB) domain.SourceRepository {
	return &sourceRepo{db: db.DB}
}

func (r *sourceRepo) CreateSource(ctx context.Context, source *domain.Source) error {
	query := `INSERT INTO sources (id, clinic_id, url) VALUES (:id, :clinic_id, :url)`
	_, err := r.db.NamedExecContext(ctx, query, source)
	return err
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

type clinicRepo struct {
	db *sqlx.DB
}

func NewClinicRepository(db *DB) domain.ClinicRepository {
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
