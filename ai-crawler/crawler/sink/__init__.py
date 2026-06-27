"""Pluggable sinks for fetched price rows.

The pipeline builds + dedupes rows once (crawler.extract.record.clean_records) and
hands the cleaned list to a Sink. A sink decides *where* they land:

    JsonlSink     -> <domain>-prices.jsonl   (CLI default, unchanged behaviour)
    PostgresSink  -> parsed_services table    (worker)
    FanoutSink    -> several sinks at once    (SINK=both)

OUTPUT_SCHEMA stays the contract every sink consumes.
"""
from crawler.sink.base import FanoutSink, Sink
from crawler.sink.jsonl import JsonlSink
from crawler.sink.postgres import PostgresSink

__all__ = ["Sink", "JsonlSink", "PostgresSink", "FanoutSink", "build_sink"]


def build_sink(kind: str, *, pool=None, source_id=None) -> Sink:
    """Construct the sink named by SINK (postgres|jsonl|both).

    Postgres sinks need an asyncpg pool + the resolved source_id; the CLI passes
    neither and gets JSONL.
    """
    kind = (kind or "jsonl").strip().lower()
    if kind == "jsonl":
        return JsonlSink()
    if kind == "postgres":
        return PostgresSink(pool, source_id)
    if kind == "both":
        return FanoutSink([JsonlSink(), PostgresSink(pool, source_id)])
    raise ValueError(f"unknown SINK={kind!r} (expected postgres|jsonl|both)")
