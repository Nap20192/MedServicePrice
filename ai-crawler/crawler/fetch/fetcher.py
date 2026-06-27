"""Fetching layer — turns URLs into fetched Pages. Network only, no extraction.

Owns the transport details: HTTP-first deep crawl, the browser fallback for
JavaScript-rendered shells, and direct URL fetching. Everything it yields is a
fully-fetched Page; what to *do* with a page (validate, extract, learn) is the
harvest layer's job.
"""
from collections.abc import AsyncIterator
from crawl4ai import (AsyncWebCrawler, BestFirstCrawlingStrategy, BrowserConfig,
                      CacheMode, CrawlerRunConfig, KeywordRelevanceScorer,
                      LXMLWebScrapingStrategy)
from crawl4ai.async_crawler_strategy import AsyncHTTPCrawlerStrategy
from crawl4ai.deep_crawling.filters import FilterChain, URLPatternFilter

from crawler.common import patterns as P
from crawler.config import (BROWSER_DISABLE_GPU, BROWSER_EXTRA_ARGS, BROWSER_HEADLESS,
                     BROWSER_VERBOSE, CONCURRENCY, CRAWL_MODE, ESCALATE,
                     FETCH_CONCURRENCY, JUNK_URL_PATTERNS, MAX_DEPTH, MAX_PAGES,
                     PAGE_TIMEOUT_MS, PRICE_KEYWORDS, get_logger)
from crawler.common.models import Page

log = get_logger(__name__)

# Speed: lxml scraping (faster than the default BeautifulSoup path) + a trimmed
# DOM (drop boilerplate/media before markdown) = less work per page.
_SCRAPER = LXMLWebScrapingStrategy()
# Headless Chrome composites via the GPU by default (shows up as GPU load during
# fetch). We only need the DOM, so turn GPU off entirely.
_NO_GPU = ["--disable-gpu", "--disable-software-rasterizer",
           "--disable-gpu-compositing", "--disable-dev-shm-usage"]


def _browser_config() -> BrowserConfig:
    extra_args = list(BROWSER_EXTRA_ARGS)
    if BROWSER_DISABLE_GPU:
        extra_args.extend(_NO_GPU)
    log.debug("browser config headless=%s verbose=%s extra_args=%d",
              BROWSER_HEADLESS, BROWSER_VERBOSE, len(extra_args))
    return BrowserConfig(headless=BROWSER_HEADLESS, verbose=BROWSER_VERBOSE,
                         extra_args=extra_args)
_LIGHT = dict(
    scraping_strategy=_SCRAPER,
    excluded_tags=["script", "style", "noscript", "svg", "iframe", "form",
                   "nav", "header", "footer", "aside"],
    exclude_all_images=True,
    remove_forms=True,
    exclude_social_media_links=True,
    exclude_external_links=True,
    word_count_threshold=10,
)
def _markdown(result) -> str:
    md = getattr(result, "markdown", None)
    if md is None:
        return ""
    for attr in ("fit_markdown", "raw_markdown"):
        if (val := getattr(md, attr, None)):
            return val
    return str(md)


def _preview(md: str, limit: int = 160) -> str:
    """First non-empty content line of the response, for the request/response trace."""
    for ln in md.splitlines():
        s = ln.strip()
        if len(s) > 3:
            return s[:limit]
    return ""


def _to_page(result) -> Page:
    status = getattr(result, "status_code", None)
    html = getattr(result, "html", "") or ""
    links = getattr(result, "links", {}) or {}
    ok = bool(getattr(result, "success", False)) or bool(status and status < 400 and (html or links))
    return Page(url=result.url, success=ok, status=status, html=html,
                md=_markdown(result) if ok else "", links=links)


def _error(result) -> str:
    for attr in ("error_message", "error", "exception", "message"):
        val = getattr(result, attr, None)
        if val:
            return str(val)[:240]
    return ""


def _needs_browser(page: Page) -> bool:
    """HTTP gave back a JS-shell (little text + SPA markers, no price) -> needs a browser."""
    text = P.TAG_RE.sub(" ", P.SCRIPT_STYLE_RE.sub("", page.html))
    visible = text.strip()
    script_count = page.html.lower().count("<script")
    script_heavy = script_count >= 3 and len(visible) < 800 and len(page.html) > 5000
    return (
        len(visible) < 800
        and (bool(P.SPA_RE.search(page.html)) or script_heavy)
        and not P.PRICE_RE.search(page.md)
    )


