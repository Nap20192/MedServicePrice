"""Two operations:

  create_or_update_adapter(url)  — discover the site, save all needed data-URLs
                                   into the adapter (create new or merge into existing).
  fetch(url)                     — load the adapter, walk its data-URLs, fetch + extract.

`run()` is a convenience wrapper: build the adapter if missing, then fetch.
"""
import time
from datetime import datetime, timezone

from crawler.adapter.mcp_explorer import explore_with_mcp
from crawler.adapter.agent_loop import run_agent_loop
from crawler.adapter.adapter import (SiteAdapter, build_fetch_instructions, build_fetch_plan,
                      build_page_groups, compact_data_urls)
from crawler.common.canonical import canonical_url
from crawler.fetch.collector import collect
from crawler.fetch.api_fetch import fetch_api_rows
from crawler.config import AGENT_LOOP, REDISCOVER, WRITE_DISCOVERY_OUTPUT, get_logger
from crawler.discovery.harvest import discover
from crawler.output.output import write_rows
from crawler.extract.record import OUTPUT_SCHEMA, clean_records
from crawler.routing.routes import host
from crawler.routing.urlinfo import url_metadata
from crawler.sink import JsonlSink, Sink

log = get_logger(__name__)


def _merge_counts(left: dict, right: dict) -> dict:
    keys = set(left) | set(right)
    return {k: max(int(left.get(k, 0)), int(right.get(k, 0))) for k in keys}


def _url_meta(urls: list[str]) -> dict:
    return {url: url_metadata(url) for url in urls}


def _city_stats(url_meta: dict) -> dict:
    stats: dict[str, int] = {}
    for meta in url_meta.values():
        city = meta.get("city") or "_unknown"
        stats[city] = stats.get(city, 0) + 1
    return dict(sorted(stats.items(), key=lambda kv: (-kv[1], kv[0])))


def _refresh_adapter_urls(adapter: SiteAdapter, store) -> None:
    adapter.data_urls = compact_data_urls(
        sorted({canonical_url(url) for url in adapter.data_urls}),
        store,
    )
    adapter.url_meta = _url_meta(adapter.data_urls)
    adapter.city_stats = _city_stats(adapter.url_meta)
    adapter.page_groups = build_page_groups(getattr(store, "url_nodes", {}), adapter.data_urls)
    adapter.fetch_plan = build_fetch_plan(adapter.data_urls, getattr(store, "url_nodes", {}))
    adapter.fields = list(OUTPUT_SCHEMA)
    adapter.output_schema = list(OUTPUT_SCHEMA)
    adapter.fetch_instructions = build_fetch_instructions(adapter.domain, adapter.data_urls)


