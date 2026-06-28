-- +goose Up
-- Normalize layer: turn raw parsed_services into a published, catalog-backed
-- "gold" table the API reads. The API must never read parsed_services (raw).
--
--   parsed_services (raw)   -> normalize service only
--   services_catalog (dim)  + service_aliases (synonyms)
--   service_offers (gold)   -> API reads only this
--   unmatched_services      -> misses, for manual labeling

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Canonical match key: lower, keep latin/cyrillic/digits, collapse the rest to
-- single spaces, trim. IMMUTABLE (no unaccent) so it can back generated columns.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION msp_name_key(txt text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT trim(both ' ' FROM
        regexp_replace(lower(coalesce(txt, '')), '[^0-9a-zа-яё]+', ' ', 'g'))
$$;
-- +goose StatementEnd

-- Enrich the catalog with a stable, unique match key + trigram index for fuzzy.
ALTER TABLE services_catalog
    ADD COLUMN IF NOT EXISTS name_key text
        GENERATED ALWAYS AS (msp_name_key(name_norm)) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS uq_services_catalog_name_key
    ON services_catalog (name_key);
CREATE INDEX IF NOT EXISTS idx_services_catalog_name_trgm
    ON services_catalog USING gin (name_norm gin_trgm_ops);

-- Synonyms / abbreviations / learned raw forms -> a catalog entry.
-- Resolving a miss = inserting an alias here, so future fetches auto-match.
CREATE TABLE IF NOT EXISTS service_aliases (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_catalog_id UUID NOT NULL REFERENCES services_catalog(id) ON DELETE CASCADE,
    alias_text         VARCHAR(500) NOT NULL,
    alias_key          text GENERATED ALWAYS AS (msp_name_key(alias_text)) STORED,
    origin             TEXT NOT NULL DEFAULT 'seed',   -- seed | manual | auto
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_aliases_key ON service_aliases (alias_key);

-- Gold layer: one live offer per (source, catalog service). This is the ONLY
-- table the API queries for prices — it carries no raw service name.
CREATE TABLE IF NOT EXISTS service_offers (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id          UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    clinic_id          UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    service_catalog_id UUID NOT NULL REFERENCES services_catalog(id) ON DELETE CASCADE,
    price_kzt          DECIMAL(12, 2) NOT NULL,
    currency           currency_enum NOT NULL DEFAULT 'KZT',
    duration_days      INT,
    parsed_at          TIMESTAMP WITH TIME ZONE,
    updated_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (source_id, service_catalog_id)
);
CREATE INDEX IF NOT EXISTS idx_service_offers_catalog_active
    ON service_offers (service_catalog_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_service_offers_clinic
    ON service_offers (clinic_id);

-- Review queue: raw names that matched nothing. Manual labeling here feeds aliases.
CREATE TABLE IF NOT EXISTS unmatched_services (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id   UUID REFERENCES sources(id) ON DELETE CASCADE,
    raw_name    VARCHAR(500) NOT NULL,
    name_key    text NOT NULL,
    occurrences INT NOT NULL DEFAULT 1,
    first_seen  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_seen   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    resolved    BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (source_id, name_key)
);

-- Seed справочник + common synonyms (KZ private-clinic vocabulary).
INSERT INTO services_catalog (name_norm, category) VALUES
    ('Общий анализ крови',          'лаборатория'),
    ('Биохимический анализ крови',  'лаборатория'),
    ('Общий анализ мочи',           'лаборатория'),
    ('УЗИ органов брюшной полости', 'диагностика'),
    ('УЗИ щитовидной железы',       'диагностика'),
    ('Электрокардиография',         'диагностика'),
    ('МРТ головного мозга',         'диагностика'),
    ('Приём врача-терапевта',       'прием врача'),
    ('Приём врача-кардиолога',      'прием врача'),
    ('Гастроскопия',                'процедура')
ON CONFLICT (name_key) DO NOTHING;

-- +goose StatementBegin
INSERT INTO service_aliases (service_catalog_id, alias_text, origin)
SELECT sc.id, a.alias_text, 'seed'
FROM services_catalog sc
JOIN (VALUES
    ('Общий анализ крови',          'ОАК'),
    ('Общий анализ крови',          'Клинический анализ крови'),
    ('Биохимический анализ крови',  'БХ крови'),
    ('Биохимический анализ крови',  'Биохимия крови'),
    ('Общий анализ мочи',           'ОАМ'),
    ('УЗИ органов брюшной полости', 'УЗИ ОБП'),
    ('УЗИ органов брюшной полости', 'УЗИ брюшной полости'),
    ('Электрокардиография',         'ЭКГ'),
    ('МРТ головного мозга',         'МРТ головы'),
    ('Приём врача-терапевта',       'Консультация терапевта'),
    ('Приём врача-терапевта',       'Прием терапевта'),
    ('Приём врача-кардиолога',      'Консультация кардиолога')
) AS a(name_norm, alias_text) ON a.name_norm = sc.name_norm
ON CONFLICT (alias_key) DO NOTHING;
-- +goose StatementEnd

-- +goose Down
DROP TABLE IF EXISTS unmatched_services;
DROP TABLE IF EXISTS service_offers;
DROP TABLE IF EXISTS service_aliases;
DROP INDEX IF EXISTS idx_services_catalog_name_trgm;
DROP INDEX IF EXISTS uq_services_catalog_name_key;
ALTER TABLE services_catalog DROP COLUMN IF EXISTS name_key;
DROP FUNCTION IF EXISTS msp_name_key(text);
