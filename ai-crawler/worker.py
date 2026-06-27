"""RabbitMQ worker entrypoint for ai-crawler.

A long-running asyncio consumer that drives the *same* pipeline functions the CLI
uses (crawler.pipeline.create_or_update_adapter / fetch), but persists fetched rows
into Postgres instead of only JSONL.

    q.adapter.create  ← adapter.create   discover/refresh a site adapter, register source
    q.adapter.fetch   ← adapter.fetch    fetch prices → parsed_services, emit parse.completed

Topology is server-declared from queue/definitions.json — this worker never declares
exchanges or queues, it only passively looks them up. Manual ack: ack on success,
reject(requeue=False) on failure so the message dead-letters. SIGTERM/SIGINT drain
in-flight work and close cleanly.

Run:  python worker.py        (from ai-crawler/, venv active)
"""
from __future__ import annotations

import asyncio
import json
import os
import signal
import uuid
from datetime import datetime, timezone

import aio_pika
import asyncpg

import crawler.config as cfg
from crawler.adapter.adapter import SiteAdapter
from crawler.config import (DATABASE_URL, RABBITMQ_URL, SINK, WORKER_PREFETCH,
                            WORKER_DECLARE_TOPOLOGY, asyncpg_dsn, get_logger,
                            log_llm_config, safe_url)
from crawler.pipeline import create_or_update_adapter, fetch
from crawler.routing.routes import host
from crawler.sink import build_sink

log = get_logger("worker")

EXCHANGE = "medprice.events"
Q_CREATE = "q.adapter.create"
Q_FETCH = "q.adapter.fetch"
RK_COMPLETED = "parse.completed"
DLX = "medprice.dlx"
Q_PARSE_COMPLETED = "q.parse.completed"
Q_DEAD_LETTER = "q.dead_letter"


async def _ensure_topology(channel: aio_pika.abc.AbstractChannel):
    events = await channel.declare_exchange(EXCHANGE, aio_pika.ExchangeType.TOPIC, durable=True)
    dlx = await channel.declare_exchange(DLX, aio_pika.ExchangeType.TOPIC, durable=True)

    q_create = await channel.declare_queue(
        Q_CREATE,
        durable=True,
        arguments={
            "x-dead-letter-exchange": DLX,
            "x-dead-letter-routing-key": "dlq.adapter.create",
        },
    )
    q_fetch = await channel.declare_queue(
        Q_FETCH,
        durable=True,
        arguments={
            "x-dead-letter-exchange": DLX,
            "x-dead-letter-routing-key": "dlq.adapter.fetch",
        },
    )
    q_parse_completed = await channel.declare_queue(
        Q_PARSE_COMPLETED,
        durable=True,
        arguments={
            "x-dead-letter-exchange": DLX,
            "x-dead-letter-routing-key": "dlq.parse.completed",
        },
    )
    q_dead = await channel.declare_queue(Q_DEAD_LETTER, durable=True)

    await q_create.bind(events, routing_key="adapter.create")
    await q_fetch.bind(events, routing_key="adapter.fetch")
    await q_parse_completed.bind(events, routing_key=RK_COMPLETED)
    await q_dead.bind(dlx, routing_key="dlq.#")
    log.info("rabbitmq topology ready exchange=%s queues=%s,%s,%s,%s",
             EXCHANGE, Q_CREATE, Q_FETCH, Q_PARSE_COMPLETED, Q_DEAD_LETTER)
    return events, q_create, q_fetch


# -- per-run knob mapping ------------------------------------------------------
def _truthy(value) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() not in ("", "0", "false", "no", "off")


