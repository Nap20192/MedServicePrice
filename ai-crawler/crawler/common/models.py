"""Shared data models for adapter and fetcher layers."""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Page:
    """Fetched page handed from fetcher to harvest."""
    url: str
    success: bool
    status: int | None
    html: str
    md: str
    links: dict


@dataclass
class PageGroup:
    """Aggregated URLs that share the same route template."""
    urls: list[str] = field(default_factory=list)
    rows: int = 0
    cities: dict[str, int] = field(default_factory=dict)
    actions: dict[str, int] = field(default_factory=dict)


@dataclass
class FetchPlan:
    """Adapter decision: which URLs should be fetched over HTTP vs browser."""
    transport_by_url: dict[str, str] = field(default_factory=dict)
    browser_urls: list[str] = field(default_factory=list)
    http_urls: list[str] = field(default_factory=list)

    @classmethod
    def empty(cls) -> "FetchPlan":
        return cls()

    @classmethod
    def from_dict(cls, data: dict | None) -> "FetchPlan":
        if not isinstance(data, dict):
            return cls.empty()
        return cls(
            transport_by_url=dict(data.get("transport_by_url", {}) or {}),
            browser_urls=list(data.get("browser_urls", []) or []),
            http_urls=list(data.get("http_urls", []) or []),
        )

