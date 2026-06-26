-- Registry of parse targets. Adding a new site = inserting a row here, not editing core
-- code (NFR: "добавление новых источников без переработки ядра").
CREATE TABLE sources (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code          TEXT NOT NULL UNIQUE,          -- short slug, e.g. 'kdl', 'invitro', 'olymp'
    name          TEXT NOT NULL,                 -- human label, e.g. 'KDL Лаборатория'
    base_url      TEXT NOT NULL,
    -- Per-source crawler knobs the Python service reads on parse.start.
    parser_kind   TEXT NOT NULL DEFAULT 'html',  -- html | pdf | docx | xlsx | api
    request_delay_ms INT NOT NULL DEFAULT 2000,  -- politeness delay (TЗ 8: no overload)
    respect_robots   BOOLEAN NOT NULL DEFAULT TRUE,
    config        JSONB NOT NULL DEFAULT '{}',   -- start urls, css selectors, crawl depth, etc.
    is_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
    last_parsed_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sources_enabled ON sources (is_enabled) WHERE is_enabled;
