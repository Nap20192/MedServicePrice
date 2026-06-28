"""Central config + logging setup.

Resolution order for every setting (first wins):
    1. real environment variable
    2. .env file        (secrets, key=value)        — project root, gitignored
    3. config.yaml      (tunables, flat key: value)  — project root
    4. hardcoded default below
Both files are loaded into os.environ via setdefault, so the rest of this module
keeps reading os.environ as before.
"""

import logging
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

_ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


def _load_yaml(path: Path) -> None:
    if not path.exists():
        return
    try:
        import yaml
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception:  # noqa: BLE001  (bad yaml / missing lib -> just skip)
        return
    for key, val in _flatten(data):
        os.environ.setdefault(key, val)


_YAML_SECTION_PREFIXES = {
    "crawl": "",
    "output": "",
    "adapter": "ADAPTER",
    "extraction": "",
    "llm": "LLM",
    "logging": "",
    "browser": "BROWSER",
    "mcp": "MCP",
}


def _flatten(data: dict, prefix: str = "") -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for k, v in (data or {}).items():
        raw_key = str(k)
        if not prefix and raw_key.lower() in _YAML_SECTION_PREFIXES:
            key = _YAML_SECTION_PREFIXES[raw_key.lower()]
        else:
            key = (f"{prefix}_{raw_key}" if prefix else raw_key).upper()
        if isinstance(v, dict):
            out += _flatten(v, key)
        elif isinstance(v, list):
            out.append((key, ",".join(str(x) for x in v)))
        elif isinstance(v, bool):
            out.append((key, "1" if v else "0"))
        elif v is not None:
            out.append((key, str(v)))
    return out


_load_dotenv(_ROOT / ".env")        # secrets first
_load_yaml(_ROOT / "config.yaml")   # then tunables (setdefault -> .env still wins)
os.environ.setdefault("CRAWL4_AI_BASE_DIRECTORY", str(_ROOT))


def _bool(name: str, default: str = "0") -> bool:
    return os.environ.get(name, default).strip().lower() not in ("0", "false", "no", "off", "")


def _csv(name: str, default: str = "") -> list[str]:
    return [s.strip() for s in os.environ.get(name, default).split(",") if s.strip()]

# -- crawl ---------------------------------------------------------------------
MAX_DEPTH = int(os.environ.get("MAX_DEPTH", "5"))
MAX_PAGES = int(os.environ.get("MAX_PAGES", "1000"))
CONCURRENCY = int(os.environ.get("CONCURRENCY", "20"))
FETCH_CONCURRENCY = max(1, int(os.environ.get("FETCH_CONCURRENCY", str(CONCURRENCY))))
PAGE_TIMEOUT_MS = int(os.environ.get("PAGE_TIMEOUT_MS", "30000"))
CRAWL_MODE = os.environ.get("CRAWL_MODE", "http")  # http | browser
ESCALATE = os.environ.get("ESCALATE", "1") != "0"  # re-fetch JS-shells with browser
DISCOVERY_MODE = os.environ.get("DISCOVERY_MODE", "agent")  # agent | deep
AGENT_BATCH_SIZE = max(
    1, int(os.environ.get("AGENT_BATCH_SIZE", str(min(CONCURRENCY, 8))))
)
AGENT_LINKS_PER_PAGE = max(1, int(os.environ.get("AGENT_LINKS_PER_PAGE", "40")))
DISCOVERY_CITY_SLUGS = [
    s.strip()
    for s in os.environ.get(
        "DISCOVERY_CITY_SLUGS",
        "astana,aktau,aktobe,saran",
    ).split(",")
    if s.strip()
]
DISCOVERY_SEED_TEMPLATES = [
    s.strip()
    for s in os.environ.get(
        "DISCOVERY_SEED_TEMPLATES",
        "/analizes/for-doctors/{city},/analizes/profi/{city},/{city}/radiology",
    ).split(",")
    if s.strip()
]
INVITRO_SEED_PATHS = [
    s.strip()
    for s in os.environ.get(
        "INVITRO_SEED_PATHS",
        "/analizes/for-doctors/,/analizes/profi/",
    ).split(",")
    if s.strip()
]
# Repeat runs auto-COLLECT (just gather from the saved adapter). Force a full
# re-discovery (rebuild the adapter) with REDISCOVER=1.
REDISCOVER = os.environ.get("REDISCOVER", "0") != "0"

# -- browser -------------------------------------------------------------------
# Default is headless. Set BROWSER_VISIBLE=1 only for debugging: Playwright will
# open a real browser window and crawler actions become visible.
BROWSER_VISIBLE = _bool("BROWSER_VISIBLE", "0")
BROWSER_HEADLESS = False if BROWSER_VISIBLE else _bool("BROWSER_HEADLESS", "1")
BROWSER_VERBOSE = _bool("BROWSER_VERBOSE", "0")
BROWSER_DISABLE_GPU = _bool("BROWSER_DISABLE_GPU", "1")
BROWSER_EXTRA_ARGS = _csv("BROWSER_EXTRA_ARGS")

