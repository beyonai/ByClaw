"""Dispatcher: routes a gateway operation to the correct KB backend endpoint.

Handles:
- KB config resolution (MinIO via ConfigProvider)
- Operation name mapping (gateway name → KB config name)
- knCode translation: portal kn_code → backend resource_code
- Circuit breaker enforcement
- Auth header resolution (Redis via AuthProvider)
- Upstream HTTP call: direct (domainURL) or by-framework discovery (domainName)
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
    # writes (S2)
    "directoryCreate": "directoryCreate",
    "directoryUpdate": "directoryUpdate",
    "directoryDelete": "directoryDelete",
    "fileImport": "fileImport",
    "fileDelete": "fileDelete",
    "fileToMarkdownIndex": "buildTrigger",
    "fileBuildStatus": "buildStatus",
    # reads (S3) — gateway op name == KB op name for the read surface
    "knowledgeSearch": "knowledgeSearch",
    "metadataSearch": "metadataSearch",
    "searchFile": "searchFile",
    "metadataFieldsList": "metadataFieldsList",
    "listDir": "listDir",
    "glob": "glob",
    "readFile": "readFile",
    "downloadFile": "downloadFile",
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
    "knowledgeSearch": "/api/v1/knowledgeItems/search",
    "metadataSearch": "/api/v1/knowledgeItems/metadataSearch",
    "searchFile": "/api/v1/knowledgeItems/searchFile",
    "metadataFieldsList": "/api/v1/knowledgeItems/metadataFields/list",
    "listDir": "/api/v1/listDir",
    "glob": "/api/v1/glob",
    "readFile": "/api/v1/readFile",
    "downloadFile": "/api/v1/downloadFile",
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

# Read operations — do NOT write audit log and do NOT write kgw_kb_write_history
# (v5 spec §7.1: only high-risk writes are audited)
_READ_OPS = frozenset(
    {
        "knowledgeSearch",
        "metadataSearch",
        "searchFile",
        "metadataFieldsList",
        "listDir",
        "glob",
        "readFile",
        "downloadFile",
        "fileBuildStatus",  # status query: read-shaped, no audit, no history
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

    # 3. Circuit breaker gate (keyed by endpoint URL or service-discovery name)
    cb_key = config.domain_url or config.domain_name
    cb = state.circuit_breakers.get(cb_key)
    _set_circuit_metric(kn_code, cb)
    if not cb.before_call():
        raise CircuitOpen(f"circuit OPEN for {kn_code}", kn_code=kn_code)

    # 4. Resolve auth headers (substitutes ${KEY} placeholders from Redis)
    headers = await state.auth_provider.resolve_headers(
        config.headers, user_code=user_id
    )

    # 5. Build upstream URL and translate portal knCode → backend resource_code
    op_path = config.operation_path(kb_op) or _DEFAULT_KB_PATHS.get(kb_op, f"/{kb_op}")

    # Replace portal kn_code with backend resource_code in the request body.
    # KB backends use their own resourceCode as knCode, not the portal's ID.
    backend_body = dict(body)
    if "knCode" in backend_body or "knCodeList" not in backend_body:
        backend_body["knCode"] = config.resource_code
    if "knCodeList" in backend_body:
        backend_body["knCodeList"] = [config.resource_code]

    # 6. Call KB backend (direct mode or by-framework service discovery)
    result_code = "-1"
    resp_body: dict[str, Any] = {}
    try:
        resp_body = await _call_backend(
            config=config,
            op_path=op_path,
            body=backend_body,
            headers=headers,
            http=state.http,
        )
        cb.record_success()
        _set_circuit_metric(kn_code, cb)
        result_code = str(resp_body.get("resultCode", "0"))
    except (KBNotFound, OperationNotSupported, CircuitOpen, BackendAuthFailed):
        raise
    except httpx.TimeoutException as exc:
        cb.record_failure()
        _set_circuit_metric(kn_code, cb)
        raise UpstreamTimeout(
            f"timeout calling {config.domain_url or config.domain_name}{op_path}",
            kn_code=kn_code,
        ) from exc
    except (httpx.ConnectError, httpx.NetworkError) as exc:
        cb.record_failure()
        _set_circuit_metric(kn_code, cb)
        raise UpstreamConnectError(
            f"connect error calling {config.domain_url or config.domain_name}{op_path}",
            kn_code=kn_code,
        ) from exc
    except _BackendAuthError as exc:
        cb.record_failure()
        _set_circuit_metric(kn_code, cb)
        raise BackendAuthFailed(str(exc), kn_code=kn_code) from exc

    latency_ms = int((time.perf_counter() - started) * 1000)

    # 7. Prometheus metrics
    DISPATCH_TOTAL.labels(
        operation=operation, kn_code=kn_code, result=result_code
    ).inc()
    DISPATCH_LATENCY.labels(operation=operation, kn_code=kn_code).observe(
        latency_ms / 1000.0
    )

    # 8. Audit log — writes only (v5 spec §7.1). Read ops must NOT audit.
    if operation not in _READ_OPS:
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

    # 9. Write history — state-changing writes only (background, fire-and-forget)
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


class _BackendAuthError(Exception):
    """Internal sentinel: KB returned 401/403."""


async def _call_backend(
    *,
    config: Any,  # KbConfig
    op_path: str,
    body: dict[str, Any],
    headers: dict[str, str],
    http: httpx.AsyncClient,
) -> dict[str, Any]:
    """Execute the upstream POST in direct or service-discovery mode.

    Direct mode:  config.domain_url is set → POST to domain_url + op_path.
    Discovery mode: config.domain_name is set and domain_url is empty →
                    use by-framework DiscoveryHttpClient.
    """
    if config.domain_url:
        url = config.domain_url.rstrip("/") + "/" + op_path.lstrip("/")
        response = await http.post(url, json=body, headers=headers)
        if response.status_code in (401, 403):
            raise _BackendAuthError(
                f"backend auth failed (HTTP {response.status_code}) for {url}"
            )
        return response.json()

    # Service-discovery mode via by-framework
    if not config.domain_name:
        raise UpstreamConnectError(
            "KB config has neither domainURL nor domainName",
            kn_code=config.kn_code,
        )
    return await _call_via_discovery(
        domain_name=config.domain_name,
        op_path=op_path,
        body=body,
        headers=headers,
    )


async def _call_via_discovery(
    *,
    domain_name: str,
    op_path: str,
    body: dict[str, Any],
    headers: dict[str, str],
) -> dict[str, Any]:
    """POST to a KB backend via by-framework service discovery.

    Uses DiscoveryClient (Redis-backed) to resolve the service name to a
    physical host:port, then POSTs JSON. The discovery client is created
    and closed per-call (no persistent state needed — gateway is stateless
    for service discovery).
    """
    from by_framework.common.redis_client import init_redis
    from by_framework.core.discovery import DiscoveryClient
    from by_framework.util.discovery_http_client import DiscoveryHttpClient
    from kgw.settings import get_settings

    settings = get_settings()
    redis_client = init_redis(
        host=settings.redis_host,
        port=settings.redis_port,
        db=settings.redis_database,
        password=settings.redis_password or None,
        username=settings.redis_username or None,
        decode_responses=True,
    )
    discovery_client = DiscoveryClient(redis_client=redis_client, cache_interval=5)
    try:
        async with DiscoveryHttpClient(discovery_client) as client:
            resp = await client.post(
                domain_name,
                op_path,
                json=body,
                headers=headers or None,
            )
        if not resp.is_success:
            raise _BackendAuthError(
                f"backend returned HTTP {resp.status_code} via discovery for {domain_name}{op_path}"
            )
        # HttpResponse.data is a dict when content-type is application/json,
        # or a string otherwise. Normalise to dict in both cases.
        if isinstance(resp.data, dict):
            return resp.data
        if isinstance(resp.data, str):
            import json as _json

            return _json.loads(resp.data)
        raise ValueError(
            f"discovery response body is not JSON-parseable: {type(resp.data)}"
        )
    finally:
        await discovery_client.close()


async def dispatch_fanout_json(
    request: Any,  # FastAPI Request
    *,
    operation: str,
    kn_code_list: list[str],
    user_id: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    """Fan out a read request across multiple KBs in parallel.

    Calls dispatch_json once per kn_code via ``asyncio.gather`` with
    ``return_exceptions=True``. Successful responses' ``resultObject.data``
    arrays are concatenated; any failure (KgwError or unexpected exception)
    is surfaced as ``{knCode, reason}`` in ``degraded_kbs`` — never aborts
    the overall response (v5 spec §3.1).

    The body is forwarded verbatim per call; ``dispatch_json`` substitutes
    each KB's resource_code into ``knCode``/``knCodeList`` for the upstream
    payload.
    """
    from kgw.envelope import KgwError  # noqa: PLC0415

    async def _one(kn_code: str) -> dict[str, Any]:
        return await dispatch_json(
            request,
            operation=operation,
            kn_code=kn_code,
            user_id=user_id,
            body=dict(body),
        )

    tasks = [_one(kc) for kc in kn_code_list]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    merged: list[Any] = []
    degraded: list[dict[str, str]] = []
    for kn_code, res in zip(kn_code_list, results):
        if isinstance(res, KgwError):
            degraded.append({"knCode": kn_code, "reason": res.error_type})
            continue
        if isinstance(res, asyncio.CancelledError):
            # Propagate cancellation — the gateway request is being torn down,
            # we must not mask that as a degraded KB.
            raise res
        if isinstance(res, Exception):
            _log.error(
                "fanout.unexpected_error",
                kn_code=kn_code,
                operation=operation,
                error=str(res),
            )
            degraded.append({"knCode": kn_code, "reason": "UnknownError"})
            continue
        # Success — extract data list from resultObject if present
        result_object = res.get("resultObject") or {}
        data = result_object.get("data")
        if isinstance(data, list):
            merged.extend(data)
        else:
            # Non-list payload (e.g. metadataFieldsList returns a dict);
            # keep the entire resultObject under {knCode: ...} so caller can dispatch.
            merged.append({**result_object, "knCode": kn_code})

    return {
        "resultCode": "0",
        "resultMsg": "success",
        "resultObject": {"data": merged, "degraded_kbs": degraded},
    }
