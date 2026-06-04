"""Dispatcher: routes a gateway operation to the correct KB backend endpoint.

Handles:
- KB config resolution (MinIO via ConfigProvider)
- Operation name mapping (gateway name → KB config name)
- Circuit breaker enforcement
- Auth header resolution (Redis via AuthProvider)
- Upstream HTTP call (shared httpx client)
- Prometheus metrics (dispatch_total, dispatch_latency, circuit_state)
- Audit log + write history persistence (fire-and-forget)
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx
from kgw.audit import AuditEntry
from kgw.envelope import (
    BackendAuthFailed,
    CircuitOpen,
    KBNotFound,
    OperationNotSupported,
    UpstreamConnectError,
    UpstreamTimeout,
)
from kgw.observability.logger import get_logger
from kgw.observability.metrics import CIRCUIT_STATE, DISPATCH_LATENCY, DISPATCH_TOTAL

_log = get_logger(__name__)

# Map gateway-facing operation name → KB config operation name
_GATEWAY_TO_KB_OP: dict[str, str] = {
    "directoryCreate": "directoryCreate",
    "directoryUpdate": "directoryUpdate",
    "directoryDelete": "directoryDelete",
    "fileImport": "fileImport",
    "fileDelete": "fileDelete",
    "fileToMarkdownIndex": "buildTrigger",
    "fileBuildStatus": "buildStatus",
}

# Default backend path by KB operation name (fallback when portal config omits paths)
_DEFAULT_KB_PATHS: dict[str, str] = {
    "directoryCreate": "/api/v1/directories/create",
    "directoryUpdate": "/api/v1/directories/update",
    "directoryDelete": "/api/v1/directories/delete",
    "fileImport": "/api/v1/knowledgeItems/import",
    "fileDelete": "/api/v1/knowledgeItems/delete",
    "buildTrigger": "/api/v1/fileToMarkdownIndex",
    "buildStatus": "/api/v1/fileBuildStatus",
}

# Operations that write to kgw_kb_write_history (state-changing writes only)
_WRITE_HISTORY_OPS = frozenset(
    {
        "directoryCreate",
        "directoryUpdate",
        "directoryDelete",
        "fileImport",
        "fileDelete",
        "fileToMarkdownIndex",
    }
)

_WRITE_HISTORY_SQL = """
INSERT INTO kgw_kb_write_history (kn_code, file_path, version, source_id)
VALUES (%(kn_code)s, %(file_path)s, %(version)s, %(source_id)s)
"""


async def dispatch_json(
    request: Any,  # FastAPI Request
    *,
    operation: str,
    kn_code: str,
    user_id: str,
    body: dict[str, Any],
    file_path: str | None = None,
) -> dict[str, Any]:
    """Route a JSON write/read request to the KB backend.

    Returns the KB response dict (passthrough). Raises KgwError subclasses
    on known failure modes; callers should not catch those — the FastAPI
    exception handler in main.py converts them to error envelopes.
    """
    state = request.app.state
    trace_id: str | None = request.headers.get("X-Trace-Id")
    started = time.perf_counter()

    # 1. Fetch KB config from MinIO
    config = await state.config_provider.get_kb_config(kn_code)
    if config is None:
        raise KBNotFound(f"unknown knCode: {kn_code}", kn_code=kn_code)

    # 2. Map gateway operation → KB operation and validate it is supported
    kb_op = _GATEWAY_TO_KB_OP.get(operation)
    if kb_op is None or kb_op not in config.operations:
        raise OperationNotSupported(
            f"operation {operation!r} not supported by {kn_code}",
            kn_code=kn_code,
            operation=operation,
        )

    # 3. Circuit breaker gate (keyed by endpoint URL)
    cb = state.circuit_breakers.get(config.domain_url)
    _set_circuit_metric(kn_code, cb)
    if not cb.before_call():
        raise CircuitOpen(f"circuit OPEN for {kn_code}", kn_code=kn_code)

    # 4. Resolve auth headers (substitutes ${KEY} placeholders from Redis)
    headers = await state.auth_provider.resolve_headers(
        config.headers, user_code=user_id
    )

    # 5. Build upstream URL
    op_path = config.operation_path(kb_op) or _DEFAULT_KB_PATHS.get(kb_op, f"/{kb_op}")
    url = f"{config.domain_url.rstrip('/')}{op_path}"

    # 5b. Ensure knCode is present in body (KB backends require it)
    if "knCode" not in body:
        body = {**body, "knCode": kn_code}

    # 6. Call KB backend
    result_code = "-1"
    resp_body: dict[str, Any] = {}
    try:
        http: httpx.AsyncClient = state.http
        response = await http.post(url, json=body, headers=headers)
        if response.status_code in (401, 403):
            cb.record_failure()
            _set_circuit_metric(kn_code, cb)
            raise BackendAuthFailed(
                f"backend auth failed (HTTP {response.status_code})", kn_code=kn_code
            )
        cb.record_success()
        _set_circuit_metric(kn_code, cb)
        resp_body = response.json()
        result_code = str(resp_body.get("resultCode", "0"))
    except (KBNotFound, OperationNotSupported, CircuitOpen, BackendAuthFailed):
        raise
    except httpx.TimeoutException as exc:
        cb.record_failure()
        _set_circuit_metric(kn_code, cb)
        raise UpstreamTimeout(f"timeout calling {url}", kn_code=kn_code) from exc
    except (httpx.ConnectError, httpx.NetworkError) as exc:
        cb.record_failure()
        _set_circuit_metric(kn_code, cb)
        raise UpstreamConnectError(
            f"connect error calling {url}", kn_code=kn_code
        ) from exc

    latency_ms = int((time.perf_counter() - started) * 1000)

    # 7. Prometheus metrics
    DISPATCH_TOTAL.labels(
        operation=operation, kn_code=kn_code, result=result_code
    ).inc()
    DISPATCH_LATENCY.labels(operation=operation, kn_code=kn_code).observe(
        latency_ms / 1000.0
    )

    # 8. Audit log (fire-and-forget — AuditWriter.record enqueues synchronously,
    #    never raises, and actual I/O happens in a background drain task)
    await state.audit.record(
        AuditEntry(
            source="serve",
            trace_id=trace_id,
            actor_user_id=user_id,
            actor_kind="user",
            operation_type=operation,
            kn_code=kn_code,
            file_path=file_path,
            payload_size_bytes=None,
            row_count=None,
            payload_redacted={"knCode": kn_code, "filePath": file_path},
            result_code=result_code,
            result_msg=resp_body.get("resultMsg"),
            latency_ms=latency_ms,
        )
    )

    # 9. Write history for state-changing writes (fire-and-forget background task;
    #    failures are logged and swallowed — never blocks the response path)
    if operation in _WRITE_HISTORY_OPS:
        asyncio.create_task(
            _write_history(state.pool, kn_code=kn_code, file_path=file_path or ""),
            name=f"write_history:{kn_code}:{operation}",
        )

    return resp_body


async def _write_history(pool: Any, *, kn_code: str, file_path: str) -> None:
    """Insert a kgw_kb_write_history row. Failures are logged and swallowed."""
    try:
        async with pool.connection() as conn:
            await conn.execute(
                _WRITE_HISTORY_SQL,
                {
                    "kn_code": kn_code,
                    "file_path": file_path,
                    "version": "",
                    "source_id": None,
                },
            )
            await conn.commit()
    except Exception as exc:  # noqa: BLE001
        _log.warning("write_history.failed", kn_code=kn_code, error=str(exc))


def _set_circuit_metric(kn_code: str, cb: Any) -> None:
    CIRCUIT_STATE.labels(kn_code=kn_code).set(cb.state.value)