def _apply_run_knobs(config: dict) -> None:
    """Map message config knobs onto pipeline globals for this run.

    MAX_DEPTH is imported by value into the discovery/fetch modules, so we patch
    those module globals too. This mutates process-global state, which is safe only
    because the create queue runs at prefetch=1 (serialized discovery).

    rate_limit_ms is recorded but request-pacing into crawl4ai (mean_delay) is not
    yet wired — noted as a follow-up.
    """
    max_depth = config.get("max_depth")
    if max_depth:
        import crawler.discovery.harvest as harvest
        import crawler.fetch.fetcher as fetcher
        md = int(max_depth)
        cfg.MAX_DEPTH = harvest.MAX_DEPTH = fetcher.MAX_DEPTH = md
        log.info("run knob MAX_DEPTH=%d", md)
    max_pages = config.get("max_pages")
    if max_pages:
        import crawler.discovery.harvest as harvest
        import crawler.fetch.fetcher as fetcher
        mp = int(max_pages)
        cfg.MAX_PAGES = harvest.MAX_PAGES = fetcher.MAX_PAGES = mp
        log.info("run knob MAX_PAGES=%d", mp)
    agent_batch_size = config.get("agent_batch_size")
    if agent_batch_size:
        import crawler.discovery.harvest as harvest
        abs_ = int(agent_batch_size)
        cfg.AGENT_BATCH_SIZE = harvest.AGENT_BATCH_SIZE = abs_
        log.info("run knob AGENT_BATCH_SIZE=%d", abs_)
    agent_links_per_page = config.get("agent_links_per_page")
    if agent_links_per_page:
        import crawler.discovery.harvest as harvest
        alpp = int(agent_links_per_page)
        cfg.AGENT_LINKS_PER_PAGE = harvest.AGENT_LINKS_PER_PAGE = alpp
        log.info("run knob AGENT_LINKS_PER_PAGE=%d", alpp)
    fetch_concurrency = config.get("fetch_concurrency")
    if fetch_concurrency:
        import crawler.fetch.fetcher as fetcher
        fc = int(fetch_concurrency)
        cfg.FETCH_CONCURRENCY = fetcher.FETCH_CONCURRENCY = fc
        log.info("run knob FETCH_CONCURRENCY=%d", fc)
    page_timeout_ms = config.get("page_timeout_ms")
    if page_timeout_ms:
        import crawler.fetch.fetcher as fetcher
        pt = int(page_timeout_ms)
        cfg.PAGE_TIMEOUT_MS = fetcher.PAGE_TIMEOUT_MS = pt
        log.info("run knob PAGE_TIMEOUT_MS=%d", pt)
    if "adapter_compact" in config:
        import crawler.adapter.adapter as adapter_mod
        value = _truthy(config.get("adapter_compact"))
        cfg.ADAPTER_COMPACT = adapter_mod.ADAPTER_COMPACT = value
        log.info("run knob ADAPTER_COMPACT=%s", value)
    if "schema_gen_max_per_domain" in config:
        import crawler.extract.extract as extract_mod
        budget = max(0, int(config.get("schema_gen_max_per_domain") or 0))
        cfg.SCHEMA_GEN_MAX_PER_DOMAIN = extract_mod.SCHEMA_GEN_MAX_PER_DOMAIN = budget
        log.info("run knob SCHEMA_GEN_MAX_PER_DOMAIN=%d", budget)
    if "llm_schema_gen" in config:
        import crawler.extract.extract as extract_mod
        enabled = _truthy(config.get("llm_schema_gen")) and bool(cfg.LLM_API_KEY)
        cfg.LLM_SCHEMA_GEN = extract_mod.LLM_SCHEMA_GEN = enabled
        log.info("run knob LLM_SCHEMA_GEN=%s", enabled)
    if "rediscover" in config:
        cfg.REDISCOVER = _truthy(config.get("rediscover"))
        log.info("run knob REDISCOVER=%s", cfg.REDISCOVER)
    rate = config.get("rate_limit_ms")
    if rate is not None:
        os.environ["RATE_LIMIT_MS"] = str(rate)  # stored; pacing TODO


# -- DB helpers ----------------------------------------------------------------
async def _already_processed(con, msg_id: str) -> bool:
    return await con.fetchval(
        "SELECT 1 FROM processed_messages WHERE msg_id = $1", msg_id) is not None


async def _mark_processed(con, msg_id: str, routing_key: str) -> None:
    await con.execute(
        "INSERT INTO processed_messages (msg_id, routing_key) VALUES ($1, $2) "
        "ON CONFLICT (msg_id) DO NOTHING", msg_id, routing_key)


async def _source_exists(con, source_id: str) -> bool:
    return await con.fetchval("SELECT 1 FROM sources WHERE id = $1", source_id) is not None


