-- Shared enum types. Kept as native ENUMs for storage compactness and query clarity.
-- New values can be appended later with `ALTER TYPE ... ADD VALUE`.

-- Service category (TЗ 2.2): лаборатория / приём врача / диагностика / процедура
CREATE TYPE service_category AS ENUM (
    'lab',          -- лаборатория (анализы)
    'doctor_visit', -- приём врача
    'diagnostics',  -- диагностика (УЗИ, МРТ, КТ, рентген)
    'procedure'     -- процедура / манипуляция
);

-- Currency. Everything is converted to KZT on ingest; USD kept only as original marker.
CREATE TYPE currency_code AS ENUM (
    'KZT',
    'USD'
);

-- State of a raw service name on its way to the catalog.
CREATE TYPE match_status AS ENUM (
    'matched',   -- bound to a catalog entry (auto or manual)
    'unmatched', -- needs manual review (sits in the unmatched queue)
    'ignored'    -- junk / not a real service, dismissed by a reviewer
);

-- Lifecycle of a single parse run for one source.
CREATE TYPE parse_run_status AS ENUM (
    'running',
    'done',
    'failed'
);
