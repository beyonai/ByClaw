from __future__ import annotations

import asyncio
from urllib.parse import urljoin

import httpx

from callcli.credentials import runtime_headers
from callcli.errors import CallCliError, EXIT_SCHEMA
from callcli.executors.common import ensure_http_success, map_http_error, validate_arguments
from callcli.sse import iter_sse


def _rpc_result(payload: object, code: str):
    if not isinstance(payload, dict):
        raise CallCliError(code, "MCP returned an invalid JSON-RPC payload")
    if payload.get("error") is not None:
        raise CallCliError(code, f"MCP JSON-RPC error: {payload['error']}")
    return payload.get("result")


class McpExecutor:
    def __init__(self, client: httpx.AsyncClient) -> None:
        self.client = client

    async def _post(self, url: str, payload: dict, headers: dict) -> tuple[httpx.Response, object | None]:
        response = await self.client.post(url, json=payload, headers=headers)
        ensure_http_success(response, "MCP")
        if response.status_code == 202 or not response.content:
            return response, None
        content_type = response.headers.get("content-type", "")
        if "text/event-stream" in content_type:
            async for _, item in iter_sse(response):
                if isinstance(item, dict) and ("result" in item or "error" in item):
                    return response, item
            return response, None
        try:
            return response, response.json()
        except ValueError as exc:
            raise CallCliError("MCP_PROTOCOL_ERROR", "MCP returned non-JSON data") from exc

    async def _streamable_discover(self, capability: dict, context: dict) -> tuple[dict, list[dict]]:
        url = capability.get("serverUrl")
        headers = runtime_headers(str(context.get("sessionId") or ""), capability.get("headers"))
        headers.update({"Accept": "application/json, text/event-stream", "Content-Type": "application/json"})
        init_payload = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2024-11-05", "capabilities": {},
            "clientInfo": {"name": "byclaw-callcli", "version": "0.1.0"}}}
        response, init = await self._post(url, init_payload, headers)
        _rpc_result(init, "MCP_DISCOVERY_FAILED")
        session_id = response.headers.get("mcp-session-id")
        if session_id:
            headers["Mcp-Session-Id"] = session_id
        await self._post(url, {"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}}, headers)
        _, listed = await self._post(url, {"jsonrpc": "2.0", "id": 2,
                                           "method": "tools/list", "params": {}}, headers)
        tools = (_rpc_result(listed, "MCP_DISCOVERY_FAILED") or {}).get("tools", [])
        return headers, [item for item in tools if isinstance(item, dict)]

    async def discover(self, capability: dict, context: dict) -> list[dict]:
        if not capability.get("serverUrl"):
            raise CallCliError("MCP_SERVER_NOT_FOUND", "MCP server URL not found")
        transfer = str(capability.get("transferType") or "streamable_http").lower().replace("-", "_")
        if transfer == "sse":
            return await self._legacy_sse(capability, "", {}, context, discover_only=True)
        try:
            _, tools = await self._streamable_discover(capability, context)
            return tools
        except CallCliError as exc:
            if not isinstance(exc.details, dict) or exc.details.get("status") != 405:
                raise
            return await self._legacy_sse(capability, "", {}, context, discover_only=True)

    async def _streamable(self, capability: dict, action: str, arguments: dict,
                          context: dict):
        url = capability.get("serverUrl")
        headers, tools = await self._streamable_discover(capability, context)
        selected = next((item for item in tools if isinstance(item, dict) and item.get("name") == action), None)
        if selected is None:
            names = [item.get("name") for item in tools if isinstance(item, dict)]
            code = "ACTION_REQUIRED" if not action else "ACTION_NOT_FOUND"
            raise CallCliError(
                code,
                "MCP action is required; run `callcli resource describe` first"
                if code == "ACTION_REQUIRED" else f"MCP action not found: {action}",
                exit_code=EXIT_SCHEMA,
                details={"availableActions": names},
            )
        validate_arguments(arguments, selected.get("inputSchema") or selected.get("input_schema"), action)
        _, called = await self._post(url, {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                                          "params": {"name": action, "arguments": arguments}}, headers)
        return _rpc_result(called, "MCP_CALL_FAILED")

    async def _legacy_sse(self, capability: dict, action: str, arguments: dict,
                          context: dict, *, discover_only: bool = False):
        sse_url = str(capability.get("serverUrl") or "")
        headers = runtime_headers(str(context.get("sessionId") or ""), capability.get("headers"))
        headers["Accept"] = "text/event-stream"
        queue: asyncio.Queue[object] = asyncio.Queue()
        endpoint_ready: asyncio.Future[str] = asyncio.get_running_loop().create_future()

        async def reader(response: httpx.Response) -> None:
            async for event, payload in iter_sse(response):
                if event == "endpoint" and isinstance(payload, str) and not endpoint_ready.done():
                    endpoint_ready.set_result(urljoin(sse_url, payload))
                elif isinstance(payload, dict):
                    await queue.put(payload)

        try:
            async with self.client.stream("GET", sse_url, headers=headers) as response:
                ensure_http_success(response, "MCP")
                task = asyncio.create_task(reader(response))
                try:
                    message_url = await asyncio.wait_for(endpoint_ready, timeout=10)

                    async def send(payload: dict, expected_id: int | None):
                        sent = await self.client.post(message_url, json=payload,
                                                      headers={**headers, "Content-Type": "application/json"})
                        ensure_http_success(sent, "MCP")
                        if expected_id is None:
                            return None
                        while True:
                            item = await asyncio.wait_for(queue.get(), timeout=30)
                            if isinstance(item, dict) and str(item.get("id")) == str(expected_id):
                                return item

                    await send({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
                        "protocolVersion": "2024-11-05", "capabilities": {},
                        "clientInfo": {"name": "byclaw-callcli", "version": "0.1.0"}}}, 1)
                    await send({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}}, None)
                    listed = await send({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, 2)
                    tools = (_rpc_result(listed, "MCP_DISCOVERY_FAILED") or {}).get("tools", [])
                    if discover_only:
                        return [item for item in tools if isinstance(item, dict)]
                    names = [x.get("name") for x in tools if isinstance(x, dict)]
                    selected = next((x for x in tools if isinstance(x, dict) and x.get("name") == action), None)
                    if selected is None:
                        raise CallCliError("ACTION_REQUIRED" if not action else "ACTION_NOT_FOUND",
                                           "MCP action is required; run `callcli resource describe` first"
                                           if not action else f"MCP action not found: {action}",
                                           exit_code=EXIT_SCHEMA, details={"availableActions": names})
                    validate_arguments(arguments, selected.get("inputSchema"), action)
                    called = await send({"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                                         "params": {"name": action, "arguments": arguments}}, 3)
                    return _rpc_result(called, "MCP_CALL_FAILED")
                finally:
                    task.cancel()
                    await asyncio.gather(task, return_exceptions=True)
        except CallCliError:
            raise
        except Exception as exc:
            raise map_http_error(exc, "MCP") from exc

    async def execute(self, capability: dict, action: str, arguments: dict, context: dict):
        if not capability.get("serverUrl"):
            raise CallCliError("MCP_SERVER_NOT_FOUND", "MCP server URL not found")
        transfer = str(capability.get("transferType") or "streamable_http").lower().replace("-", "_")
        try:
            if transfer == "sse":
                return await self._legacy_sse(capability, action, arguments, context)
            try:
                return await self._streamable(capability, action, arguments, context)
            except CallCliError as exc:
                if not isinstance(exc.details, dict) or exc.details.get("status") != 405:
                    raise
                return await self._legacy_sse(capability, action, arguments, context)
        except CallCliError:
            raise
        except Exception as exc:
            raise map_http_error(exc, "MCP") from exc
