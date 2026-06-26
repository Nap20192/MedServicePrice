-- One crawl of one source. Created on parse.start, closed on parse.done/parse.error.
-- Gives the UI a "last update" timestamp and per-source health.
CREATE TABLE parse_runs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id    UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    status       parse_run_status NOT NULL DEFAULT 'running',
    trigger      TEXT NOT NULL DEFAULT 'schedule', -- schedule | manual | retry
    pages_fetched INT NOT NULL DEFAULT 0,
    prices_found  INT NOT NULL DEFAULT 0,
    errors_count  INT NOT NULL DEFAULT 0,
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ
);

CREATE INDEX idx_parse_runs_source ON parse_runs (source_id, started_at DESC);

-- Error log (TЗ 3.1 журналирование ошибок: источник + причина).
-- Failure of one source must not stop others (NFR отказоустойчивость) — errors land here.
CREATE TABLE parse_errors (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id    UUID REFERENCES sources(id) ON DELETE SET NULL,
    parse_run_id UUID REFERENCES parse_runs(id) ON DELETE CASCADE,
    url          TEXT,
    stage        TEXT,        -- fetch | extract | parse_pdf | normalize | publish
    error_type   TEXT,        -- http_404, timeout, selector_miss, decode_error, ...
    message      TEXT NOT NULL,
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_parse_errors_source ON parse_errors (source_id, occurred_at DESC);
CREATE INDEX idx_parse_errors_run    ON parse_errors (parse_run_id);
