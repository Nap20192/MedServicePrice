# ai-crawler — Architecture & Operations Guide

A price-scraping service for Kazakhstan medical-service websites (invitro.kz,
kdlolymp.kz, emirmed.kz, …). It discovers where prices live on a site, learns a
reusable per-site profile (the **adapter**), then fetches and extracts clean
price rows into per-domain JSONL.

The engine is **generic**; everything site-specific is learned at runtime and
persisted, so repeat runs skip discovery and just collect data fast.

---

## 1. What it produces

One JSONL file per domain, `<domain-slug>-prices.jsonl` (e.g. `invitro-prices.jsonl`).
Each line is one service:

```json
{
  "service_name_raw": "Лейкоцитарная формула (...)",
  "price_kzt": "1040.00",
  "duration_days": 1,
  "category": "лаборатория",
  "meta": {"group": "Гематология", "category": "лаборатория"},
  "url": "https://invitro.kz/analizes/for-doctors/aktobe"
}
```

Schema is defined in `crawler/extract/record.py::OUTPUT_SCHEMA`:
`service_name_raw, price_kzt, duration_days, category, meta, url`.

- `category` ∈ {`лаборатория`, `приём врача`, `диагностика`, `процедура`, `прочее`}.
- `meta.group` = section/specialty heading captured during structural extraction.
- `duration_days` = parsed from "N календарных/рабочих дней" etc., else `null`.

---

## 2. Mental model

The service has **two operations** and a convenience wrapper:

| Command | Function | What it does |
|---|---|---|
| `adapter <url>` | `pipeline.create_or_update_adapter` | **Discover** the site, learn where data lives + how to read it, persist a `SiteAdapter`. |
| `fetch <url>` | `pipeline.fetch` | **Collect**: load the adapter, walk its data-URLs, extract, write JSONL. No discovery. |
| `run <url>` / bare `<url>` | `pipeline.run` | Build the adapter if missing (or `REDISCOVER=1`), then fetch. |

```
python main.py adapter https://invitro.kz/     # first time / refresh
python main.py fetch   https://invitro.kz/     # fast repeat runs
python main.py         https://invitro.kz/     # convenience (adapter-if-missing + fetch)
```

Always run with the project venv (Python 3.13): `.venv/bin/python main.py …`
(system Python lacks `crawl4ai`).

The split matters: **discovery is expensive and exploratory; fetch is cheap and
deterministic.** Once the adapter knows the ~17 productive URLs for invitro, a
fetch is seconds, not minutes.

---

## 3. Data flow

```
                          ┌─────────────── adapter command ───────────────┐
start_url ─► discovery (agent loop) ─► page processing ─► RouteStore + SiteAdapter (persisted)
            crawler/discovery         crawler/extract/        state/<domain>/  adapters/<domain>.json
                                      pageproc.py             schemas/<domain>__<sig>.json

                          ┌──────────────── fetch command ────────────────┐
SiteAdapter.data_urls ─► collector ─► fetcher (HTTP/browser) ─► page processing ─► write_rows
                         crawler/fetch  crawler/fetch/fetcher    pageproc.py        output/output.py
                                                                                    <domain>-prices.jsonl
```

Both operations funnel every fetched `Page` through the **same** page processor
(`crawler/extract/pageproc.py`), which validates the route, runs the tiered
extractor, classifies category, and records stats.

---

## 4. Package layout

Imports are absolute (`crawler.<pkg>.<mod>`), so nesting depth never breaks them.

