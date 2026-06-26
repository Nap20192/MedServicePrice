# RabbitMQ topology — MedServicePrice

Replaces NATS from the original sketch. One **topic exchange** carries all events; a
**dead-letter exchange** catches anything that fails N times so a stuck message never
blocks a queue (NFR: отказоустойчивость — сбой одного источника не валит остальные).

```
                         exchange: medprice.events  (topic, durable)
   Go scheduler  ──parse.start──▶ q.parse.start      ──▶ Python crawler
   Python        ──price.found──▶ q.price.found      ──▶ Go consumer (normalize+save)
   Python        ──parse.done──▶  q.parse.done       ──▶ Go (close parse_run)
   Python        ──parse.error─▶  q.parse.error      ──▶ Go (write parse_errors)
   Go consumer   ──enrich.request▶ q.enrich.request  ──▶ Go enrich (geo/rating/2gis)
   Go consumer   ──price.changed▶  q.notify          ──▶ Go notifier (subscriptions)

   any queue (after retries) ──▶ medprice.dlx ──dlq.#──▶ q.dead_letter (manual triage)
```

## Routing keys (events)

| Routing key     | Producer        | Consumer queue     | Meaning |
|-----------------|-----------------|--------------------|---------|
| `parse.start`   | Go scheduler    | `q.parse.start`    | Kick a crawl. Payload = one source (fan out one msg per source). |
| `price.found`   | Python crawler  | `q.price.found`    | A single scraped price. Small message, no HTML. |
| `parse.done`    | Python crawler  | `q.parse.done`     | A source finished; counters for `parse_runs`. |
| `parse.error`   | Python crawler  | `q.parse.error`    | A fetch/extract failure; row for `parse_errors`. |
| `enrich.request`| Go consumer     | `q.enrich.request` | New/updated clinic needs geo+rating+booking. |
| `price.changed` | Go consumer     | `q.notify`         | Price moved; notifier checks `subscriptions`. |

## Why one message per source on `parse.start`

Lets the crawler process sources independently and in parallel; one bad source dead-letters
on its own without stalling the rest. The scheduler publishes N messages (one per enabled
`sources` row) per daily tick, plus ad-hoc on manual "parse now" from the UI.

## Delivery rules

- All queues **durable**, messages published **persistent** (`delivery_mode=2`).
- Consumers use **manual ack**; ack only after the DB write commits (at-least-once).
- `q.price.found` is a **quorum queue** — it is the hot path, quorum gives HA + safe redelivery.
- `prefetch` (QoS): crawler-facing low (e.g. 1–4); `q.price.found` higher (e.g. 50) for throughput.
- Retry: on nack-without-requeue the message dead-letters to `medprice.dlx` → `q.dead_letter`.
  Add an `x-message-ttl` + per-queue retry exchange later if you want auto-backoff.

## Idempotency

`price.found` carries a `dedup_key`; the consumer upserts on `prices(clinic_id,
service_name_raw)`, so a redelivered message updates the same row instead of duplicating
(TЗ 3.1 дедупликация). Same idea for clinics via `(source_id, dedup_key)`.

## Import

```bash
# management plugin must be enabled
rabbitmqadmin import queue/definitions.json
# or: Management UI → Overview → Import definitions
```

Message payload shapes: see `queue/messages.md`.
