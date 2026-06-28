-- +goose Up
-- Explicit "normalized" mark on the raw layer. Distinguishes:
--   normalized_at IS NULL                          -> not yet seen by normalize
--   normalized_at SET, service_catalog_id IS NULL  -> seen, but unmatched
--   normalized_at SET, service_catalog_id NOT NULL -> seen and bound to catalog
ALTER TABLE parsed_services ADD COLUMN IF NOT EXISTS normalized_at TIMESTAMP WITH TIME ZONE;

-- Cheap lookup of the backlog (rows still awaiting normalization).
CREATE INDEX IF NOT EXISTS idx_parsed_services_pending
    ON parsed_services (source_id) WHERE is_active AND normalized_at IS NULL;

-- +goose Down
DROP INDEX IF EXISTS idx_parsed_services_pending;
ALTER TABLE parsed_services DROP COLUMN IF EXISTS normalized_at;
