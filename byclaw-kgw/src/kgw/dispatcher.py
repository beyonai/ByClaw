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
from kgw.upstream import BackendAuthError, call_backend_json

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
    # S4 metadata sync
    "metadataPropertiesBatchCreate": "/api/v1/metadataProperties/batchCreate",
    "knowledgeItemsMetadataUpdate": "/api/v1/knowledgeItems/metadata/update",
    "knowledgeItemsMetadataGet": "/api/v1/knowledgeItems/metadata/get",
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
        resp_body = await call_backend_json(
            config=config,
            op_path=op_path,
            body=backend_body,
            headers=headers,
            http=state.http,
        )
        cb.record_success()
        _set_circuit_metric(kn_code, cb)
        result_code = str(resp_body.get("resultCode", "0"))
    except (KBNotFound, OperationNotSupported, CircuitOpen, BackendAuthFailed):  # pylint: disable=try-except-raise
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
    except BackendAuthError as exc:
        cb.record_failure()
        _set_circuit_metric(kn_code, cb)
        raise BackendAuthFailed(str(exc), kn_code=kn_code) from exc

    latency_ms = int((time.perf_counter() - started) * 1000)

    # 7. Reverse-map resource_code → portal kn_code in the response body
    _remap_kn_code(
        resp_body, resource_code=config.resource_code, portal_kn_code=kn_code
    )

    # 8. Prometheus metrics
    DISPATCH_TOTAL.labels(
        operation=operation, kn_code=kn_code, result=result_code
    ).inc()
    DISPATCH_LATENCY.labels(operation=operation, kn_code=kn_code).observe(
        latency_ms / 1000.0
    )

    # 9. Audit log — writes only (v5 spec §7.1). Read ops must NOT audit.
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

    # 10. Write history — state-changing writes only (background, fire-and-forget)
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


def _remap_kn_code(
    resp_body: dict[str, Any], *, resource_code: str, portal_kn_code: str
) -> None:
    """Replace resource_code with portal kn_code in-place inside resp_body.

    Covers two shapes:
    - resultObject.knCode (single-object responses like readFile)
    - resultObject.data[].knCode (list responses like listDir, knowledgeSearch)
    """
    ro = resp_body.get("resultObject")
    if not isinstance(ro, dict):
        return
    if ro.get("knCode") == resource_code:
        ro["knCode"] = portal_kn_code
    data = ro.get("data")
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict) and item.get("knCode") == resource_code:
                item["knCode"] = portal_kn_code


def _set_circuit_metric(kn_code: str, cb: Any) -> None:
    CIRCUIT_STATE.labels(kn_code=kn_code).set(cb.state.value)


