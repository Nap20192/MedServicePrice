# MedServicePrice.kz — architecture & plan

## 1. The task, as understood

Build an MVP that does for medical prices in Kazakhstan what Aviasales does for flights.
A patient should type one service ("общий анализ крови") and immediately see every clinic
that offers it, sorted by price, with address, hours, freshness date, and a link back to
the source — instead of hand-checking dozens of clinic sites.

Three jobs underneath that:

1. **Collect** — crawl open clinic/lab price lists (HTML, PDF, DOCX, XLSX), politely
   (robots.txt, delays), tolerant to one source dying, keeping raw data 90 days for audit.
2. **Normalize** — fold messy names («ОАК», «CBC», «Клинический анализ крови») onto one
   canonical catalog entry, with a manual-review queue for what auto-matching misses.
3. **Serve** — fast search (<3s), filters (city/category/price/rating/online booking),
   sorting (price/distance/freshness), clinic cards, price history; never present data
   older than 30 days as current.

Graded on: data quality 25, UX 25, tech 20, market coverage 15, extra features 15.

## 2. Service layout (refined from the sketch)

Kept the three-process split, swapped the bus to **RabbitMQ** per request.

- **Python service — crawler only.** Crawl4AI (BestFirst + URL filters), APScheduler for
  the daily tick. Writes raw bytes straight to `raw_pages`. Publishes small
  `price.found` / `parse.done` / `parse.error` messages — no HTML on the bus.
- **RabbitMQ — thin signal bus.** One topic exchange `medprice.events`, a dead-letter
  exchange, manual-ack at-least-once. Full topology in `queue/`.
- **Go service — everything else.** Consumer (RabbitMQ → normalize → DB), Normalizer
  (pg_trgm fuzzy → Ollama fallback), REST API for the Next.js frontend, scheduler that
  publishes `parse.start` per source.
- **Enrich — async module in Go.** Geo + rating + online-booking + 2GIS id, off the hot
  path via `enrich.request`, never blocks price ingest.
- **PostgreSQL — single store.** Tables below.

```
sources ──parse.start──▶ Python crawler ──raw bytes──▶ raw_pages
                              │
                       price.found / parse.done / parse.error  (RabbitMQ)
                              ▼
        Go consumer ─▶ clinics ─▶ prices ─(trigger)─▶ price_history
              │           ▲                                │
              │      service_catalog ◀── Normalizer        ├─ price.changed ─▶ notifier ─▶ subscriptions
              │           ▲                                │
              │      unmatched_queue (manual review)       │
              └─ enrich.request ─▶ enrich ─▶ clinics(geo,rating,booking)
        parse_runs / parse_errors  ◀── run lifecycle + failures
                              ▲
                     Go REST API ─▶ Next.js (search · map · compare)
```

## 3. Data model (see `migrations/`)

| Table             | Role |
|-------------------|------|
| `sources`         | parse-target registry; add a site = insert a row (NFR extensibility) |
| `clinics`         | clinic identity + enrich columns (geo/rating/booking/2gis), dedup key |
| `service_catalog` | canonical dictionary + synonyms + FTS `tsvector` (trigger-maintained) |
| `prices`          | live price per (clinic, raw name); match status + score; freshness |
| `price_history`   | append-only price changes via trigger; powers history + alerts |
| `raw_pages`       | raw HTML/PDF bytes, 90-day `expires_at`, url+hash dedup |
| `parse_runs`      | one crawl per source: status + counters → UI "last updated" |
| `parse_errors`    | per-source failure log (source + stage + reason) |
| `unmatched_queue` | deduped names awaiting manual mapping (TЗ 3.2) |
| `subscriptions`   | price-drop watch (email/telegram), no patient PII |

Design choices worth noting:

- **Dedup is a DB constraint**, not app logic: `prices(clinic_id, service_name_raw)` and
  `clinics(source_id, dedup_key)` unique. Re-parsing upserts; safe under message redelivery.
- **Raw layer is physically separate** (`raw_pages`) from normalized (`prices`) — audit +
  re-extraction without re-crawling.
- **Freshness is data, not deletion**: keep rows, filter by `parsed_at`; the 30-day rule is
  a query predicate so history survives.
- **FTS via trigger**, not generated column — `to_tsvector('russian', …)`/`unaccent` are
  only STABLE and Postgres rejects them in `GENERATED STORED`. (Verified against pg16.)

## 4. Normalization pipeline

1. Clean raw name (lower, unaccent, strip codes/parens).
2. Exact / synonym hit on `service_catalog` → bind, score 1.0.
3. `pg_trgm` similarity ≥ threshold (e.g. 0.45) → bind, store `match_score`.
4. Below threshold → Ollama prompt ("which catalog id, if any?") → bind if confident.
5. Still nothing → row stays `unmatched`, upserted into `unmatched_queue` (occurrence
   counter ++). Reviewer maps the frequent ones first; mapping back-fills all price rows.

## 5. Ideas / improvements beyond the brief

**Data quality (25%)**
- Per-source extractor confidence + a "needs review" flag when a page's price column shifts;
  catch silent selector breakage instead of importing garbage.
- Price sanity guard: reject/flag values outside a per-category band (e.g. ОАК > 50 000 ₸).
- Currency conversion table with a stored daily USD→KZT rate, so `price_original` is auditable.

**UX (25%)**
- Autocomplete straight off `service_catalog.search_tsv` (already indexed) → sub-100ms.
- "Cheapest in your city" hero + median/percentile band so a user sees if a price is fair.
- Always show the `parsed_at` badge ("обновлено 2 дня назад") — the brief rewards transparency.

**Coverage (15%)**
- Drive crawl breadth from `sources.config.start_urls`; onboarding a new city = data, not code.
- Track distinct `city` count + clinics-per-source on a small admin dashboard (also demo gold).

**Extra features (15%)**
- Leaflet map from `clinics.lat/lng`; 2GIS route deep-link from `twogis_id`.
- Compare table: pin N clinics for one `catalog_id` side by side.
- Price-history sparkline per service from `price_history`.
- Subscriptions: `price.changed` → notifier → email/telegram when `price <= target`.

**Tech / ops (20%)**
- Idempotent consumers + DLQ already in the topology; add a small retry exchange with TTL
  for backoff before dead-lettering.
- Nightly job: delete `raw_pages` past `expires_at`, deactivate `prices` older than 30 days.
- Per-source health from `parse_runs`/`parse_errors` → alert if a source returns 0 prices.
- `schema_version` on every message → safe message evolution.

## 6. Open questions for the team

- Ollama model + host? (normalization latency vs. accuracy on the price.found hot path)
- Quorum vs. classic queue for `q.price.found` under expected daily volume.
- Catalog ownership: who curates the 50+ canonical entries and reviews the unmatched queue?