# -- MCP browser agent ---------------------------------------------------------
# Optional adapter fallback. It is used for hard SPA / anti-bot shell pages where
# the normal HTTP/browser fetch cannot discover useful data URLs.
MCP_ENABLED = _bool("MCP_ENABLED", "0")
MCP_COMMAND = _csv("MCP_COMMAND", "npx,-y,@playwright/mcp@latest")
MCP_BROWSER = os.environ.get("MCP_BROWSER", "chrome")
MCP_HEADLESS = _bool("MCP_HEADLESS", "1")
MCP_VISIBLE = _bool("MCP_VISIBLE", "0")
if MCP_VISIBLE:
    MCP_HEADLESS = False
MCP_OUTPUT_DIR = os.environ.get("MCP_OUTPUT_DIR", ".mcp-output")
MCP_SNAPSHOT_MODE = os.environ.get("MCP_SNAPSHOT_MODE", "full")
MCP_CONSOLE_LEVEL = os.environ.get("MCP_CONSOLE_LEVEL", "warning")
MCP_CAPS = _csv("MCP_CAPS", "network")
MCP_TIMEOUT_S = float(os.environ.get("MCP_TIMEOUT_S", "45"))
MCP_ALLOWED_ORIGINS = os.environ.get("MCP_ALLOWED_ORIGINS", "")
MCP_ALLOWED_HOSTS = os.environ.get("MCP_ALLOWED_HOSTS", "localhost,127.0.0.1")
MCP_BLOCKED_ORIGINS = os.environ.get("MCP_BLOCKED_ORIGINS", "")
MCP_BLOCK_SERVICE_WORKERS = _bool("MCP_BLOCK_SERVICE_WORKERS", "1")
MCP_ISOLATED = _bool("MCP_ISOLATED", "1")
MCP_SAVE_SESSION = _bool("MCP_SAVE_SESSION", "1")
MCP_SHARED_BROWSER_CONTEXT = _bool("MCP_SHARED_BROWSER_CONTEXT", "0")
MCP_IMAGE_RESPONSES = os.environ.get("MCP_IMAGE_RESPONSES", "omit")
MCP_OUTPUT_MODE = os.environ.get("MCP_OUTPUT_MODE", "file")
MCP_USER_DATA_DIR = os.environ.get("MCP_USER_DATA_DIR", ".mcp-user-data")
MCP_STORAGE_STATE = os.environ.get("MCP_STORAGE_STATE", "")
MCP_VIEWPORT_SIZE = os.environ.get("MCP_VIEWPORT_SIZE", "1366x900")
MCP_TIMEOUT_ACTION_MS = int(os.environ.get("MCP_TIMEOUT_ACTION_MS", "10000"))
MCP_TIMEOUT_NAVIGATION_MS = int(os.environ.get("MCP_TIMEOUT_NAVIGATION_MS", "60000"))
MCP_CODEGEN = os.environ.get("MCP_CODEGEN", "none")
MCP_IGNORE_HTTPS_ERRORS = _bool("MCP_IGNORE_HTTPS_ERRORS", "1")
MCP_NO_SANDBOX = _bool("MCP_NO_SANDBOX", "0")
MCP_USER_AGENT = os.environ.get("MCP_USER_AGENT", "")
MCP_PROXY_SERVER = os.environ.get("MCP_PROXY_SERVER", "")
MCP_PROXY_BYPASS = os.environ.get("MCP_PROXY_BYPASS", "")
MCP_INIT_SCRIPT = _csv("MCP_INIT_SCRIPT")
MCP_INIT_PAGE = _csv("MCP_INIT_PAGE")
# Empty by default: do NOT feed our own .env (LLM keys) into the MCP browser as
# page-injected secrets. Point this at a dedicated dotenv only if a site needs it.
MCP_SECRETS_FILE = os.environ.get("MCP_SECRETS_FILE", "")

