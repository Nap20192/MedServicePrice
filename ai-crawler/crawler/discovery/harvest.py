"""Adapter discovery — full crawl to learn where the data is and how to read it.

This is where adapter knowledge is generated (route stats, productive data-URLs,
winning extraction tier). It does no networking itself; it drives the fetcher and
feeds each fetched Page through the shared page processor. The fetch-time replay
of known data-URLs lives in `collector.py`.
"""
import time

from crawler.common.canonical import canonical_url
from crawler.config import (AGENT_BATCH_SIZE, AGENT_LINKS_PER_PAGE, DISCOVERY_MODE, ESCALATE, MAX_DEPTH,
                     MAX_PAGES, get_logger)
from crawler.fetch.fetcher import URLFetcher, _needs_browser, crawl_site, fetch_urls
from crawler.discovery.link_agent import LinkAgent, iter_links
from crawler.extract.pageproc import new_stats as _new_stats, process as _process, process_pages as _process_pages, short as _short
from crawler.routing.routes import RouteStore, host

log = get_logger(__name__)


def _has_links(page) -> bool:
    return any(True for _ in iter_links(page.links))


async def _discover_agent(start_url: str, store: RouteStore) -> tuple[list[dict], dict, RouteStore]:
    """Adaptive discovery: fetch only URLs accepted by the link-selection agent."""
    rows, stats, t0 = [], _new_stats(), time.perf_counter()
    agent = LinkAgent(start_url, store, max_depth=MAX_DEPTH, per_page=AGENT_LINKS_PER_PAGE)
    log.info("agent discovery started domain=%s max_pages=%d max_depth=%d batch=%d",
             host(start_url), MAX_PAGES, MAX_DEPTH, AGENT_BATCH_SIZE)

    iteration = 0
    async with URLFetcher() as fetcher:
        while stats["pages"] < MAX_PAGES:
            batch = agent.next_batch(min(AGENT_BATCH_SIZE, MAX_PAGES - stats["pages"]))
            if not batch:
                log.debug("agent loop done reason=frontier-empty iteration=%d pages=%d rows=%d",
                         iteration, stats["pages"], len(rows))
                break
            iteration += 1
            urls = [url for url, _depth, _reason in batch]
            log.debug("agent loop iteration=%d fetch=%d frontier=%d seen=%d pages=%d rows=%d first=%s",
                     iteration, len(urls), len(agent.frontier), len(agent.seen),
                     stats["pages"], len(rows), _short(urls[0]))
            page_depth = {canonical_url(url): depth for url, depth, _reason in batch}
            browser_retry: list[str] = []

            pages = [page async for page in fetcher.fetch(urls)]
            for page, valid, n_rows in await _process_pages(pages, rows, stats, store):
                agent.remember_rows(page.url, n_rows)
                if stats["pages"] < MAX_PAGES and (valid or _has_links(page)):
                    added = agent.consider_page_links(page, page_depth.get(canonical_url(page.url), 0))
                    if not valid and added:
                        log.debug("agent expanded invalid-but-linked page url=%s added=%d",
                                  _short(page.url), added)
                if ESCALATE and n_rows == 0 and _needs_browser(page):
                    browser_retry.append(page.url)

            if browser_retry:
                log.info("agent browser retry shell_pages=%d", len(browser_retry))
                pages = [
                    page async for page in fetch_urls(
                        browser_retry,
                        concurrency=min(len(browser_retry), AGENT_BATCH_SIZE),
                        force_browser=True,
                    )
                ]
                for page, valid, n_rows in await _process_pages(pages, rows, stats, store):
                    agent.remember_rows(page.url, n_rows)
                    if stats["pages"] < MAX_PAGES and (valid or _has_links(page)):
                        agent.consider_page_links(page, page_depth.get(canonical_url(page.url), 0))

    log.info("RESULT discovery domain=%s pages=%d pages_with_data=%d invalid_routes=%d "
             "rows=%d duration_s=%.1f agent=%s tiers=%s",
             host(start_url), stats["pages"], stats["with_prices"], stats["invalid"], len(rows),
             time.perf_counter() - t0, agent.summary(), stats["tiers"] or "{}")
    return rows, stats, store


async def discover(start_url: str) -> tuple[list[dict], dict, RouteStore]:
    """Full crawl: discover where the data is and how to extract it."""
    store = RouteStore(host(start_url))
    blocked = store.dead_globs()
    if blocked:
        log.info("loaded %d dead route-template(s) from prior runs, excluding from crawl", len(blocked))

    if DISCOVERY_MODE == "agent":
        return await _discover_agent(start_url, store)

    rows, stats, t0 = [], _new_stats(), time.perf_counter()
    log.info("discovery started domain=%s", host(start_url))
    async for page in crawl_site(start_url, blocked):
        _process(page, rows, stats, store)

    log.info("RESULT discovery domain=%s pages=%d pages_with_data=%d invalid_routes=%d rows=%d "
             "duration_s=%.1f tiers=%s", host(start_url), stats["pages"], stats["with_prices"],
             stats["invalid"], len(rows), time.perf_counter() - t0, stats["tiers"] or "{}")
    return rows, stats, store