async def _register_source(con, adapter_id: str, name: str, base_url: str,
                           config: dict, source_id: str | None = None) -> str:
    """Upsert clinic + source for an adapter and persist the mapping. Returns source_id.

    Reuses the existing source if the adapter_id is already mapped (re-create just
    refreshes config). If source_id is supplied by the backend, maps the adapter to
    that existing source. Otherwise creates a clinic + source pair.
    """
    domain = host(base_url)
    existing = await con.fetchrow(
        "SELECT source_id FROM adapters WHERE adapter_id = $1", adapter_id)
    if existing:
        await con.execute(
            "UPDATE adapters SET base_url=$2, domain=$3, config=$4, "
            "updated_at=now() WHERE adapter_id=$1",
            adapter_id, base_url, domain, json.dumps(config))
        return str(existing["source_id"])

    if source_id and await _source_exists(con, source_id):
        await con.execute(
            "INSERT INTO adapters (adapter_id, domain, source_id, base_url, config) "
            "VALUES ($1, $2, $3, $4, $5)",
            adapter_id, domain, source_id, base_url, json.dumps(config))
        log.info("registered existing source adapter_id=%s domain=%s source_id=%s",
                 adapter_id, domain, source_id)
        return source_id

    clinic_id = await con.fetchval(
        "INSERT INTO clinics (name) VALUES ($1) RETURNING id", name or domain)
    source_id = await con.fetchval(
        "INSERT INTO sources (clinic_id, url) VALUES ($1, $2) RETURNING id",
        clinic_id, base_url)
    await con.execute(
        "INSERT INTO adapters (adapter_id, domain, source_id, base_url, config) "
        "VALUES ($1, $2, $3, $4, $5)",
        adapter_id, domain, source_id, base_url, json.dumps(config))
    log.info("registered source adapter_id=%s domain=%s source_id=%s",
             adapter_id, domain, source_id)
    return str(source_id)


async def _resolve_source(con, adapter_id: str, url: str) -> str | None:
    """Find the source_id for a fetch: by adapter_id, else by domain."""
    row = await con.fetchrow(
        "SELECT source_id FROM adapters WHERE adapter_id = $1", adapter_id)
    if row:
        return str(row["source_id"])
    row = await con.fetchrow(
        "SELECT source_id FROM adapters WHERE domain = $1 ORDER BY created_at LIMIT 1",
        host(url))
    return str(row["source_id"]) if row else None


async def _ensure_adapter_ready(base_url: str, *, force_rediscover: bool = False) -> None:
    domain = host(base_url)
    adapter = SiteAdapter.load(domain)
    if force_rediscover or cfg.REDISCOVER or adapter is None or not adapter.data_urls:
        if force_rediscover or cfg.REDISCOVER:
            log.info("rediscovering adapter domain=%s", domain)
        adapter = await create_or_update_adapter(base_url)
    if adapter is None or not adapter.data_urls:
        raise RuntimeError(
            f"adapter for domain={domain} has no data URLs after discovery")


