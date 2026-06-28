-- +goose Up
-- Clinic identified by its URL; price tied to the source (not the clinic) and
-- carries a city. City becomes an enum.

-- +goose StatementBegin
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'city_enum') THEN
        CREATE TYPE city_enum AS ENUM (
            'Астана', 'Алматы', 'Шымкент', 'Караганда', 'Актобе', 'Тараз',
            'Павлодар', 'Усть-Каменогорск', 'Семей', 'Атырау', 'Костанай',
            'Кызылорда', 'Уральск', 'Петропавловск', 'Актау', 'Темиртау',
            'Туркестан', 'Кокшетау', 'Талдыкорган', 'Экибастуз'
        );
    END IF;
END
$$;
-- +goose StatementEnd

-- Clinic is a brand/network identified by its site URL.
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS url TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_clinics_url ON clinics (url) WHERE url IS NOT NULL;

-- A source URL is city-specific; the city of its prices comes from here.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS city city_enum;

-- Gold prices belong to a source, not a clinic — drop the denormalized clinic_id
-- (the clinic is reached via sources) and stamp the city onto the price.
ALTER TABLE service_offers ADD COLUMN IF NOT EXISTS city city_enum;
DROP INDEX IF EXISTS idx_service_offers_clinic;
ALTER TABLE service_offers DROP COLUMN IF EXISTS clinic_id;

-- +goose Down
ALTER TABLE service_offers ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_service_offers_clinic ON service_offers (clinic_id);
ALTER TABLE service_offers DROP COLUMN IF EXISTS city;
ALTER TABLE sources DROP COLUMN IF EXISTS city;
DROP INDEX IF EXISTS uq_clinics_url;
ALTER TABLE clinics DROP COLUMN IF EXISTS url;
DROP TYPE IF EXISTS city_enum;
