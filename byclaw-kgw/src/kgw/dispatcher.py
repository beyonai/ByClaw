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
import enum
import time
from typing import Any

import httpx
from by_framework.errors.http import DiscoveryHttpClientError
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


class GatewayOp(str, enum.Enum):
    """Gateway-facing operation identifiers (the ``operation`` arg of dispatch_json)."""

    # writes (S2)
    DIRECTORY_CREATE = "directoryCreate"
    DIRECTORY_UPDATE = "directoryUpdate"
    DIRECTORY_DELETE = "directoryDelete"
    FILE_IMPORT = "fileImport"
    FILE_DELETE = "fileDelete"
    FILE_TO_MARKDOWN_INDEX = "fileToMarkdownIndex"
    FILE_BUILD_STATUS = "fileBuildStatus"
    # reads (S3)
    KNOWLEDGE_SEARCH = "knowledgeSearch"
    METADATA_SEARCH = "metadataSearch"
    SEARCH_FILE = "searchFile"
    METADATA_FIELDS_LIST = "metadataFieldsList"
    LIST_DIR = "listDir"
    GLOB = "glob"
    READ_FILE = "readFile"
    DOWNLOAD_FILE = "downloadFile"


class KbOp(str, enum.Enum):
    """KB-config operation identifiers (matches the ``name`` field in resourceService entries)."""

    DIRECTORY_CREATE = "directoryCreate"
    DIRECTORY_UPDATE = "directoryUpdate"
    DIRECTORY_DELETE = "directoryDelete"
    FILE_IMPORT = "fileImport"
    FILE_DELETE = "fileDelete"
    BUILD_TRIGGER = "buildTrigger"
    BUILD_STATUS = "buildStatus"
    KNOWLEDGE_SEARCH = "knowledgeSearch"
    METADATA_SEARCH = "metadataSearch"
    SEARCH_FILE = "searchFile"
    METADATA_FIELDS_LIST = "metadataFieldsList"
    LIST_DIR = "listDir"
    GLOB = "glob"
    READ_FILE = "readFile"
    DOWNLOAD_FILE = "downloadFile"
    # S4 metadata sync
    METADATA_PROPERTIES_BATCH_CREATE = "metadataPropertiesBatchCreate"
    KNOWLEDGE_ITEMS_METADATA_UPDATE = "knowledgeItemsMetadataUpdate"
    KNOWLEDGE_ITEMS_METADATA_GET = "knowledgeItemsMetadataGet"
    METADATA_PROPERTIES_DELETE = "metadataPropertiesDelete"


# Map gateway-facing operation name → KB config operation name
_GATEWAY_TO_KB_OP: dict[GatewayOp, KbOp] = {
    GatewayOp.DIRECTORY_CREATE: KbOp.DIRECTORY_CREATE,
    GatewayOp.DIRECTORY_UPDATE: KbOp.DIRECTORY_UPDATE,
    GatewayOp.DIRECTORY_DELETE: KbOp.DIRECTORY_DELETE,
    GatewayOp.FILE_IMPORT: KbOp.FILE_IMPORT,
    GatewayOp.FILE_DELETE: KbOp.FILE_DELETE,
    GatewayOp.FILE_TO_MARKDOWN_INDEX: KbOp.BUILD_TRIGGER,
    GatewayOp.FILE_BUILD_STATUS: KbOp.BUILD_STATUS,
    GatewayOp.KNOWLEDGE_SEARCH: KbOp.KNOWLEDGE_SEARCH,
    GatewayOp.METADATA_SEARCH: KbOp.METADATA_SEARCH,
    GatewayOp.SEARCH_FILE: KbOp.SEARCH_FILE,
    GatewayOp.METADATA_FIELDS_LIST: KbOp.METADATA_FIELDS_LIST,
    GatewayOp.LIST_DIR: KbOp.LIST_DIR,
    GatewayOp.GLOB: KbOp.GLOB,
    GatewayOp.READ_FILE: KbOp.READ_FILE,
    GatewayOp.DOWNLOAD_FILE: KbOp.DOWNLOAD_FILE,
}

# Default backend path by KB operation name (fallback when portal config omits paths)
_DEFAULT_KB_PATHS: dict[KbOp, str] = {
    KbOp.DIRECTORY_CREATE: "/api/v1/directories/create",
    KbOp.DIRECTORY_UPDATE: "/api/v1/directories/update",
    KbOp.DIRECTORY_DELETE: "/api/v1/directories/delete",
    KbOp.FILE_IMPORT: "/api/v1/knowledgeItems/import",
    KbOp.FILE_DELETE: "/api/v1/knowledgeItems/delete",
    KbOp.BUILD_TRIGGER: "/api/v1/fileToMarkdownIndex",
    KbOp.BUILD_STATUS: "/api/v1/fileBuildStatus",
    KbOp.KNOWLEDGE_SEARCH: "/api/v1/knowledgeItems/search",
    KbOp.METADATA_SEARCH: "/api/v1/knowledgeItems/metadataSearch",
    KbOp.SEARCH_FILE: "/api/v1/knowledgeItems/searchFile",
    KbOp.METADATA_FIELDS_LIST: "/api/v1/knowledgeItems/metadataFields/list",
    KbOp.LIST_DIR: "/api/v1/listDir",
    KbOp.GLOB: "/api/v1/glob",
    KbOp.READ_FILE: "/api/v1/readFile",
    KbOp.DOWNLOAD_FILE: "/api/v1/downloadFile",
    # S4 metadata sync
    KbOp.METADATA_PROPERTIES_BATCH_CREATE: "/api/v1/metadataProperties/batchCreate",
    KbOp.KNOWLEDGE_ITEMS_METADATA_UPDATE: "/api/v1/knowledgeItems/metadata/update",
    KbOp.KNOWLEDGE_ITEMS_METADATA_GET: "/api/v1/knowledgeItems/metadata/get",
    KbOp.METADATA_PROPERTIES_DELETE: "/api/v1/metadataProperties/delete",
}

