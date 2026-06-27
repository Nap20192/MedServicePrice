"""Optional Playwright MCP exploration for adapter generation.

This module is intentionally adapter-facing: it does not fetch rows for output.
It asks Playwright MCP to inspect hard browser pages and returns evidence the
adapter can persist as an MCP strategy.
"""
from __future__ import annotations

import asyncio
import json
import re
from dataclasses import asdict, dataclass, field
from urllib.parse import urlparse

from crawler.config import (MCP_ALLOWED_HOSTS, MCP_ALLOWED_ORIGINS, MCP_BLOCK_SERVICE_WORKERS,
                            MCP_BLOCKED_ORIGINS, MCP_BROWSER, MCP_CAPS, MCP_CODEGEN,
                            MCP_COMMAND, MCP_CONSOLE_LEVEL, MCP_ENABLED, MCP_HEADLESS,
                            MCP_IGNORE_HTTPS_ERRORS, MCP_IMAGE_RESPONSES, MCP_INIT_PAGE,
                            MCP_INIT_SCRIPT, MCP_ISOLATED, MCP_NO_SANDBOX, MCP_OUTPUT_DIR,
                            MCP_OUTPUT_MODE, MCP_PROXY_BYPASS, MCP_PROXY_SERVER,
                            MCP_SAVE_SESSION, MCP_SECRETS_FILE, MCP_SHARED_BROWSER_CONTEXT,
                            MCP_SNAPSHOT_MODE, MCP_STORAGE_STATE, MCP_TIMEOUT_ACTION_MS,
                            MCP_TIMEOUT_NAVIGATION_MS, MCP_TIMEOUT_S,
                            MCP_USER_AGENT, MCP_USER_DATA_DIR, MCP_VIEWPORT_SIZE, get_logger)

log = get_logger(__name__)


@dataclass
class MCPStrategy:
    enabled: bool = False
    status: str = "disabled"
    reason: str = ""
    command: list[str] = field(default_factory=list)
    tools: list[str] = field(default_factory=list)
    network_candidates: list[str] = field(default_factory=list)
    suggested_page_urls: list[str] = field(default_factory=list)
    snapshot_chars: int = 0
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


class _MCPStdioClient:
    def __init__(self, command: list[str], *, timeout_s: float):
        self.command = command
        self.timeout_s = timeout_s
        self.proc: asyncio.subprocess.Process | None = None
        self._next_id = 1

    async def __aenter__(self) -> "_MCPStdioClient":
        self.proc = await asyncio.create_subprocess_exec(
            *self.command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await self.request("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "ai-crawler", "version": "0.1"},
        })
        await self.notify("notifications/initialized", {})
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        if self.proc is None:
            return
        try:
            await self.notify("notifications/cancelled", {"reason": "client-close"})
        except Exception:  # noqa: BLE001
            pass
        if self.proc.returncode is None:
            self.proc.terminate()
            try:
                await asyncio.wait_for(self.proc.wait(), timeout=3)
            except asyncio.TimeoutError:
                self.proc.kill()

    async def notify(self, method: str, params: dict) -> None:
        await self._write({"jsonrpc": "2.0", "method": method, "params": params})

    async def request(self, method: str, params: dict | None = None) -> dict:
        msg_id = self._next_id
        self._next_id += 1
        await self._write({"jsonrpc": "2.0", "id": msg_id, "method": method,
                           "params": params or {}})
        while True:
            msg = await self._read()
            if msg.get("id") != msg_id:
                continue
            if "error" in msg:
                raise RuntimeError(msg["error"])
            return msg.get("result", {})

    async def call_tool(self, name: str, arguments: dict | None = None) -> dict:
        return await self.request("tools/call", {
            "name": name,
            "arguments": arguments or {},
        })

    async def list_tools(self) -> list[str]:
        result = await self.request("tools/list")
        return [tool.get("name", "") for tool in result.get("tools", []) if tool.get("name")]

    async def _write(self, payload: dict) -> None:
        if self.proc is None or self.proc.stdin is None:
            raise RuntimeError("MCP process is not running")
        line = json.dumps(payload, ensure_ascii=False) + "\n"
        self.proc.stdin.write(line.encode("utf-8"))
        await self.proc.stdin.drain()

    async def _read(self) -> dict:
        if self.proc is None or self.proc.stdout is None:
            raise RuntimeError("MCP process is not running")
        raw = await asyncio.wait_for(self.proc.stdout.readline(), timeout=self.timeout_s)
        if not raw:
            stderr = ""
            if self.proc.stderr is not None:
                try:
                    err = await asyncio.wait_for(self.proc.stderr.read(2048), timeout=1)
                    stderr = err.decode("utf-8", errors="replace")
                except Exception:  # noqa: BLE001
                    stderr = ""
            raise RuntimeError(f"MCP server closed stdout stderr={stderr[:500]}")
        return json.loads(raw.decode("utf-8"))


