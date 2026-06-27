"""Shared page processing: validate a fetched Page, extract rows, learn routes.

Used by both sides of the pipeline — discovery (adapter building) and the
fetcher (collect). It does no networking; callers feed it already-fetched Pages.
"""
import asyncio
from urllib.parse import urlsplit

from collections import Counter

from crawler.config import LLM_CONCURRENCY, get_logger
from crawler.extract.category import categorize
from crawler.extract.extract import extract_page
from crawler.common.models import Page
from crawler.output.output import save_page
from crawler.routing.routes import RouteStore, route_template, route_valid
from crawler.routing.urlinfo import infer_city

log = get_logger(__name__)


def short(url: str) -> str:
    s = urlsplit(url)
    return (s.path or "/") + (f"?{s.query}" if s.query else "")


def new_stats() -> dict:
    return {"pages": 0, "with_prices": 0, "tiers": {}, "invalid": 0}


def process(page: Page, rows: list, stats: dict, store: RouteStore) -> tuple[bool, int]:
    """Validate the route, extract rows, record route + data stats."""
    return apply_result(analyze(page), rows, stats, store)


async def process_pages(pages: list[Page], rows: list, stats: dict,
                        store: RouteStore) -> list[tuple[Page, bool, int]]:
    """Analyze pages concurrently, then apply route/store mutations sequentially."""
    if not pages:
        return []
    sem = asyncio.Semaphore(LLM_CONCURRENCY)

    async def run(page: Page) -> dict:
        async with sem:
            return await asyncio.to_thread(analyze, page)

    results = await asyncio.gather(*(run(page) for page in pages))
    applied = []
    for result in results:
        valid, n_rows = apply_result(result, rows, stats, store)
        applied.append((result["page"], valid, n_rows))
    return applied


def analyze(page: Page) -> dict:
    """CPU/LLM page analysis only. Does not mutate shared crawl state."""
    tmpl = route_template(page.url)
    valid, reason = route_valid(page)
    if not valid:                                    # invalid route -> skip everything
        return {
            "page": page,
            "tmpl": tmpl,
            "valid": False,
            "reason": reason,
            "tier": "",
            "page_rows": [],
            "page_category": "",
        }

    tier, page_rows, _lines = extract_page(page.url, page.html, page.md)
    city = infer_city(page.url)
    for row in page_rows:
        row["city"] = city
        row["category"] = categorize(row.get("service", ""), page.url)
    page_category = _dominant_category(page_rows) or categorize(url=page.url)
    return {
        "page": page,
        "tmpl": tmpl,
        "valid": True,
        "reason": reason,
        "tier": tier,
        "page_rows": page_rows,
        "page_category": page_category,
    }


def apply_result(result: dict, rows: list, stats: dict, store: RouteStore) -> tuple[bool, int]:
    """Apply one analyzed page to shared route stats, output rows, and saved pages."""
    page = result["page"]
    tmpl = result["tmpl"]
    valid = bool(result["valid"])
    stats["pages"] += 1
    store.record(tmpl, valid)
    if not valid:
        stats["invalid"] += 1
        log.warning("invalid page url=%s template=%s reason=%s status=%s",
                    page.url, tmpl, result["reason"], page.status)
        return False, 0

    tier = result["tier"]
    page_rows = result["page_rows"]
    page_category = result["page_category"]
    store.record_data(page.url, tmpl, len(page_rows))
    store.record_node(page.url, rows=len(page_rows), category=page_category)
    if page_rows:
        stats["with_prices"] += 1
        stats["tiers"][tier] = stats["tiers"].get(tier, 0) + 1
        rows.extend(page_rows)
        save_page(page.url, page_rows)
        sample = page_rows[0]
        log.info("page url=%s category=%s tier=%s rows=%d sample=%r",
                 short(page.url), page_category, tier, len(page_rows),
                 f"{sample['service'][:50]} | {sample['price']:g} {sample['currency']}")
    else:
        log.debug("page url=%s category=%s tier=%s rows=0", short(page.url), page_category, tier)
    return True, len(page_rows)


def _dominant_category(page_rows: list) -> str:
    """The category most rows on the page fall into — the page's service type."""
    if not page_rows:
        return ""
    return Counter(r.get("category", "") for r in page_rows).most_common(1)[0][0]
