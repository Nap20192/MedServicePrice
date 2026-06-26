-- Current price rows = the user-facing dataset (TЗ 2.2 service_* + price fields).
-- One row per (clinic, raw service name). Re-parsing updates the row in place
-- (dedup), and shifts the old value into price_history via trigger.
CREATE TABLE prices (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id         UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    -- NULL while the name is still unmatched; set by the Normalizer once bound.
    catalog_id        UUID REFERENCES service_catalog(id) ON DELETE SET NULL,
    source_id         UUID REFERENCES sources(id) ON DELETE SET NULL,

    service_name_raw  TEXT NOT NULL,             -- name exactly as on the site
    category          service_category,          -- best-effort, refined on match

    price_kzt         NUMERIC(12,2) NOT NULL,    -- always stored in KZT
    price_original    NUMERIC(12,2),             -- value before conversion (if USD)
    currency_original currency_code NOT NULL DEFAULT 'KZT',
    duration_days     INT,                       -- turnaround for lab tests

    source_url        TEXT,
    match_status      match_status NOT NULL DEFAULT 'unmatched',
    match_score       REAL,                      -- fuzzy similarity 0..1 (audit of auto-match)
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    parsed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT prices_price_nonneg CHECK (price_kzt >= 0),
    -- Dedup (TЗ 3.1): same service at same clinic is a single live row.
    CONSTRAINT prices_dedup_uq UNIQUE (clinic_id, service_name_raw)
);

CREATE INDEX idx_prices_catalog   ON prices (catalog_id) WHERE is_active;
CREATE INDEX idx_prices_clinic    ON prices (clinic_id);
CREATE INDEX idx_prices_price     ON prices (price_kzt) WHERE is_active;
CREATE INDEX idx_prices_unmatched ON prices (match_status) WHERE match_status = 'unmatched';
CREATE INDEX idx_prices_raw_trgm  ON prices USING gin (service_name_raw gin_trgm_ops);
-- Freshness check (NFR: данные старше 30 дней не считать актуальными).
CREATE INDEX idx_prices_parsed_at ON prices (parsed_at);