# -- handlers ------------------------------------------------------------------
class Worker:
    def __init__(self, pool: asyncpg.Pool, exchange: aio_pika.abc.AbstractExchange):
        self.pool = pool
        self.exchange = exchange

    async def handle_create(self, data: dict) -> None:
        adapter_id = data["adapter_id"]
        base_url = data["base_url"]
        config = data.get("config") or {}
        _apply_run_knobs(config)
        log.info("TASK adapter.create adapter_id=%s domain=%s", adapter_id, host(base_url))
        await _ensure_adapter_ready(base_url, force_rediscover=_truthy(config.get("rediscover")))
        async with self.pool.acquire() as con:
            await _register_source(
                con,
                adapter_id,
                data.get("name", ""),
                base_url,
                config,
                data.get("source_id"),
            )

    async def handle_fetch(self, data: dict) -> None:
        adapter_id = data["adapter_id"]
        url = data["url"]
        source_id = None
        if SINK in ("postgres", "both"):
            async with self.pool.acquire() as con:
                source_id = await _resolve_source(con, adapter_id, url)
            if source_id is None:
                config = data.get("config") or {}
                base_url = data.get("base_url") or url
                _apply_run_knobs(config)
                log.warning("adapter missing for adapter_id=%s url=%s — creating first",
                            adapter_id, url)
                await _ensure_adapter_ready(base_url, force_rediscover=_truthy(config.get("rediscover")))
                async with self.pool.acquire() as con:
                    source_id = await _register_source(
                        con,
                        adapter_id,
                        data.get("name", ""),
                        base_url,
                        config,
                        data.get("source_id"),
                    )
            else:
                config = data.get("config") or {}
                _apply_run_knobs(config)
                await _ensure_adapter_ready(
                    data.get("base_url") or url,
                    force_rediscover=_truthy(config.get("rediscover")),
                )
        sink = build_sink(SINK, pool=self.pool, source_id=source_id)
        log.info("TASK adapter.fetch adapter_id=%s domain=%s sink=%s", adapter_id, host(url), SINK)
        rows_written = await fetch(url, sink)
        await self._publish_completed(adapter_id, source_id, rows_written)

    async def _publish_completed(self, adapter_id: str, source_id: str | None,
                                 rows_written: int) -> None:
        payload = {
            "schema_version": 1,
            "msg_id": str(uuid.uuid4()),
            "adapter_id": adapter_id,
            "source_id": source_id,
            "rows_written": rows_written,
            "parsed_at": datetime.now(timezone.utc).isoformat(),
        }
        await self.exchange.publish(
            aio_pika.Message(
                body=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                content_type="application/json",
            ),
            routing_key=RK_COMPLETED,
        )
        log.info("RESULT worker adapter_id=%s source_id=%s rows_written=%d event=%s",
                 adapter_id, source_id, rows_written, RK_COMPLETED)

    # -- delivery wrapper ------------------------------------------------------
    def _consumer(self, handler):
        async def on_message(message: aio_pika.abc.AbstractIncomingMessage) -> None:
            rk = message.routing_key or ""
            try:
                data = json.loads(message.body.decode("utf-8"))
                msg_id = str(data.get("msg_id") or message.message_id or uuid.uuid4())
            except Exception:  # noqa: BLE001  — unparseable body can never succeed
                log.exception("bad message body rk=%s — dead-lettering", rk)
                await message.reject(requeue=False)
                return
            try:
                async with self.pool.acquire() as con:
                    if await _already_processed(con, msg_id):
                        log.info("skip already-processed msg_id=%s rk=%s", msg_id, rk)
                        await message.ack()
                        return
                await handler(data)
                async with self.pool.acquire() as con:
                    await _mark_processed(con, msg_id, rk)
                await message.ack()
            except Exception:  # noqa: BLE001  — isolate: one bad source must not stop others
                log.exception("handler failed rk=%s msg_id=%s — dead-lettering", rk, msg_id)
                await message.reject(requeue=False)
        return on_message


async def main() -> None:
    log_llm_config()
    log.info("worker starting rabbitmq_url=%s postgres_url=%s sink=%s prefetch=%d declare_topology=%s",
             safe_url(RABBITMQ_URL), safe_url(DATABASE_URL), SINK, WORKER_PREFETCH,
             WORKER_DECLARE_TOPOLOGY)

    pool = await asyncpg.create_pool(asyncpg_dsn(DATABASE_URL), min_size=1, max_size=10)
    connection = await aio_pika.connect_robust(RABBITMQ_URL)
    channel = await connection.channel()
    await channel.set_qos(prefetch_count=WORKER_PREFETCH)

    if WORKER_DECLARE_TOPOLOGY:
        exchange, q_create, q_fetch = await _ensure_topology(channel)
    else:
        # Passive lookups only — use this when topology is managed externally.
        exchange = await channel.get_exchange(EXCHANGE, ensure=True)
        q_create = await channel.get_queue(Q_CREATE, ensure=True)
        q_fetch = await channel.get_queue(Q_FETCH, ensure=True)

    worker = Worker(pool, exchange)
    await q_create.consume(worker._consumer(worker.handle_create))
    await q_fetch.consume(worker._consumer(worker.handle_fetch))
    log.info("worker consuming queues=%s,%s", Q_CREATE, Q_FETCH)

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    await stop.wait()

    log.info("worker shutting down — draining")
    await connection.close()
    await pool.close()
    log.info("worker stopped")


if __name__ == "__main__":
    asyncio.run(main())
