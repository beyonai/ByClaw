from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any

from groksearchcli.errors import EXIT_TIMEOUT, GrokSearchCliError


class XaiSearchClient:
    """Thin adapter around the official xAI Python SDK Chat API."""

    def __init__(self, *, event_callback=None, sdk_client: Any | None = None) -> None:
        self.api_key = os.environ.get("XAI_API_KEY", "").strip()
        if not self.api_key:
            raise GrokSearchCliError("MISSING_CREDENTIAL", "XAI_API_KEY is not configured")
        if sdk_client is None:
            try:
                from xai_sdk import Client  # noqa: PLC0415
            except ImportError as exc:
                raise GrokSearchCliError(
                    "INTERNAL_ERROR", "xai-sdk is not installed", retryable=False
                ) from exc
            self._sdk_client_class = Client
        else:
            self._sdk_client_class = None
        self.sdk_client = sdk_client
        self.event_callback = event_callback

    def search(self, request: dict, *, timeout_seconds: float) -> dict:
        """Execute the same Chat API flow as the official xAI examples."""
        try:
            from xai_sdk.chat import system, user  # noqa: PLC0415
            from xai_sdk.tools import web_search, x_search  # noqa: PLC0415

            sdk = self.sdk_client or self._sdk_client_class(
                api_key=self.api_key,
                timeout=timeout_seconds,
            )
            tools = [self._make_tool(tool, web_search=web_search, x_search=x_search)
                     for tool in request.get("tools", [])]
            chat = sdk.chat.create(
                model=request.get("model", "grok-4.6"),
                tools=tools,
                include=["verbose_streaming", "inline_citations"],
            )
            if request.get("instructions"):
                chat.append(system(request["instructions"]))
            chat.append(user(request.get("input", "")))

            self._emit({"type": "response.created"})
            response = None
            is_thinking = True
            for response, chunk in chat.stream():
                for tool_call in getattr(chunk, "tool_calls", []) or []:
                    function = getattr(tool_call, "function", None)
                    name = getattr(function, "name", "search")
                    raw_arguments = getattr(function, "arguments", "{}")
                    try:
                        arguments = json.loads(raw_arguments) if isinstance(raw_arguments, str) else raw_arguments
                    except (TypeError, ValueError):
                        arguments = {"raw": raw_arguments}
                    self._emit({
                        "type": "response.output_item.added",
                        "item": {
                            "type": "x_search_call" if name == "x_search" else "web_search_call",
                            "tool_name": name,
                            "action": arguments,
                        },
                    })
                content = getattr(chunk, "content", "") or ""
                usage = getattr(response, "usage", None)
                reasoning_tokens = getattr(usage, "reasoning_tokens", None)
                if is_thinking and reasoning_tokens and not content:
                    self._emit({
                        "type": "response.reasoning_summary_text.delta",
                        "usage": {"reasoning_tokens": reasoning_tokens},
                    })
                if content:
                    is_thinking = False
                    self._emit({"type": "response.output_text.delta", "text": content})

            if response is None:
                raise GrokSearchCliError("PROTOCOL_ERROR", "xAI SDK returned no response")
            result = self._response_dict(response, request)
            self._emit({"type": "response.completed"})
            return result
        except GrokSearchCliError:
            raise
        except Exception as exc:
            raise self._transport_error(exc) from exc

    def _emit(self, event: dict) -> None:
        if self.event_callback:
            self.event_callback(event)

    @staticmethod
    def _make_tool(tool: dict, *, web_search, x_search):
        kind = tool.get("type")
        if kind == "web_search":
            filters = tool.get("filters", {})
            return web_search(
                allowed_domains=filters.get("allowed_domains"),
                excluded_domains=filters.get("excluded_domains"),
                enable_image_understanding=tool.get("enable_image_understanding", False),
                enable_image_search=tool.get("enable_image_search", False),
            )
        if kind == "x_search":
            parse_date = lambda value: datetime.fromisoformat(value) if value else None
            return x_search(
                allowed_x_handles=tool.get("allowed_x_handles"),
                excluded_x_handles=tool.get("excluded_x_handles"),
                from_date=parse_date(tool.get("from_date")),
                to_date=parse_date(tool.get("to_date")),
                enable_image_understanding=tool.get("enable_image_understanding", False),
                enable_video_understanding=tool.get("enable_video_understanding", False),
            )
        raise GrokSearchCliError("INVALID_ARGUMENT", f"unsupported tool: {kind}", exit_code=2)

    @staticmethod
    def _response_dict(response: Any, request: dict) -> dict:
        usage_obj = getattr(response, "usage", None)
        usage = {
            field: value for field in ("prompt_tokens", "completion_tokens", "total_tokens", "reasoning_tokens")
            if (value := getattr(usage_obj, field, None)) is not None
        }
        server_usage = getattr(response, "server_side_tool_usage", {}) or {}
        output = []
        for tool_call in getattr(response, "tool_calls", []) or []:
            name = getattr(getattr(tool_call, "function", None), "name", "")
            output.append({"type": "x_search_call" if name == "x_search" else "web_search_call"})
        output.append({"type": "message", "content": [{
            "type": "output_text", "text": getattr(response, "content", "") or "",
        }]})
        usage["num_server_side_tools_used"] = sum(server_usage.values()) if isinstance(server_usage, dict) else 0
        return {
            "id": getattr(response, "id", None),
            "model": request.get("model"),
            "status": "completed",
            "output": output,
            "citations": list(getattr(response, "citations", []) or []),
            "usage": usage,
        }

    @staticmethod
    def _transport_error(exc: Exception) -> GrokSearchCliError:
        if isinstance(exc, TimeoutError) or "Timeout" in exc.__class__.__name__:
            return GrokSearchCliError(
                "REQUEST_TIMEOUT", "xAI request timed out", exit_code=EXIT_TIMEOUT, retryable=True
            )
        return GrokSearchCliError("SERVICE_UNAVAILABLE", "xAI service is unavailable", retryable=True)