```
crawler/
  config.py        Central config (env + .env + config.yaml) and logging setup.
  pipeline.py      The two operations (adapter / fetch) + run wrapper. Orchestrator.

  common/          Leaf utilities, no internal deps.
    patterns.py    Compiled regexes (price, duration, currency, layout anchors).
    canonical.py   URL canonicalisation (dedupe key).
    models.py      Dataclasses: Page, FetchPlan.
    promptlog.py   Structured LLM-prompt logging (PROMPT_BEGIN/BODY/END).

  routing/         URL → route knowledge.
    routes.py      route_template(), route_valid(), RouteStore (per-domain state).
    urlinfo.py     infer_city(), url_metadata() (route_template + city + category).

  fetch/           Network only. No extraction.
    fetcher.py     HTTP-first deep crawl, URLFetcher, browser fallback (GPU off).
    collector.py   The fetch operation: replay adapter data-URLs, escalate shells.

  discovery/       Adapter building.
    harvest.py     discover(): agent-driven (default) or deep-crawl discovery.
    link_agent.py  LinkAgent: scores/selects links, explains follow/skip decisions.

  extract/         Turn HTML/markdown into clean rows.
    extract.py     Tier router + all extractors (jsonld/schema/links/blocks/html/regex).
    jsonld.py      Tier 0: schema.org Product/Offer JSON-LD.
    schema.py      Tier 1/2: CSS-schema cache + LLM induction (per HTML structure).
    cleaning.py    parse_price, clean_name, make_row, junk filters.
    category.py    categorize(name,url) → service category.
    record.py      build_record(): row → OUTPUT_SCHEMA JSONL, dedupe key.
    pageproc.py    Shared page processing (validate → extract → classify → record).

  adapter/         Site-specific knowledge.
    adapter.py     SiteAdapter dataclass: load/save/build, data-URL compaction, fetch plan.
    agent_prompt.py  System prompt text (carried in fetch_instructions).
    mcp_explorer.py  Optional Playwright-MCP fallback for hard SPA/anti-bot sites.

  output/
    output.py      url_filename(), save_page(), output_path(), write_rows().
```

Persisted artifacts (all gitignored, regenerated):
- `adapters/<domain>.json` — the SiteAdapter (data_urls, route_rules, fetch_plan…).
- `state/<domain>/` — RouteStore (routes.json, data_urls.txt, url_nodes.json, url_stats.json).
- `schemas/<domain>__<sig>.json` — LLM-induced CSS schemas keyed by HTML-structure signature.
- `pages/` — optional per-URL extracted JSON (only if `SAVE_PAGES=1`).

---

## 5. Discovery (the agent loop)

`DISCOVERY_MODE=agent` (default) uses `LinkAgent` — a deterministic,
explainable link-selection policy (not an LLM agent):

1. Seed the frontier with only the start URL. No guessed paths or city URLs are generated.
2. Each iteration pops a batch (`AGENT_BATCH_SIZE`) of highest-scored URLs, fetches them.
3. Each fetched page is processed (extracted). Productive pages → data-URLs.
4. Links on each page are scored by `LinkAgent.decide()`:
   - **+** productive route (history), price keywords, medical-catalog path hints
     (`analiz`, `napravleni`, `vrach`, `uslugi`, `prajs`…), city listing.
   - **−** deep path, query string, id-detail routes.
   - Hard **skip**: external, max-depth, duplicate, junk pattern, dead-route memory,
     covered-by-listing.
   - A single strong catalog hint clears the follow threshold (so specialty pages
     like `/napravleniya/ginekologiya/` are followed).
5. Score ≥ threshold → follow (queued, capped at `AGENT_LINKS_PER_PAGE`).

Every decision is logged (DEBUG for per-link, INFO for batch/expand summaries) and
recorded into `url_nodes`, so discovery is fully auditable. Each link/page also
gets a **category** so the agent's choices are category-aware.

Cross-run learning: dead route-templates (0 valid, ≥`DEAD_ROUTE_THRESHOLD` invalid)
become glob filters blocked on the next run.

`DISCOVERY_MODE=deep` is the alternative: crawl4ai `BestFirstCrawlingStrategy`
deep crawl instead of the agent.

---

## 6. Extraction — the tier router

`crawler/extract/extract.py::extract_page(url, html, md)` tries sources
**fast-first**, returning on the first that yields rows:

| Tier | Name | Source | When it wins |
|---|---|---|---|
| 0 | `jsonld` | `<script type=application/ld+json>` Product/Offer | structured data present |
| 1 | `schema` | cached CSS schema for this HTML structure | a schema was induced before |
| 2 | `links` | markdown links whose text carries a price | SPA link-lists (kdlolymp) |
| 2 | `blocks` | `№`-anchored multi-line cards | invitro for-doctors cards |
| 2 | `html` | DOM `label + price-leaf` rows grouped by heading | emirmed `div.info` tables |
| 2 | `regex` | markdown line/table + look-back name | generic tables / fallback |
| 3 | `schema-gen` | **LLM**-induced CSS schema (slow, last resort) | all deterministic tiers empty |

Key design points:
- **Deterministic tiers run before the LLM.** The LLM (tier 3) only fires when
  jsonld/schema/links/blocks/html/regex all produce nothing *and* the page has a
  price. This is why fetch is fast and reliable.
- **LLM is budgeted** per domain per run (`SCHEMA_GEN_MAX_PER_DOMAIN`, default 2)
  and **off by default** (`LLM_SCHEMA_GEN=0`) — deterministic extractors cover the
  tested sites ~10× faster.
