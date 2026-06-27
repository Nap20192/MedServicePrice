"""Persist results: cleaned price pages + deduped JSONL rows."""
import hashlib
import json
import re
from datetime import datetime, timezone
from urllib.parse import urlparse

from crawler.config import OUTPUT_DIR, OUTPUT_PATH, PAGES_DIR, SAVE_PAGES, get_logger
from crawler.extract.record import OUTPUT_SCHEMA, clean_records

log = get_logger(__name__)

_TLDS = {"kz", "ru", "com", "net", "org", "io", "co", "kg", "uz", "info", "biz"}


def _domain_slug(domain: str) -> str:
    """invitro.kz -> invitro, kdlolymp.kz -> kdlolymp, sub.example.com -> sub-example."""
    parts = [p for p in domain.lower().removeprefix("www.").split(".") if p]
    if len(parts) > 1 and parts[-1] in _TLDS:
        parts = parts[:-1]
    slug = re.sub(r"[^a-z0-9-]+", "-", "-".join(parts)).strip("-")
    return slug or "site"


def output_path(domain: str) -> "object":
    """Per-domain output file, unless OUTPUT_PATH forces a fixed one."""
    if OUTPUT_PATH is not None:
        return OUTPUT_PATH
    return OUTPUT_DIR / f"{_domain_slug(domain)}-prices.jsonl"


def url_filename(url: str) -> str:
    """Filename derived from the URL itself: host + path (+ query), sanitized.

    Very long names are truncated with a short hash suffix to stay unique."""
    p = urlparse(url)
    raw = f"{p.netloc}{p.path}" + (f"_{p.query}" if p.query else "")
    name = re.sub(r"[^a-zA-Z0-9._-]+", "_", raw).strip("_") or "index"
    if len(name) > 150:
        name = f"{name[:150]}_{hashlib.sha1(url.encode()).hexdigest()[:8]}"
    return f"{name}.json"


def save_page(url: str, rows: list[dict]) -> None:
    """Save one page's extracted rows as a JSON file named after its URL."""
    if not (SAVE_PAGES and rows):
        return
    PAGES_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "url": url,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "count": len(rows),
        "prices": rows,
    }
    (PAGES_DIR / url_filename(url)).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_rows(rows: list[dict], fields: list[str] | None = None,
               instructions: dict | None = None, *, domain: str = "") -> int:
    """Dedupe and write rows in the MedServicePrice JSONL schema.

    Writes to <domain>-prices.jsonl (or OUTPUT_PATH if forced)."""
    clean = clean_records(rows, fields or OUTPUT_SCHEMA, instructions)
    path = output_path(domain)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        for rec in clean:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    log.info("wrote output rows=%d duplicates_removed=%d fields=%s path=%s",
             len(clean), len(rows) - len(clean), ",".join(fields or OUTPUT_SCHEMA), path)
    return len(clean)
