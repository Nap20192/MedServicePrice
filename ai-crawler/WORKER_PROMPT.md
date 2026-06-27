# ai-crawler — RabbitMQ worker + Postgres sink

This document has three parts:

- **Part A — Refined architecture** (the decisions and why).
- **Part B — Implementation prompt (English)** — self-contained, paste-ready for a coding agent.
- **Part C — Промпт (Russian)** — the same task, described in more detail, with full context.

---

## Part A — Refined architecture

### Today

`ai-crawler` is a **CLI** with two operations (`crawler/pipeline.py`):

- `create_or_update_adapter(start_url) -> SiteAdapter` — *discovery*: crawl the site, learn
  where prices live, persist a per-domain `SiteAdapter` on disk (`adapters/<domain>.json`,
  `state/<domain>/`). Expensive, exploratory.
- `fetch(start_url) -> int` — *collect*: load the adapter, walk its `data_urls`, extract
  clean rows, **write JSONL** (`<domain>-prices.jsonl` via `crawler/output/output.py`). Cheap,
  deterministic.

Row shape (`crawler/extract/record.py::OUTPUT_SCHEMA`):
`service_name_raw, price_kzt, duration_days, category, meta, url`.

Postgres already exists (`migrations/0001_initial.up.sql`): `clinics`, `sources`,
`services_catalog`, `parsed_services`. RabbitMQ topology already exists
(`queue/definitions.json`, loaded server-side): topic exchange `medprice.events`, DLX
`medprice.dlx`, queues `q.adapter.create`, `q.adapter.fetch`, `q.dead_letter`. The Go backend
is the API + **publisher** of `adapter.create` / `adapter.fetch`.

### Target

Make `ai-crawler` a long-running **worker** that is driven by RabbitMQ and writes to Postgres,
keeping the CLI intact. Add a future **normalize** service that closes the loop over the same bus.

```
 Go backend (API + scheduler)
     │  publish adapter.create {adapter_id, name, base_url, config}
     │  publish adapter.fetch  {adapter_id, url, trigger}
     ▼
 medprice.events (topic) ──► q.adapter.create ─┐
                          └─► q.adapter.fetch ──┤
                                                ▼
                                        ai-crawler WORKER  (new: crawler/worker/)
                          on adapter.create → create_or_update_adapter(base_url)
                                              → upsert clinic + source in Postgres
                                              → publish adapter.created
                          on adapter.fetch  → fetch(url) → rows
                                              → UPSERT parsed_services (dedup + stale-off)
                                              → publish parse.completed {source_id, count}
                                                ▲                         │
                                                │                         ▼
                          publish adapter.fetch │                   q.normalize
                          (re-crawl request)    │                         ▼
                                                └──────────── NORMALIZE service (future)
                                       reads parsed_services WHERE service_catalog_id IS NULL,
                                       matches → services_catalog, sets service_catalog_id,
                                       publishes normalize.done; may request a re-fetch.
```

### Decisions

1. **Worker, not rewrite.** Add `crawler/worker/` and a `python main.py worker` command. The
   handlers call the existing `pipeline.create_or_update_adapter` / `pipeline.fetch`. The CLI
   keeps working unchanged.
2. **Postgres is the sink, JSONL becomes optional.** `fetch` must expose the extracted rows so
   the worker can write them to `parsed_services` (today `fetch` returns only a count). Refactor
   minimally: have the worker call `collect(...)` the same way `fetch` does, or change `fetch`
   to return `(rows, stats)`; keep JSONL behind a flag.
3. **One clinic + one source per domain (MVP).** `adapter.create` upserts a `clinics` row
   (`name`, from message) and a `sources` row (`url` = `base_url`). All rows from a later
   `adapter.fetch` of that domain attach to that `source_id`. (`parsed_services` has no per-page
   URL column; the page url in the row is not stored — fine for MVP.)
