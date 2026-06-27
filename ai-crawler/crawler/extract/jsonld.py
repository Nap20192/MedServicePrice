"""Tier 0: schema.org structured data (JSON-LD). Zero-LLM, exact."""
import json

from crawler.common import patterns as P
from crawler.extract.cleaning import make_row
from crawler.config import DEFAULT_CURRENCY


def _walk(node, out: list) -> None:
    """Collect (name, price, currency) from Product/Offer trees."""
    if isinstance(node, list):
        for x in node:
            _walk(x, out)
        return
    if not isinstance(node, dict):
        return
    offers = node.get("offers")
    if offers is not None:
        item = node.get("itemOffered")
        base_name = node.get("name") or (item.get("name") if isinstance(item, dict) else None)
        for off in (offers if isinstance(offers, list) else [offers]):
            if isinstance(off, dict):
                price = off.get("price") or off.get("lowPrice")
                cur = off.get("priceCurrency", "")
                nm = off.get("name") or base_name
                if price is not None and nm:
                    out.append((nm, price, cur))
    for v in node.values():
        if isinstance(v, (dict, list)):
            _walk(v, out)


def extract_jsonld(url: str, html: str) -> list[dict]:
    rows = []
    for block in P.LDJSON_RE.findall(html):
        try:
            data = json.loads(block.strip())
        except json.JSONDecodeError:
            continue
        pairs: list = []
        _walk(data, pairs)
        for name, price, cur in pairs:
            if (r := make_row(name, price, cur or DEFAULT_CURRENCY, url)):
                rows.append(r)
    return rows
