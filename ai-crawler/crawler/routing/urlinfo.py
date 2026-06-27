"""Derived metadata for adapter URLs."""
from __future__ import annotations

from urllib.parse import urlparse

from crawler.common import patterns as P
from crawler.extract.category import categorize
from crawler.routing.routes import route_template

CITY_STOPWORDS = {
    "analiz",
    "analizy",
    "analizes",
    "analysis",
    "for-doctors",
    "for-patients",
    "services",
    "service",
    "price",
    "prices",
    "pricing",
    "pricelist",
    "house-call",
    "catalog",
    "city",
    "profi",
    "radiology",
    "promotions",
    "promotion",
    "news",
    "articles",
    "article",
    "about",
    "contacts",
    "contact",
    "services",
    "service",
    "ru",
    "kz",
    "en",
}


def infer_city(url: str) -> str | None:
    """Infer a city slug from common catalog URL shapes.

    This is intentionally conservative: numeric ids and generic catalog words
    are ignored, so unknown URLs return None instead of a false city.
    """
    segments = [s for s in urlparse(url).path.strip("/").split("/") if s]
    for segment in segments:
        low = segment.lower()
        if low in CITY_STOPWORDS or P.ID_SEG_RE.match(segment):
            continue
        if any(ch.isalpha() for ch in segment):
            return low
    return None


def url_metadata(url: str) -> dict:
    city = infer_city(url)
    return {
        "route_template": route_template(url),
        "city": city,
        "category": categorize(url=url),
    }
