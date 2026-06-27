"""Sink contract + a fan-out combiner."""
from __future__ import annotations

from typing import Protocol, runtime_checkable

from crawler.config import get_logger

log = get_logger(__name__)


@runtime_checkable
class Sink(Protocol):
    """Persist already-cleaned price records for one domain. Returns rows written."""

    async def emit(self, records: list[dict], *, domain: str) -> int: ...


class FanoutSink:
    """Write the same records to several sinks (SINK=both). Rows-written is the max."""

    def __init__(self, sinks: list[Sink]):
        self.sinks = sinks

    async def emit(self, records: list[dict], *, domain: str) -> int:
        written = 0
        for sink in self.sinks:
            try:
                written = max(written, await sink.emit(records, domain=domain))
            except Exception:  # noqa: BLE001  — one sink failing must not hide the others
                log.exception("sink %s failed domain=%s", type(sink).__name__, domain)
                raise
        return written
