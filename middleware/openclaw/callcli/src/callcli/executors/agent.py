from __future__ import annotations

import uuid

import httpx

from callcli.credentials import runtime_headers
from callcli.errors import CallCliError, EXIT_RESOURCE
from callcli.executors.common import ensure_http_success, map_http_error
from callcli.sse import iter_sse, openai_delta


def _a2a_text(payload: object) -> str:
    if not isinstance(payload, dict):
        return ""
    if payload.get("error"):
        raise CallCliError("A2A_AGENT_ERROR", str(payload["error"]))
    result = payload.get("result") if isinstance(payload.get("result"), dict) else {}
    kind = str(result.get("kind") or "").lower()
    if kind == "artifact-update":
        result = result.get("artifact") if isinstance(result.get("artifact"), dict) else {}
    elif kind in {"task", "status-update"}:
        status = result.get("status") if isinstance(result.get("status"), dict) else {}
        result = status.get("message") if isinstance(status.get("message"), dict) else {}
    parts = result.get("parts") if isinstance(result.get("parts"), list) else []
    return "".join(str(x.get("text") or "") for x in parts
                   if isinstance(x, dict) and str(x.get("kind") or "").lower() == "text")


class AgentExecutor:
    def __init__(self, client: httpx.AsyncClient, event_sink=None) -> None:
        self.client = client
        self.event_sink = event_sink

    async def _emit(self, event: dict) -> None:
        if self.event_sink is not None:
            value = self.event_sink(event)
            if hasattr(value, "__await__"):
                await value

    async def execute(self, capability: dict, query: str, arguments: dict, context: dict):
        if capability.get("implType") == "ASK_PERSONAL":
            raise CallCliError("UNSUPPORTED_LOCAL_AGENT", "ASK_PERSONAL is not supported by callcli v1",
                               exit_code=EXIT_RESOURCE)
        if capability.get("integrationType") == "PAGE":
            raise CallCliError("UNSUPPORTED_INTERACTIVE_AGENT", "PAGE agent is not supported by callcli v1",
                               exit_code=EXIT_RESOURCE)
        if not query.strip():
            raise CallCliError("INVALID_ARGUMENT", "query is required for AGENT", exit_code=2)
        url = str(capability.get("sseUrl") or "")
        if not url:
            raise CallCliError("AGENT_URL_NOT_FOUND", "agent SSE URL not found")
        headers = runtime_headers(str(context.get("sessionId") or ""), capability.get("headers"))
        headers.update({"Accept": "text/event-stream", "Content-Type": "application/json"})
        await self._emit({"event": "start", "target": {"resourceId": capability["id"], "resourceType": "AGENT"}})
        try:
            if capability.get("integrationType") == "A2A":
                card = await self.client.get(url, headers=headers)
                ensure_http_success(card, "AGENT")
                rpc_url = str(card.json().get("url") or "")
                if not rpc_url:
                    raise CallCliError("AGENT_URL_NOT_FOUND", "A2A card has no RPC URL")
                payload = {"jsonrpc": "2.0", "id": str(uuid.uuid4()), "method": "message/stream",
                           "params": {"message": {"messageId": str(uuid.uuid4()), "role": "user",
                                                   "parts": [{"kind": "text", "text": query}],
                                                   "contextId": str(uuid.uuid4()), "kind": "message"}}}
                post_url = rpc_url
                extractor = _a2a_text
            else:
                payload = {"chatContent": query, "sessionId": str(context.get("sessionId") or ""),
                           "chatId": str(context.get("traceId") or uuid.uuid4()),
                           "agentId": capability["id"], "stream": True, "redList": [], "blackList": [],
                           "deepThink": bool(arguments.get("deep_think", False)),
                           "extParam": arguments.get("ext_param", {}), "language": "zh-CN",
                           "histories": arguments.get("histories", []), "versionType": 1}
                post_url = url
                extractor = openai_delta
            pieces = []
            async with self.client.stream("POST", post_url, json=payload, headers=headers) as response:
                ensure_http_success(response, "AGENT")
                async for _, item in iter_sse(response):
                    text = extractor(item)
                    if text:
                        pieces.append(text)
                        await self._emit({"event": "delta", "data": {"text": text}})
            result = {"text": "".join(pieces)}
            await self._emit({"event": "complete", "data": result})
            return result
        except CallCliError:
            raise
        except Exception as exc:
            raise map_http_error(exc, "AGENT") from exc
