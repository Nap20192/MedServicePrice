-- Price history (TЗ 3.4 история изменения цен + powers subscriptions/alerts).
-- Append-only: one row each time a price actually changes.
CREATE TABLE price_history (
    id          BIGINT GENERATED ALWAYS AS IDENTITY,
    price_id    UUID NOT NULL REFERENCES prices(id) ON DELETE CASCADE,
    clinic_id   UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    catalog_id  UUID REFERENCES service_catalog(id) ON DELETE SET NULL,
    old_price_kzt NUMERIC(12,2),
    new_price_kzt NUMERIC(12,2) NOT NULL,
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id)
);

CREATE INDEX idx_price_history_price   ON price_history (price_id, changed_at DESC);
CREATE INDEX idx_price_history_catalog ON price_history (catalog_id, changed_at DESC);

-- Trigger: log a row only when price_kzt moves. Fires on re-parse upserts.
CREATE OR REPLACE FUNCTION log_price_change() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO price_history(price_id, clinic_id, catalog_id, old_price_kzt, new_price_kzt)
        VALUES (NEW.id, NEW.clinic_id, NEW.catalog_id, NULL, NEW.price_kzt);
    ELSIF NEW.price_kzt IS DISTINCT FROM OLD.price_kzt THEN
        INSERT INTO price_history(price_id, clinic_id, catalog_id, old_price_kzt, new_price_kzt)
        VALUES (NEW.id, NEW.clinic_id, NEW.catalog_id, OLD.price_kzt, NEW.price_kzt);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prices_history
    AFTER INSERT OR UPDATE OF price_kzt ON prices
    FOR EACH ROW EXECUTE FUNCTION log_price_change();
