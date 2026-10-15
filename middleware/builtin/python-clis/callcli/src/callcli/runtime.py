from __future__ import annotations

import time

from callcli.capability import build_capability


class ExecutorRouter:
    def __init__(self, tool, toolkit, mcp, agent) -> None:
        self.executors = {"TOOL": tool, "TOOLKIT": toolkit, "MCP": mcp, "AGENT": agent}

    async def execute(self, capability: dict, *, action: str = "", query: str = "",
                      arguments: dict | None = None, context: dict | None = None):
        arguments, context = arguments or {}, context or {}
        kind = capability["type"]
        if kind == "TOOL":
            return await self.executors[kind].execute(capability, arguments, context)
        if kind in {"TOOLKIT", "MCP"}:
            return await self.executors[kind].execute(capability, action, arguments, context)
        return await self.executors[kind].execute(capability, query, arguments, context)

    async def describe(self, capability: dict, context: dict | None = None):
        if capability["type"] != "MCP":
            return None
        return await self.executors["MCP"].discover(capability, context or {})


class CapabilityRuntime:
    def __init__(self, catalog, provider, executor) -> None:
        self.catalog = catalog
        self.provider = provider
        self.executor = executor

    async def describe(self, session_id: str, resource_id: str, resource_type: str) -> dict:
        await self.catalog.find_authorized(session_id, resource_id, resource_type)
        raw = await self.provider.resolve(resource_id, resource_type)
        capability = build_capability(raw, resource_id, resource_type)
        if capability["type"] == "MCP":
            capability["tools"] = await self.executor.describe(
                capability, {"sessionId": session_id}
            )
        return capability

    async def invoke(self, session_id: str, resource_id: str, resource_type: str, *,
                     action: str = "", query: str = "", arguments: dict | None = None,
                     trace_id: str = "") -> dict:
        started = time.monotonic()
        await self.catalog.find_authorized(session_id, resource_id, resource_type)
        raw = await self.provider.resolve(resource_id, resource_type)
        capability = build_capability(raw, resource_id, resource_type)
        data = await self.executor.execute(capability, action=action, query=query,
                                           arguments=arguments or {},
                                           context={"sessionId": session_id, "traceId": trace_id})
        return {"ok": True, "operation": "capability.invoke", "data": data,
                "target": {"resourceId": str(resource_id), "resourceType": resource_type.upper(),
                           **({"action": action} if action else {})},
                "meta": {"durationMs": round((time.monotonic() - started) * 1000)}}