async def dispatch_fanout_json(
    request: Any,  # FastAPI Request
    *,
    operation: str,
    kn_code_list: list[str],
    user_id: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    """Fan out a read request across multiple KBs, grouping by backend URL.

    KBs that share the same (domain_url/domain_name, op_path) are batched into a
    single upstream call with a merged ``knCodeList``.  This halves backend traffic
    for installations where many portal knCodes share a single KB service.

    Successful responses' ``resultObject.data`` arrays are concatenated; any
    failure (KgwError or unexpected exception) is surfaced as
    ``{knCode, reason}`` in ``degraded_kbs`` — never aborts the overall response
    (v5 spec §3.1).

    ``knCode`` values in the upstream response are back-mapped from
    ``resource_code`` to the portal ``kn_code`` before merging.
    """
    from kgw.envelope import KgwError  # noqa: PLC0415

    state = request.app.state

    # 1. Resolve all KB configs concurrently, collect failures immediately.
    configs_or_err: list[Any] = await asyncio.gather(
        *[state.config_provider.get_kb_config(kc) for kc in kn_code_list],
        return_exceptions=True,
    )

    degraded: list[dict[str, str]] = []
    # kn_code → KbConfig (only successfully resolved)
    resolved: dict[str, Any] = {}
    for kn_code, cfg in zip(kn_code_list, configs_or_err):
        if isinstance(cfg, asyncio.CancelledError):
            raise cfg
        if isinstance(cfg, Exception):
            _log.error(
                "fanout.config_fetch_error",
                kn_code=kn_code,
                error=str(cfg),
            )
            degraded.append({"knCode": kn_code, "reason": "UnknownError"})
        elif cfg is None:
            degraded.append({"knCode": kn_code, "reason": KBNotFound.error_type})
        else:
            resolved[kn_code] = cfg

    if not resolved:
        return {
            "resultCode": "0",
            "resultMsg": "success",
            "resultObject": {"data": [], "degraded_kbs": degraded},
        }

    # 2. Map gateway operation → KB operation name (same for all KBs)
    kb_op = _GATEWAY_TO_KB_OP.get(operation)

    # 3. Group resolved KBs by (endpoint_key, op_path).
    #    endpoint_key = domain_url if set, else domain_name.
    #    KBs in the same group share a backend and can be batched.
    groups: dict[
        tuple[str, str], list[str]
    ] = {}  # (endpoint_key, op_path) → [kn_code, ...]
    for kn_code, cfg in resolved.items():
        if kb_op is None or kb_op not in cfg.operations:
            degraded.append(
                {"knCode": kn_code, "reason": OperationNotSupported.error_type}
            )
            continue
        endpoint_key = cfg.domain_url or cfg.domain_name
        op_path = cfg.operation_path(kb_op) or _DEFAULT_KB_PATHS.get(kb_op, f"/{kb_op}")
        groups.setdefault((endpoint_key, op_path), []).append(kn_code)

    if not groups:
        return {
            "resultCode": "0",
            "resultMsg": "success",
            "resultObject": {"data": [], "degraded_kbs": degraded},
        }

    # 4. Dispatch one request per group concurrently.
    async def _call_group(
        group_kn_codes: list[str], endpoint_key: str, op_path: str
    ) -> dict[str, Any]:
        """Send one aggregated request for all KBs in the group."""
        # All KBs in a group share the same endpoint; use the first config.
        first_cfg = resolved[group_kn_codes[0]]
        resource_codes = [resolved[kc].resource_code for kc in group_kn_codes]

        cb = state.circuit_breakers.get(endpoint_key)
        _set_circuit_metric(group_kn_codes[0], cb)
        if not cb.before_call():
            raise CircuitOpen(
                f"circuit OPEN for {endpoint_key}", kn_code=group_kn_codes[0]
            )

        headers = await state.auth_provider.resolve_headers(
            first_cfg.headers, user_code=user_id
        )

        group_body = dict(body)
        group_body["knCodeList"] = resource_codes
        group_body.pop("knCode", None)

        try:
            resp = await call_backend_json(
                config=first_cfg,
                op_path=op_path,
                body=group_body,
                headers=headers,
                http=state.http,
            )
        except httpx.TimeoutException as exc:
            cb.record_failure()
            _set_circuit_metric(group_kn_codes[0], cb)
            raise UpstreamTimeout(
                f"timeout calling {endpoint_key}{op_path}",
                kn_code=group_kn_codes[0],
            ) from exc
        except (httpx.ConnectError, httpx.NetworkError) as exc:
            cb.record_failure()
            _set_circuit_metric(group_kn_codes[0], cb)
            raise UpstreamConnectError(
                f"connect error calling {endpoint_key}{op_path}",
                kn_code=group_kn_codes[0],
            ) from exc
        except BackendAuthError as exc:
            cb.record_failure()
            _set_circuit_metric(group_kn_codes[0], cb)
            raise BackendAuthFailed(str(exc), kn_code=group_kn_codes[0]) from exc
        cb.record_success()
        _set_circuit_metric(group_kn_codes[0], cb)
        return resp

    group_items = list(groups.items())
    group_tasks = [
        _call_group(kc_list, ep, path) for (ep, path), kc_list in group_items
    ]
    group_results = await asyncio.gather(*group_tasks, return_exceptions=True)

    # 5. Merge results; reverse-map resource_code → portal kn_code.
    merged: list[Any] = []
    for ((endpoint_key, op_path), group_kn_codes), res in zip(
        group_items, group_results
    ):
        # Build resource_code → portal kn_code map for this group
        rc_to_portal: dict[str, str] = {
            resolved[kc].resource_code: kc for kc in group_kn_codes
        }

        if isinstance(res, asyncio.CancelledError):
            raise res
        if isinstance(res, KgwError):
            for kn_code in group_kn_codes:
                degraded.append({"knCode": kn_code, "reason": res.error_type})
            continue
        if isinstance(res, Exception):
            _log.error(
                "fanout.group_error",
                endpoint=endpoint_key,
                operation=operation,
                error=str(res),
            )
            for kn_code in group_kn_codes:
                degraded.append({"knCode": kn_code, "reason": "UnknownError"})
            continue

        result_object = res.get("resultObject") or {}
        data = result_object.get("data")
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict) and "knCode" in item:
                    item["knCode"] = rc_to_portal.get(item["knCode"], item["knCode"])
            merged.extend(data)
        else:
            # Non-list payload: wrap under portal kn_code (use first in group).
            ro_copy = dict(result_object)
            if "knCode" in ro_copy:
                ro_copy["knCode"] = rc_to_portal.get(
                    ro_copy["knCode"], group_kn_codes[0]
                )
            else:
                ro_copy["knCode"] = group_kn_codes[0]
            merged.append(ro_copy)

    return {
        "resultCode": "0",
        "resultMsg": "success",
        "resultObject": {"data": merged, "degraded_kbs": degraded},
    }
