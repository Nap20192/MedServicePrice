"""Tier 3 regex extractor + the tier router that picks the best source."""
import re
import threading

from crawler.common import patterns as P
from crawler.extract import schema as S
from crawler.extract.cleaning import clean_name, line, make_row
from crawler.config import LLM_SCHEMA_GEN, SCHEMA_GEN_MAX_PER_DOMAIN, get_logger
from crawler.extract.jsonld import extract_jsonld
from crawler.routing.routes import host

try:
    from lxml import html as _lhtml
except Exception:  # noqa: BLE001
    _lhtml = None

log = get_logger(__name__)

_schema_tried: set[str] = set()      # domain:structure keys attempted for LLM schema-gen
_schema_failed: set[str] = set()     # domain:structure keys where schema tier gave up
_schema_inflight: dict[str, threading.Event] = {}
_schema_gen_count: dict[str, int] = {}   # domain -> LLM schema-gen calls this run
_schema_lock = threading.RLock()


def _schema_key(domain: str, signature: str) -> str:
    return f"{domain}:{signature}"


def _tag_structure(rows: list[dict], signature: str) -> list[dict]:
    for row in rows:
        meta = dict(row.get("meta") or {})
        meta["structure_signature"] = signature
        row["meta"] = meta
    return rows


def _reserve_schema_generation(schema_key: str) -> tuple[bool, threading.Event | None]:
    """Return (owner, event). Owner performs LLM call; waiters wait for event."""
    with _schema_lock:
        if schema_key in _schema_inflight:
            return False, _schema_inflight[schema_key]
        event = threading.Event()
        _schema_inflight[schema_key] = event
        _schema_tried.add(schema_key)
        return True, event


def _finish_schema_generation(schema_key: str) -> None:
    with _schema_lock:
        event = _schema_inflight.pop(schema_key, None)
        if event:
            event.set()


def _is_surcharge(ln: str, start: int) -> bool:
    """A price like 'Взятие крови из вены:+1390 ₸' is an add-on, not the row price."""
    return ln[max(0, start - 1):start] == "+"


def _lookback_name(lines: list[str], i: int) -> str:
    """Name for a price-only line: nearest preceding text line (card layouts where
    the label sits above the price, e.g. emirmed doctor cards)."""
    for j in range(i - 1, max(-1, i - 5), -1):
        s = lines[j].strip()
        if not s or P.PRICE_RE.search(s) or s.startswith("!") or s.startswith("["):
            continue
        if P.LETTER_RE.search(s) and s.lower() not in P.NAME_STOPWORDS and len(s) >= 3:
            return s
    return ""


def extract_regex(url: str, md: str) -> tuple[list[dict], list[str]]:
    rows, lines = [], []
    raw_lines = md.splitlines()
    for i, raw in enumerate(raw_lines):
        ln = raw.strip()
        if not ln or "---" in ln or not P.PRICE_RE.search(ln):
            continue
        if ln.startswith("|"):
            cells = [c.strip() for c in ln.strip("|").split("|")]
            price_cell = next((c for c in cells if P.PRICE_RE.search(c)), "")
            name = next((c for c in cells if c and not P.PRICE_RE.search(c)), "")
            pm = P.PRICE_RE.search(price_cell)
        else:
            matches = list(P.PRICE_RE.finditer(ln))
            pm = matches[-1]                              # last price = effective/discounted
            name = ln[: matches[0].start()].strip()
            if len(name) < 3:                             # price-only line -> look back
                name = _lookback_name(raw_lines, i)
        if not pm or _is_surcharge(ln, pm.start()):
            continue
        if (r := make_row(name, pm.group(1) or pm.group(2), pm.group(0), url)):
            rows.append(r)
            lines.append(line(r))
    return rows, lines


def _price_links(md: str):
    """Yield markdown links whose anchor text carries a price (link-list layout)."""
    for m in P.MD_LINK_RE.finditer(md):
        text = m.group(1).strip()
        if P.PRICE_RE.search(text):
            yield text


def _is_link_layout(md: str) -> bool:
    return sum(1 for _ in _price_links(md)) >= 3


def _strip_link_name(text: str, price_token: str, category: str) -> str:
    """Peel category / duration / price / 'В корзину' off a link's tail."""
    name = P.CART_RE.sub("", text)
    idx = name.find(price_token)                       # drop price and everything after
    if idx != -1:
        name = name[:idx]
    name = P.DURATION_RE.sub("", name)                 # drop "1 день"
    if category:                                       # drop trailing category word
        name = re.sub(re.escape(category) + r"\s*$", "", name.strip())
    return name.strip()


