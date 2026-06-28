-- +goose Up
-- AI-written description of each canonical service. The LLM curator generates it
-- for new entries and reads candidates' descriptions to disambiguate match-vs-create.
ALTER TABLE services_catalog ADD COLUMN IF NOT EXISTS description TEXT;

-- +goose Down
ALTER TABLE services_catalog DROP COLUMN IF EXISTS description;
