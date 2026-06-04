"""Shared httpx AsyncClient for upstream KB / Connector calls.

The client is created once per process (in the FastAPI lifespan) and
shared by every dispatcher / proxy. It:

  * injects ``X-Trace-Id`` from the request context (unless the caller
    set it explicitly)
  * retries once on transient errors for idempotent reads (GET/HEAD)
  * passes ``stream(...)`` through unchanged for streaming uploads/
    downloads (used by S2/S3)
"""

from __future__ import annotations

import httpx
from kgw.observability.logger import get_logger
from kgw.observability.tracing import TRACE_HEADER, current_trace_id

_log = get_logger(__name__)

_RETRYABLE_EXC = (httpx.ConnectError, httpx.ReadError, httpx.WriteError)


class _KgwClient(httpx.AsyncClient):
    """httpx AsyncClient subclass that wires trace-id injection + retry."""

    async def send(  # type: ignore[override]
        self,
        request: httpx.Request,
        *,
        stream: bool = False,
        auth: httpx._types.AuthTypes
        | httpx._client.UseClientDefault = httpx.USE_CLIENT_DEFAULT,  # pylint: disable=protected-access
        follow_redirects: bool
        | httpx._client.UseClientDefault = httpx.USE_CLIENT_DEFAULT,  # pylint: disable=protected-access
    ) -> httpx.Response:
        if TRACE_HEADER not in request.headers:
            tid = current_trace_id()
            if tid:
                request.headers[TRACE_HEADER] = tid

        is_idempotent = request.method.upper() in {"GET", "HEAD"}
        max_attempts = 2 if is_idempotent else 1
        last_exc: Exception | None = None
        for attempt in range(1, max_attempts + 1):
            try:
                return await super().send(
                    request,
                    stream=stream,
                    auth=auth,
                    follow_redirects=follow_redirects,
                )
            except _RETRYABLE_EXC as exc:
                last_exc = exc
                if attempt >= max_attempts:
                    break
                _log.warning(
                    "http.retry",
                    method=request.method,
                    url=str(request.url),
                    attempt=attempt,
                    error=str(exc),
                )
        assert last_exc is not None
        raise last_exc


def build_http_client(
    *,
    timeout_seconds: float,
    max_connections: int,
    max_keepalive: int,
) -> _KgwClient:
    """Construct the shared httpx client. Caller is responsible for closing."""
    limits = httpx.Limits(
        max_connections=max_connections,
        max_keepalive_connections=max_keepalive,
    )
    return _KgwClient(timeout=timeout_seconds, limits=limits)
