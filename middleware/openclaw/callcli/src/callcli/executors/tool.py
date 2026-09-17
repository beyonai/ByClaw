from __future__ import annotations

import httpx

from callcli.credentials import runtime_headers
from callcli.errors import CallCliError
from callcli.executors.common import ensure_http_success, map_http_error, response_data, validate_arguments


class ToolExecutor:
    def __init__(self, client: httpx.AsyncClient) -> None:
        self.client = client

    async def execute(self, capability: dict, arguments: dict, context: dict):
        validate_arguments(arguments, capability.get("inputSchema"), capability.get("name", "tool"))
        url = str(capability.get("url") or "")
        if not url:
            raise CallCliError("TOOL_URL_NOT_FOUND", "tool URL not found")
        headers = runtime_headers(str(context.get("sessionId") or ""), capability.get("headers"))
        try:
            response = await self.client.request(str(capability.get("method") or "POST"), url,
                                                 json=arguments, headers=headers)
        except Exception as exc:
            raise map_http_error(exc, "TOOL") from exc
        ensure_http_success(response, "TOOL")
        return response_data(response)