def _http_strategy():
    return AsyncHTTPCrawlerStrategy() if CRAWL_MODE == "http" else None


def _deep_cfg(blocked: list[str]):
    return CrawlerRunConfig(
        **_LIGHT,
        deep_crawl_strategy=BestFirstCrawlingStrategy(
            max_depth=MAX_DEPTH, max_pages=MAX_PAGES, include_external=False,
            url_scorer=KeywordRelevanceScorer(keywords=PRICE_KEYWORDS, weight=1.0),
            filter_chain=FilterChain([URLPatternFilter(JUNK_URL_PATTERNS + blocked, reverse=True)])),
        cache_mode=CacheMode.BYPASS, page_timeout=PAGE_TIMEOUT_MS, stream=True,
        exclude_external_links=True, semaphore_count=CONCURRENCY, verbose=False)


async def crawl_site(start_url: str, blocked: list[str]) -> AsyncIterator[Page]:
    """Deep crawl from start_url. Yields complete Pages; JS-shells are escalated
    to a headless browser and yielded as their rendered version instead."""
    shells: list[str] = []
    async with AsyncWebCrawler(crawler_strategy=_http_strategy(),
                               config=_browser_config()) as crawler:
        async for result in await crawler.arun(url=start_url, config=_deep_cfg(blocked)):
            page = _to_page(result)
            if CRAWL_MODE == "http" and ESCALATE and page.success and _needs_browser(page):
                shells.append(page.url)
                log.debug("browser fallback queued url=%s reason=js-shell", page.url)
                continue
            yield page

    if shells:
        log.debug("escalating %d javascript-rendered page(s) to headless browser urls=%s",
                 len(shells), ",".join(shells[:6]))
        async for page in fetch_urls(shells, concurrency=min(CONCURRENCY, 6), force_browser=True):
            yield page


async def fetch_urls(urls: list[str], *, concurrency: int = FETCH_CONCURRENCY,
                     force_browser: bool = False) -> AsyncIterator[Page]:
    """Fetch an explicit list of URLs directly (no discovery)."""
    async with URLFetcher(concurrency=concurrency, force_browser=force_browser) as fetcher:
        async for page in fetcher.fetch(urls):
            yield page


class URLFetcher:
    """Reusable direct URL fetcher.

    Agent discovery calls this repeatedly with small batches, so keeping one
    AsyncWebCrawler alive avoids browser/session setup per frontier batch.
    """

    def __init__(self, *, concurrency: int = FETCH_CONCURRENCY, force_browser: bool = False):
        self.concurrency = concurrency
        self.force_browser = force_browser
        self.crawler = None
        # In browser mode the page may load its list lazily / via XHR after first
        # paint: scroll the whole page and wait a beat so dynamic rows materialize.
        spa = dict(scan_full_page=True, scroll_delay=0.3,
                   delay_before_return_html=1.0) if force_browser else {}
        self.cfg = CrawlerRunConfig(**_LIGHT, **spa, cache_mode=CacheMode.BYPASS,
                                    page_timeout=PAGE_TIMEOUT_MS, stream=True,
                                    semaphore_count=concurrency, verbose=False)

    async def __aenter__(self) -> "URLFetcher":
        strategy = None if self.force_browser else _http_strategy()
        self.crawler = AsyncWebCrawler(crawler_strategy=strategy,
                                       config=_browser_config())
        await self.crawler.__aenter__()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        if self.crawler is not None:
            await self.crawler.__aexit__(exc_type, exc, tb)

    async def fetch(self, urls: list[str]) -> AsyncIterator[Page]:
        if not urls:
            return
        if self.crawler is None:
            raise RuntimeError("URLFetcher must be used as an async context manager")
        transport = "browser" if self.force_browser else "http"
        for url in urls:
            log.debug("http request  method=GET transport=%s url=%s", transport, url)
        async for result in await self.crawler.arun_many(urls=list(urls), config=self.cfg):
            page = _to_page(result)
            err = _error(result)
            log.debug("http response status=%s ok=%s html_bytes=%d md_chars=%d url=%s error=%r preview=%r",
                     page.status, page.success, len(page.html), len(page.md), page.url,
                     err, _preview(page.md))
            if not page.success:
                log.warning("http failed transport=%s status=%s url=%s error=%s",
                            transport, page.status, page.url, err or "unknown")
            yield page