4. **Idempotent upsert + stale deactivation.** Add a unique constraint
   `parsed_services(source_id, service_name_raw)` (new migration). On fetch: `INSERT ... ON
   CONFLICT (source_id, service_name_raw) DO UPDATE SET price_kzt, duration_days, parsed_at,
   is_active=true`. After the batch, set `is_active=false` for that source's rows not seen this
   run (service disappeared from the site). Reruns update, never duplicate.
5. **`service_catalog_id` stays NULL at ingest.** Normalization is a separate stage; the
   crawler never guesses the catalog id.
6. **Events out, for the loop.** Worker publishes to `medprice.events`:
   - `adapter.created` — after discovery (adapter_id, domain, data_urls count, source_id).
   - `parse.completed` — after fetch (adapter_id, source_id, url, prices_upserted, parsed_at).
     This is what the normalize service consumes (new binding `q.normalize` ← `parse.completed`).
   - `parse.error` — on a handled failure (adapter_id, url, stage, message).
7. **Reliability.** Manual ack: ack only after Postgres commit. On exception → `nack(requeue=false)`
   so the message dead-letters to `medprice.dlx`/`q.dead_letter`. The worker must **not** declare
   exchanges/queues — topology comes from `definitions.json`. Respect `config.rate_limit_ms` as a
   politeness delay.
8. **Normalize ↔ crawler is bidirectional over the bus.** Normalize consumes `parse.completed`,
   normalizes new `parsed_services` rows, and may publish `adapter.fetch` (re-crawl) back to the
   crawler — both directions go through `medprice.events`, no direct calls.

### Schema change to add (new migration `migrations/0002_parsed_services_dedup.up.sql`)

```sql
-- idempotent upsert key + faster "unmatched" scans for the normalize service
ALTER TABLE parsed_services
    ADD CONSTRAINT parsed_services_source_name_uq UNIQUE (source_id, service_name_raw);
CREATE INDEX IF NOT EXISTS idx_parsed_unmatched
    ON parsed_services (source_id) WHERE service_catalog_id IS NULL;
```
Down: drop the index and the constraint.

---

## Part B — Implementation prompt (English)

