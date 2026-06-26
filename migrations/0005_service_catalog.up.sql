-- Canonical service dictionary (TЗ 3.2 справочник услуг). The Normalizer maps raw
-- scraped names onto these rows. Min 50 entries required for the deliverable.
CREATE TABLE service_catalog (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Stable human slug, e.g. 'cbc' for "Общий анализ крови (ОАК)".
    code       TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,                    -- canonical display name
    category   service_category NOT NULL,
    -- Synonyms used by fuzzy matching: «ОАК», «CBC», «Клинический анализ крови» ...
    synonyms   TEXT[] NOT NULL DEFAULT '{}',
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Full-text search column over name + synonyms for the autocomplete search bar.
-- NOTE: to_tsvector with a config *name* (and unaccent) is only STABLE, so it cannot sit
-- in a GENERATED STORED column (Postgres needs IMMUTABLE). We maintain it with a trigger
-- instead — the trigger body has no immutability restriction.
ALTER TABLE service_catalog ADD COLUMN search_tsv tsvector;

CREATE OR REPLACE FUNCTION service_catalog_tsv() RETURNS trigger AS $$
BEGIN
    NEW.search_tsv := to_tsvector('russian',
        coalesce(NEW.name, '') || ' ' || array_to_string(NEW.synonyms, ' '));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_service_catalog_tsv
    BEFORE INSERT OR UPDATE OF name, synonyms ON service_catalog
    FOR EACH ROW EXECUTE FUNCTION service_catalog_tsv();

CREATE INDEX idx_catalog_search_tsv ON service_catalog USING gin (search_tsv);
CREATE INDEX idx_catalog_name_trgm  ON service_catalog USING gin (name gin_trgm_ops);
CREATE INDEX idx_catalog_category   ON service_catalog (category);
