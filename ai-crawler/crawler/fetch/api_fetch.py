"""Fetch price rows from JSON/XHR endpoints the discovery agent found.

The agent records `network_endpoints` (e.g. kdlolymp.kz/api/analysis-data). Pulling
structured JSON is far cheaper and cleaner than scraping HTML, so fetch() pulls these
first. Extraction is generic and tolerant of real-world nesting: a "record" is any
object whose subtree carries both a name-like and a price-like field — even when, as on
kdlolymp, the name sits in `translation.title` and the price in a nested `price.price`.

Best-effort: endpoint errors are logged & skipped. The fetcher only requests endpoints
found during discovery; it does not guess city/query variants.
"""
from __future__ import annotations

import re
import httpx

from crawler.config import get_logger

log = get_logger(__name__)

# Specific on purpose: a bare "service"/"analysis" would steal codes like
# `service_group_code` / `analysis_id` instead of the real `translation.title`.
_NAME_KEYS = ("title", "name", "analysis_name", "test_name", "service_name",
              "наимен", "услуг", "название")
_PRICE_KEYS = ("price", "cost", "amount", "tariff", "цена", "стоим", "тариф")
_DUR_KEYS = ("min_duration", "days", "term", "srok", "срок")  # avoid `duration_unit`

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; MedServicePriceBot/1.0)",
    "Accept": "application/json, text/plain, */*",
}
_PRICE_RE = re.compile(r"[\d][\d\s.,]*")


def _to_price(value) -> str | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return f"{float(value):.2f}" if value > 0 else None
    if not isinstance(value, str):
        return None
    m = _PRICE_RE.search(value)
    if not m:
        return None
    digits = m.group(0).replace(" ", "").replace(" ", "").replace(",", ".")
    digits = re.sub(r"\.(?=\d{3}\b)", "", digits)  # thousands dots: 18.470 -> 18470
    try:
        v = float(digits)
    except ValueError:
        return None
    return f"{v:.2f}" if v > 0 else None


def _search(node, keys: tuple, coerce) -> object | None:
    """Find the first key matching `keys` whose coerced value is truthy, scanning
    this dict then its nested *dict* children (never lists — that keeps a parent
    category from stealing a price out of its children array)."""
    if not isinstance(node, dict):
        return None
    for k, v in node.items():
        if any(h in str(k).lower() for h in keys):
            got = coerce(v)
            if got:
                return got
    for v in node.values():
        if isinstance(v, dict):
            got = _search(v, keys, coerce)
            if got:
                return got
    return None


def _clean_name(v) -> str | None:
    return v.strip() if isinstance(v, str) and v.strip() else None


def _harvest(node, url: str, out: list[dict], city: str | None = None) -> None:
    """Emit one row per record dict (name + price found in its subtree); otherwise
    recurse into children."""
    if isinstance(node, dict):
        name = _search(node, _NAME_KEYS, _clean_name)
        price = _search(node, _PRICE_KEYS, _to_price)
        if name and price:
            dur = _search(node, _DUR_KEYS, lambda x: x if isinstance(x, int) and x > 0 else None)
            row = {"service_name_raw": name, "price_kzt": price,
                   "duration_days": dur, "url": url}
            if city:
                row["city"] = city
            out.append(row)
            return  # treat as a leaf record; do not double-emit from children
        for v in node.values():
            if isinstance(v, (dict, list)):
                _harvest(v, url, out, city)
    elif isinstance(node, list):
        for item in node:
            _harvest(item, url, out, city)


async def _pull(client: httpx.AsyncClient, url: str, out: list[dict],
                cap: int, city: str | None = None) -> int:
    before = len(out)
    try:
        resp = await client.get(url)
        if resp.status_code != 200:
            return 0
        data = resp.json()
    except (httpx.HTTPError, ValueError):
        return 0
    _harvest(data, url.split("?")[0], out, city)
    if len(out) > cap:
        del out[cap:]
    return len(out) - before


async def fetch_api_rows(endpoints: list[dict], domain: str, *, cap: int = 50000) -> list[dict]:
    rows: list[dict] = []
    async with httpx.AsyncClient(timeout=30, headers=_HEADERS, follow_redirects=True) as client:
        for ep in endpoints:
            url = (ep or {}).get("url")
            if not url:
                continue
            got = await _pull(client, url, rows, cap)
            log.info("api endpoint fetched domain=%s url=%s rows=%d total_rows=%d",
                     domain, url, got, len(rows))
    return rows
