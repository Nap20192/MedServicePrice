-- +goose Up
-- Keep the raw service name (as seen on the source site) on the published offer, so
-- the UI can show it next to the normalized name for transparency.
ALTER TABLE service_offers ADD COLUMN IF NOT EXISTS service_name_raw TEXT;

-- +goose Down
ALTER TABLE service_offers DROP COLUMN IF EXISTS service_name_raw;
