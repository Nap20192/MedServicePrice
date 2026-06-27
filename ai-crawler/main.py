"""CLI entrypoint.

  python main.py adapter <url>   create or update the site adapter (discover data-URLs)
  python main.py fetch   <url>   walk the adapter's data-URLs and fetch data
  python main.py <url>           convenience: build adapter if missing, then fetch

Config via env (see crawler/config.py): MAX_DEPTH, MAX_PAGES, CONCURRENCY,
FETCH_CONCURRENCY, DISCOVERY_MODE=agent|deep, CRAWL_MODE=http|browser, MIN_PRICE, FIELDS,
WRITE_DISCOVERY_OUTPUT, LLM_SCHEMA_GEN + LLM_* for schema induction.
"""
import asyncio
import sys

from crawler.config import log, log_llm_config
from crawler.pipeline import create_or_update_adapter, fetch, run

COMMANDS = {"adapter": create_or_update_adapter, "fetch": fetch, "run": run}


def main() -> None:
    args = [a for a in sys.argv[1:] if a.strip()]
    if not args:
        sys.exit("Usage: python main.py [adapter|fetch] <start_url>")

    if args[0] in COMMANDS:
        command, rest = COMMANDS[args[0]], args[1:]
    else:
        command, rest = run, args                    # bare URL -> convenience run
    if not rest:
        sys.exit(f"Usage: python main.py {args[0]} <start_url>")

    start = rest[0] if rest[0].startswith("http") else "https://" + rest[0]
    log_llm_config()
    try:
        asyncio.run(command(start))
    except KeyboardInterrupt:
        log.warning("run interrupted by user (SIGINT)")


if __name__ == "__main__":
    main()
