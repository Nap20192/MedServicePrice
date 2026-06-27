"""Compiled regexes + keyword constants shared across extractors."""
import re

# Price token: a number adjacent to a currency marker. Groups isolate the number.
_CUR = r"₸|тг|тнг|тенге|kzt|руб|р\.|₽|£|€|\$"
_NUM = r"\d[\d\s .,]{1,}\d|\d"
PRICE_RE = re.compile(rf"(?:(?:{_CUR})\s*({_NUM}))|(?:({_NUM})\s*(?:{_CUR}))", re.IGNORECASE)

# Name cleaning. Filter-slider / surcharge labels are not service names.
NAME_STOPWORDS = {"меню", "корзина", "войти", "каталог", "главная", "контакты", "поиск",
                  "menu", "cart", "login", "home", "search", "итого", "total", "всего",
                  "менее", "более", "от", "до", "less", "more", "from", "to",
                  "в корзину", "подробнее", "заказать", "купить"}

# Card layout: invitro-style catalog where each service is a multi-line block
# headed by a standalone item code ("№ 119", "№ 5KZ"), with the name on a
# markdown-link line and the real price on its own currency-only line.
CODE_LINE_RE = re.compile(r"^№\s*\S+\s*$")

# Link-list layout (kdlolymp-style SPA): each service is a markdown link whose
# text glues name + category + duration + price + add-to-cart, all on one line.
CART_RE = re.compile(r"в\s*корзину", re.IGNORECASE)
HEADING_RE = re.compile(r"^#{1,6}\s+(.*\S)\s*$")
# Execution time -> days. Handles "1 календарный день", "До 5 рабочих дней", "3 days".
DURATION_RE = re.compile(
    r"(?:до\s*)?(\d+)\s*(?:календарн\w*|рабоч\w*)?\s*(?:дн\w*|день|days?)", re.IGNORECASE)
TAIL_RE = re.compile(r"[\s:–—\-.…]*(?:от|from|цена|стоимость|price|cost)?[\s.…]*$", re.IGNORECASE)
MD_IMG_RE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
MD_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]*\)")
MD_NOISE_RE = re.compile(r"[*_`>#]+")
HEAD_RE = re.compile(r"^[\s\[\]\-•|.+:]+")
PLUS_TAIL_RE = re.compile(r"[\s:+]+$")
LETTER_RE = re.compile(r"[A-Za-zА-Яа-яЁё]")

# Crawl helpers.
SPA_RE = re.compile(r"__NEXT_DATA__|window\.__NUXT__|data-reactroot|ng-app|"
                    r"id=[\"']root[\"']|id=[\"']app[\"']|enable JavaScript", re.IGNORECASE)
LDJSON_RE = re.compile(r"<script[^>]*application/ld\+json[^>]*>(.*?)</script>", re.DOTALL | re.IGNORECASE)
TAG_RE = re.compile(r"<[^>]+>")
SCRIPT_STYLE_RE = re.compile(r"<(script|style|svg|noscript|head)\b.*?</\1>", re.DOTALL | re.IGNORECASE)

# Routes.
ID_SEG_RE = re.compile(r"^(?:\d+|[0-9a-fA-F]{8,}|[0-9a-fA-F-]{16,})$")
INVALID_CONTENT_RE = re.compile(
    r"не найден|страниц\w* не существ|ничего не найдено|page not found|error\s*404|404\s*not",
    re.IGNORECASE)
