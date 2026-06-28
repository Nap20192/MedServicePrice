# normalize service

Separate Go binary that maps freshly-parsed rows onto the service catalog.

```
ai-crawler worker ──parse.completed──▶ q.parse.completed ──▶ normalize
        ▲                                                        │
        └────── adapter.fetch / adapter.create ◀── (re-request) ─┘
normalize:  parsed_services(service_catalog_id IS NULL) ──match──▶ services_catalog
```

## Layout (per-service layers)

```
cmd/normalize/main.go               entrypoint — wiring + signals
internal/normalize/
  app/        consumer.go           delivery: RabbitMQ Handler (ack / DLX)
  usecase/    normalize.go          business logic: load → match → bind
  domain/     events.go             types + Repository port (interface)
  repository/postgres/repo.go       persistence: parsed_services / services_catalog
internal/platform/database/         shared sqlx/pgx connection (used by all services)
```

Single Go module (`medprice`); reuses `pkg/rabbitmq` and the shared
`internal/platform/database`. No new dependencies. The api service mirrors the same
four layers under `internal/api/`.

## What it does

1. Consumes `q.parse.completed` (`{adapter_id, source_id, rows_written, parsed_at}`).
2. Loads active rows of that source where `service_catalog_id IS NULL`.
3. Matches each `service_name_raw` against `services_catalog` and sets `service_catalog_id`.
4. Misses stay `NULL` (manual-labeling queue — TODO).
5. Manual ack; on error `Nack(requeue=false)` → DLX (`q.parse.completed` has one).

To request more data it **reuses** `adapter.fetch` / `adapter.create` (no new routing keys).

## Run with AI

```bash
RABBITMQ_URL=amqp://msp:msp@localhost:5672/ \
DATABASE_URL=postgres://msp:msp@localhost:55432/msp?sslmode=disable \
LLM_BASE_URL=https://api.deepseek.com \
LLM_API_KEY=... \
LLM_MODEL=deepseek-chat \
LLM_MIN_CONFIDENCE=0.7 \
LLM_TIMEOUT_S=20 \
LLM_MAX_TOKENS=120 \
LLM_MAX_CALLS_PER_SOURCE=80 \
NORMALIZE_WORKERS=1 \
NORMALIZE_SOURCE_WORKERS=2 \
go run ./cmd/normalize
```

For Docker Compose, put the same values into `deploy/.env` and run:

```bash
docker compose -f deploy/docker-compose.yml up normalize
```

## Matching strategy

- deterministic match: alias, exact catalog key, trigram/fuzzy candidates;
- AI fallback: OpenAI-compatible `/chat/completions` endpoint decides whether to bind
  to an existing catalog entry or create a new canonical service;
- token guard: the LLM answer is capped by `LLM_MAX_TOKENS`, each source is capped by
  `LLM_MAX_CALLS_PER_SOURCE`, and quota/rate-limit/token errors disable the LLM until
  process restart while deterministic matching keeps running;
- worker pools: `NORMALIZE_WORKERS` controls RabbitMQ event consumers, while
  `NORMALIZE_SOURCE_WORKERS` controls how many pending sources the sweep processes
  in parallel;
- unmatched/noisy rows are persisted in `unmatched_services`;
- normalized, deduplicated offers are published to `service_offers`, which is the only
  table read by the public API.
