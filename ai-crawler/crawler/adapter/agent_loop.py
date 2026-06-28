"""LLM tool-calling discovery agent (opt-in, AGENT_LOOP=1).

Unlike the deterministic link policy, this drives a real Playwright-MCP browser
through an LLM that can *act*: navigate, click buttons/tabs, snapshot the page,
inspect network requests. The LLM is given tools; after each model turn we execute
the requested tool calls and feed the results back. The agent records the
productive price URLs, the interaction steps needed to reach them (clicks/navigation),
and any JSON/XHR price endpoints — producing a much more detailed adapter.

Best-effort and fully isolated: any failure returns an empty result and the caller
keeps the deterministic adapter. Enabled only when AGENT_LOOP=1 and an LLM key is set.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from urllib.parse import urlparse

import httpx

from crawler.adapter.mcp_explorer import _MCPStdioClient, _mcp_command, _content_text
from crawler.config import (AGENT_LOOP, AGENT_MAX_STEPS, AGENT_SNAPSHOT_CHARS,
                            LLM_API_KEY, LLM_BASE_URL, LLM_MODEL, MCP_TIMEOUT_S, get_logger)

log = get_logger(__name__)


@dataclass
class AgentResult:
    enabled: bool = False
    status: str = "disabled"
    data_urls: list[str] = field(default_factory=list)        # productive price pages
    interactions: list[dict] = field(default_factory=list)    # clicks/navs to reach data
    network_endpoints: list[dict] = field(default_factory=list)  # JSON/XHR price APIs
    structures: list[str] = field(default_factory=list)       # distinct HTML structures seen
    trace: list[dict] = field(default_factory=list)           # tool-call log
    steps: int = 0
    summary: str = ""

    def to_dict(self) -> dict:
        return {
            "enabled": self.enabled, "status": self.status, "steps": self.steps,
            "summary": self.summary, "data_urls": self.data_urls,
            "interactions": self.interactions, "network_endpoints": self.network_endpoints,
            "structures": self.structures, "trace": self.trace[-40:],
        }


# ---- Tool schemas exposed to the LLM (OpenAI function-calling format) ----

TOOLS = [
    {"type": "function", "function": {
        "name": "navigate", "description": "Open a URL in the browser.",
        "parameters": {"type": "object", "properties": {
            "url": {"type": "string", "description": "Absolute URL to open"}},
            "required": ["url"]}}},
    {"type": "function", "function": {
        "name": "click",
        "description": "Click an element (tab, button, 'show prices', city selector, "
                       "'load more'). Use the ref from the latest snapshot.",
        "parameters": {"type": "object", "properties": {
            "element": {"type": "string", "description": "Human description of the element"},
            "ref": {"type": "string", "description": "ref id from the snapshot, e.g. e23"}},
            "required": ["element", "ref"]}}},
    {"type": "function", "function": {
        "name": "snapshot",
        "description": "Get the accessibility snapshot of the current page (text + refs "
                       "for clickable elements). Call after navigate/click to see the page.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {
        "name": "network_requests",
        "description": "List network requests the page made — use to find JSON/XHR price APIs.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {
        "name": "record_data_url",
        "description": "Record a URL that contains real service-name + price rows (a productive "
                       "page worth fetching later).",
        "parameters": {"type": "object", "properties": {
            "url": {"type": "string"},
            "structure": {"type": "string", "description": "short HTML-structure label, e.g. 'price-table'"},
            "reason": {"type": "string"}},
            "required": ["url"]}}},
    {"type": "function", "function": {
        "name": "record_interaction",
        "description": "Record an interaction step (click/navigate) that is REQUIRED to reach "
                       "price data, so the fetcher can replay it later.",
        "parameters": {"type": "object", "properties": {
            "on_url": {"type": "string"},
            "action": {"type": "string", "enum": ["click", "navigate", "select"]},
            "target": {"type": "string", "description": "element description or url"},
            "note": {"type": "string"}},
            "required": ["action", "target"]}}},
    {"type": "function", "function": {
        "name": "record_network_endpoint",
        "description": "Record a JSON/XHR endpoint that returns price data (cheap to fetch later).",
        "parameters": {"type": "object", "properties": {
            "url": {"type": "string"}, "method": {"type": "string"}, "note": {"type": "string"}},
            "required": ["url"]}}},
    {"type": "function", "function": {
        "name": "finish",
        "description": "Stop. Call when productive price URLs are recorded or no more are reachable.",
        "parameters": {"type": "object", "properties": {
            "summary": {"type": "string"},
            "structures": {"type": "array", "items": {"type": "string"}}}}}},
]

SYSTEM_PROMPT = """\
You are the ai-crawler discovery agent for MedServicePrice.kz, driving a real browser.

Goal: on an unknown public medical website, find the pages that list real medical
services with prices (analyses, doctor visits, diagnostics, procedures), and record:
- every productive price URL (record_data_url),
- the interaction steps needed to reveal prices when they are behind a tab/button/city
  selector/"show prices"/"load more" (record_interaction),
- any JSON/XHR endpoint that returns prices (record_network_endpoint).

How to work:
1. snapshot the current page to see text and clickable refs.
2. If prices are hidden behind a control (tab "Прайс", city selector, "Показать цены",
   "Загрузить ещё") — click it (using its ref), then snapshot again and record the
   interaction.
