-- +goose Up
ALTER TABLE sources ALTER COLUMN clinic_id DROP NOT NULL;
ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_clinic_id_fkey;
ALTER TABLE sources
    ADD CONSTRAINT sources_clinic_id_fkey
    FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sources_url ON sources (url);

CREATE TABLE IF NOT EXISTS scheduler_settings (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE,
    fetch_interval_hours INT NOT NULL DEFAULT 24,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT scheduler_settings_singleton CHECK (id),
    CONSTRAINT scheduler_settings_interval_positive CHECK (fetch_interval_hours > 0)
);

INSERT INTO scheduler_settings (id, fetch_interval_hours)
VALUES (TRUE, 24)
ON CONFLICT (id) DO NOTHING;

-- +goose Down
DROP TABLE IF EXISTS scheduler_settings;
DROP INDEX IF EXISTS uq_sources_url;

ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_clinic_id_fkey;
ALTER TABLE sources
    ADD CONSTRAINT sources_clinic_id_fkey
    FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE;
ALTER TABLE sources ALTER COLUMN clinic_id SET NOT NULL;