async def create_or_update_adapter(start_url: str) -> SiteAdapter:
    """Discover the site and persist all needed data-URLs into the adapter."""
    t0 = time.perf_counter()
    started_at = datetime.now(timezone.utc).isoformat()
    domain = host(start_url)
    existing = SiteAdapter.load(domain)
    action = "update" if existing else "create"
    log.info("adapter %s started domain=%s", action, domain)

    rows, stats, store = await discover(start_url)
    discovery_duration = time.perf_counter() - t0
    store.save()

    run_info = {
        "command": "adapter",
        "start_url": start_url,
        "started_at": started_at,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "duration_s": round(discovery_duration, 3),
        "pages": stats["pages"],
        "pages_with_prices": stats["with_prices"],
        "invalid_routes": stats["invalid"],
        "rows_extracted": len(rows),
    }
    if not store.data_urls:
        mcp_strategy = await explore_with_mcp(
            start_url,
            reason="adapter discovery found no data urls",
        )
        if mcp_strategy.enabled:
            run_info["mcp_strategy"] = mcp_strategy.to_dict()
            adapter = SiteAdapter(
                domain=domain,
                fields=list(OUTPUT_SCHEMA),
                output_schema=list(OUTPUT_SCHEMA),
                fetch_instructions=build_fetch_instructions(domain, []),
                route_rules={
                    tmpl: {
                        "decision": "skip",
                        "role": "empty-or-shell",
                        "valid": int(s.get("valid", 0)),
                        "invalid": int(s.get("invalid", 0)),
                        "rows": int(s.get("rows", 0)),
                    }
                    for tmpl, s in sorted(store.stats.items())
                },
                blocked_patterns=store.dead_globs(),
                run_info={**run_info, "status": "no_data_urls_discovered"},
                mcp_strategy=mcp_strategy.to_dict(),
            )
            adapter.save()
            log.warning("adapter discovery found no data URLs; saved MCP exploration profile "
                        "domain=%s mcp_status=%s candidates=%d",
                        domain, mcp_strategy.status, len(mcp_strategy.network_candidates))
            return adapter
        if existing and existing.data_urls:
            existing.run_info["last_adapter_attempt"] = {
                **run_info,
                "status": "no_data_urls_discovered",
            }
            existing.save()
            log.warning("adapter discovery found no data URLs; kept existing adapter domain=%s data_urls=%d",
                        domain, len(existing.data_urls))
            return existing
        log.error("adapter discovery found no data URLs; refusing to persist empty adapter domain=%s",
                  domain)
        return SiteAdapter(
            domain=domain,
            fields=list(OUTPUT_SCHEMA),
            output_schema=list(OUTPUT_SCHEMA),
            fetch_instructions=build_fetch_instructions(domain, []),
            run_info={**run_info, "status": "no_data_urls_discovered"},
        )

    adapter = SiteAdapter.build(domain, stats, store.data_urls, store, run_info)
    if existing:                                     # UPDATE: merge URLs, keep field config
        before = len(existing.data_urls)
        adapter.data_urls = sorted(
            {canonical_url(url) for url in existing.data_urls}
            | {canonical_url(url) for url in adapter.data_urls}
        )
        _refresh_adapter_urls(adapter, store)
        adapter.fields = list(OUTPUT_SCHEMA)
        adapter.output_schema = list(OUTPUT_SCHEMA)
        adapter.fetch_instructions = build_fetch_instructions(domain, adapter.data_urls)
        adapter.route_rules = {**existing.route_rules, **adapter.route_rules}
        adapter.blocked_patterns = sorted(set(existing.blocked_patterns) | set(adapter.blocked_patterns))
        adapter.extractor_stats = _merge_counts(existing.extractor_stats, adapter.extractor_stats)
        log.info("adapter merged domain=%s before=%d discovered=%d after=%d url_nodes=%d groups=%d browser_urls=%d",
                 domain, before, len(store.data_urls), len(adapter.data_urls),
                 len(getattr(store, "url_nodes", {})), len(adapter.page_groups),
                 len(adapter.fetch_plan.browser_urls if adapter.fetch_plan else []))
    # Optional LLM tool-calling agent: drive a browser (navigate/click/snapshot) to
    # find price pages hidden behind tabs/buttons and any JSON price endpoints, then
    # enrich the adapter with those URLs + the interaction steps to replay them.
    if AGENT_LOOP:
        agent = await run_agent_loop(start_url)
        if agent.enabled and agent.status == "ok":
            if agent.data_urls:
                adapter.data_urls = sorted(
                    {canonical_url(u) for u in adapter.data_urls}
                    | {canonical_url(u) for u in agent.data_urls})
                _refresh_adapter_urls(adapter, store)
            adapter.interaction_steps = agent.interactions
            adapter.network_endpoints = agent.network_endpoints
            adapter.agent_trace = agent.to_dict()
            log.info("agent enriched adapter domain=%s agent_data_urls=%d interactions=%d endpoints=%d "
                     "total_data_urls=%d", domain, len(agent.data_urls), len(agent.interactions),
                     len(agent.network_endpoints), len(adapter.data_urls))

    adapter.save()
    store.set_data_urls(adapter.data_urls)
    store.save()

    if WRITE_DISCOVERY_OUTPUT:
        write_rows(rows, OUTPUT_SCHEMA, adapter.fetch_instructions, domain=domain)
    elif rows:
        log.info("adapter discovery extracted rows=%d but output write is disabled "
                 "(set WRITE_DISCOVERY_OUTPUT=1 to persist discovery rows)", len(rows))
    log.info("RESULT adapter_%s domain=%s data_urls=%d discovery_rows=%d pages=%d "
             "pages_with_data=%d duration_s=%.1f",
             action, domain, len(adapter.data_urls), len(rows), stats["pages"],
             stats["with_prices"], time.perf_counter() - t0)
    return adapter


