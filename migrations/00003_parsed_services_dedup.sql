-- +goose Up
-- One live row per (source, raw service name). Required for worker UPSERT.
CREATE UNIQUE INDEX IF NOT EXISTS uq_parsed_services_source_name
    ON parsed_services (source_id, service_name_raw);

-- Keep user-facing live-list lookups cheap.
CREATE INDEX IF NOT EXISTS idx_parsed_services_source_active
    ON parsed_services (source_id) WHERE is_active;

-- +goose Down
DROP INDEX IF EXISTS idx_parsed_services_source_active;
DROP INDEX IF EXISTS uq_parsed_services_source_name;