> **Role.** You are implementing a RabbitMQ-driven worker mode for the existing Python
> `ai-crawler` service in this monorepo, plus a Postgres sink, without breaking the CLI.
>
> **Repo context.**
> - Service root: `ai-crawler/`. Python **3.13** venv at `ai-crawler/.venv` (system Python lacks
>   `crawl4ai`); run everything as `.venv/bin/python`.
> - Existing pipeline (`ai-crawler/crawler/pipeline.py`):
>   `create_or_update_adapter(start_url: str) -> SiteAdapter` (discovery, persists adapter on disk),
>   `fetch(start_url: str) -> int` (loads adapter, extracts rows, currently writes JSONL via
>   `crawler/output/output.py::write_rows`). Rows follow `OUTPUT_SCHEMA` in
>   `crawler/extract/record.py`: `service_name_raw, price_kzt (string e.g. "1040.00"),
>   duration_days (int|null), category (ru), meta{group,category}, url`.
> - Config pattern (`crawler/config.py`): every setting is an env var, resolved
>   env → `.env` → `config.yaml` → default. Reuse it; add new settings there or in a small
>   `crawler/worker/settings.py`.
> - Postgres (`migrations/00001_initial.sql`): `clinics(id,name,city,address,phone,
>   working_hours)`, `sources(id,clinic_id,url)`, `services_catalog(id,name_norm,category)`,
>   `parsed_services(id,source_id,service_catalog_id,service_name_raw,price_kzt numeric,
>   currency enum KZT|USD,duration_days,parsed_at,is_active)`. Connection:
>   `DATABASE_URL=postgres://msp:msp@localhost:55432/msp?sslmode=disable`.
> - RabbitMQ: `RABBITMQ_URL=amqp://msp:msp@localhost:5672/`. Topology is created server-side from
>   `queue/definitions.json` — **do not declare** exchanges/queues in code. Topic exchange
>   `medprice.events`, DLX `medprice.dlx`. Consume queues `q.adapter.create` and `q.adapter.fetch`.
>   Deps already pinned: `aio-pika`, `asyncpg`, `apscheduler` (`ai-crawler/requirements.txt`).
> - Incoming messages (`queue/messages.md`), JSON, persistent:
>   - `adapter.create`: `{schema_version, msg_id, adapter_id, name, base_url, config:{rate_limit_ms, max_depth}, created_at}`
>   - `adapter.fetch`: `{schema_version, msg_id, adapter_id, url, trigger, requested_at}`
>
> **Build.**
> 1. New package `ai-crawler/crawler/worker/`:
>    - `settings.py` — `RABBITMQ_URL`, `DATABASE_URL`, exchange/queue/routing-key names, prefetch.
>    - `db.py` — asyncpg pool; `ensure_clinic_source(name, base_url) -> source_id`;
>      `upsert_prices(source_id, rows) -> int` using `INSERT ... ON CONFLICT
>      (source_id, service_name_raw) DO UPDATE`; `deactivate_stale(source_id, seen_names)`.
>      Convert `price_kzt` string → numeric; `currency='KZT'`; `service_catalog_id=NULL`.
>    - `bus.py` — aio-pika robust connection; consume a queue with manual ack; `publish(routing_key,
>      payload)` to `medprice.events` (persistent). On handler error `nack(requeue=False)`.
>    - `handlers.py` — `on_adapter_create(msg)`: call `create_or_update_adapter(base_url)`,
>      `ensure_clinic_source`, publish `adapter.created`. `on_adapter_fetch(msg)`: run the fetch,
>      get rows (refactor `fetch` to return rows, or replicate its `collect(...)` call), resolve
>      `source_id`, `upsert_prices`, `deactivate_stale`, publish `parse.completed`. Apply
>      `rate_limit_ms` delay.
>    - `runner.py` — connect, open the asyncpg pool, start both consumers, run forever.
>    - `__init__.py`.
> 2. `main.py` — add a `worker` command: `python main.py worker` → `asyncio.run(runner.main())`.
>    Keep `adapter`/`fetch`/`run` exactly as they are.
> 3. Minimal pipeline refactor so fetched rows are reachable by the worker without re-fetching.
>    Keep JSONL output behind a flag (e.g. `WRITE_JSONL=0` default in worker mode).
> 4. New goose migration `migrations/00003_parsed_services_dedup.sql` adding the unique
>    constraint `(source_id, service_name_raw)` and a partial index on `service_catalog_id IS NULL`.
> 5. Update `queue/definitions.json` + `queue/messages.md`: add outgoing routing keys
>    `adapter.created`, `parse.completed`, `parse.error`, and a `q.normalize` queue bound to
>    `parse.completed` for the future normalize service (DLX-wired like the others).
>
> **Constraints.**
> - Do not break the CLI. Do not redeclare RabbitMQ topology. Manual ack after DB commit; failures
>   dead-letter. Idempotent (rerun updates, never duplicates). Deterministic extraction stays the
>   default (no LLM required). Respect politeness delay. Async throughout (aio-pika + asyncpg).
>
> **Acceptance.**
> - `.venv/bin/python main.py worker` connects to RabbitMQ + Postgres and consumes both queues.
> - Publishing `adapter.create` for a domain runs discovery, creates `clinics`+`sources`, persists
>   the on-disk adapter, and emits `adapter.created`.
> - Publishing `adapter.fetch` for that domain upserts rows into `parsed_services` (deduped,
>   stale rows set `is_active=false`), with `service_catalog_id` NULL, and emits `parse.completed`.
> - Killing the worker mid-message leaves the message un-acked (redelivered); a poison message ends
>   up in `q.dead_letter`. Re-running a fetch does not create duplicate rows.

