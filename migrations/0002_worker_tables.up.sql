-- Worker bookkeeping tables.

-- adapter_id ↔ domain ↔ source_id mapping (point 2 of the worker spec).
-- adapter.create registers a clinic + source, then records the association here so
-- adapter.fetch can resolve a source_id from adapter_id / URL without re-deriving it.
CREATE TABLE IF NOT EXISTS adapters (
    adapter_id  TEXT PRIMARY KEY,                       -- e.g. "kdl_adapter" (from the message)
    domain      TEXT NOT NULL,                          -- host(base_url), e.g. "kdl.kz"
    source_id   UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    base_url    TEXT NOT NULL,
    config      JSONB NOT NULL DEFAULT '{}',            -- rate_limit_ms, max_depth, ...
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_adapters_domain    ON adapters (domain);
CREATE INDEX IF NOT EXISTS idx_adapters_source_id ON adapters (source_id);

-- Idempotency ledger (point 7): a message is processed at most once. The worker
-- claims a msg_id here (INSERT ... ON CONFLICT DO NOTHING) before doing work and
-- skips redeliveries whose id is already present.
CREATE TABLE IF NOT EXISTS processed_messages (
    msg_id       TEXT PRIMARY KEY,
    routing_key  TEXT,
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
