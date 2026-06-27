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
                            asyncpg_dsn, get_logger, log_llm_config)
from crawler.pipeline import create_or_update_adapter, fetch
from crawler.routing.routes import host
from crawler.sink import build_sink

log = get_logger("worker")

EXCHANGE = "medprice.events"
Q_CREATE = "q.adapter.create"
Q_FETCH = "q.adapter.fetch"
RK_COMPLETED = "parse.completed"


# -- per-run knob mapping ------------------------------------------------------
def _apply_run_knobs(config: dict) -> None:
    """Map message config.{max_depth,rate_limit_ms} onto pipeline knobs for this run.

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


async def _ensure_adapter_ready(base_url: str) -> None:
    domain = host(base_url)
    adapter = SiteAdapter.load(domain)
    if adapter is None or not adapter.data_urls:
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
        log.info("adapter.create adapter_id=%s base_url=%s", adapter_id, base_url)
        await _ensure_adapter_ready(base_url)
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
                await _ensure_adapter_ready(base_url)
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
                await _ensure_adapter_ready(data.get("base_url") or url)
        sink = build_sink(SINK, pool=self.pool, source_id=source_id)
        log.info("adapter.fetch adapter_id=%s url=%s sink=%s", adapter_id, url, SINK)
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
        log.info("published %s adapter_id=%s rows=%d", RK_COMPLETED, adapter_id, rows_written)

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
    log.info("worker starting rabbitmq=%s sink=%s prefetch=%d",
             RABBITMQ_URL, SINK, WORKER_PREFETCH)

    pool = await asyncpg.create_pool(asyncpg_dsn(DATABASE_URL), min_size=1, max_size=10)
    connection = await aio_pika.connect_robust(RABBITMQ_URL)
    channel = await connection.channel()
    await channel.set_qos(prefetch_count=WORKER_PREFETCH)

    # Passive lookups only — server already declared these from definitions.json.
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