---

## Part C — Промпт (русский, подробно, со всем контекстом)

> **Роль.** Ты реализуешь режим воркера для существующего Python-сервиса `ai-crawler` в этом
> монорепозитории: сервис должен управляться через RabbitMQ и писать результаты в Postgres, при
> этом CLI должен продолжать работать. Дополнительно закладывается будущий сервис **normalize**,
> который общается с краулером через ту же шину.
>
> **Контекст репозитория.**
> - Корень сервиса: `ai-crawler/`. Виртуальное окружение Python **3.13** в `ai-crawler/.venv`
>   (системный Python не содержит `crawl4ai`) — запускать всё через `.venv/bin/python`.
> - Готовый пайплайн (`ai-crawler/crawler/pipeline.py`) имеет две операции:
>   - `create_or_update_adapter(start_url) -> SiteAdapter` — **discovery**: обходит сайт, находит,
>     где лежат цены, сохраняет на диск пер-доменный `SiteAdapter` (`adapters/<domain>.json`,
>     `state/<domain>/`). Дорогая операция.
>   - `fetch(start_url) -> int` — **сбор**: грузит адаптер, обходит его `data_urls`, извлекает
>     строки и сейчас пишет JSONL (`crawler/output/output.py::write_rows`). Дешёвая и
>     детерминированная.
>   Схема строки (`crawler/extract/record.py::OUTPUT_SCHEMA`): `service_name_raw`,
>   `price_kzt` (строка, напр. `"1040.00"`), `duration_days` (int|null), `category` (рус.),
>   `meta{group, category}`, `url`.
> - Конфиг (`crawler/config.py`): любая настройка — это переменная окружения, порядок
>   `env → .env → config.yaml → default`. Используй этот же механизм; новые настройки положи туда
>   или в небольшой `crawler/worker/settings.py`.
> - Postgres (`migrations/00001_initial.sql`): таблицы `clinics(id,name,city,address,phone,
>   working_hours)`, `sources(id,clinic_id,url)`, `services_catalog(id,name_norm,category)`,
>   `parsed_services(id,source_id,service_catalog_id,service_name_raw,price_kzt numeric,
>   currency enum KZT|USD,duration_days,parsed_at,is_active)`. Подключение:
>   `DATABASE_URL=postgres://msp:msp@localhost:55432/msp?sslmode=disable`.
> - RabbitMQ: `RABBITMQ_URL=amqp://msp:msp@localhost:5672/`. Топология создаётся на стороне сервера
>   из `queue/definitions.json` — **в коде ничего не объявлять** (ни exchange, ни очереди). Topic
>   exchange `medprice.events`, DLX `medprice.dlx`. Слушать очереди `q.adapter.create` и
>   `q.adapter.fetch`. Зависимости уже зафиксированы: `aio-pika`, `asyncpg`, `apscheduler`.
> - Входящие сообщения (`queue/messages.md`), JSON, persistent:
>   - `adapter.create`: `{schema_version, msg_id, adapter_id, name, base_url, config:{rate_limit_ms, max_depth}, created_at}` — создать/обновить адаптер.
>   - `adapter.fetch`: `{schema_version, msg_id, adapter_id, url, trigger, requested_at}` — запустить сбор данных.
>
> **Что построить.**
> 1. Новый пакет `ai-crawler/crawler/worker/`:
>    - `settings.py` — `RABBITMQ_URL`, `DATABASE_URL`, имена exchange/очередей/routing-key, prefetch.
>    - `db.py` — пул asyncpg; `ensure_clinic_source(name, base_url) -> source_id` (идемпотентно
>      создаёт клинику и источник); `upsert_prices(source_id, rows) -> int` через
>      `INSERT ... ON CONFLICT (source_id, service_name_raw) DO UPDATE SET price_kzt,
>      duration_days, parsed_at, is_active=true`; `deactivate_stale(source_id, seen_names)` —
>      выставить `is_active=false` тем услугам источника, которых не было в этом проходе.
>      `price_kzt`: строку → numeric; `currency='KZT'`; `service_catalog_id=NULL` (нормализатор
>      проставит позже).
>    - `bus.py` — устойчивое подключение aio-pika; потребление очереди с **ручным ack**;
>      `publish(routing_key, payload)` в `medprice.events` (persistent). При ошибке обработчика —
>      `nack(requeue=False)` (сообщение уходит в DLX).
>    - `handlers.py`:
>      - `on_adapter_create(msg)` — вызвать `create_or_update_adapter(base_url)`,
>        `ensure_clinic_source(name, base_url)`, опубликовать `adapter.created`.
>      - `on_adapter_fetch(msg)` — выполнить сбор, получить строки (отрефакторить `fetch`, чтобы он
>        возвращал строки, либо повторить его вызов `collect(...)`), найти `source_id`, вызвать
>        `upsert_prices` + `deactivate_stale`, опубликовать `parse.completed`. Учитывать задержку
>        `rate_limit_ms`.
>    - `runner.py` — подключиться, открыть пул asyncpg, поднять оба потребителя, работать бесконечно.
>    - `__init__.py`.
> 2. `main.py` — добавить команду `worker`: `python main.py worker` → `asyncio.run(runner.main())`.
>    Команды `adapter`/`fetch`/`run` оставить без изменений.
> 3. Минимальный рефактор пайплайна, чтобы строки после `fetch` были доступны воркеру без
>    повторного обхода. JSONL-вывод оставить за флагом (`WRITE_JSONL=0` по умолчанию в воркере).
> 4. Новая миграция `migrations/0002_parsed_services_dedup.{up,down}.sql`: уникальное ограничение
>    `(source_id, service_name_raw)` + частичный индекс по `service_catalog_id IS NULL`
>    (для нормализатора). В down — откат обоих.
> 5. Обновить `queue/definitions.json` и `queue/messages.md`: добавить исходящие routing-key
>    `adapter.created`, `parse.completed`, `parse.error` и очередь `q.normalize`, привязанную к
>    `parse.completed` (для будущего сервиса normalize), с DLX как у остальных.
>
> **Ограничения.**
> - Не ломать CLI. Не переобъявлять топологию RabbitMQ. Ручной ack только после коммита в Postgres;
>   сбои уходят в DLX. Идемпотентность: повторный прогон обновляет, а не дублирует. Детерминированная
>   экстракция остаётся по умолчанию (LLM не требуется). Соблюдать вежливую задержку. Всё асинхронно
>   (aio-pika + asyncpg).
>
> **Критерии приёмки.**
> - `.venv/bin/python main.py worker` подключается к RabbitMQ и Postgres и слушает обе очереди.
> - Публикация `adapter.create` по домену запускает discovery, создаёт `clinics`+`sources`,
>   сохраняет адаптер на диск, публикует `adapter.created`.
> - Публикация `adapter.fetch` по тому же домену делает upsert строк в `parsed_services`
>   (без дублей; пропавшие услуги → `is_active=false`), `service_catalog_id` = NULL, публикует
>   `parse.completed`.
> - Падение воркера в середине обработки оставляет сообщение без ack (переотправка); «ядовитое»
>   сообщение попадает в `q.dead_letter`. Повторный `fetch` не создаёт дублей.
>
> **Будущий сервис normalize (контекст, реализовывать не сейчас).** Отдельный сервис слушает
> `parse.completed` (очередь `q.normalize`), читает `parsed_services WHERE service_catalog_id IS
> NULL`, сопоставляет сырые названия со `services_catalog` (fuzzy/LLM), проставляет
> `service_catalog_id`, публикует `normalize.done`; при необходимости публикует `adapter.fetch`
> обратно краулеру (доп. сбор). Связь двусторонняя и идёт только через `medprice.events`.
