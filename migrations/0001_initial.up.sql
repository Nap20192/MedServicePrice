CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS clinics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    city VARCHAR(100),
    address TEXT,
    phone VARCHAR(50),
    working_hours VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS sources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    url TEXT NOT NULL
);

CREATE TYPE service_category AS ENUM (
    'лаборатория',
    'прием врача',
    'диагностика',
    'процедура'
);

CREATE TABLE IF NOT EXISTS services_catalog (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name_norm VARCHAR(255) NOT NULL,
    category service_category NOT NULL
);

CREATE TYPE currency_enum AS ENUM (
    'KZT',
    'USD'
);

CREATE TABLE IF NOT EXISTS parsed_services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    service_catalog_id UUID REFERENCES services_catalog(id) ON DELETE SET NULL,
    service_name_raw VARCHAR(500) NOT NULL,
    price_kzt DECIMAL(12, 2) NOT NULL,
    currency currency_enum NOT NULL DEFAULT 'KZT',
    duration_days INT,
    parsed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE
);
