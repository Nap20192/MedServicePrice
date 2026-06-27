"""Structured prompt logging helpers."""
from __future__ import annotations

import hashlib

from crawler.config import LOG_PROMPTS, LOG_PROMPTS_FULL, PROMPT_LOG_MAX_CHARS, get_logger

log = get_logger("prompt")
_seen: set[str] = set()


def log_prompt(kind: str, text: str, *, domain: str = "", once_key: str = "",
               meta: dict | None = None) -> None:
    """Log prompts with explicit markers so they are easy to grep in crawler.log."""
    if not LOG_PROMPTS:
        return
    body = text or ""
    digest = hashlib.sha1(body.encode("utf-8")).hexdigest()[:12]
    key = once_key or f"{kind}:{domain}:{digest}"
    if key in _seen:
        return
    _seen.add(key)

    fields = {
        "kind": kind,
        "domain": domain or "_unknown",
        "chars": len(body),
        "sha1": digest,
        **(meta or {}),
    }
    field_text = " ".join(f"{k}={v}" for k, v in fields.items())
    log.info("PROMPT_BEGIN %s", field_text)
    if LOG_PROMPTS_FULL:
        clipped = body[:PROMPT_LOG_MAX_CHARS]
        if len(body) > len(clipped):
            clipped += f"\n...[truncated {len(body) - len(clipped)} chars]"
        for line in clipped.splitlines() or [""]:
            log.info("PROMPT_BODY %s", line)
    log.info("PROMPT_END kind=%s domain=%s sha1=%s", kind, domain or "_unknown", digest)

