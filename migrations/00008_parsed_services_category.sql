-- +goose Up
ALTER TABLE parsed_services
    ADD COLUMN IF NOT EXISTS category TEXT;

CREATE INDEX IF NOT EXISTS idx_parsed_services_category
    ON parsed_services (category);

-- +goose Down
DROP INDEX IF EXISTS idx_parsed_services_category;
ALTER TABLE parsed_services
    DROP COLUMN IF EXISTS category;
