"""SiteAdapter — per-site scraping profile (the site-specific knowledge).

The engine (crawl + tier extractors) is generic. Everything site-specific lives
here and is persisted to adapters/<domain>.json:

    fields     — the output fields we want
    method     — which extraction tier won on this site (jsonld | schema | regex | mixed)
    data_urls  — concrete URLs where the data actually is
    schema_ref — points at schemas/<domain>.json when method == schema

First run DISCOVERs and builds the adapter; later runs just load it and COLLECT.
"""
import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from fnmatch import fnmatch
from urllib.parse import urlparse
from collections import defaultdict

from crawler.common.canonical import canonical_url
from crawler.common import patterns as P
from crawler.adapter.agent_prompt import AGENT_LOOP_SYSTEM_PROMPT
from crawler.common.promptlog import log_prompt
from crawler.config import (ADAPTER_COMPACT, ADAPTER_DIR, ADAPTER_LISTING_ROW_THRESHOLD, FIELDS,
                     JUNK_URL_PATTERNS, PAGES_DIR, get_logger)
from crawler.output.output import url_filename
from crawler.extract.record import OUTPUT_SCHEMA
from crawler.common.models import FetchPlan
from crawler.routing.routes import route_template
from crawler.extract.schema import list_schema_signatures, load_schema
from crawler.routing.urlinfo import url_metadata

log = get_logger(__name__)


def _adapter_path(domain: str):
    import re
    return ADAPTER_DIR / f"{re.sub(r'[^a-zA-Z0-9.]', '_', domain)}.json"