# -- output / state ------------------------------------------------------------
# Output is per-domain: <OUTPUT_DIR>/<domain-slug>-prices.jsonl (e.g.
# kdlolymp-prices.jsonl). Set OUTPUT_PATH to force one fixed file for every run.
OUTPUT_DIR = Path(os.environ.get("OUTPUT_DIR", "."))
OUTPUT_PATH = Path(os.environ["OUTPUT_PATH"]) if os.environ.get("OUTPUT_PATH") else None
PAGES_DIR = Path(os.environ.get("PAGES_DIR", "pages"))
SCHEMA_DIR = Path(os.environ.get("SCHEMA_DIR", "schemas"))
STATE_DIR = Path(os.environ.get("STATE_DIR", "state"))  # persisted route templates
ADAPTER_DIR = Path(
    os.environ.get("ADAPTER_DIR", "adapters")
)  # per-site scraping profiles
SAVE_PAGES = os.environ.get("SAVE_PAGES", "0") != "0"
WRITE_DISCOVERY_OUTPUT = os.environ.get("WRITE_DISCOVERY_OUTPUT", "0") != "0"
ADAPTER_COMPACT = os.environ.get("ADAPTER_COMPACT", "1") != "0"
ADAPTER_LISTING_ROW_THRESHOLD = int(
    os.environ.get("ADAPTER_LISTING_ROW_THRESHOLD", "25")
)

# -- extraction ----------------------------------------------------------------
# The output fields fetch writes. Other product/clinic fields belong to later pipeline stages.
FIELDS = [
    f.strip()
    for f in os.environ.get(
        "FIELDS",
        "service_name_raw,price_kzt,duration_days,url",
    ).split(",")
    if f.strip()
]
DEFAULT_CURRENCY = os.environ.get("DEFAULT_CURRENCY", "KZT")
MIN_PRICE = float(os.environ.get("MIN_PRICE", "50"))
# A route-template with >= this many invalid hits and zero valid is blocked next run.
DEAD_ROUTE_THRESHOLD = int(os.environ.get("DEAD_ROUTE_THRESHOLD", "5"))

# -- LLM (optional, schema induction only) -------------------------------------
LLM_MODEL = os.environ.get("LLM_MODEL", "gemini-2.5-flash")
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", f"gemini/{LLM_MODEL}")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "")
LLM_API_KEY = (
    os.environ.get("LLM_API_KEY")
    or os.environ.get("DEEPSEEK_API_KEY")
    or os.environ.get("GEMINI_API_KEY")
    or os.environ.get("GOOGLE_API_KEY")
    or os.environ.get("OPENAI_API_KEY", "")
)
LLM_SCHEMA_GEN = os.environ.get("LLM_SCHEMA_GEN", "1") != "0" and bool(LLM_API_KEY)
LLM_CONCURRENCY = max(1, int(os.environ.get("LLM_CONCURRENCY", "5")))

# LLM tool-calling discovery agent (opt-in). Drives a Playwright-MCP browser with
# navigate/click/snapshot tools to build a richer adapter. Off by default — the
# deterministic discovery path stays the default and is untouched.
# Many KZ clinic/gov sites serve weak/misconfigured TLS certs. Default to NOT
# verifying so discovery doesn't die on SSLCertVerificationError. Set VERIFY_SSL=1
# to enforce verification.
VERIFY_SSL = os.environ.get("VERIFY_SSL", "0") != "0"

AGENT_LOOP = os.environ.get("AGENT_LOOP", "0") != "0" and bool(LLM_API_KEY)
AGENT_MAX_STEPS = max(1, int(os.environ.get("AGENT_MAX_STEPS", "24")))
AGENT_SNAPSHOT_CHARS = max(1000, int(os.environ.get("AGENT_SNAPSHOT_CHARS", "6000")))
# LLM schema induction is the slow last resort: cap calls per domain per run so a
# site with many distinct page structures cannot trigger dozens of ~90s LLM calls.
SCHEMA_GEN_MAX_PER_DOMAIN = max(0, int(os.environ.get("SCHEMA_GEN_MAX_PER_DOMAIN", "2")))

# -- worker / infra (RabbitMQ + Postgres sink) ---------------------------------
# Used only by worker.py and the Postgres sink; the CLI ignores them.
RABBITMQ_URL = os.environ.get("RABBITMQ_URL", "amqp://msp:msp@localhost:5672/")
DATABASE_URL = os.environ.get("DATABASE_URL", "postgres://msp:msp@localhost:55432/msp")
WORKER_PREFETCH = max(1, int(os.environ.get("WORKER_PREFETCH", "1")))
WORKER_DECLARE_TOPOLOGY = _bool("WORKER_DECLARE_TOPOLOGY", "1")
# Where fetch() persists rows: postgres (worker default) | jsonl (CLI default) | both.
SINK = os.environ.get("SINK", "postgres").strip().lower()


def asyncpg_dsn(url: str = DATABASE_URL) -> str:
    """asyncpg accepts postgres://; normalize the postgresql+driver forms just in case."""
    for prefix in ("postgresql+asyncpg://", "postgresql://"):
        if url.startswith(prefix):
            return "postgres://" + url[len(prefix):]
    return url