def extract_links(url: str, md: str) -> tuple[list[dict], list[str]]:
    """Link-list extractor: one service per markdown link, with name/price/duration
    parsed out of the link text; category comes from the nearest '## ' heading."""
    rows, out, category = [], [], ""
    for raw in md.splitlines():
        s = raw.strip()
        if (h := P.HEADING_RE.match(s)):
            category = h.group(1).strip()
        for m in P.MD_LINK_RE.finditer(s):
            text = m.group(1).strip()
            pm = P.PRICE_RE.search(text)
            if not pm:
                continue
            name = _strip_link_name(text, pm.group(0), category)
            row = make_row(name, pm.group(1) or pm.group(2), pm.group(0), url)
            if not row:
                continue
            if (m2 := P.DURATION_RE.search(text)):
                row["duration_days"] = int(m2.group(1))
            rows.append(row)
            out.append(line(row))
    return rows, out


def _is_card_layout(md: str) -> bool:
    """Catalog of multi-line cards, each headed by a standalone item code (№ ...)."""
    return sum(1 for ln in md.splitlines() if P.CODE_LINE_RE.match(ln.strip())) >= 3


def _block_name(block: list[str]) -> str:
    for ln in block:                                   # service title is a markdown link
        m = P.MD_LINK_RE.search(ln)
        if m and P.LETTER_RE.search(m.group(1)):
            return m.group(1).strip()
    for ln in block[1:]:                               # fallback: first real text line
        s = ln.strip()
        if s and P.LETTER_RE.search(s) and not P.PRICE_RE.search(s):
            return s
    return ""


def _block_price(block: list[str]) -> tuple[str, str] | None:
    """The card price is a currency-only line; labeled amounts (surcharges,
    filter sliders) carry letters around the number and are skipped."""
    found = None
    for ln in block:
        s = ln.strip()
        pm = P.PRICE_RE.search(s)
        if not pm or _is_surcharge(s, pm.start()):
            continue
        residual = P.MD_NOISE_RE.sub("", P.PRICE_RE.sub("", s))
        if P.LETTER_RE.search(residual):               # labeled -> not the row price
            continue
        found = (pm.group(1) or pm.group(2), pm.group(0))
    return found


def _block_duration(block: list[str]) -> int | None:
    for ln in block:
        if (m := P.DURATION_RE.search(ln)):
            return int(m.group(1))
    return None


def extract_blocks(url: str, md: str) -> tuple[list[dict], list[str]]:
    """Card-layout extractor: segment markdown into per-service blocks anchored on
    the item code, then read name / price / duration from the block as a unit."""
    lines = md.splitlines()
    anchors = [i for i, ln in enumerate(lines) if P.CODE_LINE_RE.match(ln.strip())]
    rows, out = [], []
    for k, start in enumerate(anchors):
        end = anchors[k + 1] if k + 1 < len(anchors) else len(lines)
        block = lines[start:end]
        name = _block_name(block)
        price = _block_price(block)
        if not name or not price:
            continue
        row = make_row(name, price[0], price[1], url)
        if not row:
            continue
        if (days := _block_duration(block)) is not None:
            row["duration_days"] = days
        rows.append(row)
        out.append(line(row))
    return rows, out


_HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
_HEADING_CLASS = ("name", "title", "heading", "header", "category", "specialty", "group", "napravlenie")


def _price_leaf(text: str):
    """A node whose whole text is just a price (e.g. <span>15000 ₸</span>)."""
    pm = P.PRICE_RE.search(text)
    if not pm:
        return None
    residual = P.MD_NOISE_RE.sub("", P.PRICE_RE.sub("", text)).replace("-", "")
    return None if P.LETTER_RE.search(residual) else pm


def _is_heading_el(el) -> bool:
    if el.tag in _HEADING_TAGS:
        return True
    cls = (el.get("class") or "").lower()
    return any(k in cls for k in _HEADING_CLASS)


def extract_html(url: str, html: str) -> tuple[list[dict], list[str]]:
    """Structural HTML extractor: read repeating "<label> … <price>" rows straight
    from the DOM and group them under the nearest heading (e.g. emirmed's
    <p class="name">Нейрохирург</p> + <div class="info"><p>service</p><span>price</span>).
    Each row carries its group/specialty in row["meta"]."""
    if _lhtml is None or not html or "<" not in html:
        return [], []
    try:
        tree = _lhtml.fromstring(html)
    except Exception:  # noqa: BLE001
        return [], []
    rows, out, group = [], [], ""
    for el in tree.iter():
        if not isinstance(el.tag, str):                      # skip comments / PIs
            continue
        if _is_heading_el(el):
            htext = " ".join(t.strip() for t in el.xpath("./text()")).strip()
            if htext and len(htext) < 80 and P.LETTER_RE.search(htext) and not P.PRICE_RE.search(htext):
                group = htext
            continue
        text = (el.text_content() or "").strip()
        if len(el) or len(text) > 24 or not (pm := _price_leaf(text)):  # want a price leaf node
            continue
        container = el.getparent()
        if container is None:
            continue
        full = (container.text_content() or "").strip()
        if len(full) > 300:                                  # not a row-level container
            continue
        name = clean_name(re.sub(r"\s*[-—–]\s*", " ", P.PRICE_RE.sub(" ", full)))
        row = make_row(name, pm.group(1) or pm.group(2), pm.group(0), url)
        if not row:
            continue
        row["meta"] = {"group": group} if group else {}
        if (m := P.DURATION_RE.search(full)):
            row["duration_days"] = int(m.group(1))
        rows.append(row)
        out.append(line(row))
    return rows, out