def _mcp_command(domain: str) -> list[str]:
    cmd = list(MCP_COMMAND)
    cmd += ["--browser", MCP_BROWSER]
    if MCP_HEADLESS:
        cmd.append("--headless")
    cmd += ["--output-dir", MCP_OUTPUT_DIR]
    cmd += ["--output-mode", MCP_OUTPUT_MODE]
    cmd += ["--snapshot-mode", MCP_SNAPSHOT_MODE]
    cmd += ["--console-level", MCP_CONSOLE_LEVEL]
    cmd += ["--image-responses", MCP_IMAGE_RESPONSES]
    cmd += ["--codegen", MCP_CODEGEN]
    cmd += ["--viewport-size", MCP_VIEWPORT_SIZE]
    cmd += ["--timeout-action", str(MCP_TIMEOUT_ACTION_MS)]
    cmd += ["--timeout-navigation", str(MCP_TIMEOUT_NAVIGATION_MS)]
    # note: playwright-mcp has no --timeout-expect flag; do not pass it.
    if MCP_CAPS:
        cmd += ["--caps", ",".join(MCP_CAPS)]
    if MCP_ALLOWED_HOSTS:
        cmd += ["--allowed-hosts", MCP_ALLOWED_HOSTS]
    allowed = MCP_ALLOWED_ORIGINS or f"https://{domain};http://{domain}"
    cmd += ["--allowed-origins", allowed]
    if MCP_BLOCKED_ORIGINS:
        cmd += ["--blocked-origins", MCP_BLOCKED_ORIGINS]
    if MCP_BLOCK_SERVICE_WORKERS:
        cmd.append("--block-service-workers")
    if MCP_ISOLATED:
        cmd.append("--isolated")
    elif MCP_USER_DATA_DIR:
        cmd += ["--user-data-dir", MCP_USER_DATA_DIR]
    if MCP_SAVE_SESSION:
        cmd.append("--save-session")
    if MCP_SHARED_BROWSER_CONTEXT:
        cmd.append("--shared-browser-context")
    if MCP_STORAGE_STATE:
        cmd += ["--storage-state", MCP_STORAGE_STATE]
    if MCP_IGNORE_HTTPS_ERRORS:
        cmd.append("--ignore-https-errors")
    if MCP_NO_SANDBOX:
        cmd.append("--no-sandbox")
    if MCP_USER_AGENT:
        cmd += ["--user-agent", MCP_USER_AGENT]
    if MCP_PROXY_SERVER:
        cmd += ["--proxy-server", MCP_PROXY_SERVER]
    if MCP_PROXY_BYPASS:
        cmd += ["--proxy-bypass", MCP_PROXY_BYPASS]
    for script in MCP_INIT_SCRIPT:
        cmd += ["--init-script", script]
    for page in MCP_INIT_PAGE:
        cmd += ["--init-page", page]
    if MCP_SECRETS_FILE:
        cmd += ["--secrets", MCP_SECRETS_FILE]
    return cmd


async def explore_with_mcp(start_url: str, *, reason: str) -> MCPStrategy:
    """Run Playwright MCP once and return evidence for the adapter."""
    domain = urlparse(start_url).netloc
    if not MCP_ENABLED:
        return MCPStrategy(enabled=False, status="disabled", reason="MCP_ENABLED=0")

    command = _mcp_command(domain)
    strategy = MCPStrategy(enabled=True, status="started", reason=reason, command=command)
    log.info("mcp exploration started domain=%s reason=%s command=%s",
             domain, reason, " ".join(command))

    try:
        async with _MCPStdioClient(command, timeout_s=MCP_TIMEOUT_S) as client:
            tools = await client.list_tools()
            strategy.tools = tools
            if "browser_navigate" not in tools:
                strategy.status = "missing-tool"
                strategy.notes.append("browser_navigate not exposed by MCP server")
                return strategy

            await client.call_tool("browser_navigate", {"url": start_url})
            if "browser_wait_for" in tools:
                try:
                    await client.call_tool("browser_wait_for", {"time": 2})
                except Exception as e:  # noqa: BLE001
                    strategy.notes.append(f"browser_wait_for skipped: {str(e)[:160]}")
            snapshot_text = ""
            if "browser_snapshot" in tools:
                snapshot_text = _content_text(await client.call_tool("browser_snapshot", {}))
                strategy.snapshot_chars = len(snapshot_text)
            network_text = ""
            if "browser_network_requests" in tools:
                network_text = _content_text(await client.call_tool("browser_network_requests", {}))

            found = _extract_urls("\n".join([snapshot_text, network_text]), domain)
            strategy.network_candidates = found["network"]
            strategy.suggested_page_urls = found["pages"]
            strategy.status = "ok"
            strategy.notes.append("MCP exploration completed; persist candidates for adapter review")
            log.info("mcp exploration finished domain=%s snapshot_chars=%d network_candidates=%d page_urls=%d",
                     domain, strategy.snapshot_chars, len(strategy.network_candidates),
                     len(strategy.suggested_page_urls))
            return strategy
    except FileNotFoundError as e:
        strategy.status = "unavailable"
        strategy.notes.append(f"MCP command not found: {e}")
    except Exception as e:  # noqa: BLE001
        strategy.status = "failed"
        strategy.notes.append(str(e)[:500])
    log.warning("mcp exploration failed domain=%s status=%s notes=%s",
                domain, strategy.status, strategy.notes[:2])
    return strategy


def _content_text(result: dict) -> str:
    chunks = []
    for item in result.get("content", []) or []:
        if isinstance(item, dict):
            chunks.append(str(item.get("text") or item.get("data") or ""))
    return "\n".join(chunks)


def _extract_urls(text: str, domain: str) -> dict[str, list[str]]:
    urls = set(re.findall(r"https?://[^\s\"'<>]+", text))
    network, pages = set(), set()
    for url in urls:
        clean = url.rstrip("),.;]")
        parsed = urlparse(clean)
        if parsed.netloc and parsed.netloc != domain:
            continue
        low = clean.lower()
        if any(token in low for token in ("api", "graphql", "json", "clinic", "doctor",
                                          "service", "price", "search")):
            network.add(clean)
        elif parsed.path and parsed.path != "/":
            pages.add(clean)
    return {
        "network": sorted(network)[:100],
        "pages": sorted(pages)[:100],
    }
