# MedServicePrice.kz

**Агрегатор цен на медицинские услуги в Казахстане.** Автоматически собирает прайсы клиник, нормализует названия к единому справочнику и даёт пользователю поиск с фильтрами и картой — как Aviasales, но для медицины.

🔗 **Live:** https://med-service-price-production.up.railway.app/

---

## Что умеет

- Поиск по нормализованным названиям услуг с автодополнением (ОАК → Общий анализ крови)
- Фильтры: город, категория, ценовой диапазон, рейтинг клиники
- Сортировка по цене (дешевле / дороже) и дате обновления
- Переключение между списком и картой (координаты из Google Maps)
- Карточка клиники со всеми услугами, контактами, режимом работы
- Пометка данных старше 30 дней
- Административный интерфейс для управления источниками и клиниками
- Автозапуск сбора данных по расписанию (интервал настраивается из UI)

---

## Архитектура

```
┌──────────────────────────────────────────────────┐
│                   Frontend (React)               │
│   HomePage · SearchPage · ClinicPage · Sources   │
└────────────────────┬─────────────────────────────┘
                     │ REST /api/v1
┌────────────────────▼─────────────────────────────┐
│              Go API  (chi)                        │
│  /prices · /sources · /clinics · /scheduler       │
└──────────┬──────────────────┬────────────────────┘
           │ RabbitMQ         │ Postgres (pgx/sqlx)
           │                  │
┌──────────▼──────┐  ┌────────▼───────────────────┐
│  ai-crawler     │  │  Go Normalize service        │
│  (Python 3.13)  │  │  Sweep → fuzzy match → LLM  │
│  worker.py      │  │  raw → service_offers (gold) │
└─────────────────┘  └────────────────────────────┘
           │
     Postgres (raw layer: parsed_services)
```

### Сервисы

| Сервис | Стек | Роль |
|---|---|---|
| **api** | Go 1.25, chi | REST API, управление источниками/клиниками, шедулер |
| **normalize** | Go 1.25 | Нормализация raw → gold, LLM-куратор |
| **ai-crawler** | Python 3.13 | AI-агент парсинга прайсов клиник |
| **frontend** | React, Vite, TypeScript, Tailwind | Пользовательский UI |
| **postgres** | PostgreSQL | Единственная БД; 12 миграций через goose |
| **rabbitmq** | RabbitMQ + management | Очередь задач: `q.adapter.create`, `q.adapter.fetch` |

---

## Поток данных

```
Оператор добавляет URL прайса (UI/API)
  → Go API публикует в q.adapter.create
  → ai-crawler worker: discovery (LinkAgent) → SiteAdapter.json (персистентный профиль сайта)
  → worker публикует в q.adapter.fetch
  → ai-crawler: fetch по сохранённым data_urls → parsed_services (raw, Postgres)
  → worker публикует parse.completed
  → Go normalize: sweep по unnormalized записям → trigram + aliases → LLM (если нет детерминированного матча)
  → service_offers (gold layer) — API читает только отсюда
```

---

## Источники данных (парсятся реально)

`kdlolymp.kz` · `invitro.kz` · `helix.kz` · `doq.kz` · `olymp.kz` · `medel.kz` · `emirmed.kz` · `mck.kz`

Добавление нового источника: вставить URL в UI → краулер автоматически делает discovery.

---

## База данных

12 миграций (goose), ключевые таблицы:

| Таблица | Слой | Назначение |
|---|---|---|
| `clinics` | dim | Клиники с адресом, телефоном, координатами (Google Places), рейтингом |
| `sources` | raw | URL прайс-страницы, FK → clinic |
| `parsed_services` | raw | Сырые записи от парсера (читает только normalize service) |
| `services_catalog` | dim | Нормализованный справочник (name_norm, category) |
| `service_aliases` | dim | Синонимы: ОАК, CBC, Клинический анализ крови → один catalog entry |
| `service_offers` | **gold** | Одно живое предложение на (source, catalog_service); API читает только это |
| `unmatched_services` | queue | Записи без матча — очередь ручной разметки |

