"""Normalize raw extracted fields into clean price rows."""
import re
from urllib.parse import urlparse

from crawler.common import patterns as P
from crawler.config import DEFAULT_CURRENCY, MIN_PRICE


BAD_URL_PARTS = (
    "/about/news/",
    "/news/",
    "/ak/",
    "/promo",
    "/promotion",
    "/actions/",
)

BAD_NAME_RE = re.compile(
    r"^(?:"
    r"взятие\s+крови|"
    r"стоимость\s+выезда|"
    r"выезд\s+за|"
    r"выезд\s+мед|"
    r"доступно\s+с\s+выездом|"
    r"при[её]м\s+в\s+клинике|"
    r"комплекс\s+исследований\s+за|"
    r"акци[яи]\b|"
    r"новинка\b|"
    r"в\s+дни\s+проведения\s+акции|"
    r"до\s+\d+\s+.*(?:скидк|проверьте)|"
    r"сдать\s+комплексы\s+анализов|"
    r"\d+\s*[-–—]\s*\d+\s*дн\w*\s*$|"
    r"\d+\s*дн\w*\s*$|"
    r"№\s*\S+\s*$"
    r")",
    re.IGNORECASE,
)


def parse_price(num) -> float | None:
    digits = re.sub(r"\D", "", str(num))
    return float(digits) if digits else None


def detect_currency(token: str) -> str:
    low = token.lower()
    if "₸" in token or "тг" in low or "тенге" in low or "тнг" in low or "kzt" in low:
        return "KZT"
    if "₽" in token or "руб" in low or "р." in low:
        return "RUB"
    if "£" in token:
        return "GBP"
    if "€" in token:
        return "EUR"
    if "$" in token:
        return "USD"
    return DEFAULT_CURRENCY


def clean_name(text: str) -> str:
    text = P.MD_IMG_RE.sub(" ", text)
    text = P.MD_LINK_RE.sub(r"\1", text)
    text = P.MD_NOISE_RE.sub(" ", text)
    text = P.HEAD_RE.sub("", text)
    text = P.PLUS_TAIL_RE.sub("", text)
    text = P.TAIL_RE.sub("", text)
    text = re.sub(r"\(\s*\)", "", text)              # empty parens left after price removal
    text = re.sub(r"\s*\($", "", text)               # dangling '(' from a split parenthetical
    return re.sub(r"\s{2,}", " ", text).strip()


def is_bad_service_name(name: str, url: str = "") -> bool:
    low = (name or "").strip().casefold()
    if not low:
        return True
    if low in P.NAME_STOPWORDS or BAD_NAME_RE.search(low):
        return True
    parsed_path = urlparse(url or "").path.casefold()
    if parsed_path and any(part in parsed_path for part in BAD_URL_PARTS):
        return True
    return False


def make_row(service, price, currency_token, url) -> dict | None:
    """Validate + normalize. Returns a row dict or None if junk."""
    name = clean_name(str(service or ""))
    p = parse_price(price)
    if (p is None or p < MIN_PRICE or len(name) < 3 or name.lower() in P.NAME_STOPWORDS
            or not P.LETTER_RE.search(name)):
        return None
    if is_bad_service_name(name, url):
        return None
    if name.startswith("(") and ")" not in name:        # prose fragment, e.g. "(сумма заказа"
        return None
    cur = detect_currency(currency_token) if currency_token else DEFAULT_CURRENCY
    return {"service": name, "price": p, "currency": cur, "url": url}


def line(row: dict) -> str:
    return f"{row['service']} | {row['price']:g} {row['currency']}"
