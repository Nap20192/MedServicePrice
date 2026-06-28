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
			c.url AS clinic_url,
			a.adapter_id
		FROM sources s
		LEFT JOIN clinics c ON c.id = s.clinic_id
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
			c.url AS clinic_url,
			a.adapter_id
		FROM sources s
		LEFT JOIN clinics c ON c.id = s.clinic_id
		LEFT JOIN adapters a ON a.source_id = s.id
		ORDER BY c.name NULLS LAST, s.url`
	if err := r.db.SelectContext(ctx, &sources, query); err != nil {
		return nil, err
	}
	if sources == nil {
		sources = []domain.SourceDetails{}
	}
	return sources, nil
}

func (r *sourceRepo) ListFetchableSources(ctx context.Context) ([]domain.SourceDetails, error) {
	return r.ListSources(ctx)
}

func (r *sourceRepo) AttachSourcesToClinic(ctx context.Context, clinicID uuid.UUID, sourceIDs []uuid.UUID) error {
	if len(sourceIDs) == 0 {
		return nil
	}
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, sourceID := range sourceIDs {
		if _, err := tx.ExecContext(ctx, `UPDATE sources SET clinic_id = $1 WHERE id = $2`, clinicID, sourceID); err != nil {
			return err
		}
	}
	return tx.Commit()
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
	query := `INSERT INTO clinics
		(id, name, city, address, phone, working_hours, url, google_place_id, lat, lng, rating, reviews_count)
		VALUES (:id, :name, :city, :address, :phone, :working_hours, :url, :google_place_id, :lat, :lng, :rating, :reviews_count)`
	_, err := r.db.NamedExecContext(ctx, query, clinic)
	return err
}

func (r *clinicRepo) UpsertClinic(ctx context.Context, clinic *domain.Clinic, externalRaw []byte) error {
	var raw *string
	if len(externalRaw) > 0 {
		value := string(externalRaw)
		raw = &value
	}

	existingID, found, err := r.findExistingClinicID(ctx, clinic)
	if err != nil {
		return err
	}
	if found {
		clinic.ID = existingID
		_, err := r.db.ExecContext(ctx, `
			UPDATE clinics SET
				name          = $2,
				city          = COALESCE($3, city),
				address       = COALESCE($4, address),
				phone         = COALESCE($5, phone),
				working_hours = COALESCE($6, working_hours),
				url           = COALESCE($7, url),
				google_place_id     = COALESCE($8, google_place_id),
				lat           = COALESCE($9, lat),
				lng           = COALESCE($10, lng),
				rating        = COALESCE($11, rating),
				reviews_count = COALESCE($12, reviews_count),
				external_raw  = COALESCE(CAST($13 AS jsonb), external_raw)
			WHERE id = $1`,
			clinic.ID, clinic.Name, clinic.City, clinic.Address, clinic.Phone,
			clinic.WorkingHours, clinic.URL, clinic.GooglePlaceID, clinic.Lat, clinic.Lng,
			clinic.Rating, clinic.ReviewsCount, raw)
		return err
	}

	_, err = r.db.ExecContext(ctx, `
		INSERT INTO clinics
			(id, name, city, address, phone, working_hours, url, google_place_id, lat, lng, rating, reviews_count, external_raw)
		VALUES
			($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CAST($13 AS jsonb))`,
		clinic.ID, clinic.Name, clinic.City, clinic.Address, clinic.Phone,
		clinic.WorkingHours, clinic.URL, clinic.GooglePlaceID, clinic.Lat, clinic.Lng,
		clinic.Rating, clinic.ReviewsCount, raw)
	return err
}

func (r *clinicRepo) findExistingClinicID(ctx context.Context, clinic *domain.Clinic) (uuid.UUID, bool, error) {
	var id uuid.UUID
	if clinic.GooglePlaceID != nil && *clinic.GooglePlaceID != "" {
		err := r.db.GetContext(ctx, &id, `SELECT id FROM clinics WHERE google_place_id = $1`, *clinic.GooglePlaceID)
		if err == nil {
			return id, true, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return uuid.Nil, false, err
		}
	}
	if clinic.URL != nil && *clinic.URL != "" {
		err := r.db.GetContext(ctx, &id, `SELECT id FROM clinics WHERE url = $1`, *clinic.URL)
		if err == nil {
			return id, true, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return uuid.Nil, false, err
		}
	}
	return uuid.Nil, false, nil
}

func (r *clinicRepo) GetClinicByID(ctx context.Context, id uuid.UUID) (*domain.Clinic, error) {
	var c domain.Clinic
	query := `SELECT id, name, city, address, phone, working_hours, url, google_place_id, lat, lng, rating, reviews_count FROM clinics WHERE id = $1`
	err := r.db.GetContext(ctx, &c, query, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &c, nil
}

func (r *clinicRepo) ListClinics(ctx context.Context) ([]domain.Clinic, error) {
	var clinics []domain.Clinic
	query := `SELECT id, name, city, address, phone, working_hours, url, google_place_id, lat, lng, rating, reviews_count FROM clinics ORDER BY name`
	if err := r.db.SelectContext(ctx, &clinics, query); err != nil {
		return nil, err
	}
	if clinics == nil {
		clinics = []domain.Clinic{}
	}
	return clinics, nil
}

func (r *clinicRepo) FindClinicByGooglePlaceID(ctx context.Context, googlePlaceID string) (*domain.Clinic, error) {
	var c domain.Clinic
	query := `SELECT id, name, city, address, phone, working_hours, url, google_place_id, lat, lng, rating, reviews_count FROM clinics WHERE google_place_id = $1 LIMIT 1`
	err := r.db.GetContext(ctx, &c, query, googlePlaceID)
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
	query := `SELECT id, name, city, address, phone, working_hours, url, google_place_id, lat, lng, rating, reviews_count FROM clinics WHERE name = $1 AND city = $2 LIMIT 1`
	err := r.db.GetContext(ctx, &c, query, name, city)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &c, nil
}

type schedulerRepo struct {
	db *sqlx.DB
}

func NewSchedulerRepository(db *database.DB) domain.SchedulerRepository {
	return &schedulerRepo{db: db.DB}
}

func (r *schedulerRepo) GetSettings(ctx context.Context) (*domain.SchedulerSettings, error) {
	var settings domain.SchedulerSettings
	query := `
		INSERT INTO scheduler_settings (id, fetch_interval_hours)
		VALUES (TRUE, 24)
		ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
		RETURNING fetch_interval_hours, updated_at`
	if err := r.db.GetContext(ctx, &settings, query); err != nil {
		return nil, err
	}
	return &settings, nil
}

func (r *schedulerRepo) UpdateFetchInterval(ctx context.Context, hours int) (*domain.SchedulerSettings, error) {
	var settings domain.SchedulerSettings
	query := `
		INSERT INTO scheduler_settings (id, fetch_interval_hours, updated_at)
		VALUES (TRUE, $1, now())
		ON CONFLICT (id) DO UPDATE
		SET fetch_interval_hours = EXCLUDED.fetch_interval_hours,
			updated_at = now()
		RETURNING fetch_interval_hours, updated_at`
	if err := r.db.GetContext(ctx, &settings, query, hours); err != nil {
		return nil, err
	}
	return &settings, nil
}