def _fallback_extract(url: str, html: str, md: str, signature: str) -> tuple[str, list[dict], list[str]]:
    if _is_link_layout(md):                                     # tier 3a (link-list / SPA)
        rows, lines = extract_links(url, md)
        if rows:
            return "links", _tag_structure(rows, signature), lines

    if _is_card_layout(md):                                     # tier 3b (card blocks)
        rows, lines = extract_blocks(url, md)
        if rows:
            return "blocks", _tag_structure(rows, signature), lines

    rows, lines = extract_html(url, html)                       # tier 3c (DOM table)
    if len(rows) >= 3:
        return "html", _tag_structure(rows, signature), lines

    rows, lines = extract_regex(url, md)                        # tier 3d (markdown line)
    return "regex", _tag_structure(rows, signature), lines


def _apply_cached(url: str, html: str, domain: str, signature: str):
    schema = S.load_schema(domain, signature)
    if schema and (rows := S.apply_schema(url, html, schema)):
        S.mark_signature(domain, signature, "productive", tier="schema", rows=len(rows))
        return rows
    return None


def _llm_induce(url: str, html: str, domain: str, signature: str, schema_key: str):
    """Slow last resort: induce a CSS schema with the LLM. Budgeted per domain.
    Returns (tier, rows, lines) or None. Only called when deterministic tiers are empty."""
    with _schema_lock:
        if schema_key in _schema_failed:
            return None
        inflight = _schema_inflight.get(schema_key)
        already_tried = schema_key in _schema_tried
        over_budget = _schema_gen_count.get(domain, 0) >= SCHEMA_GEN_MAX_PER_DOMAIN

    if inflight or already_tried:                    # another worker did/does this structure
        if inflight:
            inflight.wait()
        if (rows := _apply_cached(url, html, domain, signature)):
            return "schema", _tag_structure(rows, signature), [line(r) for r in rows]
        return None
    if over_budget:                                  # domain LLM budget spent -> stay deterministic
        return None

    owner, _event = _reserve_schema_generation(schema_key)
    if not owner:
        return None
    with _schema_lock:
        _schema_gen_count[domain] = _schema_gen_count.get(domain, 0) + 1
        used = _schema_gen_count[domain]
    try:
        log.info("inducing css schema (deterministic tiers empty) domain=%s structure=%s budget=%d/%d",
                 domain, signature, used, SCHEMA_GEN_MAX_PER_DOMAIN)
        schema = S.generate_schema(domain, html, signature)
    finally:
        _finish_schema_generation(schema_key)
    if schema and (rows := S.apply_schema(url, html, schema)):
        S.mark_signature(domain, signature, "productive", tier="schema-gen", rows=len(rows))
        return "schema-gen", _tag_structure(rows, signature), [line(r) for r in rows]
    with _schema_lock:
        _schema_failed.add(schema_key)
    S.drop_schema(domain, signature)
    S.mark_signature(domain, signature, "failed", tier="schema-gen",
                     reason="induced schema yielded no rows")
    log.warning("induced schema yielded no rows domain=%s structure=%s", domain, signature)
    return None


def extract_page(url: str, html: str, md: str) -> tuple[str, list[dict], list[str]]:
    """Router (fast first): jsonld -> cached CSS schema -> deterministic
    (links/blocks/html/regex) -> LLM schema induction (slow, last resort, budgeted)."""
    domain = host(url)
    signature = S.structure_signature(html)
    schema_key = _schema_key(domain, signature)
    with _schema_lock:
        if S.signature_status(domain, signature) == "failed":
            _schema_failed.add(schema_key)
        schema_failed = schema_key in _schema_failed

    rows = extract_jsonld(url, html)                            # tier 0: JSON-LD
    if rows:
        return "jsonld", _tag_structure(rows, signature), [line(r) for r in rows]

    if not schema_failed and (rows := _apply_cached(url, html, domain, signature)):  # tier 1: cached
        return "schema", _tag_structure(rows, signature), [line(r) for r in rows]

    tier, rows, lines = _fallback_extract(url, html, md, signature)   # tier 2: deterministic FIRST
    if rows:
        return tier, rows, lines

    if LLM_SCHEMA_GEN and not schema_failed and P.PRICE_RE.search(md):  # tier 3: LLM, last resort
        if (result := _llm_induce(url, html, domain, signature, schema_key)):
            return result

    return tier, rows, lines                                     # deterministic empty result