def safe_url(url: str) -> str:
    """Return a log-safe URL with credentials masked."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return "<invalid-url>"

    if not parts.netloc or "@" not in parts.netloc:
        return url

    _, host = parts.netloc.rsplit("@", 1)
    return urlunsplit((parts.scheme, f"***:***@{host}", parts.path, parts.query, parts.fragment))


# -- prompt logging ------------------------------------------------------------
LOG_PROMPTS = _bool("LOG_PROMPTS", "1")
# Full prompt body = the entire ~60k-char HTML dumped line-by-line. Off by default;
# the BEGIN/END metadata lines still log. Turn on for prompt debugging only.
LOG_PROMPTS_FULL = _bool("LOG_PROMPTS_FULL", "0")
PROMPT_LOG_MAX_CHARS = int(os.environ.get("PROMPT_LOG_MAX_CHARS", "6000"))


def log_llm_config() -> None:
    """One line at startup stating which LLM (if any) this run will use."""
    logger = get_logger("config")
    if not LLM_SCHEMA_GEN:
        reason = "no api key" if not LLM_API_KEY else "LLM_SCHEMA_GEN=0"
        logger.info("llm disabled (%s) — extraction is deterministic (jsonld/blocks/links/regex)", reason)
        return
    logger.info("llm provider=%s model=%s base_url=%s api_key=%s concurrency=%d "
                "usage=schema-induction-once-per-html-structure",
                LLM_PROVIDER, LLM_MODEL, LLM_BASE_URL or "default",
                "set" if LLM_API_KEY else "none", LLM_CONCURRENCY)

PRICE_KEYWORDS = [
    "price",
    "prices",
    "pricing",
    "tariff",
    "catalog",
    "service",
    "services",
    "analiz",
    "analizy",
    "lab",
    "test",
    "цена",
    "цены",
    "прайс",
    "стоимость",
    "тариф",
    "услуг",
    "анализ",
    "каталог",
    "прейскурант",
]
JUNK_URL_PATTERNS = [
    "*login*",
    "*signin*",
    "*logout*",
    "*cart*",
    "*basket*",
    "*account*",
    "*CITY_NAME=*",
    "*utm_*",
    "*.jpg",
    "*.jpeg",
    "*.png",
    "*.gif",
    "*.svg",
    "*.pdf",
    "*.zip",
    "*/cdn-cgi/*",
    "*#*",
    # price-less sections — skip in discovery (only yield junk / waste crawl budget)
    "*clinic.php*",        # office detail pages -> "Выезд за 15000" junk
    "*/offices/*",
    "*/news/*",
    "*/articles/*",
    "*/article/*",
    "*/vacancy*",
    "*/about/*",
    "*/promo*",
    "*/promotion*",
    "*/actions/*",
    "*/blog/*",
    "*/reviews*",
    "*/otzyvy*",
]


class _ConsoleFormatter(logging.Formatter):
    """Console output: `HH:MM:SS LEVEL component  message`. Colors the level on a TTY."""

    _RESET, _DIM = "\033[0m", "\033[2m"
    _COL = {
        logging.DEBUG: "\033[2m",
        logging.INFO: "\033[32m",
        logging.WARNING: "\033[33m",
        logging.ERROR: "\033[31m",
        logging.CRITICAL: "\033[1;31m",
    }

    def __init__(self, color: bool):
        super().__init__(datefmt="%H:%M:%S")
        self.color = color

    def format(self, record: logging.LogRecord) -> str:
        t = self.formatTime(record, self.datefmt)
        level = record.levelname.ljust(7)
        comp = record.name.removeprefix("crawler.").removeprefix("crawler").ljust(9)
        msg = record.getMessage()
        if not self.color:
            return f"{t} {level} {comp} {msg}"
        col = self._COL.get(record.levelno, "")
        return (
            f"{self._DIM}{t}{self._RESET} {col}{level}{self._RESET} "
            f"{self._DIM}{comp}{self._RESET} {msg}"
        )


def setup_logging() -> None:
    level = getattr(logging, os.environ.get("LOG_LEVEL", "INFO").upper(), logging.INFO)
    use_color = os.environ.get("LOG_COLOR", "auto")
    color = (
        sys.stdout.isatty()
        if use_color == "auto"
        else use_color not in ("0", "no", "off")
    )

    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(_ConsoleFormatter(color))
    # File log: full ISO-ish timestamp + level + component, plain (greppable).
    fileh = logging.FileHandler("crawler.log", mode="w", encoding="utf-8")
    fileh.setFormatter(
        logging.Formatter(
            "%(asctime)s.%(msecs)03d %(levelname)-7s %(name)-16s %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
    )

    root = logging.getLogger()
    root.setLevel(level)
    root.handlers[:] = [console, fileh]
    for noisy in ("asyncio", "urllib3", "playwright", "crawl4ai", "httpx", "LiteLLM"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def get_logger(name: str = "crawler") -> logging.Logger:
    return logging.getLogger(name)


setup_logging()
log = get_logger("crawler")
