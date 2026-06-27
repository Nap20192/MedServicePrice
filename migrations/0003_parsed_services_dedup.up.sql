-- Upsert key for the Postgres sink (point 3): one live row per (source, raw service
-- name). The worker's fetch handler UPSERTs on this key, so a re-fetch updates the
-- price in place instead of duplicating. Required for the ON CONFLICT clause.
CREATE UNIQUE INDEX IF NOT EXISTS uq_parsed_services_source_name
    ON parsed_services (source_id, service_name_raw);

-- Freshness bookkeeping: re-fetch sets is_active=false for the whole source, then
-- flips current rows back to true. This partial index keeps the "live list" lookups
-- (the user-facing query) cheap.
CREATE INDEX IF NOT EXISTS idx_parsed_services_source_active
    ON parsed_services (source_id) WHERE is_active;
