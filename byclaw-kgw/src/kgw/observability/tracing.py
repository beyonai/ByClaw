"""Trace-ID propagation middleware.

Reads ``X-Trace-Id`` from the inbound request; generates a UUID if
absent. Stores the ID in a ContextVar so log calls and downstream
http clients can pick it up. Echoes the ID on the response.
"""

from __future__ import annotations

import contextvars
import uuid

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

TRACE_HEADER = "X-Trace-Id"

_trace_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "kgw_trace_id", default=None
)


def current_trace_id() -> str | None:
    """Return the current request's trace id, or None outside a request."""
    return _trace_id_var.get()


class TraceIdMiddleware(BaseHTTPMiddleware):
    """Inject/forward the trace id and bind it into the structlog context."""

    async def dispatch(self, request: Request, call_next):
        incoming = request.headers.get(TRACE_HEADER)
        trace_id = incoming or uuid.uuid4().hex
        token = _trace_id_var.set(trace_id)
        structlog.contextvars.bind_contextvars(trace_id=trace_id)
        try:
            response: Response = await call_next(request)
        finally:
            _trace_id_var.reset(token)
            structlog.contextvars.unbind_contextvars("trace_id")
        response.headers[TRACE_HEADER] = trace_id
        return response
