"""Deterministic link-selection agent for adapter discovery.

The crawler fetches only URLs accepted by this policy. Decisions are based on
site memory (route stats), URL/anchor relevance, and duplicate suppression.
"""
from __future__ import annotations

import fnmatch
import heapq
from dataclasses import dataclass, field
from urllib.parse import urlparse

from crawler.common import patterns as P
from crawler.common.canonical import canonical_url
from crawler.extract.category import OTHER, categorize
from crawler.config import (ADAPTER_LISTING_ROW_THRESHOLD, DISCOVERY_CITY_SLUGS,
                     DISCOVERY_SEED_TEMPLATES, JUNK_URL_PATTERNS, PRICE_KEYWORDS,
                     get_logger)
from crawler.routing.routes import host, route_template, template_to_glob

log = get_logger(__name__)


def _short(url: str) -> str:
    p = urlparse(url)
    return (p.path or "/") + (f"?{p.query}" if p.query else "")

STRONG_PATH_HINTS = (
    "analiz",
    "analizy",
    "analizes",
    "analysis",
    "laborator",
    "service",
    "services",
    "price",
    "prices",
    "pricing",
    "pricelist",
    "prajs",
    "prais",
    "catalog",
    "for-doctors",
    "napravleni",     # направления (clinic specialties index)
    "vrach",          # врачи / приём
    "doctor",
    "priem",
    "priyom",
    "konsultac",      # консультация
    "uslugi",
    "uslug",
    "tarif",
    "spravochnik",
    "specialist",
    "klinik",
    "услуг",
    "анализ",
    "цена",
    "цены",
    "прайс",
    "направлен",
    "врач",
    "приём",
    "прием",
    "консультац",
    "специалист",
)

CITY_HINTS = (
    "astana",
    "aktau",
    "aktobe",
    "saran",
    "almaty",
    "atyrau",
    "karaganda",
    "kostanay",
    "pavlodar",
    "semey",
    "shymkent",
    "taraz",
    "uralsk",
    "oskemen",
)

GENERIC_SEED_PATHS = (
    "/services",
    "/service",
    "/uslugi",
    "/price",
    "/prices",
    "/pricelist",
    "/catalog",
    "/doctors",
    "/doctor",
    "/vrachi",
    "/clinics",
    "/clinic",
    "/kliniki",
    "/napravleniya",
    "/specialists",
    "/search",
)


@dataclass(frozen=True)
class LinkDecision:
    action: str
    score: float
    reason: str
    url: str
    category: str = OTHER


@dataclass(order=True)
class _QueuedURL:
    priority: float
    order: int
    url: str = field(compare=False)
    depth: int = field(compare=False)
    reason: str = field(compare=False)


