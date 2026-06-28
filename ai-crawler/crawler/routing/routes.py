"""Route-template recognition, validity, productivity + cross-run persistence.

Route template normalizes dynamic id segments:
    /city/156/3310/  ->  /city/{id}/{id}/

Per-domain stats persisted to state/<domain>/routes.json:
    { template: {"valid": n, "invalid": n, "rows": n} }

Productive routes (rows > 0) = where the useful data lives. Their concrete URLs
are written to state/<domain>/data_urls.txt. Entirely-dead templates
(0 valid, >= threshold invalid) become glob filters on the next run.
"""
import json
import re
from datetime import datetime, timezone
from urllib.parse import urlparse

from crawler.common import patterns as P
from crawler.common.canonical import canonical_url
from crawler.config import DEAD_ROUTE_THRESHOLD, PAGES_DIR, STATE_DIR, get_logger
from crawler.output.output import url_filename

log = get_logger(__name__)

_CITY_SLUGS = {
    "astana",
    "almaty",
    "aktau",
    "aktobe",
    "atyrau",
    "karaganda",
    "kostanay",
    "pavlodar",
    "saran",
    "semey",
    "shymkent",
    "taraz",
    "uralsk",
    "oskemen",
}
_LEGACY_GUESSED_ROOTS = {"services", "doctors", "clinics", "analizes", "pricelist", "price-list"}
# Empty: /analizes/for-doctors/<city> and /analizes/profi/<city> are REAL city-priced
# listing pages that discovery visits and extracts (e.g. for-doctors/astana → 2135 rows).
# Flagging them as "guessed" dropped whole cities of prices from the adapter.
_LEGACY_GUESSED_INVITRO_ROOTS: set[str] = set()


def host(url: str) -> str:
    return urlparse(url).netloc


def route_template(url: str) -> str:
    path = urlparse(canonical_url(url)).path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    segs = ["{id}" if P.ID_SEG_RE.match(s) else s for s in path.split("/")]
    return "/".join(segs) or "/"


def route_valid(page) -> tuple[bool, str]:
    """Invalid id-routes (404 / redirect / empty / not-found body) -> skip everything.

    `page` is a fetcher.Page (duck-typed: .success, .status, .md)."""
    if not page.success:
        return False, f"status={page.status or 'err'}"
    if page.status and page.status >= 400:
        return False, f"status={page.status}"
    text = page.md.strip()
    has_links = any(page.links.get(group) for group in ("internal", "external")) if isinstance(page.links, dict) else False
    if len(text) < 50:
        if has_links:
            return True, "ok-links-only"
        return False, "empty"
    if P.INVALID_CONTENT_RE.search(text[:1500]) and not P.PRICE_RE.search(page.md):
        return False, "404-page"
    return True, "ok"


def template_to_glob(template: str) -> str:
    """/a/{id}/{id}/ -> */a/*/*/  (matches the whole URL via URLPatternFilter)."""
    return "*" + re.sub(r"\{id\}", "*", template).rstrip("/") + "/*"


def is_legacy_guessed_url(url: str) -> bool:
    segments = [seg for seg in urlparse(url).path.split("/") if seg]
    if len(segments) >= 2 and segments[0] in _CITY_SLUGS and segments[1] in _LEGACY_GUESSED_ROOTS:
        return True
    if len(segments) >= 2 and segments[0] in {"pricelist", "price-list"} and segments[1] in _CITY_SLUGS:
        return True
    if (
        len(segments) >= 3
        and segments[0] == "analizes"
        and segments[1] in _LEGACY_GUESSED_INVITRO_ROOTS
        and segments[2] in _CITY_SLUGS
    ):
        return True
    return False


