-- +goose Up
-- Worker bookkeeping tables.

-- adapter_id <-> domain <-> source_id mapping.
-- adapter.create registers a source mapping here so adapter.fetch can resolve
-- a source_id from adapter_id / URL without re-deriving it.
CREATE TABLE IF NOT EXISTS adapters (
    adapter_id  TEXT PRIMARY KEY,
    domain      TEXT NOT NULL,
    source_id   UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    base_url    TEXT NOT NULL,
    config      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_adapters_domain    ON adapters (domain);
CREATE INDEX IF NOT EXISTS idx_adapters_source_id ON adapters (source_id);

-- Idempotency ledger: a message is processed at most once.
CREATE TABLE IF NOT EXISTS processed_messages (
    msg_id       TEXT PRIMARY KEY,
    routing_key  TEXT,
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- +goose Down
DROP TABLE IF EXISTS processed_messages;
DROP TABLE IF EXISTS adapters;
