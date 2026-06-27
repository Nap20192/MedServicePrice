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

## Run

```bash
RABBITMQ_URL=amqp://msp:msp@localhost:5672/ \
DATABASE_URL=postgres://msp:msp@localhost:55432/msp?sslmode=disable \
go run ./cmd/normalize
```

## Status: STUB (per spec)

- **Matcher** = exact, case-insensitive lookup on `name_norm`. TODO: trigram/fuzzy
  similarity + synonyms + optional Ollama fallback.
- **Unmatched queue** not persisted yet (only counted/logged).
