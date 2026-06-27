"""JSONL sink — the original CLI output, factored behind the Sink interface."""
from __future__ import annotations

import json

from crawler.config import get_logger
from crawler.output.output import output_path

log = get_logger(__name__)


class JsonlSink:
    """Write cleaned records to <domain>-prices.jsonl (or OUTPUT_PATH if forced)."""

    async def emit(self, records: list[dict], *, domain: str) -> int:
        path = output_path(domain)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as fh:
            for rec in records:
                fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        log.info("jsonl sink wrote rows=%d path=%s", len(records), path)
        return len(records)