class LinkAgent:
    """Maintains a priority frontier and explains why URLs are followed/skipped."""

    def __init__(self, start_url: str, store, *, max_depth: int, per_page: int = 40):
        self.start_url = canonical_url(start_url)
        self.domain = host(self.start_url)
        self.store = store
        self.max_depth = max_depth
        self.per_page = per_page
        self.frontier: list[_QueuedURL] = []
        self.seen: set[str] = set()
        self.queued: set[str] = set()
        self.decisions = {"follow": 0, "skip": 0}
        self.skip_reasons: dict[str, int] = {}
        self.follow_reasons: dict[str, int] = {}
        self._order = 0
        self.add(self.start_url, 0, 100.0, "start-url")
        self._seed_generic_candidates()
        self._seed_site_candidates()

    def add(self, url: str, depth: int, score: float, reason: str) -> bool:
        url = canonical_url(url, self.start_url)
        if url in self.seen or url in self.queued:
            return False
        self.queued.add(url)
        self._order += 1
        heapq.heappush(self.frontier, _QueuedURL(-score, self._order, url, depth, reason))
        return True

    def next_batch(self, limit: int) -> list[tuple[str, int, str]]:
        batch = []
        while self.frontier and len(batch) < limit:
            item = heapq.heappop(self.frontier)
            self.queued.discard(item.url)
            if item.url in self.seen:
                continue
            if self._covered_by_listing(item.url):
                self.decisions["skip"] = self.decisions.get("skip", 0) + 1
                self.skip_reasons["covered-by-listing"] = (
                    self.skip_reasons.get("covered-by-listing", 0) + 1
                )
                self.store.record_node(item.url, depth=item.depth, action="skip",
                                       reason="covered-by-listing", score=-1)
                log.debug("agent skip url=%s reason=covered-by-listing", _short(item.url))
                continue
            self.seen.add(item.url)
            self.store.record_node(item.url, depth=item.depth, action="fetch",
                                   reason=item.reason, score=-item.priority)
            log.debug("agent select url=%s depth=%d score=%.1f reason=%s",
                     _short(item.url), item.depth, -item.priority, item.reason)
            batch.append((item.url, item.depth, item.reason))
        return batch

    def remember_rows(self, url: str, rows: int) -> None:
        if rows:
            tmpl = route_template(url)
            self.follow_reasons[f"productive:{tmpl}"] = self.follow_reasons.get(f"productive:{tmpl}", 0) + 1

    def _seed_generic_candidates(self) -> None:
        for path in GENERIC_SEED_PATHS:
            self.add(path, 1, 58.0, "seed-generic-catalog")
        for city in CITY_HINTS[:8]:
            for path in (f"/{city}/services", f"/{city}/doctors", f"/{city}/clinics"):
                self.add(path, 1, 52.0, "seed-generic-city")

    def _seed_site_candidates(self) -> None:
        if "invitro." in self.domain:
            for city in DISCOVERY_CITY_SLUGS:
                for template in DISCOVERY_SEED_TEMPLATES:
                    path = template.format(city=city)
                    self.add(path, 1, 85.0, "seed-city-listing")
        if "kdlolymp." in self.domain:
            for city in DISCOVERY_CITY_SLUGS:
                for path in (
                    f"/pricelist/{city}",
                    f"/pricelist/{city}/",
                    f"/price-list/{city}",
                ):
                    self.add(path, 1, 92.0, "seed-pricelist")
        if len(self.frontier) > 1:
            log.debug("agent seeded frontier domain=%s candidates=%d (start-url + site seeds)",
                     self.domain, len(self.frontier))

    def consider_page_links(self, page, depth: int) -> int:
        candidates = []
        seen_links = skipped = 0
        skip_tally: dict[str, int] = {}
        for link in iter_links(page.links):
            href = link.get("href") or link.get("url")
            if not href:
                continue
            seen_links += 1
            text = link.get("text") or link.get("title") or link.get("aria_label") or ""
            decision = self.decide(href, text, page.url, depth + 1)
            self.decisions[decision.action] = self.decisions.get(decision.action, 0) + 1
            bucket = self.follow_reasons if decision.action == "follow" else self.skip_reasons
            bucket[decision.reason] = bucket.get(decision.reason, 0) + 1
            self.store.record_node(decision.url, parent_url=page.url, depth=depth + 1,
                                   action=decision.action, reason=decision.reason,
                                   score=decision.score, text=text, category=decision.category)
            if decision.action == "follow":
                candidates.append(decision)
            else:
                skipped += 1
                skip_tally[decision.reason] = skip_tally.get(decision.reason, 0) + 1
                log.debug("agent skip url=%s score=%.1f reason=%s", _short(decision.url),
                          decision.score, decision.reason)

        candidates.sort(key=lambda d: d.score, reverse=True)
        added = 0
        for decision in candidates[: self.per_page]:
            if self.add(decision.url, depth + 1, decision.score, decision.reason):
                added += 1
        if seen_links:
            top = ", ".join(f"{_short(d.url)}({d.score:.0f}:{d.category}:{d.reason})"
                            for d in candidates[:3])
            cats: dict[str, int] = {}
            for d in candidates:
                cats[d.category] = cats.get(d.category, 0) + 1
            log.debug("agent expand from=%s depth=%d links=%d follow=%d queued=%d skip=%d "
                     "categories=%s skip_reasons=%s top=[%s]", _short(page.url), depth, seen_links,
                     len(candidates), added, skipped, _top(cats, 5), _top(skip_tally, 4), top or "-")
        return added

    def decide(self, href: str, text: str, source_url: str, depth: int) -> LinkDecision:
        url = canonical_url(href, source_url)
        parsed = urlparse(url)
        if not parsed.scheme.startswith("http") or parsed.netloc != self.domain:
            return LinkDecision("skip", 0.0, "external", url)
        if depth > self.max_depth:
            return LinkDecision("skip", 0.0, "max-depth", url)
        if url in self.seen or url in self.queued:
            return LinkDecision("skip", 0.0, "duplicate-url", url)
        if self._matches_junk(url):
            return LinkDecision("skip", 0.0, "junk-pattern", url)
        if self._covered_by_listing(url):
            return LinkDecision("skip", 0.0, "covered-by-listing", url)

        tmpl = route_template(url)
        stats = self.store.stats.get(tmpl, {})
        valid = int(stats.get("valid", 0))
        invalid = int(stats.get("invalid", 0))
        rows = int(stats.get("rows", 0))
        if invalid >= valid + 3 and rows == 0:
            return LinkDecision("skip", 0.0, "dead-route-memory", url)

        haystack = f"{parsed.path} {parsed.query} {text}".lower()
        score = 0.0
        reasons = []

        if rows:
            score += min(40.0, 12.0 + rows / 20.0)
            reasons.append("productive-route")
        if valid and not invalid:
            score += 4.0
            reasons.append("valid-route")
        if any(P.ID_SEG_RE.match(seg) for seg in parsed.path.split("/") if seg):
            score += 3.0
            reasons.append("detail-like")

        keyword_hits = sum(1 for kw in PRICE_KEYWORDS if kw.lower() in haystack)
        if keyword_hits:
            score += min(24.0, keyword_hits * 4.0)
            reasons.append("price-keyword")

        strong_hits = sum(1 for kw in STRONG_PATH_HINTS if kw in haystack)
        if strong_hits:                                  # one catalog hint clears the follow bar
            score += min(30.0, strong_hits * 8.0)
            reasons.append("medical-catalog")

        segments = [seg.lower() for seg in parsed.path.split("/") if seg]
        if any(city in segments for city in CITY_HINTS) and not any(P.ID_SEG_RE.match(seg) for seg in segments):
            score += 18.0
            reasons.append("city-listing")

        path_depth = len([s for s in parsed.path.split("/") if s])
        if path_depth > 7:
            score -= 4.0
            reasons.append("deep-path")
        if parsed.query:
            score -= 1.5
            reasons.append("query")

        category = categorize(text, url)                 # what kind of service this page serves
        if score < 6.0:
            self.store.record_node(url, parent_url=source_url, depth=depth, action="skip",
                                   reason="low-score", score=score, text=text, category=category)
            return LinkDecision("skip", score, "low-score", url, category)
        return LinkDecision("follow", score, "+".join(reasons[:4]) or "relevant", url, category)

    def summary(self) -> dict:
        return {
            "seen": len(self.seen),
            "queued": len(self.queued),
            "decisions": self.decisions,
            "top_skip_reasons": _top(self.skip_reasons),
            "top_follow_reasons": _top(self.follow_reasons),
        }

    def _matches_junk(self, url: str) -> bool:
        patterns = list(JUNK_URL_PATTERNS)
        patterns.extend(template_to_glob(t) for t in self.store.dead_templates())
        return any(fnmatch.fnmatch(url, pattern) for pattern in patterns)

    def _covered_by_listing(self, url: str) -> bool:
        parsed = urlparse(url)
        segments = [seg for seg in parsed.path.strip("/").split("/") if seg]
        if not any(P.ID_SEG_RE.match(seg) for seg in segments):
            return False
        while segments:
            segments.pop()
            parent = "/" + "/".join(segments)
            if not parent or parent == "/":
                break
            stats = self.store.stats.get(route_template(parent), {})
            rows = int(stats.get("rows", 0))
            if rows >= ADAPTER_LISTING_ROW_THRESHOLD:
                return True
        root_stats = self.store.stats.get("/analizes/for-doctors", {})
        return int(root_stats.get("rows", 0)) >= ADAPTER_LISTING_ROW_THRESHOLD


def iter_links(links: dict | None):
    if not isinstance(links, dict):
        return
    for group in ("internal", "external"):
        for link in links.get(group, []) or []:
            if isinstance(link, dict):
                yield link


def _top(counts: dict[str, int], limit: int = 8) -> dict[str, int]:
    return dict(sorted(counts.items(), key=lambda kv: -kv[1])[:limit])