Нормализация: `pg_trgm` (fuzzy) + `msp_name_key()` (канонический ключ) + LLM (DeepSeek/Ollama) как последний уровень.

---

## AI-краулер (`ai-crawler/`)

Python-сервис с двумя режимами работы:

**`adapter <url>`** — discovery: агент (`LinkAgent`) обходит сайт, обучает `SiteAdapter.json` — per-domain профиль с productive data_urls, правилами маршрутизации, fetch plan (http/browser).

**`fetch <url>`** — детерминированный прогон по сохранённым URL (секунды вместо минут).

**Экстракторы (tiered, fast-first):**
1. `jsonld` — schema.org Product/Offer
2. `schema` — кешированная CSS-схема (если была выведена ранее)
3. `links` — markdown-ссылки с ценой (kdlolymp)
4. `blocks` — `№`-анкорные карточки (invitro)
5. `html` — DOM `label + price-leaf` по заголовкам (emirmed)
6. `regex` — таблицы/строки с look-back на название
7. `schema-gen` (**LLM**) — выводит CSS-схему; только если все выше дали 0 строк

LLM-тир отключён по умолчанию (`LLM_SCHEMA_GEN=0`). Транспорт: HTTP-first, escalate to headless Chromium для SPA.

---

## Нормализация (`internal/normalize/`)

Go-сервис слушает `q.parse.completed` и по sweep-расписанию обрабатывает новые `parsed_services`:

1. Exact match по `name_key` (canonical функция в Postgres)
2. Alias lookup (`service_aliases`)
3. Trigram similarity (`pg_trgm`) — топ-5 кандидатов
4. LLM (`deepseek-chat` / Ollama) — решает match/no-match, возвращает `confidence`; при confidence < порога → auto-create новой записи в справочнике
5. Результат → `service_offers` (upsert по `source_id, service_catalog_id`)

---

## API (`/api/v1`)

| Метод | Endpoint | Описание |
|---|---|---|
| `GET` | `/prices` | Поиск цен; фильтры: query, city, category, min/max price, rating_min, sort, limit/offset |
| `POST` | `/sources` | Добавить URL прайса (опция fetch_now) |
| `GET` | `/sources` | Список источников с деталями |
| `POST` | `/sources/{id}/fetch` | Запустить парсинг вручную |
| `POST` | `/sources/{id}/adapter` | Перестроить адаптер (re-discovery) |
| `POST` | `/sources/{id}/branches` | Создать филиалы сети под одним источником |
| `POST` | `/sources/{id}/clinic` | Привязать источник к клинике |
| `POST` | `/clinics` | Создать клинику вручную |
| `GET` | `/clinics` | Список клиник |
| `GET` | `/clinics/google-places/search` | Поиск клиник через Google Maps Places API |
| `POST` | `/clinics/google-places/import` | Импорт клиники из Google Maps (с координатами, рейтингом) |
| `GET/PUT` | `/scheduler` | Настройки автозапуска (интервал в часах) |
| `GET` | `/health` | Health check |

---

## Frontend (`frontend/`)

React + Vite + TypeScript + Tailwind CSS. Страницы:

- **HomePage** — hero с поиском, быстрые категории (8 популярных услуг), статистика из БД, список источников
- **SearchPage** — поиск с sidebar-фильтрами (категория, цена, рейтинг), сортировка, пагинация, переключение список/карта (Leaflet)
- **ClinicPage** — карточка клиники с полным списком её услуг
- **SourcesPage** — admin-панель: добавление URL, создание клиник вручную, поиск/импорт из Google Maps, управление филиалами сети, шедулер

---

## Локальный запуск

### Требования
- Docker + Docker Compose
- Go 1.21+ (для локальной разработки)
- Python 3.13 + venv (для краулера)
- Node.js 20+ (для frontend)

### Docker Compose (полный стек)

```bash
cp deploy/.env.example deploy/.env
# Заполните deploy/.env (опционально: GOOGLE_MAPS_API_KEY, LLM_API_KEY)

cd deploy
docker compose up --build
```

