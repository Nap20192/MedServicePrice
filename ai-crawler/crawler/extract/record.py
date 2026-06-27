"""Build minimal fetch JSONL records from extracted crawler rows."""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

from crawler.common import patterns as P
from crawler.extract.category import categorize
from crawler.extract.cleaning import clean_name, is_bad_service_name

OUTPUT_SCHEMA = [
    "service_name_raw",
    "price_kzt",
    "duration_days",
    "category",
    "meta",
    "url",
]


def build_record(row: dict, instructions: dict | None = None) -> dict | None:
    """Convert an extracted row into the minimal fetch JSONL schema."""
    raw_name = clean_name(str(row.get("service") or row.get("service_name_raw") or ""))
    price = _decimal_kzt(row.get("price") or row.get("price_kzt"))
    if not raw_name or price is None:
        return None

    duration = row.get("duration_days")
    if duration is None:
        duration = infer_duration_days(raw_name)
    url = row.get("url") or row.get("source_url") or ""
    if is_bad_service_name(raw_name, url):
        return None
    category = row.get("category") or categorize(raw_name, url)
    return {
        "service_name_raw": raw_name,
        "price_kzt": str(price),
        "duration_days": duration,
        "category": category,
        "meta": _build_meta(row, category),
        "url": url,
    }


def clean_records(rows: list[dict], fields: list[str] | None = None,
                  instructions: dict | None = None) -> list[dict]:
    """Build, dedupe and project extracted rows onto the output schema.

    Single source of truth shared by every sink (JSONL, Postgres). Dedup key is
    service_name_raw + price_kzt + duration_days + url (see record_key)."""
    seen: set[tuple] = set()
    out: list[dict] = []
    for rec in rows:
        built = build_record(rec, instructions)
        if built is None:
            continue
        key = record_key(built)
        if key in seen:
            continue
        seen.add(key)
        out.append({field: built.get(field) for field in (fields or OUTPUT_SCHEMA)})
    return out


def _build_meta(row: dict, category: str) -> dict:
    """Nested context for a price row: extractor group/specialty + category."""
    meta = dict(row.get("meta") or {})
    meta["category"] = category
    return {k: v for k, v in meta.items() if v}


def infer_duration_days(name: str) -> int | None:
    match = P.DURATION_RE.search(name or "")
    return int(match.group(1)) if match else None


def record_key(record: dict) -> tuple:
    return (
        record["service_name_raw"].casefold(),
        record["price_kzt"],
        record.get("duration_days"),
        record.get("url"),
    )


def _decimal_kzt(value) -> Decimal | None:
    if value is None:
        return None
    try:
        decimal = Decimal(str(value))
    except Exception:  # noqa: BLE001
        return None
    if decimal <= 0:
        return None
    return decimal.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
