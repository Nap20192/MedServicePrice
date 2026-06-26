-- Extensions used across the schema.
-- pgcrypto       -> gen_random_uuid() for UUID primary keys
-- pg_trgm        -> trigram fuzzy matching for the Normalizer (service name -> catalog)
-- unaccent       -> strip diacritics before matching ("Анализ" vs "анализ", lat/cyr noise)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