class RouteStore:
    """Per-domain route stats + useful data-URLs, persisted across runs."""

    def __init__(self, domain: str):
        self.domain = domain
        self.dir = STATE_DIR / re.sub(r"[^a-zA-Z0-9.]", "_", domain)
        self.path = self.dir / "routes.json"
        self.urls_path = self.dir / "data_urls.txt"
        self.url_stats_path = self.dir / "url_stats.json"
        self.url_nodes_path = self.dir / "url_nodes.json"
        self.stats: dict[str, dict] = {}        # template -> {valid, invalid, rows}
        self.data_urls: set[str] = set()        # concrete URLs that yielded rows
        self.url_stats: dict[str, dict] = {}    # url -> {rows, template, seen, last_seen_at}
        self.url_nodes: dict[str, dict] = {}    # url -> node metadata for every discovered sublink
        self._load()

    def _load(self) -> None:
        if self.path.exists():
            try:
                raw = json.loads(self.path.read_text(encoding="utf-8"))
                self.stats = {}
                for template, stats in raw.items():
                    normalized = route_template(template)
                    target = self._t(normalized)
                    target["valid"] += int(stats.get("valid", 0))
                    target["invalid"] += int(stats.get("invalid", 0))
                    target["rows"] += int(stats.get("rows", 0))
            except json.JSONDecodeError:
                self.stats = {}
        if self.urls_path.exists():
            self.data_urls = {
                canonical_url(l.strip())
                for l in self.urls_path.read_text(encoding="utf-8").splitlines()
                if l.strip() and not is_legacy_guessed_url(l.strip())
            }
        if self.url_stats_path.exists():
            try:
                raw = json.loads(self.url_stats_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                raw = {}
            for url, stats in raw.items():
                if not isinstance(stats, dict):
                    continue
                key = canonical_url(url)
                existing = self.url_stats.setdefault(
                    key,
                    {"rows": 0, "template": route_template(key), "seen": 0, "last_seen_at": ""},
                )
                existing["rows"] = max(int(existing.get("rows", 0)), int(stats.get("rows", 0)))
                existing["seen"] = int(existing.get("seen", 0)) + int(stats.get("seen", 0) or 1)
                existing["template"] = route_template(key)
                existing["last_seen_at"] = stats.get("last_seen_at") or existing.get("last_seen_at", "")
        if self.url_nodes_path.exists():
            try:
                raw_nodes = json.loads(self.url_nodes_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                raw_nodes = {}
            for url, node in raw_nodes.items():
                if not isinstance(node, dict):
                    continue
                key = canonical_url(url)
                self.url_nodes[key] = {
                    **node,
                    "url": key,
                    "route_template": route_template(key),
                }
        self._bootstrap_url_stats_from_pages()

    def _bootstrap_url_stats_from_pages(self) -> None:
        if not PAGES_DIR.exists():
            return
        for url in list(self.data_urls):
            key = canonical_url(url)
            if key in self.url_stats and int(self.url_stats[key].get("rows", 0)) > 0:
                continue
            page_path = PAGES_DIR / url_filename(key)
            if not page_path.exists():
                continue
            try:
                payload = json.loads(page_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            rows = int(payload.get("count") or len(payload.get("prices", [])))
            if rows <= 0:
                continue
            self.url_stats[key] = {
                "rows": rows,
                "template": route_template(key),
                "seen": 1,
                "last_seen_at": payload.get("scraped_at", ""),
            }

    def _t(self, template: str) -> dict:
        return self.stats.setdefault(template, {"valid": 0, "invalid": 0, "rows": 0})

    def record(self, template: str, valid: bool) -> None:
        self._t(template)["valid" if valid else "invalid"] += 1

    def record_data(self, url: str, template: str, n_rows: int) -> None:
        """A page yielded `n_rows` price rows — mark it as a useful data URL."""
        self._t(template)["rows"] += n_rows
        if n_rows:
            key = canonical_url(url)
            if is_legacy_guessed_url(key):
                log.debug("skip legacy guessed data url=%s rows=%d", key, n_rows)
                return
            self.data_urls.add(key)
            stat = self.url_stats.setdefault(
                key,
                {"rows": 0, "template": route_template(key), "seen": 0, "last_seen_at": ""},
            )
            stat["rows"] = max(int(stat.get("rows", 0)), n_rows)
            stat["template"] = route_template(key)
            stat["seen"] = int(stat.get("seen", 0)) + 1
            stat["last_seen_at"] = datetime.now(timezone.utc).isoformat()
            self.record_node(key, action="fetch", reason="productive-page", rows=n_rows)

    def record_node(self, url: str, *, parent_url: str | None = None, depth: int | None = None,
                    action: str | None = None, reason: str | None = None, score: float | None = None,
                    text: str | None = None, rows: int | None = None,
                    category: str | None = None) -> None:
        key = canonical_url(url)
        node = self.url_nodes.setdefault(key, {
            "url": key,
            "parent_url": None,
            "depth": None,
            "action": None,
            "reason": None,
            "score": None,
            "rows": 0,
            "text": "",
            "route_template": route_template(key),
            "city": "",
            "category": "",
            "seen_at": "",
        })
        if parent_url:
            node["parent_url"] = canonical_url(parent_url)
        if depth is not None:
            node["depth"] = depth
        if action:
            node["action"] = action
        if category:
            node["category"] = category
        if reason:
            node["reason"] = reason
        if score is not None:
            node["score"] = score
        if text:
            node["text"] = text[:280]
        if rows is not None:
            node["rows"] = max(int(node.get("rows", 0)), int(rows))
        node["route_template"] = route_template(key)
        try:
            from .urlinfo import infer_city
            node["city"] = node.get("city") or infer_city(key) or ""
        except Exception:  # noqa: BLE001
            node["city"] = node.get("city") or ""
        node["seen_at"] = datetime.now(timezone.utc).isoformat()

    def dead_templates(self) -> list[str]:
        return [t for t, s in self.stats.items()
                if s["valid"] == 0 and s["invalid"] >= DEAD_ROUTE_THRESHOLD]

    def dead_globs(self) -> list[str]:
        return [template_to_glob(t) for t in self.dead_templates()]

    def productive_templates(self) -> list[tuple[str, int]]:
        """Templates where the data lives, sorted by total rows desc."""
        prod = [(t, s["rows"]) for t, s in self.stats.items() if s["rows"] > 0]
        return sorted(prod, key=lambda kv: -kv[1])

    def set_data_urls(self, urls: list[str]) -> None:
        """Replace persisted useful URLs with the adapter-selected compact set."""
        selected = {canonical_url(url) for url in urls if not is_legacy_guessed_url(url)}
        self.data_urls = selected
        self.url_stats = {
            url: stats for url, stats in self.url_stats.items()
            if canonical_url(url) in selected
        }
        self.url_nodes = {
            url: node for url, node in self.url_nodes.items()
            if canonical_url(url) in selected
            or node.get("action") == "follow"
            or node.get("rows", 0) > 0
        }

    def save(self) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.stats, ensure_ascii=False, indent=2), encoding="utf-8")
        self.urls_path.write_text("\n".join(sorted(self.data_urls)) + "\n", encoding="utf-8")
        self.url_stats_path.write_text(
            json.dumps(self.url_stats, ensure_ascii=False, indent=2), encoding="utf-8")
        self.url_nodes_path.write_text(
            json.dumps(self.url_nodes, ensure_ascii=False, indent=2), encoding="utf-8")
        prod, dead = self.productive_templates(), self.dead_templates()
        log.debug("persisted route stats templates=%d productive=%d dead=%d path=%s",
                 len(self.stats), len(prod), len(dead), self.path)
        log.debug("persisted data urls count=%d path=%s", len(self.data_urls), self.urls_path)
        if prod:
            log.debug("productive route-templates (rows per template): %s", dict(prod[:6]))
        if dead:
            log.debug("dead route-templates to be blocked next run: %s", dead[:6])
