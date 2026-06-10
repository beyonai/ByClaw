"""Access-log middleware: logs request and response as separate events.

Outputs two log lines per request::

    access.request  method=POST path=/kgw/api/v1/listDir request_body={...}
    access.response method=POST path=/kgw/api/v1/listDir status=200 latency_ms=45 response_body={...}

Uses a pure ASGI middleware so response body is reliably captured.
Skips health/metrics endpoints and body logging for multipart / streaming.
"""

from __future__ import annotations

import time

from kgw.observability.logger import get_logger
from starlette.types import ASGIApp, Message, Receive, Scope, Send

_log = get_logger(__name__)

_SKIP_PREFIXES = ("/healthz", "/metrics")
_MAX_BODY_LOG_CHARS = 2048


def _truncate(value: str) -> str:
    return (
        value
        if len(value) <= _MAX_BODY_LOG_CHARS
        else value[:_MAX_BODY_LOG_CHARS] + "..."
    )


class AccessLogMiddleware:
    """Pure ASGI middleware — two separate log events per HTTP request."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        if path.startswith(_SKIP_PREFIXES):
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "")
        query = scope.get("query_string", b"").decode("utf-8", errors="replace")
        content_type = ""
        for k, v in scope.get("headers", []):
            if k == b"content-type":
                content_type = v.decode("utf-8", errors="replace")
                break

        skip_body = "multipart" in content_type

        # For GET/HEAD: log request immediately (no body).
        if method in ("GET", "HEAD", "OPTIONS", "DELETE"):
            _log.info("access.request", method=method, path=path, query=query)

        # Collect request body and log when complete.
        req_body_chunks: list[bytes] = []
        req_logged = False

        async def receive_wrapper() -> Message:
            nonlocal req_logged
            message = await receive()
            if message.get("type") != "http.request":
                return message
            if not skip_body and method in ("POST", "PUT", "PATCH"):
                body = message.get("body", b"")
                if body:
                    req_body_chunks.append(body)
                if not message.get("more_body", False):
                    if not req_logged:
                        req_body_str = b"".join(req_body_chunks).decode(
                            "utf-8", errors="replace"
                        )
                        _log.info(
                            "access.request",
                            method=method,
                            path=path,
                            query=query,
                            request_body=_truncate(req_body_str),
                        )
                        req_logged = True
            return message

        # Collect response body.
        resp_body_chunks: list[bytes] = []
        resp_status = 0

        async def send_wrapper(message: Message) -> None:
            nonlocal resp_status
            if message.get("type") == "http.response.start":
                resp_status = message.get("status", 0)
            elif message.get("type") == "http.response.body":
                body = message.get("body", b"")
                if body:
                    resp_body_chunks.append(body)
            await send(message)

        started = time.perf_counter()

        await self.app(scope, receive_wrapper, send_wrapper)

        latency_ms = int((time.perf_counter() - started) * 1000)

        resp_body_str = ""
        if resp_body_chunks:
            resp_body_str = b"".join(resp_body_chunks).decode("utf-8", errors="replace")

        _log.info(
            "access.response",
            method=method,
            path=path,
            status=resp_status,
            latency_ms=latency_ms,
            response_body=_truncate(resp_body_str),
        )
