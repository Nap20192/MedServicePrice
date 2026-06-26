-- Raw layer (TЗ 3.1 хранение сырых данных отдельно; NFR: хранить >= 90 дней для аудита).
-- Python writes here directly; nothing user-facing reads it.
CREATE TABLE raw_pages (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id    UUID REFERENCES sources(id) ON DELETE SET NULL,
    parse_run_id UUID,                           -- groups pages of one crawl (see parse_runs)
    url          TEXT NOT NULL,
    content_type TEXT,                           -- text/html, application/pdf, ...
    raw_content  BYTEA,                          -- original bytes (html/pdf/docx)
    content_hash TEXT NOT NULL,                  -- sha256; skip re-store if unchanged
    http_status  INT,
    fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Retention helper: a daily job deletes rows past 90 days.
    expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '90 days')
);

CREATE INDEX idx_raw_pages_source  ON raw_pages (source_id, fetched_at DESC);
CREATE INDEX idx_raw_pages_expires ON raw_pages (expires_at);
-- Same url+hash already stored => crawler skips (dedup of raw layer).
CREATE UNIQUE INDEX idx_raw_pages_url_hash ON raw_pages (url, content_hash);