- Layouts are mutually exclusive in practice: invitro links carry no price (→ blocks),
  kdlolymp links carry a price (→ links), emirmed has `div.info` (→ html).

`make_row()` validates every candidate: price ≥ `MIN_PRICE`, name has letters,
length ≥ 3, not a stopword/UI label/surcharge/prose-fragment; drops junk like
"менее 2000 ₸" (price filter), "Взятие крови …:+1390 ₸" (surcharge), "Выезд за …"
(office boilerplate).

---

## 7. Transport & dynamic sites

HTTP-first, escalate to a headless browser only when needed.

1. `CRAWL_MODE=http` (default): fetch via `AsyncHTTPCrawlerStrategy` — fast, no browser, no GPU.
2. `_needs_browser(page)` detects a JS shell: little text + SPA markers + no price.
3. Such pages escalate to headless Chromium (GPU disabled via `--disable-gpu …`).
   Discovery escalates inline; `collector.collect` escalates too (a data-URL that
   returns a shell with 0 rows is re-fetched with the browser).
4. Browser mode scrolls the full page + waits a beat (`scan_full_page`,
   `scroll_delay`, `delay_before_return_html`) so lazy/XHR lists materialise.
5. The adapter remembers which pages needed a browser (`fetch_plan.browser_urls`,
   reason `js-shell`) so next run goes straight to the browser.

Most KZ medical catalogs are server-rendered and work over plain HTTP.

Force a visible browser for debugging: `BROWSER_VISIBLE=1` (headed Chromium).
Force browser for every fetch: `CRAWL_MODE=browser`. Disable escalation: `ESCALATE=0`.

For API/XHR-driven SPAs that even browser rendering struggles with, the optional
**Playwright MCP** explorer (`MCP_ENABLED=1`) navigates the page, snapshots it,
captures network (XHR/API) requests, and persists candidate API URLs into the
adapter for review. See `.mcp.json` for the standalone MCP-client config.

---

## 8. The SiteAdapter

`adapters/<domain>.json` is the learned profile. Notable fields:

- `data_urls` — the concrete productive URLs to fetch (compacted: junk-pattern URLs
  dropped, detail pages collapsed under their listing).
- `method` — the winning extraction tier (or `mixed`).
- `fetch_plan` — transport plan (`http_urls`, `browser_urls`).
- `route_rules` — per-template decisions (fetch / defer / skip) with valid/invalid/rows.
- `blocked_patterns` — dead route globs to exclude next discovery.
- `url_nodes`, `page_groups`, `url_meta`, `city_stats`, `extractor_stats`, `run_info`.

`fetch` reads the adapter as a **fixed plan** (recomputes only the transport plan,
no network) — it never rediscovers or rewrites the URL set. Rebuilding is the
`adapter` command's job. Compaction (`compact_data_urls`) always strips
`JUNK_URL_PATTERNS` URLs, even ones inherited from stale `state/`.

---

## 9. Configuration

Resolution order (first wins): **real env var → `.env` → `config.yaml` → default**.
Both files are loaded into `os.environ` at import (`crawler/config.py`), so every
setting is just an env var.

- `config.yaml` — non-secret tunables, grouped (crawl/browser/mcp/output/extraction/llm/logging).
  Known sections map to flat env names (`crawl.max_depth` → `MAX_DEPTH`).
- `.env` — secrets + local overrides (API keys, `LLM_SCHEMA_GEN`, `BROWSER_VISIBLE`). Gitignored.
- `.env.example` — template.

### Key knobs

| Env | Default | Meaning |
|---|---|---|
| `MAX_DEPTH` / `MAX_PAGES` | 5 / 1000 | discovery crawl limits |
| `CONCURRENCY` / `FETCH_CONCURRENCY` | 20 / 20 | parallel fetches |
| `CRAWL_MODE` | http | `http` \| `browser` |
| `ESCALATE` | 1 | re-fetch JS-shells with a browser |
| `DISCOVERY_MODE` | agent | `agent` \| `deep` |
| `BROWSER_VISIBLE` | 0 | headed Chromium (debug) |
| `LLM_SCHEMA_GEN` | 0 | enable LLM CSS-schema induction |
| `SCHEMA_GEN_MAX_PER_DOMAIN` | 2 | LLM-call budget per domain/run |
| `LLM_MODEL` / `LLM_PROVIDER` / `LLM_BASE_URL` | deepseek-v4-flash | litellm routing |
| `MIN_PRICE` | 50 | reject prices below this |
| `OUTPUT_DIR` / `OUTPUT_PATH` | `.` / unset | per-domain dir, or one fixed file |
| `SAVE_PAGES` | 0 | also dump per-URL extracted JSON |
| `REDISCOVER` | 0 | force adapter rebuild in `run` |
| `LOG_LEVEL` / `LOG_PROMPTS_FULL` | INFO / 0 | logging verbosity |
| `MCP_ENABLED` | 0 | enable Playwright-MCP fallback |

