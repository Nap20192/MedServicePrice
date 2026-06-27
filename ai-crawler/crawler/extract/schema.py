"""Tier 1/2: CSS extraction schema — disk cache + deterministic apply + LLM induction."""
import hashlib
import json
import re
import threading
from datetime import datetime, timezone

from crawl4ai import JsonCssExtractionStrategy, LLMConfig

from crawler.common import patterns as P
from crawler.common.promptlog import log_prompt
from crawler.extract.cleaning import make_row
from crawler.config import (LLM_API_KEY, LLM_BASE_URL, LLM_PROVIDER, SCHEMA_DIR, STATE_DIR, get_logger)

log = get_logger(__name__)
_REGISTRY_LOCK = threading.RLock()


def _safe_domain(domain: str) -> str:
    return re.sub(r"[^a-zA-Z0-9.]", "_", domain)


def _schema_path(domain: str, signature: str | None = None):
    suffix = f"__{signature}" if signature else ""
    return SCHEMA_DIR / f"{_safe_domain(domain)}{suffix}.json"


def _registry_path(domain: str):
    return STATE_DIR / _safe_domain(domain) / "schema_signatures.json"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _node_token(el) -> str:
    cls = ".".join(sorted((el.get("class") or "").split())[:3])
    node_id = el.get("id")
    if node_id:
        return f"{el.tag}#{node_id}"
    return f"{el.tag}.{cls}" if cls else str(el.tag)


def structure_signature(html: str) -> str:
    """Stable-ish fingerprint of the DOM structure around visible price nodes."""
    cleaned = P.SCRIPT_STYLE_RE.sub("", html or "")
    try:
        from lxml import html as _lhtml

        tree = _lhtml.fromstring(cleaned)
        paths: list[str] = []
        for el in tree.iter():
            if not isinstance(el.tag, str):
                continue
            text = (el.text_content() or "").strip()
            if not text or not P.PRICE_RE.search(text):
                continue
            ancestors = list(el.iterancestors())[-4:] + [el]
            paths.append(">".join(_node_token(node) for node in ancestors))
            if len(paths) >= 80:
                break
        raw = "|".join(sorted(paths)) if paths else cleaned[:4000]
    except Exception:  # noqa: BLE001
        raw = P.TAG_RE.sub(lambda m: m.group(0).split()[0] + ">", cleaned[:8000])
    if not raw:
        raw = cleaned[:4000]
    return hashlib.sha1(raw.encode("utf-8", errors="ignore")).hexdigest()[:12]


def list_schema_signatures(domain: str) -> dict:
    safe = _safe_domain(domain)
    out = load_signature_registry(domain)
    if not SCHEMA_DIR.exists():
        return out
    for p in sorted(SCHEMA_DIR.glob(f"{safe}__*.json")):
        sig = p.stem.split("__", 1)[1]
        current = out.get(sig, {})
        current.update({"status": "productive", "path": str(p), "file": p.name})
        out[sig] = current
    legacy = _schema_path(domain)
    if legacy.exists():
        current = out.get("legacy", {})
        current.update({"status": "productive", "path": str(legacy), "file": legacy.name})
        out["legacy"] = current
    return out


def load_schema(domain: str, signature: str | None = None) -> dict | None:
    p = _schema_path(domain, signature)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return None
    return None


def save_schema(domain: str, schema: dict, signature: str | None = None) -> None:
    SCHEMA_DIR.mkdir(parents=True, exist_ok=True)
    _schema_path(domain, signature).write_text(
        json.dumps(schema, ensure_ascii=False, indent=2), encoding="utf-8")


def drop_schema(domain: str, signature: str | None = None) -> None:
    _schema_path(domain, signature).unlink(missing_ok=True)


def load_signature_registry(domain: str) -> dict:
    with _REGISTRY_LOCK:
        p = _registry_path(domain)
        if not p.exists():
            return {}
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
        return data if isinstance(data, dict) else {}


def signature_status(domain: str, signature: str) -> str | None:
    entry = load_signature_registry(domain).get(signature)
    return entry.get("status") if isinstance(entry, dict) else None


def mark_signature(domain: str, signature: str, status: str, **meta) -> None:
    with _REGISTRY_LOCK:
        registry = load_signature_registry(domain)
        entry = dict(registry.get(signature) or {})
        entry.update(meta)
        entry["status"] = status
        entry["updated_at"] = _now()
        registry[signature] = entry
        p = _registry_path(domain)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(registry, ensure_ascii=False, indent=2), encoding="utf-8")


def apply_schema(url: str, html: str, schema: dict) -> list[dict]:
    try:
        raw = JsonCssExtractionStrategy(schema).run(url, [html])
    except Exception as e:                                       # noqa: BLE001
        log.debug("css schema apply failed url=%s error=%s", url, e)
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            raw = []
    if isinstance(raw, dict):
        raw = [raw]
    rows = []
    for it in raw:
        if not isinstance(it, dict):
            continue
        if (r := make_row(it.get("service") or it.get("name"),
                          it.get("price"), it.get("currency") or it.get("price"), url)):
            rows.append(r)
    return rows


def generate_schema(domain: str, html: str, signature: str | None = None) -> dict | None:
    """Induce a reusable CSS schema for one unseen HTML structure."""
    trimmed = P.SCRIPT_STYLE_RE.sub("", html)[:60_000]
    query = "Extract each medical service/analysis name and its price from the repeating rows."
    target = '{"service": "Общий анализ крови", "price": "2500 ₸", "currency": "KZT"}'
    log_prompt(
        "llm.schema_induction",
        "\n".join([
            "TASK:",
            query,
            "",
            "TARGET_JSON_EXAMPLE:",
            target,
            "",
            "HTML_PREVIEW:",
            trimmed[:4000],
        ]),
        domain=domain,
        once_key=f"schema-induction:{domain}:{signature or 'legacy'}",
        meta={"provider": LLM_PROVIDER, "html_chars": len(trimmed), "structure_signature": signature},
    )
    kwargs = dict(provider=LLM_PROVIDER, api_token=LLM_API_KEY)
    if LLM_BASE_URL:
        kwargs["base_url"] = LLM_BASE_URL
    try:
        schema = JsonCssExtractionStrategy.generate_schema(
            html=trimmed,
            query=query,
            target_json_example=target,
            llm_config=LLMConfig(**kwargs),
        )
    except Exception as e:                                       # noqa: BLE001
        log.warning("llm schema induction failed domain=%s error=%s", domain, str(e)[:120])
        return None
    if schema:
        save_schema(domain, schema, signature)
        if signature:
            mark_signature(
                domain,
                signature,
                "schema_generated",
                schema_file=_schema_path(domain, signature).name,
            )
        log.info("llm schema induced domain=%s structure=%s path=%s",
                 domain, signature or "legacy", _schema_path(domain, signature).name)
    return schema
