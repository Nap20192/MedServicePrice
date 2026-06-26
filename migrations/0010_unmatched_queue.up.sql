-- Manual-labeling queue (TЗ 3.2 unmatched queue). Distinct raw names the Normalizer
-- could not auto-bind, deduped so a reviewer maps each name once instead of per-row.
CREATE TABLE unmatched_queue (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    normalized_text TEXT NOT NULL UNIQUE,        -- lower/unaccented raw name, the dedup key
    sample_raw      TEXT NOT NULL,               -- one example as seen on a site
    occurrences     INT NOT NULL DEFAULT 1,      -- how many price rows share this name
    -- Best fuzzy guess offered to the reviewer (does not bind anything).
    suggested_catalog_id UUID REFERENCES service_catalog(id) ON DELETE SET NULL,
    suggested_score REAL,
    status          match_status NOT NULL DEFAULT 'unmatched',
    resolved_catalog_id  UUID REFERENCES service_catalog(id) ON DELETE SET NULL,
    resolved_by     TEXT,                         -- reviewer id/name
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_unmatched_status ON unmatched_queue (status) WHERE status = 'unmatched';
CREATE INDEX idx_unmatched_occ    ON unmatched_queue (occurrences DESC);
