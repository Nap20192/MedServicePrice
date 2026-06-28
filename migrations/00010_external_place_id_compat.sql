-- +goose Up
-- Compatibility for databases where migration 00009 was already applied before
-- the external clinic import was switched from 2GIS to Google Maps Places.
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'clinics' AND column_name = 'twogis_id'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'clinics' AND column_name = 'google_place_id'
    ) THEN
        ALTER TABLE clinics RENAME COLUMN twogis_id TO google_place_id;
    END IF;
END
$$;
-- +goose StatementEnd

DROP INDEX IF EXISTS uq_clinics_twogis_id;
CREATE UNIQUE INDEX IF NOT EXISTS uq_clinics_google_place_id
    ON clinics (google_place_id) WHERE google_place_id IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS uq_clinics_google_place_id;
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'clinics' AND column_name = 'google_place_id'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'clinics' AND column_name = 'twogis_id'
    ) THEN
        ALTER TABLE clinics RENAME COLUMN google_place_id TO twogis_id;
    END IF;
END
$$;
-- +goose StatementEnd

CREATE UNIQUE INDEX IF NOT EXISTS uq_clinics_twogis_id
    ON clinics (twogis_id) WHERE twogis_id IS NOT NULL;
