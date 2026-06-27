# Message payloads

All bodies are JSON, UTF-8, published **persistent**. Each carries `schema_version` and a
`msg_id` (UUID) for tracing/idempotency.

## 1. `adapter.create`  (Backend → Worker)

Used to configure or register a new adapter.

```json
{
  "schema_version": 1,
  "msg_id": "0b9b...uuid",
  "adapter_id": "kdl_adapter",
  "name": "KDL Kazakhstan",
  "base_url": "https://kdl.kz",
  "config": {
    "rate_limit_ms": 2000,
    "max_depth": 3
  },
  "created_at": "2026-06-27T10:00:00Z"
}
```

## 2. `adapter.fetch`  (Backend → Worker)

Used to trigger an actual data fetch.

```json
{
  "schema_version": 1,
  "msg_id": "77aa...uuid",
  "adapter_id": "kdl_adapter",
  "url": "https://kdl.kz/analyzes",
  "trigger": "schedule",
  "requested_at": "2026-06-27T10:05:00Z"
}
```

## 3. `parse.completed`  (Worker → Backend / Normalize)  — NEW

Emitted by the worker after a successful `adapter.fetch` has loaded rows into
`parsed_services`. Tells the normalize service that fresh, unmapped rows exist for a
source (it then maps `service_name_raw` → `services_catalog`). Queue: `q.parse.completed`.

```json
{
  "schema_version": 1,
  "msg_id": "d4e5...uuid",
  "adapter_id": "kdl_adapter",
  "source_id": "c0ffee00-...-uuid",
  "rows_written": 1180,
  "parsed_at": "2026-06-27T10:40:00Z"
}
```

### Normalize → ai-crawler (re-fetch / re-discover)

Normalize does **not** get new routing keys for asking work — it **reuses the existing
ones** so ai-crawler stays the single executor:

- to refresh prices for a source → publish `adapter.fetch` `{adapter_id, url, trigger:"normalize"}`.
- to rebuild a stale/broken adapter → publish `adapter.create` `{adapter_id, name, base_url, config}`.

So the contract is one new outbound event (`parse.completed`) and zero new inbound
queues; the loop is `adapter.fetch → parse.completed → (normalize maps) → adapter.fetch…`.

> **Proposed, not assumed:** `parse.completed` is the routing key chosen here. If the
> backend prefers `parse.done`/`normalize.request`, only this key + the
> `q.parse.completed` binding in `definitions.json` change.