def _url_rows(store, url: str) -> int:
    key = canonical_url(url)
    if store is not None:
        rows = int(store.url_stats.get(key, {}).get("rows", 0))
        if rows:
            return rows
    page_path = PAGES_DIR / url_filename(key)
    if not page_path.exists():
        return 0
    try:
        payload = json.loads(page_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return 0
    return int(payload.get("count") or len(payload.get("prices", [])))


def _has_id_segment(url: str) -> bool:
    return any(P.ID_SEG_RE.match(seg) for seg in urlparse(url).path.split("/") if seg)


def _same_scope(parent: str, child: str, *, allow_global_city: bool) -> bool:
    p_meta, c_meta = url_metadata(parent), url_metadata(child)
    parent_city = p_meta.get("city")
    child_city = c_meta.get("city")
    if parent_city != child_city and not (allow_global_city and parent_city is None):
        return False
    p_path = urlparse(parent).path.rstrip("/")
    c_path = urlparse(child).path.rstrip("/")
    return c_path.startswith(p_path + "/")


def _is_junk_url(url: str) -> bool:
    return any(fnmatch(url, pat) for pat in JUNK_URL_PATTERNS)


def _compact_urls(urls: list[str], store) -> list[str]:
    # Always drop junk-pattern URLs (offices/news/etc), even ones inherited from
    # stale state, so the adapter never re-fetches price-less pages.
    urls = [url for url in urls if not _is_junk_url(url)]
    if not ADAPTER_COMPACT:
        return sorted(urls)

    candidates = sorted({canonical_url(url) for url in urls})
    listings = [
        url for url in candidates
        if _url_rows(store, url) >= ADAPTER_LISTING_ROW_THRESHOLD and not _has_id_segment(url)
    ]
    kept_listings: list[str] = []
    for url in sorted(listings, key=lambda u: len(urlparse(u).path)):
        if any(_same_scope(parent, url, allow_global_city=False) for parent in kept_listings):
            continue
        kept_listings.append(url)
    kept = set(kept_listings)
    dropped = 0
    for url in candidates:
        if url in kept:
            continue
        if any(_same_scope(listing, url, allow_global_city=True) for listing in kept_listings):
            dropped += 1
            continue
        kept.add(url)
    if dropped:
        log.debug("adapter compacted data_urls before=%d after=%d dropped_detail_urls=%d",
                 len(candidates), len(kept), dropped)
    return sorted(kept)


def compact_data_urls(urls: list[str], store=None) -> list[str]:
    return _compact_urls(urls, store)


@dataclass
class SiteAdapter:
    domain: str
    fields: list[str] = field(default_factory=lambda: list(FIELDS))
    method: str = "regex"
    data_urls: list[str] = field(default_factory=list)
    url_meta: dict = field(default_factory=dict)
    city_stats: dict = field(default_factory=dict)
    url_nodes: dict = field(default_factory=dict)
    page_groups: dict = field(default_factory=dict)
    fetch_plan: FetchPlan = field(default_factory=FetchPlan)
    output_schema: list[str] = field(default_factory=lambda: list(OUTPUT_SCHEMA))
    fetch_instructions: dict = field(default_factory=dict)
    mcp_strategy: dict = field(default_factory=dict)
    schema_signatures: dict = field(default_factory=dict)
    route_rules: dict = field(default_factory=dict)
    blocked_patterns: list[str] = field(default_factory=list)
    extractor_stats: dict = field(default_factory=dict)
    run_info: dict = field(default_factory=dict)
    has_schema: bool = False
    updated_at: str = ""

    # -- persistence ----------------------------------------------------------
    @classmethod
    def load(cls, domain: str) -> "SiteAdapter | None":
        p = _adapter_path(domain)
        if not p.exists():
            return None
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return None
        if isinstance(data.get("data_urls"), list):
            data["data_urls"] = sorted({canonical_url(url) for url in data["data_urls"] if url})
        if isinstance(data.get("url_meta"), dict):
            data["url_meta"] = {
                canonical_url(url): meta
                for url, meta in data["url_meta"].items()
                if url and isinstance(meta, dict)
            }
        if isinstance(data.get("url_nodes"), dict):
            data["url_nodes"] = {
                canonical_url(url): node
                for url, node in data["url_nodes"].items()
                if url and isinstance(node, dict)
            }
        if isinstance(data.get("page_groups"), dict):
            data["page_groups"] = data["page_groups"]
        if isinstance(data.get("fetch_plan"), dict):
            data["fetch_plan"] = FetchPlan.from_dict(data["fetch_plan"])
        if isinstance(data.get("mcp_strategy"), dict):
            data["mcp_strategy"] = data["mcp_strategy"]
        if isinstance(data.get("route_rules"), dict):
            route_rules = {}
            for template, rule in data["route_rules"].items():
                normalized = route_template(template)
                if normalized not in route_rules:
                    route_rules[normalized] = rule
                    continue
                current = route_rules[normalized]
                current["valid"] = int(current.get("valid", 0)) + int(rule.get("valid", 0))
                current["invalid"] = int(current.get("invalid", 0)) + int(rule.get("invalid", 0))
                current["rows"] = int(current.get("rows", 0)) + int(rule.get("rows", 0))
                if current.get("decision") != "fetch" and rule.get("decision") == "fetch":
                    current["decision"] = "fetch"
                    current["role"] = "data"
            data["route_rules"] = route_rules
        if not data.get("page_groups") and data.get("url_nodes") and data.get("data_urls"):
            data["page_groups"] = build_page_groups(data["url_nodes"], data["data_urls"])
        if not data.get("fetch_plan") and data.get("data_urls"):
            data["fetch_plan"] = build_fetch_plan(data.get("data_urls", []), data.get("url_nodes", {}))
        return cls(**{k: data[k] for k in data if k in cls.__dataclass_fields__})

    def save(self) -> None:
        ADAPTER_DIR.mkdir(parents=True, exist_ok=True)
        self.updated_at = datetime.now(timezone.utc).isoformat()
        _adapter_path(self.domain).write_text(
            json.dumps(asdict(self), ensure_ascii=False, indent=2), encoding="utf-8")
        log.info("adapter persisted domain=%s method=%s data_urls=%d url_nodes=%d groups=%d "
                 "fetch_plan=%d mcp=%s fields=%s path=%s",
                 self.domain, self.method, len(self.data_urls), len(self.url_nodes),
                 len(self.page_groups), len(self.fetch_plan.browser_urls),
                 self.mcp_strategy.get("status", "none") if self.mcp_strategy else "none",
                 ",".join(self.fields), _adapter_path(self.domain))

    # -- build from a discovery run ------------------------------------------
    @classmethod
    def build(cls, domain: str, stats: dict, data_urls: set[str], store=None,
              run_info: dict | None = None) -> "SiteAdapter":
        tiers = stats.get("tiers", {})
        method = max(tiers, key=tiers.get) if tiers else "regex"
        if len(tiers) > 1:
            method = "mixed"
        route_rules = {}
        blocked_patterns = []
        if store is not None:
            for tmpl, s in sorted(store.stats.items()):
                rows = int(s.get("rows", 0))
                valid = int(s.get("valid", 0))
                invalid = int(s.get("invalid", 0))
                if rows:
                    decision = "fetch"
                    role = "data"
                elif valid and invalid <= valid:
                    decision = "defer"
                    role = "listing"
                else:
                    decision = "skip"
                    role = "junk"
                route_rules[tmpl] = {
                    "decision": decision,
                    "role": role,
                    "valid": valid,
                    "invalid": invalid,
                    "rows": rows,
                }
            blocked_patterns = store.dead_globs()
        urls = _compact_urls(sorted({canonical_url(url) for url in data_urls}), store)
        url_meta = {url: url_metadata(url) for url in urls}
        url_nodes = getattr(store, "url_nodes", {}) if store is not None else {}
        page_groups = build_page_groups(url_nodes, urls)
        fetch_plan = build_fetch_plan(urls, url_nodes)
        city_stats: dict[str, int] = {}
        for meta in url_meta.values():
            city = meta.get("city") or "_unknown"
            city_stats[city] = city_stats.get(city, 0) + 1
        schema_signatures = list_schema_signatures(domain)
        return cls(domain=domain, fields=list(FIELDS), method=method,
                   data_urls=urls, url_meta=url_meta, city_stats=city_stats,
                   url_nodes=url_nodes, page_groups=page_groups, fetch_plan=fetch_plan,
                   output_schema=list(OUTPUT_SCHEMA),
                   fetch_instructions=build_fetch_instructions(domain, urls),
                   schema_signatures=schema_signatures,
                   route_rules=route_rules, blocked_patterns=blocked_patterns, extractor_stats=tiers,
                   run_info=run_info or {},
                   has_schema=bool(schema_signatures) or load_schema(domain) is not None)


def build_fetch_instructions(domain: str, data_urls: list[str]) -> dict:
    """Instructions passed from adapter to fetch/output stages."""
    log_prompt(
        "adapter.agent_loop.system",
        AGENT_LOOP_SYSTEM_PROMPT,
        domain=domain,
        once_key=f"adapter-system:{domain}",
        meta={"target_fields": ",".join(OUTPUT_SCHEMA), "source_urls": len(data_urls)},
    )
    return {
        "target_fields": list(OUTPUT_SCHEMA),
        "data_model": {
            "type": "medservice_price_minimal",
            "url_nodes": True,
            "page_groups": True,
            "fetch_plan": True,
            "mcp_strategy": True,
            "schema_signatures": True,
            "source_url_per_row": True,
        },
        "record_type": "service_price_minimal",
        "system_prompt": AGENT_LOOP_SYSTEM_PROMPT,
        "fetch_only": ["service name", "price", "duration", "url"],
        "field_map": {
            "service_name_raw": "exact service label from source page",
            "price_kzt": "price converted to KZT decimal string",
            "duration_days": "execution duration in days if visible, else null",
            "url": "canonical source URL for the row",
        },
        "dedupe_policy": "service_name_raw + price_kzt + duration_days + url",
        "source_urls": data_urls,
    }


def build_fetch_plan(data_urls: list[str], url_nodes: dict | None = None) -> FetchPlan:
    """Build a structured transport plan from adapter-selected URLs."""
    selected = [canonical_url(url) for url in data_urls if url]
    nodes = url_nodes or {}
    transport_by_url: dict[str, str] = {}
    browser_urls: list[str] = []
    http_urls: list[str] = []
    # HTTP-first: only fall back to a (GPU-using) headless browser when discovery
    # actually saw a JavaScript shell for this page. Path keywords alone are not a
    # reason — most KZ med catalogs (invitro, kdlolymp, emirmed) are server-rendered.
    for url in selected:
        node = nodes.get(url, {}) if isinstance(nodes, dict) else {}
        reason = str(node.get("reason") or "").lower()
        needs_browser = "js-shell" in reason or "dynamic" in reason or "spa" in reason
        transport_by_url[url] = "browser" if needs_browser else "http"
        (browser_urls if needs_browser else http_urls).append(url)
    return FetchPlan(
        transport_by_url=transport_by_url,
        browser_urls=browser_urls,
        http_urls=http_urls,
    )


def build_page_groups(url_nodes: dict, selected_urls: list[str]) -> dict:
    groups: dict[str, dict] = defaultdict(lambda: {"urls": [], "rows": 0, "cities": {}, "actions": {}})
    selected = {canonical_url(url) for url in selected_urls}
    seen: set[str] = set()
    for url, node in (url_nodes or {}).items():
        key = canonical_url(url)
        if key not in selected and int(node.get("rows", 0)) <= 0 and node.get("action") != "follow":
            continue
        tmpl = node.get("route_template") or route_template(key)
        group = groups[tmpl]
        group["urls"].append(key)
        seen.add(key)
        group["rows"] = max(group["rows"], int(node.get("rows", 0)))
        city = node.get("city") or "_unknown"
        group["cities"][city] = group["cities"].get(city, 0) + 1
        action = node.get("action") or "unknown"
        group["actions"][action] = group["actions"].get(action, 0) + 1
    for key in sorted(selected - seen):
        tmpl = route_template(key)
        group = groups[tmpl]
        group["urls"].append(key)
        meta = url_metadata(key)
        city = meta.get("city") or "_unknown"
        group["cities"][city] = group["cities"].get(city, 0) + 1
        group["actions"]["selected"] = group["actions"].get("selected", 0) + 1
    return {k: dict(v) for k, v in groups.items()}
