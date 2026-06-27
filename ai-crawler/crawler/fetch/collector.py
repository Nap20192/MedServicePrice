"""Fetcher operation — replay the adapter's known data-URLs and extract rows.

No discovery, no adapter mutation: the adapter already decided *what* to fetch
and *how* to transport it. This module just walks that plan, fetches each URL,
and runs the shared page processor. Adapter building lives in `harvest.py`.
"""
import time

from crawler.config import ESCALATE, get_logger
from crawler.fetch.fetcher import _needs_browser, fetch_urls
from crawler.extract.pageproc import new_stats, process_pages
from crawler.routing.routes import RouteStore

log = get_logger(__name__)


async def collect(domain: str, data_urls: list[str], *,
                  browser_urls: list[str] | None = None) -> tuple[list[dict], dict, RouteStore]:
    """Re-fetch known data-URLs and extract. No discovery.

    HTTP-first: any page that comes back as a JavaScript shell (no rows + SPA
    markers) is escalated to a headless browser and re-fetched — so dynamic
    sites still yield data even though the adapter planned them as HTTP."""
    store = RouteStore(domain)
    rows, stats, t0 = [], new_stats(), time.perf_counter()
    browser = [url for url in (browser_urls or []) if url in data_urls]
    http_urls = [url for url in data_urls if url not in set(browser)]
    log.info("collect started domain=%s http_urls=%d browser_urls=%d total_urls=%d",
             domain, len(http_urls), len(browser), len(data_urls))

    escalate: list[str] = []
    if http_urls:
        log.debug("collect transport=http batch=%d urls=%s", len(http_urls), ",".join(http_urls[:6]))
        pages = [page async for page in fetch_urls(http_urls)]
        for page, _valid, n_rows in await process_pages(pages, rows, stats, store):
            if ESCALATE and n_rows == 0 and _needs_browser(page):
                escalate.append(page.url)

    browser_batch = list(dict.fromkeys(browser + escalate))
    if escalate:
        log.info("collect browser escalation pages=%d", len(escalate))
    if browser_batch:
        log.debug("collect transport=browser batch=%d urls=%s",
                  len(browser_batch), ",".join(browser_batch[:6]))
        pages = [page async for page in fetch_urls(browser_batch, force_browser=True)]
        await process_pages(pages, rows, stats, store)

    log.info("RESULT collect domain=%s pages=%d pages_with_data=%d invalid_routes=%d rows=%d "
             "escalated=%d duration_s=%.1f tiers=%s", domain, stats["pages"], stats["with_prices"],
             stats["invalid"], len(rows), len(escalate), time.perf_counter() - t0, stats["tiers"] or "{}")
    return rows, stats, store
