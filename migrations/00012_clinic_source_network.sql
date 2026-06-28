-- +goose Up
-- Clinic networks: many branch clinics (same name, different address/city) share one
-- crawled source (the network site) and its city-scoped service_offers. A branch's
-- prices = the source's offers for the branch's city. Reverses the old 1:1
-- sources.clinic_id into a M:1 clinics.source_id (many clinics -> one source).
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES sources(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_clinics_source_id ON clinics (source_id);

-- Backfill: each existing clinic was pointed at by one source — make it that source's branch.
UPDATE clinics c
SET source_id = s.id
FROM sources s
WHERE s.clinic_id = c.id AND c.source_id IS NULL;

-- +goose Down
DROP INDEX IF EXISTS idx_clinics_source_id;
ALTER TABLE clinics DROP COLUMN IF EXISTS source_id;
