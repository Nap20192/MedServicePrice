"""Postgres sink — load cleaned rows into parsed_services (worker path).

Freshness model (spec point 3): a re-fetch of a source is a full replace of its
*live* list. In one transaction we flip every row of the source to is_active=false,
then UPSERT the current rows back to is_active=true on (source_id, service_name_raw).
Rows that vanished from the site stay is_active=false; normalize-filled
service_catalog_id is preserved across the upsert.
"""
from __future__ import annotations

from decimal import Decimal

from crawler.config import DEFAULT_CURRENCY, get_logger

log = get_logger(__name__)

_DEACTIVATE = "UPDATE parsed_services SET is_active = false WHERE source_id = $1"

_UPSERT = """
INSERT INTO parsed_services
    (source_id, service_name_raw, price_kzt, currency, duration_days, parsed_at, is_active)
VALUES ($1, $2, $3, $4::currency_enum, $5, now(), true)
ON CONFLICT (source_id, service_name_raw) DO UPDATE SET
    price_kzt     = EXCLUDED.price_kzt,
    currency      = EXCLUDED.currency,
    duration_days = EXCLUDED.duration_days,
    parsed_at     = now(),
    is_active     = true
-- service_catalog_id intentionally left untouched: normalize owns it.
"""


class PostgresSink:
    """Persist records for one source_id via an asyncpg pool."""

    def __init__(self, pool, source_id):
        if pool is None or source_id is None:
            raise ValueError("PostgresSink requires an asyncpg pool and a source_id")
        self.pool = pool
        self.source_id = source_id

    async def emit(self, records: list[dict], *, domain: str) -> int:
        rows = self._to_params(records)
        if not rows:
            # Guard against a transient empty fetch wiping a good live list: skip the
            # deactivate-all step entirely when nothing was extracted.
            log.warning("postgres sink got 0 valid rows domain=%s source_id=%s — "
                        "leaving existing rows untouched", domain, self.source_id)
            return 0
        async with self.pool.acquire() as con:
            async with con.transaction():
                await con.execute(_DEACTIVATE, self.source_id)
                await con.executemany(_UPSERT, rows)
        log.info("postgres sink upserted rows=%d domain=%s source_id=%s",
                 len(rows), domain, self.source_id)
        return len(rows)

    def _to_params(self, records: list[dict]) -> list[tuple]:
        # Collapse to one row per service_name_raw (the upsert key); last wins.
        by_name: dict[str, tuple] = {}
        for rec in records:
            name = (rec.get("service_name_raw") or "").strip()
            price = _decimal(rec.get("price_kzt"))
            if not name or price is None:
                continue
            duration = rec.get("duration_days")
            by_name[name] = (
                self.source_id,
                name,
                price,
                DEFAULT_CURRENCY,
                int(duration) if duration is not None else None,
            )
        return list(by_name.values())


def _decimal(value) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except Exception:  # noqa: BLE001
        return None
