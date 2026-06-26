-- Clinics (TЗ 2.2 clinic_* fields) + enrich columns (geo, rating, online booking).
CREATE TABLE clinics (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id      UUID REFERENCES sources(id) ON DELETE SET NULL,
    name           TEXT NOT NULL,
    city           TEXT NOT NULL,
    address        TEXT,
    phone          TEXT,
    working_hours  TEXT,
    source_url     TEXT,                         -- page the clinic was discovered on

    -- Enrich service (async, non-blocking): filled later, may stay NULL.
    latitude       DOUBLE PRECISION,
    longitude      DOUBLE PRECISION,
    rating         NUMERIC(2,1),                 -- 0.0 .. 5.0
    has_online_booking BOOLEAN NOT NULL DEFAULT FALSE,
    twogis_id      TEXT,                         -- external id from 2GIS for route links
    enriched_at    TIMESTAMPTZ,

    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Dedup key: same clinic from same source must not double-insert (TЗ 3.1 дедупликация).
    -- Normalized name+city+address fingerprint built by the consumer before upsert.
    dedup_key      TEXT NOT NULL,
    CONSTRAINT clinics_dedup_uq UNIQUE (source_id, dedup_key)
);

CREATE INDEX idx_clinics_city ON clinics (city);
CREATE INDEX idx_clinics_geo  ON clinics (latitude, longitude);
-- Trigram index for fuzzy clinic-name search in the UI.
CREATE INDEX idx_clinics_name_trgm ON clinics USING gin (name gin_trgm_ops);
