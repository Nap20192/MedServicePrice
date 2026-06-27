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