async def fetch(start_url: str, sink: Sink | None = None) -> int:
    """Walk the adapter's saved data-URLs and fetch fresh data from each.

    Pure fetch step: it reads the adapter as a fixed plan and does not rediscover
    or rewrite it. Adapter (re)building is create_or_update_adapter's job.

    `sink` decides where rows land. Default (None) = JSONL, preserving the CLI
    behaviour; the worker passes a Postgres (or fan-out) sink instead."""
    t0 = time.perf_counter()
    started_at = datetime.now(timezone.utc).isoformat()
    domain = host(start_url)
    adapter = SiteAdapter.load(domain)
    if adapter is None or not adapter.data_urls:
        log.error("no adapter for domain=%s — run create_or_update_adapter first", domain)
        return 0

    adapter.fetch_plan = build_fetch_plan(adapter.data_urls, adapter.url_nodes)  # HTTP-first, no network
    browser_urls = list(adapter.fetch_plan.browser_urls if adapter.fetch_plan else [])
    # Agent fix B: pages the discovery agent had to interact with (click a tab/city/
    # "show prices") load data via JS — force a browser so that data renders.
    if adapter.interaction_steps:
        inter = {canonical_url(s.get("on_url")) for s in adapter.interaction_steps if s.get("on_url")}
        browser_urls = sorted(set(browser_urls) | inter)
    log.info("fetch started domain=%s data_urls=%d browser_urls=%d endpoints=%d method=%s",
             domain, len(adapter.data_urls), len(browser_urls), len(adapter.network_endpoints),
             adapter.method)
    rows, stats, store = await collect(domain, adapter.data_urls, browser_urls=browser_urls)
    store.save()

    # Agent fix A: pull the JSON/XHR price endpoints the agent found — cheaper and
    # cleaner than HTML — and merge their rows in before normalization.
    api_rows: list[dict] = []
    if adapter.network_endpoints:
        api_rows = await fetch_api_rows(adapter.network_endpoints, domain)
        log.info("api endpoints fetched domain=%s endpoints=%d api_rows=%d",
                 domain, len(adapter.network_endpoints), len(api_rows))

    if sink is None:
        sink = JsonlSink()
    records = clean_records(rows + api_rows, OUTPUT_SCHEMA, adapter.fetch_instructions)
    n = await sink.emit(records, domain=domain)
    adapter.run_info["last_fetch"] = {
        "command": "fetch",
        "start_url": start_url,
        "started_at": started_at,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "duration_s": round(time.perf_counter() - t0, 3),
        "data_urls": len(adapter.data_urls),
        "pages": stats["pages"],
        "pages_with_prices": stats["with_prices"],
        "invalid_routes": stats["invalid"],
        "rows_extracted": len(rows) + len(api_rows),
        "api_rows": len(api_rows),
        "prices_written": n,
    }
    adapter.save()
    log.info("RESULT fetch domain=%s prices=%d pages=%d pages_with_data=%d invalid_routes=%d "
             "duration_s=%.1f sink=%s",
             domain, n, stats["pages"], stats["with_prices"], stats["invalid"],
             time.perf_counter() - t0, type(sink).__name__)
    return n


async def run(start_url: str, sink: Sink | None = None) -> int:
    """Convenience: ensure an adapter exists (create/update), then fetch through it."""
    adapter = SiteAdapter.load(host(start_url))
    if REDISCOVER or adapter is None or not adapter.data_urls:
        await create_or_update_adapter(start_url)
    return await fetch(start_url, sink)
