-- Price-drop subscriptions (TЗ 3.4 опц.). User watches a service, optionally pinned to a
-- clinic and/or city, and gets notified when a matching price falls. No patient PII —
-- just a contact channel.
CREATE TABLE subscriptions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel     TEXT NOT NULL,                   -- email | telegram
    contact     TEXT NOT NULL,                   -- address / chat id
    catalog_id  UUID NOT NULL REFERENCES service_catalog(id) ON DELETE CASCADE,
    clinic_id   UUID REFERENCES clinics(id) ON DELETE CASCADE,   -- optional pin
    city        TEXT,                            -- optional filter
    target_price_kzt NUMERIC(12,2),              -- notify when price <= this (NULL = any drop)
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    last_notified_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT subscriptions_uq UNIQUE (channel, contact, catalog_id, clinic_id)
);

CREATE INDEX idx_subscriptions_catalog ON subscriptions (catalog_id) WHERE is_active;
