"""URL and row keys used to avoid crawling and output duplicates."""
from __future__ import annotations

import re
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

TRACKING_PREFIXES = ("utm_",)
TRACKING_KEYS = {
    "fbclid",
    "gclid",
    "yclid",
    "mc_cid",
    "mc_eid",
    "from",
    "ref",
    "referer",
}

CITY_SEGMENTS = {
    "aktau",
    "aktobe",
    "almaty",
    "astana",
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


def canonical_url(url: str, base_url: str | None = None) -> str:
    """Return a stable URL key for crawl de-duplication.

    Query parameters are kept unless they are obvious tracking noise because
    some medical catalogs use city/filter parameters to change prices.
    """
    absolute = urljoin(base_url or "", (url or "").strip())
    p = urlparse(absolute)
    scheme = (p.scheme or "https").lower()
    netloc = p.netloc.lower()
    path = re.sub(r"/{2,}", "/", p.path or "/")
    path = re.sub(r"(/analizes/(?:for-doctors|profi))/city(?=/|$)", r"\1", path)
    path = _normalize_city_segments(path)
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")

    query_pairs = []
    for key, value in parse_qsl(p.query, keep_blank_values=False):
        low = key.lower()
        if low in TRACKING_KEYS or any(low.startswith(prefix) for prefix in TRACKING_PREFIXES):
            continue
        query_pairs.append((key, value))
    query = urlencode(sorted(query_pairs), doseq=True)
    return urlunparse((scheme, netloc, path, "", query, ""))


def _normalize_city_segments(path: str) -> str:
    parts = path.split("/")
    normalized = []
    for part in parts:
        low = part.lower()
        normalized.append(low if low in CITY_SEGMENTS else part)
    return "/".join(normalized)


def service_key(service: str) -> str:
    """Normalize a service name for duplicate detection."""
    text = (service or "").lower()
    text = text.replace("ё", "е")
    text = re.sub(r"[№#]", " ", text)
    text = re.sub(r"[^\wа-я]+", " ", text, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", text).strip()