3. Prefer compact high-yield listing/price pages over hundreds of detail pages.
4. Inspect network_requests to catch price APIs the page loads in the background.
5. When you have recorded the productive URLs (or none are reachable), call finish.

Only collect price rows — ignore auth/cart/news/promo/contacts pages. Be efficient;
you have a limited number of steps. Always act via tool calls."""


async def _chat(client: httpx.AsyncClient, messages: list[dict]) -> dict:
    url = LLM_BASE_URL.rstrip("/") + "/chat/completions"
    resp = await client.post(url, headers={"Authorization": f"Bearer {LLM_API_KEY}"},
                             json={"model": LLM_MODEL, "messages": messages,
                                   "tools": TOOLS, "tool_choice": "auto", "temperature": 0})
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]


async def run_agent_loop(start_url: str) -> AgentResult:
    """Drive an LLM+browser agent to build a detailed adapter for start_url."""
    res = AgentResult()
    if not AGENT_LOOP:
        res.status = "disabled"
        log.info("agent loop disabled (set AGENT_LOOP=1 + LLM key to enable)")
        return res
    if not LLM_BASE_URL or not LLM_MODEL:
        res.status = "no-llm-config"
        log.warning("agent loop needs LLM_BASE_URL + LLM_MODEL")
        return res

    domain = urlparse(start_url).netloc
    res.enabled = True
    command = _mcp_command(domain)
    log.info("agent loop started domain=%s model=%s max_steps=%d", domain, LLM_MODEL, AGENT_MAX_STEPS)

    seen_data: set[str] = set()
    try:
        async with _MCPStdioClient(command, timeout_s=MCP_TIMEOUT_S) as mcp, \
                httpx.AsyncClient(timeout=120) as http:
            tools = await mcp.list_tools()
            if "browser_navigate" not in tools:
                res.status = "missing-tool"
                return res
            await mcp.call_tool("browser_navigate", {"url": start_url})

            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"Start at {start_url} (domain {domain}). "
                                             f"Find and record the price pages."},
            ]

            for step in range(AGENT_MAX_STEPS):
                res.steps = step + 1
                msg = await _chat(http, messages)
                messages.append(msg)
                tool_calls = msg.get("tool_calls") or []
                if not tool_calls:
                    res.summary = msg.get("content", "") or res.summary
                    log.info("agent step=%d no tool calls, stopping. content=%s",
                             res.steps, (msg.get("content") or "")[:200])
                    break

                finished = False
                for tc in tool_calls:
                    name = tc["function"]["name"]
                    try:
                        args = json.loads(tc["function"].get("arguments") or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    out = await _exec_tool(mcp, name, args, res, seen_data)
                    res.trace.append({"step": res.steps, "tool": name, "args": args,
                                      "result": out[:160]})
                    log.info("agent step=%d tool=%s args=%s -> %s",
                             res.steps, name, json.dumps(args, ensure_ascii=False)[:160], out[:160])
                    messages.append({"role": "tool", "tool_call_id": tc["id"], "content": out})
                    if name == "finish":
                        res.summary = args.get("summary", "")
                        res.structures = list(dict.fromkeys(res.structures + (args.get("structures") or [])))
                        finished = True
                if finished:
                    break

            res.status = "ok"
            log.info("agent loop finished domain=%s steps=%d data_urls=%d interactions=%d endpoints=%d",
                     domain, res.steps, len(res.data_urls), len(res.interactions),
                     len(res.network_endpoints))
            return res
    except FileNotFoundError as e:
        res.status = "mcp-unavailable"
        log.warning("agent loop: MCP command not found: %s", e)
    except Exception as e:  # noqa: BLE001
        res.status = "failed"
        log.warning("agent loop failed domain=%s err=%s", domain, str(e)[:300])
    return res


async def _exec_tool(mcp, name: str, args: dict, res: AgentResult, seen_data: set) -> str:
    """Execute one tool call; return a short string fed back to the LLM."""
    try:
        if name == "navigate":
            await mcp.call_tool("browser_navigate", {"url": args["url"]})
            return f"navigated to {args['url']}"
        if name == "click":
            await mcp.call_tool("browser_click", {"element": args.get("element", ""),
                                                  "ref": args["ref"]})
            return f"clicked {args.get('element', args.get('ref'))}"
        if name == "snapshot":
            txt = _content_text(await mcp.call_tool("browser_snapshot", {}))
            return txt[:AGENT_SNAPSHOT_CHARS]
        if name == "network_requests":
            txt = _content_text(await mcp.call_tool("browser_network_requests", {}))
            return txt[:AGENT_SNAPSHOT_CHARS]
        if name == "record_data_url":
            url = args["url"]
            if url not in seen_data:
                seen_data.add(url)
                res.data_urls.append(url)
                if args.get("structure"):
                    res.structures = list(dict.fromkeys(res.structures + [args["structure"]]))
            return f"recorded data url ({len(res.data_urls)} total)"
        if name == "record_interaction":
            res.interactions.append({k: args.get(k) for k in ("on_url", "action", "target", "note")})
            return "interaction recorded"
        if name == "record_network_endpoint":
            res.network_endpoints.append({k: args.get(k) for k in ("url", "method", "note")})
            return "endpoint recorded"
        if name == "finish":
            return "finishing"
        return f"unknown tool {name}"
    except Exception as e:  # noqa: BLE001
        return f"tool {name} error: {str(e)[:200]}"
