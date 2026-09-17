from __future__ import annotations

from pathlib import Path

import httpx

from callcli.credentials import runtime_headers
from callcli.errors import CallCliError, EXIT_ARGUMENT, EXIT_SCHEMA
from callcli.executors.common import ensure_http_success, map_http_error, response_data, validate_arguments


def _action(capability: dict, name: str) -> dict:
    actions = [item for item in capability.get("actions") or [] if isinstance(item, dict) and item.get("name")]
    if not name:
        raise CallCliError("ACTION_REQUIRED",
                           "TOOLKIT action is required; run `callcli resource describe` first",
                           exit_code=EXIT_SCHEMA,
                           details={"availableActions": [x["name"] for x in actions]})
    selected = next((item for item in actions if item["name"] == name), None)
    if selected is None:
        raise CallCliError("ACTION_NOT_FOUND", f"action not found: {name}", exit_code=EXIT_SCHEMA,
                           details={"availableActions": [x["name"] for x in actions]})
    return selected


class ToolkitExecutor:
    def __init__(self, client: httpx.AsyncClient) -> None:
        self.client = client

    async def execute(self, capability: dict, action: str, arguments: dict, context: dict):
        selected = _action(capability, action)
        validate_arguments(arguments, selected.get("inputSchema"), action)
        headers = runtime_headers(str(context.get("sessionId") or ""),
                                  {**capability.get("headers", {}), **selected.get("headers", {})})
        try:
            if selected.get("multipart"):
                data, files = {}, {}
                properties = selected.get("inputSchema", {}).get("properties", {})
                for key, value in arguments.items():
                    prop = properties.get(key, {}) if isinstance(properties, dict) else {}
                    if prop.get("format") == "binary":
                        path = Path(str(value))
                        if not path.is_absolute() or not path.is_file():
                            raise CallCliError("INVALID_FILE", f"binary input must be a readable absolute file: {key}",
                                               exit_code=EXIT_ARGUMENT)
                        files[key] = (path.name, path.read_bytes())
                    else:
                        data[key] = value if isinstance(value, str) else __import__("json").dumps(value)
                response = await self.client.request(selected.get("method", "POST"), selected["url"],
                                                     data=data, files=files, headers=headers)
            elif selected.get("requestContentType") == "application/x-www-form-urlencoded":
                response = await self.client.request(selected.get("method", "POST"), selected["url"],
                                                     data=arguments, headers=headers)
            else:
                response = await self.client.request(selected.get("method", "POST"), selected["url"],
                                                     json=arguments, headers=headers)
        except CallCliError:
            raise
        except Exception as exc:
            raise map_http_error(exc, "TOOLKIT") from exc
        ensure_http_success(response, "TOOLKIT")
        return response_data(response)
