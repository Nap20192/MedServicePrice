# Message payloads

All bodies are JSON, UTF-8, published **persistent**. Each carries `schema_version` and a
`msg_id` (UUID) for tracing/idempotency. Keep them small — no HTML, no PDFs (raw bytes go
straight to `raw_pages` from Python).

## `parse.start`  (Go scheduler → Python)

One message per source.

```json
{
  "schema_version": 1,
  "msg_id": "0b9b...uuid",
  "parse_run_id": "f1c2...uuid",
  "source": {
    "id": "a3d1...uuid",
    "code": "kdl",
    "base_url": "https://kdl.kz",
    "parser_kind": "html",
    "request_delay_ms": 2000,
    "respect_robots": true,
    "config": { "start_urls": ["https://kdl.kz/analyzes"], "max_depth": 3 }
  },
  "trigger": "schedule"
}
```

## `price.found`  (Python → Go consumer)

The hot path. One scraped price.

```json
{
  "schema_version": 1,
  "msg_id": "77aa...uuid",
  "parse_run_id": "f1c2...uuid",
  "source_code": "kdl",
  "clinic": {
    "name": "KDL Алматы, ул. Абая 10",
    "city": "Алматы",
    "address": "ул. Абая 10",
    "phone": "+7 727 000 00 00",
    "working_hours": "Пн-Пт 08:00-18:00",
    "source_url": "https://kdl.kz/almaty/abaya-10",
    "dedup_key": "kdl|almaty|abaya-10"
  },
  "service_name_raw": "Общий анализ крови (ОАК) с лейкоформулой",
  "category_hint": "lab",
  "price": 2500.00,
  "currency": "KZT",
  "duration_days": 1,
  "source_url": "https://kdl.kz/almaty/abaya-10/oak",
  "parsed_at": "2026-06-26T09:12:00Z"
}
```

Consumer steps: upsert clinic → normalize `service_name_raw` (trgm/fuzzy → catalog, fall
back to Ollama) → upsert `prices` → on price change publish `price.changed` → publish
`enrich.request` if clinic geo missing.

## `parse.done`  (Python → Go)

```json
{
  "schema_version": 1,
  "msg_id": "12cd...uuid",
  "parse_run_id": "f1c2...uuid",
  "source_code": "kdl",
  "pages_fetched": 142,
  "prices_found": 1180,
  "errors_count": 3,
  "finished_at": "2026-06-26T09:40:00Z"
}
```

## `parse.error`  (Python → Go)

```json
{
  "schema_version": 1,
  "msg_id": "98ef...uuid",
  "parse_run_id": "f1c2...uuid",
  "source_code": "invitro",
  "url": "https://invitro.kz/price.pdf",
  "stage": "parse_pdf",
  "error_type": "decode_error",
  "message": "could not extract table from page 4",
  "occurred_at": "2026-06-26T09:21:00Z"
}
```

## `enrich.request`  (Go consumer → Go enrich)

```json
{
  "schema_version": 1,
  "msg_id": "a1b2...uuid",
  "clinic_id": "c0ff...uuid",
  "name": "KDL Алматы, ул. Абая 10",
  "city": "Алматы",
  "address": "ул. Абая 10",
  "want": ["geo", "rating", "online_booking", "twogis_id"]
}
```

## `price.changed`  (Go consumer → Go notifier)

```json
{
  "schema_version": 1,
  "msg_id": "d4e5...uuid",
  "price_id": "be11...uuid",
  "catalog_id": "ca7a...uuid",
  "clinic_id": "c0ff...uuid",
  "city": "Алматы",
  "old_price_kzt": 2800.00,
  "new_price_kzt": 2500.00,
  "changed_at": "2026-06-26T09:30:00Z"
}
```
