# ai-crawler

Generic price crawler. Site knowledge is **learned at runtime** and persisted to
`adapters/<domain>.json` + `state/<domain>/`. Two entrypoints share the same pipeline:

- **CLI** (`main.py`) — one-shot, writes `<domain>-prices.jsonl`.
- **Worker** (`worker.py`) — long-running RabbitMQ consumer, writes to Postgres
  (`parsed_services`) and emits `parse.completed`.

## CLI (unchanged)

```bash
python main.py adapter <url>   # discover / refresh the site adapter
python main.py fetch   <url>   # walk the adapter's data-URLs, write JSONL
python main.py <url>           # adapter-if-missing, then fetch
```

## Worker

Consumes `q.adapter.create` and `q.adapter.fetch` (server-declared from
`queue/definitions.json` — the worker never declares topology). Manual ack: ack on
success, `reject(requeue=False)` → DLX on failure, so one bad source never stalls the
rest. Re-deliveries are skipped via the `processed_messages` ledger (dedup by `msg_id`).

```bash
# 1. infra (postgres + rabbitmq + migrations) — from repo root
cd deploy && cp .env.example .env && docker compose up -d postgres rabbitmq migrate

# 2. run the worker (local venv)
cd ../ai-crawler
RABBITMQ_URL=amqp://msp:msp@localhost:5672/ \
DATABASE_URL=postgres://msp:msp@localhost:55432/msp \
SINK=postgres python worker.py
```

Or run everything (incl. the worker) in Docker via the explicit profile:

```bash
cd deploy && docker compose --profile docker-worker up -d --build
```

### Flow

```
adapter.create ─▶ worker.create_or_update_adapter() + register clinic/source
adapter.fetch  ─▶ worker.fetch(url, PostgresSink) ─▶ parsed_services
                                                  └▶ publish parse.completed
parse.completed ─▶ normalize maps service_name_raw → services_catalog
                   (normalize re-requests work via adapter.fetch / adapter.create)
```

### Config (via `crawler/config.py`, env-first)

| Var | Default | Meaning |
|-----|---------|---------|
| `RABBITMQ_URL` | `amqp://msp:msp@localhost:5672/` | broker |
| `DATABASE_URL` | `postgres://msp:msp@localhost:55432/msp` | asyncpg DSN |
| `WORKER_PREFETCH` | `1` | QoS; keep 1 for discovery (per-run knobs are process-global) |
| `SINK` | `postgres` | `postgres` \| `jsonl` \| `both` |

### Persistence model

`parsed_services` holds one **live** row per `(source_id, service_name_raw)`. A re-fetch
is a full replace of the source's live list: in one transaction it sets all the source's
rows `is_active=false`, then upserts the current rows back to `is_active=true`.
`service_catalog_id` (filled by normalize) is preserved across upserts. An empty fetch is
treated as a transient failure and leaves existing rows untouched.

### Known limitations / assumptions

- `config.max_depth` is applied per run by patching module globals; safe only at
  `WORKER_PREFETCH=1` (serialized discovery).
- `config.rate_limit_ms` is recorded but request-pacing into crawl4ai (`mean_delay`)
  is not yet wired — follow-up.
- `parse.completed` is a **proposed** routing key; change it in one place
  (`definitions.json` binding + `worker.RK_COMPLETED`) if the backend wants another name.