---

## 10. How to change / extend

**Add a new site** — usually nothing. Run `adapter <url>`; the generic discovery +
tiers handle it. If discovery doesn't reach the price pages, pass a more specific
source URL that links to the catalog, or add path hints to `STRONG_PATH_HINTS`
(`crawler/discovery/link_agent.py`).

**Add an extraction layout** — write `extract_<x>(url, html|md)` in
`crawler/extract/extract.py` returning `(rows, lines)`, add a detector, and wire it
into `_fallback_extract`'s ordered chain. Reuse `make_row()` for validation. Tag
structural context into `row["meta"]`.

**Add/adjust a category** — edit keyword tuples and the cascade in
`crawler/extract/category.py`. Categories surface in the row + `meta` + page logs +
agent decisions.

**Change the output schema** — edit `OUTPUT_SCHEMA` and `build_record()` in
`crawler/extract/record.py`. `write_rows` projects to it.

**Tune junk filtering** — `JUNK_URL_PATTERNS` (config.py) blocks URL sections in
discovery + adapter compaction; `BAD_NAME_RE` / `BAD_URL_PARTS` (cleaning.py) drop
junk rows.

**Tune discovery scoring** — weights and reasons in `LinkAgent.decide()`.

---

## 11. Scaling

- **Per-domain parallelism** — discovery/fetch already fetch concurrently
  (`CONCURRENCY`, `FETCH_CONCURRENCY`) and analyze pages in threads
  (`process_pages`, bounded by `LLM_CONCURRENCY`). Raise these for more throughput
  (watch target rate-limits and local CPU — `html` tier is lxml/CPU-bound).
- **Many domains** — adapters/state are per-domain and independent; run domains as
  separate processes/workers. The service is stateless beyond the on-disk
  `adapters/` + `state/` dirs, so it shards trivially (one worker per domain, or a
  queue of domains). The repo already pins `aio-pika` (RabbitMQ) and `asyncpg`
  (Postgres) for a queue/store integration; `apscheduler` for a daily tick.
- **Keep LLM off** for scale — deterministic tiers are fast and don't hit external
  rate limits. Enable LLM only for specific hard domains, with the per-domain budget.
- **Caching** — induced schemas persist by HTML-structure signature; productive
  data-URLs persist; dead routes persist. Repeat runs converge to fast fetches.
- **Storage** — output is append-friendly JSONL; point `OUTPUT_DIR` at a shared
  volume or post-process into Postgres.

---

## 12. Operations & troubleshooting

- `ModuleNotFoundError: crawl4ai` → using system Python. Use `.venv/bin/python`.
- Clean one site: `rm -rf state/<domain> adapters/<domain>.json` and the
  `schemas/<domain>__*` files (note: a trailing shell glob with no match aborts the
  whole `rm` in zsh — delete schemas with `find schemas -name '<domain>__*' -delete`).
- Slow fetch / many `inducing css schema` logs → LLM schema-gen is on; set
  `LLM_SCHEMA_GEN=0` (deterministic) or lower `SCHEMA_GEN_MAX_PER_DOMAIN`.
- GPU usage during fetch → a headless browser launched; already GPU-disabled, and
  fetch is HTTP-first. Check `fetch_plan.browser_urls` if a site is wrongly browser-routed.
- "found no data URLs" → discovery never reached/parsed price pages. Inspect the
  `agent expand` logs (DEBUG) for skip reasons; use a more specific source URL,
  add path hints, or enable MCP.
- Output is per-domain `<slug>-prices.jsonl`; set `OUTPUT_PATH` to force one file.

---

## 13. Dependencies

Python 3.13 (crawl4ai pins lxml ~5.3, no wheel for 3.14). See `requirements.txt`:
`crawl4ai` (+ Playwright, lxml, beautifulsoup4, litellm), `playwright`, `aio-pika`,
`asyncpg`, `apscheduler`, `PyYAML`. After install, fetch the browser once:
`python -m playwright install chromium`. Node.js is needed only for the optional
Playwright-MCP fallback (`npx @playwright/mcp`).
