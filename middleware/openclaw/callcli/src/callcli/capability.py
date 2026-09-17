from __future__ import annotations

import json
from urllib.parse import urljoin

from callcli.contracts import SUPPORTED_TYPES
from callcli.errors import CallCliError, EXIT_RESOURCE


def _dict(value) -> dict:
    return value if isinstance(value, dict) else {}


def _headers(value) -> dict[str, str]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            value = {}
    return {str(k): str(v) for k, v in _dict(value).items() if v is not None}


def _absolute(base: str, value: str) -> str:
    if value.startswith(("http://", "https://")):
        return value.rstrip("/")
    return urljoin(base.rstrip("/") + "/", value.lstrip("/")) if base else value


def _media(content: object, preferred: tuple[str, ...]) -> tuple[str, dict]:
    media_types = _dict(content)
    for content_type in preferred:
        if content_type in media_types:
            return content_type, _dict(_dict(media_types[content_type]).get("schema"))
    for content_type, definition in media_types.items():
        if isinstance(definition, dict):
            return str(content_type), _dict(definition.get("schema"))
    return "", {}


def _response_schema(operation: dict) -> dict:
    responses = _dict(operation.get("responses"))
    response = _dict(responses.get("200"))
    if not response:
        response = next((_dict(value) for status, value in responses.items()
                         if str(status).startswith("2") and isinstance(value, dict)), {})
    if not response:
        response = _dict(responses.get("default"))
    _, schema = _media(response.get("content"), ("application/json",))
    return schema


def _openapi_actions(raw: dict, base: str) -> list[dict]:
    actions: list[dict] = []
    for machine in raw.get("pluginMachineInfo") or []:
        spec = _dict(_dict(machine).get("pluginMachineOpenAPI"))
        spec_base = base
        servers = spec.get("servers") if isinstance(spec.get("servers"), list) else []
        if servers and isinstance(servers[0], dict) and servers[0].get("url"):
            spec_base = str(servers[0]["url"])
        for route, path_item in _dict(spec.get("paths")).items():
            for method, operation in _dict(path_item).items():
                if method.lower() not in {"get", "post", "put", "patch", "delete"} or not isinstance(operation, dict):
                    continue
                content = _dict(_dict(operation.get("requestBody")).get("content"))
                content_type, schema = _media(content, (
                    "application/json", "application/x-www-form-urlencoded", "multipart/form-data",
                ))
                actions.append({
                    "name": str(operation.get("operationId") or f"{method}_{route}"),
                    "description": str(operation.get("description") or operation.get("summary") or ""),
                    "url": _absolute(spec_base, str(route)), "method": method.upper(),
                    "headers": {}, "inputSchema": schema,
                    "outputSchema": _response_schema(operation),
                    "requestContentType": content_type,
                    "multipart": content_type == "multipart/form-data",
                })
    return actions


def _service_actions(raw: dict, base: str) -> list[dict]:
    out = []
    for service in raw.get("resourceService") or []:
        if not isinstance(service, dict):
            continue
        properties = {}
        required = []
        for param in service.get("bodyParams") or []:
            if not isinstance(param, dict) or not param.get("name"):
                continue
            name = str(param["name"])
            properties[name] = {"type": str(param.get("type") or "string"),
                                "description": str(param.get("description") or "")}
            if param.get("required"):
                required.append(name)
        out.append({"name": str(service.get("serviceCode") or service.get("serviceName") or ""),
                    "description": str(service.get("serviceDesc") or ""),
                    "url": _absolute(base, str(service.get("path") or "")),
                    "method": str(service.get("method") or "POST").upper(),
                    "headers": {str(x.get("name")): str(x.get("value")) for x in service.get("headers") or []
                                if isinstance(x, dict) and x.get("name") and x.get("value") is not None},
                    "inputSchema": {"type": "object", "properties": properties, "required": required}})
    return out


def build_capability(raw: dict, resource_id: str, resource_type: str) -> dict:
    expected = resource_type.upper()
    if expected not in SUPPORTED_TYPES:
        raise CallCliError("UNSUPPORTED_RESOURCE_TYPE", f"unsupported resource type: {expected}",
                           exit_code=EXIT_RESOURCE)
    actual = str(raw.get("resourceBizType") or raw.get("type") or expected).upper()
    if actual != expected:
        raise CallCliError("RESOURCE_TYPE_MISMATCH", f"resource type mismatch: expected {expected}, actual {actual}",
                           exit_code=EXIT_RESOURCE)
    actual_id = str(raw.get("resourceId") or raw.get("metadata", {}).get("resource_id") or resource_id)
    if actual_id != str(resource_id):
        raise CallCliError("RESOURCE_ID_MISMATCH", "capability resource id does not match request",
                           exit_code=EXIT_RESOURCE)
    base = str(raw.get("domainURL") or raw.get("domainUrl") or "")
    meta = _dict(raw.get("metaContent"))
    cap = {"id": actual_id, "type": actual, "name": str(raw.get("resourceName") or raw.get("name") or actual_id),
           "description": str(raw.get("resourceDesc") or raw.get("description") or ""),
           "headers": _headers(raw.get("headers") or _dict(raw.get("metadata")).get("default_headers")),
           "implType": str(raw.get("implType") or _dict(raw.get("metadata")).get("impl_type") or ""),
           "integrationType": str(raw.get("integrationType") or "")}
    if actual == "TOOLKIT":
        cap["actions"] = _openapi_actions(raw, base) or _service_actions(raw, base) or list(raw.get("actions") or raw.get("tools") or [])
    elif actual == "TOOL":
        tool = _dict(raw.get("tool"))
        cap.update({"url": _absolute(base, str(tool.get("url") or raw.get("url") or "")),
                    "method": str(tool.get("method") or raw.get("method") or "POST").upper(),
                    "inputSchema": tool.get("input_schema") or raw.get("inputSchema") or raw.get("input_schema") or {}})
    elif actual == "MCP":
        mcp = _dict(raw.get("mcp"))
        url = (mcp.get("server_url") or raw.get("agentSseUrl") or raw.get("mcpServerUrl")
               or meta.get("agentSseUrl") or meta.get("mcpServerUrl") or "")
        cap.update({"serverUrl": _absolute(base, str(url)),
                    "transferType": str(mcp.get("transfer_type") or raw.get("mcpTransferType")
                                        or meta.get("mcpType") or "streamable_http"),
                    "tools": mcp.get("tools") or raw.get("tools") or []})
    else:
        agent = _dict(raw.get("agent"))
        cap.update({"sseUrl": _absolute(base, str(agent.get("sse_url") or raw.get("agentSseUrl") or meta.get("agentSseUrl") or "")),
                    "homeUrl": _absolute(base, str(agent.get("agent_home_url") or raw.get("agentHomeUrl") or "")),
                    "integrationType": str(agent.get("integration_type") or raw.get("integrationType") or ""),
                    "implType": str(raw.get("implType") or _dict(raw.get("metadata")).get("impl_type") or "")})
    return cap