# Read operations — do NOT write audit log (v5 spec §7.1: only writes are audited)
_READ_OPS: frozenset[GatewayOp] = frozenset(
    {
        GatewayOp.KNOWLEDGE_SEARCH,
        GatewayOp.METADATA_SEARCH,
        GatewayOp.SEARCH_FILE,
        GatewayOp.METADATA_FIELDS_LIST,
        GatewayOp.LIST_DIR,
        GatewayOp.GLOB,
        GatewayOp.READ_FILE,
        GatewayOp.DOWNLOAD_FILE,
        GatewayOp.FILE_BUILD_STATUS,  # status query: read-shaped, no audit, no history
    }
)


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

    # Operation may arrive as a GatewayOp member or a raw string.
    # Normalize to plain str for stringly-typed sinks (Prometheus, audit, logs).
    op_str = operation.value if isinstance(operation, enum.Enum) else str(operation)

    # 1. Fetch KB config
    config = await state.config_provider.get_kb_config(kn_code)
    if config is None:
        raise KBNotFound(f"unknown knCode: {kn_code}", kn_code=kn_code)

    _log.info(
        "dispatch.config_resolved",
        kn_code=kn_code,
        resource_code=config.resource_code,
        domain_url=config.domain_url,
        domain_name=config.domain_name,
        operation=op_str,
    )

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
    op_path = config.operation_path(kb_op) or _DEFAULT_KB_PATHS.get(
        kb_op, f"/{kb_op.value}"
    )

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
        _log.error(
            "dispatch.upstream_timeout",
            kn_code=kn_code,
            operation=op_str,
            upstream=f"{config.domain_url or config.domain_name}{op_path}",
        )
        cb.record_failure()
        _set_circuit_metric(kn_code, cb)
        raise UpstreamTimeout(
            f"timeout calling {config.domain_url or config.domain_name}{op_path}",
            kn_code=kn_code,
        ) from exc
    except (httpx.ConnectError, httpx.NetworkError) as exc:
        _log.error(
            "dispatch.upstream_connect_error",
            kn_code=kn_code,
            operation=op_str,
            upstream=f"{config.domain_url or config.domain_name}{op_path}",
        )
        cb.record_failure()
        _set_circuit_metric(kn_code, cb)
        raise UpstreamConnectError(
            f"connect error calling {config.domain_url or config.domain_name}{op_path}",
            kn_code=kn_code,
        ) from exc
    except DiscoveryHttpClientError as exc:
        _log.error(
            "dispatch.discovery_error",
            kn_code=kn_code,
            operation=op_str,
            upstream=f"{config.domain_name}{op_path}",
            error=str(exc),
        )
        cb.record_failure()
        _set_circuit_metric(kn_code, cb)
        raise UpstreamConnectError(
            f"service-discovery error for {config.domain_name}{op_path}: {exc}",
            kn_code=kn_code,
        ) from exc
    except BackendAuthError as exc:
        _log.error(
            "dispatch.backend_auth_failed",
            kn_code=kn_code,
            operation=op_str,
            error=str(exc),
        )
        cb.record_failure()
        _set_circuit_metric(kn_code, cb)
        raise BackendAuthFailed(str(exc), kn_code=kn_code) from exc

    latency_ms = int((time.perf_counter() - started) * 1000)

    # 7. Reverse-map resource_code → portal kn_code in the response body
    _remap_kn_code(
        resp_body, resource_code=config.resource_code, portal_kn_code=kn_code
    )

    # 8. Prometheus metrics
    DISPATCH_TOTAL.labels(operation=op_str, kn_code=kn_code, result=result_code).inc()
    DISPATCH_LATENCY.labels(operation=op_str, kn_code=kn_code).observe(
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
                operation_type=op_str,
                kn_code=kn_code,
                file_path=file_path or body.get("directoryPath"),
                payload_size_bytes=None,
                row_count=None,
                payload_redacted=body,
                result_code=result_code,
                result_msg=resp_body.get("resultMsg"),
                latency_ms=latency_ms,
            )
        )

    _log.info(
        "dispatch.completed",
        kn_code=kn_code,
        operation=op_str,
        result_code=result_code,
        latency_ms=latency_ms,
    )

    return resp_body


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

    # Operation may arrive as a GatewayOp member or a raw string.
    # Normalize to plain str for stringly-typed sinks (Prometheus, audit, logs).
    op_str = operation.value if isinstance(operation, enum.Enum) else str(operation)

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
        op_path = cfg.operation_path(kb_op) or _DEFAULT_KB_PATHS.get(
            kb_op, f"/{kb_op.value}"
        )
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
                operation=op_str,
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