Сервисы:
- Frontend: http://localhost:3000
- API: http://localhost:8080
- RabbitMQ Management: http://localhost:15672 (msp / msp)

Миграции применяются автоматически при старте API (`RUN_MIGRATIONS=1`).

### Только краулер (CLI)

```bash
cd ai-crawler
python -m venv .venv
.venv/bin/pip install -r requirements.txt
python -m playwright install chromium

cp .env.example .env
# Укажите DATABASE_URL и RABBITMQ_URL если нужен Postgres-sink

# Открытие нового сайта
.venv/bin/python main.py adapter https://invitro.kz/

# Быстрый повторный сбор данных
.venv/bin/python main.py fetch https://invitro.kz/
```

### Только frontend (dev)

```bash
cd frontend
cp .env.example .env.local
# VITE_API_BASE_URL=http://localhost:8080/api/v1

npm install
npm run dev
```

---

## Переменные окружения

Все переменные из `deploy/.env.example`:

| Переменная | Описание |
|---|---|
| `DATABASE_URL` | PostgreSQL DSN для API и normalize |
| `RABBITMQ_URL` | AMQP URL |
| `HTTP_PORT` | Порт API (по умолчанию 8080) |
| `GOOGLE_MAPS_API_KEY` | Google Places API (опционально, для импорта координат) |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | LLM для нормализации (DeepSeek или Ollama) |
| `LLM_MIN_CONFIDENCE` | Минимальная уверенность LLM для принятия матча (0.7) |
| `NORMALIZE_SWEEP_INTERVAL_S` | Интервал sweep нормализации (300 с) |
| `VITE_API_BASE_URL` | URL бэкенда для frontend-сборки |

Для краулера (`ai-crawler/.env.example`): `MAX_DEPTH`, `CONCURRENCY`, `LLM_SCHEMA_GEN`, `CRAWL_MODE`, `BROWSER_VISIBLE`, `MIN_PRICE`, `OUTPUT_DIR`.

---

## Структура репозитория

```
MedServicePrice/
├── cmd/
│   ├── api/          — entrypoint Go API + Dockerfile
│   └── normalize/    — entrypoint Go normalize service + Dockerfile
├── internal/
│   ├── api/          — HTTP handlers, domain models, usecases, repository
│   └── normalize/    — normalize usecases, LLM client (DeepSeek/OpenAI-compat)
├── pkg/
│   ├── logger/       — structured logger
│   └── rabbitmq/     — AMQP helper
├── migrations/       — 12 goose SQL миграций
├── frontend/         — React/Vite SPA
│   └── src/
│       ├── pages/    — HomePage, SearchPage, ClinicPage, SourcesPage
│       ├── components/
│       └── api/      — typed fetch-клиент
├── ai-crawler/       — Python парсер
│   ├── crawler/      — pipeline, discovery, fetch, extract, adapter, output
│   ├── worker.py     — RabbitMQ consumer
│   └── main.py       — CLI entrypoint
├── deploy/           — docker-compose + Dockerfiles для postgres/rabbitmq/goose
└── queue/            — RabbitMQ definitions.json (topology)
```

---

## Нефункциональные характеристики

- **Слои данных разделены**: API никогда не читает `parsed_services` (raw), только `service_offers` (gold)
- **Отказоустойчивость краулера**: недоступность одного сайта не блокирует остальные; dead-letter queue для failed messages
- **Масштабируемость**: адаптеры per-domain и независимы, краулер stateless (state на диске), добавление нового источника без изменения кода
- **Прозрачность**: дата последнего парсинга отображается для каждой цены; данные старше 30 дней помечаются
- **Дедупликация**: `UNIQUE (source_id, service_catalog_id)` в `service_offers`; raw-слой дедуплицируется миграцией

---

## Хакатон

Проект создан на хакатоне MedTech 2025, кейс 1 — MedServicePrice.kz.

Критерии оценки: качество данных (25%), UX (25%), техническая реализация (20%), охват рынка (15%), дополнительные функции (15%).
