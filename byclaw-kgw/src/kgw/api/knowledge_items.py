from __future__ import annotations

from typing import Annotated, Any

import httpx
from fastapi import APIRouter, File, Form, Header, Request, UploadFile
from kgw.dispatcher import (
    _DEFAULT_KB_PATHS,
    _remap_kn_code,
    _write_history,
    dispatch_fanout_json,
    dispatch_json,
)
from kgw.envelope import (
    INVALID_OPERATION_FOR_TYPE,
    BackendAuthFailed,
    CircuitOpen,
    KBNotFound,
    MetadataPropertyNotFound,
    OperationNotSupported,
    UpstreamConnectError,
    UpstreamTimeout,
    success,
)
from kgw.metadata import binding as binding_mod
from kgw.metadata import registry
from kgw.metadata import sync as sync_mod
from kgw.metadata.translator import (
    translate_request_metadata,
    translate_response_metadata,
)
from kgw.observability.logger import get_logger
from kgw.stream_proxy import proxy_upload
from kgw.upstream import BackendAuthError, call_backend_json

_log = get_logger(__name__)
router = APIRouter(prefix="/kgw/api/v1")

# ---------------------------------------------------------------------------
# Operation × value_type compatibility table
# ---------------------------------------------------------------------------
# Operations allowed per value_type.
# "set" and "unset" are universally allowed; type-specific ops are listed here.
_OPS_FOR_TYPE: dict[str, set[str]] = {
    "string": {"set", "unset"},
    "number": {"set", "unset"},
    "boolean": {"set", "unset"},
    "array": {"set", "unset", "append", "clear"},
    "object": {"set", "unset"},
}
# Fallback for unknown value_types — only set/unset allowed
_DEFAULT_OPS: set[str] = {"set", "unset"}


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


async def _resolve_property_map(
    pool: Any,
    names: list[str],
) -> tuple[dict[str, str], dict[str, str], dict[str, Any]]:
    """Return (name_to_backend, backend_to_name, props_by_name) for given property names.

    Raises MetadataPropertyNotFound if any name is not in the active registry.
    """
    props = await registry.list_active_properties(pool, names)
    found_names = {p.property_name for p in props}
    missing = [n for n in names if n not in found_names]
    if missing:
        raise MetadataPropertyNotFound(
            f"metadata property not found: {missing[0]}",
            property_name=missing[0],
            missing=missing,
        )
    name_to_backend = {p.property_name: p.backend_name for p in props}
    backend_to_name = {p.backend_name: p.property_name for p in props}
    props_by_name = {p.property_name: p for p in props}
    return name_to_backend, backend_to_name, props_by_name


def _validate_op(op: dict[str, Any], value_type: str) -> None:
    """Raise INVALID_OPERATION_FOR_TYPE if op['operation'] is not valid for value_type."""
    operation = op.get("operation", "")
    allowed = _OPS_FOR_TYPE.get(value_type, _DEFAULT_OPS)
    if operation not in allowed:
        raise INVALID_OPERATION_FOR_TYPE(
            f"operation '{operation}' not valid for value_type '{value_type}'",
            operation=operation,
            value_type=value_type,
        )


async def _rollback_binding(
    pool: Any, attempt_id: int, property_id: int, kn_code: str, file_path: str
) -> None:
    """Try to delete PENDING binding; on failure write outbox row."""
    try:
        await binding_mod.delete_by_attempt(pool, attempt_id)
    except Exception as rb_exc:  # noqa: BLE001
        _log.warning(
            "metadata_update.rollback_failed",
            attempt_id=attempt_id,
            error=str(rb_exc),
        )
        try:
            await binding_mod.write_outbox(
                pool,
                property_id=property_id,
                kn_code=kn_code,
                file_path=file_path,
                attempt_id=attempt_id,
            )
        except Exception as ob_exc:  # noqa: BLE001
            _log.error(
                "metadata_update.outbox_write_failed",
                attempt_id=attempt_id,
                error=str(ob_exc),
            )


# ---------------------------------------------------------------------------
# Existing endpoints
# ---------------------------------------------------------------------------


@router.post("/knowledgeItems/delete")
async def knowledge_item_delete(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
) -> dict[str, Any]:
    kn_code = str(body.get("knCode", ""))
    file_path = str(body.get("filePath") or "")
    return await dispatch_json(
        request,
        operation="fileDelete",
        kn_code=kn_code,
        user_id=x_user_id,
        body=body,
        file_path=file_path,
    )


@router.post("/knowledgeItems/import")
async def knowledge_item_import(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    kn_code: Annotated[str, Form(alias="knCode")],
    file_path: Annotated[str, Form(alias="filePath")],
    file_content: Annotated[UploadFile, File(alias="fileContent")],
) -> dict[str, Any]:
    """Stream multipart upload to the KB backend without buffering full file in RAM."""
    import asyncio

    from kgw.audit import AuditEntry

    state = request.app.state

    config = await state.config_provider.get_kb_config(kn_code)
    if config is None:
        raise KBNotFound(f"unknown knCode: {kn_code}", kn_code=kn_code)
    if "fileImport" not in config.operations:
        raise OperationNotSupported(
            f"fileImport not supported by {kn_code}",
            kn_code=kn_code,
            operation="fileImport",
        )

    cb = state.circuit_breakers.get(config.domain_url or config.domain_name)
    if not cb.before_call():
        raise CircuitOpen(f"circuit OPEN for {kn_code}", kn_code=kn_code)

    headers = await state.auth_provider.resolve_headers(
        config.headers, user_code=x_user_id
    )
    op_path = config.operation_path("fileImport") or "/api/v1/knowledgeItems/import"
    url = f"{config.domain_url.rstrip('/')}{op_path}"

    try:
        # Replace portal kn_code with backend resource_code in form fields
        form = {"knCode": config.resource_code, "filePath": file_path}
        result = await proxy_upload(
            url=url,
            upstream_headers=headers,
            http=state.http,
            form_fields=form,
            upload_file=file_content,
            kn_code=kn_code,
            operation="fileImport",
        )
        cb.record_success()
    except Exception:
        cb.record_failure()
        raise

    await state.audit.record(
        AuditEntry(
            source="serve",
            trace_id=request.headers.get("X-Trace-Id"),
            actor_user_id=x_user_id,
            actor_kind="user",
            operation_type="fileImport",
            kn_code=kn_code,
            file_path=file_path,
            payload_size_bytes=None,
            row_count=None,
            payload_redacted={"knCode": kn_code, "filePath": file_path},
            result_code=str(result.get("resultCode", "0")),
            result_msg=result.get("resultMsg"),
            latency_ms=None,
        )
    )
    asyncio.create_task(
        _write_history(state.pool, kn_code=kn_code, file_path=file_path),
        name=f"write_history:{kn_code}:fileImport",
    )

    return result


@router.post("/knowledgeItems/search")
async def knowledge_search(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
) -> dict[str, Any]:
    """Multi-KB parallel semantic search."""
    kn_code_list = list(body.get("knCodeList") or [])
    return await dispatch_fanout_json(
        request,
        operation="knowledgeSearch",
        kn_code_list=kn_code_list,
        user_id=x_user_id,
        body=body,
    )


@router.post("/knowledgeItems/metadataSearch")
async def metadata_search(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
) -> dict[str, Any]:
    """Multi-KB parallel metadata-only search."""
    kn_code_list = list(body.get("knCodeList") or [])
    return await dispatch_fanout_json(
        request,
        operation="metadataSearch",
        kn_code_list=kn_code_list,
        user_id=x_user_id,
        body=body,
    )


@router.post("/knowledgeItems/searchFile")
async def search_file(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
) -> dict[str, Any]:
    """Multi-KB parallel file-level search."""
    kn_code_list = list(body.get("knCodeList") or [])
    return await dispatch_fanout_json(
        request,
        operation="searchFile",
        kn_code_list=kn_code_list,
        user_id=x_user_id,
        body=body,
    )


# ---------------------------------------------------------------------------
# New S4 endpoints
# ---------------------------------------------------------------------------


@router.post("/knowledgeItems/metadata/update")
async def metadata_update(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
) -> dict[str, Any]:
    """Update metadata for a knowledge item file.

    Flow:
    1. Validate property names + operation/valueType compatibility.
    2. Lazy-sync each property to the target KB.
    3. Write PENDING binding rows for set/append ops.
    4. Call backend; on failure roll back bindings.
    5. Mark bindings SYNCED; process unset/clear deletions.
    6. Reverse-translate response (knCode + metadata field names).
    """
    state = request.app.state
    pool = state.pool

    kn_code = str(body["knCode"])
    file_path = str(body["filePath"])
    op_list = list(body.get("operationList") or ())

    # Edge case: nothing to do
    if not op_list:
        return success({})

    # 1. Resolve property map
    names = [op["propertyName"] for op in op_list]
    name_to_backend, backend_to_name, props_by_name = await _resolve_property_map(
        pool, names
    )

    # 2. Validate operation × valueType
    for op in op_list:
        prop = props_by_name[op["propertyName"]]
        _validate_op(op, prop.value_type)

    # 3. Resolve KB config
    cfg = await state.config_provider.get_kb_config(kn_code)
    if cfg is None:
        raise KBNotFound(f"unknown knCode: {kn_code}", kn_code=kn_code)

    op_id = "knowledgeItemsMetadataUpdate"
    op_path = cfg.operation_path(op_id) or _DEFAULT_KB_PATHS.get(op_id, f"/{op_id}")

    # 4. Lazy sync for each unique property_id
    unique_props = {p.property_id: p for p in props_by_name.values()}
    for p in unique_props.values():
        await sync_mod.ensure_synced(
            state, property_id=p.property_id, kn_code=kn_code, user_code=x_user_id
        )

    # 5. Generate attempt_id and write PENDING bindings for set/append ops
    attempt_id = binding_mod.new_attempt_id()
    set_or_append_names = [
        op["propertyName"] for op in op_list if op.get("operation") in {"set", "append"}
    ]

    # Use the first set/append property for rollback tracking (if multiple, they share attempt_id)
    # We'll track the first for outbox fallback; all share the same attempt_id
    first_set_prop = (
        props_by_name[set_or_append_names[0]] if set_or_append_names else None
    )

    if set_or_append_names:
        async with pool.connection() as conn:
            async with conn.transaction():
                for name in set_or_append_names:
                    await binding_mod.upsert_pending(
                        conn,
                        property_id=props_by_name[name].property_id,
                        kn_code=kn_code,
                        file_path=file_path,
                        attempt_id=attempt_id,
                    )

    # 6. Translate request body for backend
    backend_payload = translate_request_metadata(body, name_to_backend)
    backend_payload["knCode"] = cfg.resource_code

    # 7. Resolve auth headers
    headers = await state.auth_provider.resolve_headers(
        cfg.headers, user_code=x_user_id
    )

    # 8. Circuit breaker gate
    cb_key = cfg.domain_url or cfg.domain_name
    cb = state.circuit_breakers.get(cb_key)
    if not cb.before_call():
        if first_set_prop is not None:
            await _rollback_binding(
                pool, attempt_id, first_set_prop.property_id, kn_code, file_path
            )
        raise CircuitOpen(f"circuit OPEN for {kn_code}", kn_code=kn_code)

    # 9. Call backend
    try:
        resp = await call_backend_json(
            config=cfg,
            op_path=op_path,
            body=backend_payload,
            headers=headers,
            http=state.http,
        )
        cb.record_success()
    except httpx.TimeoutException as exc:
        cb.record_failure()
        if first_set_prop is not None:
            await _rollback_binding(
                pool, attempt_id, first_set_prop.property_id, kn_code, file_path
            )
        raise UpstreamTimeout(
            f"timeout calling {cfg.domain_url or cfg.domain_name}{op_path}",
            kn_code=kn_code,
        ) from exc
    except (httpx.ConnectError, httpx.NetworkError) as exc:
        cb.record_failure()
        if first_set_prop is not None:
            await _rollback_binding(
                pool, attempt_id, first_set_prop.property_id, kn_code, file_path
            )
        raise UpstreamConnectError(
            f"connect error calling {cfg.domain_url or cfg.domain_name}{op_path}",
            kn_code=kn_code,
        ) from exc
    except BackendAuthError as exc:
        cb.record_failure()
        if first_set_prop is not None:
            await _rollback_binding(
                pool, attempt_id, first_set_prop.property_id, kn_code, file_path
            )
        raise BackendAuthFailed(str(exc), kn_code=kn_code) from exc
    except ValueError as exc:
        cb.record_failure()
        if first_set_prop is not None:
            await _rollback_binding(
                pool, attempt_id, first_set_prop.property_id, kn_code, file_path
            )
        raise UpstreamConnectError(
            f"decode error calling {cfg.domain_url or cfg.domain_name}{op_path}",
            kn_code=kn_code,
        ) from exc

    # 10. Backend resultCode check — passthrough on failure
    if resp.get("resultCode") != "0":
        if first_set_prop is not None:
            await _rollback_binding(
                pool, attempt_id, first_set_prop.property_id, kn_code, file_path
            )
        return resp

    # 11. Mark SYNCED
    if set_or_append_names:
        await binding_mod.mark_synced_by_attempt(pool, attempt_id=attempt_id)

    # 12. Process unset/clear — delete binding rows
    unset_or_clear_ops = [
        op for op in op_list if op.get("operation") in {"unset", "clear"}
    ]
    if unset_or_clear_ops:
        async with pool.connection() as conn:
            async with conn.transaction():
                for op in unset_or_clear_ops:
                    await binding_mod.delete_by_property_op(
                        conn,
                        property_id=props_by_name[op["propertyName"]].property_id,
                        kn_code=kn_code,
                        file_path=file_path,
                    )

    # 13. Reverse-translate response
    _remap_kn_code(resp, resource_code=cfg.resource_code, portal_kn_code=kn_code)
    return translate_response_metadata(resp, backend_to_name)


@router.post("/knowledgeItems/metadata/get")
async def metadata_get(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
) -> dict[str, Any]:
    """Get metadata for a knowledge item file (read-only, no binding writes)."""
    state = request.app.state
    pool = state.pool

    kn_code = str(body["knCode"])
    field_list = list(body.get("metadataFieldList") or ())

    # Resolve property map for field name translation (if fields specified)
    if field_list:
        name_to_backend, backend_to_name, _ = await _resolve_property_map(
            pool, field_list
        )
    else:
        name_to_backend = {}
        backend_to_name = {}

    # Resolve KB config
    cfg = await state.config_provider.get_kb_config(kn_code)
    if cfg is None:
        raise KBNotFound(f"unknown knCode: {kn_code}", kn_code=kn_code)

    op_id = "knowledgeItemsMetadataGet"
    op_path = cfg.operation_path(op_id) or _DEFAULT_KB_PATHS.get(op_id, f"/{op_id}")

    # Translate request body
    backend_payload = translate_request_metadata(body, name_to_backend)
    backend_payload["knCode"] = cfg.resource_code

    # Resolve auth headers
    headers = await state.auth_provider.resolve_headers(
        cfg.headers, user_code=x_user_id
    )

    # Circuit breaker gate
    cb_key = cfg.domain_url or cfg.domain_name
    cb = state.circuit_breakers.get(cb_key)
    if not cb.before_call():
        raise CircuitOpen(f"circuit OPEN for {kn_code}", kn_code=kn_code)

    # Call backend
    try:
        resp = await call_backend_json(
            config=cfg,
            op_path=op_path,
            body=backend_payload,
            headers=headers,
            http=state.http,
        )
        cb.record_success()
    except httpx.TimeoutException as exc:
        cb.record_failure()
        raise UpstreamTimeout(
            f"timeout calling {cfg.domain_url or cfg.domain_name}{op_path}",
            kn_code=kn_code,
        ) from exc
    except (httpx.ConnectError, httpx.NetworkError) as exc:
        cb.record_failure()
        raise UpstreamConnectError(
            f"connect error calling {cfg.domain_url or cfg.domain_name}{op_path}",
            kn_code=kn_code,
        ) from exc
    except BackendAuthError as exc:
        cb.record_failure()
        raise BackendAuthFailed(str(exc), kn_code=kn_code) from exc
    except ValueError as exc:
        cb.record_failure()
        raise UpstreamConnectError(
            f"decode error calling {cfg.domain_url or cfg.domain_name}{op_path}",
            kn_code=kn_code,
        ) from exc

    # Reverse-translate response
    _remap_kn_code(resp, resource_code=cfg.resource_code, portal_kn_code=kn_code)
    return translate_response_metadata(resp, backend_to_name)


@router.post("/knowledgeItems/metadataFields/list")
async def metadata_fields_list(
    request: Request,
    body: dict[str, Any],
) -> dict[str, Any]:
    """List gateway-managed metadata fields synced to the given KBs (local-only).

    Reads kgw_metadata_property_sync + kgw_metadata_property — does NOT call backend.
    Returns only fields written through the gateway (system fields and natively-written
    fields are not exposed by this endpoint after S4).
    """
    pool = request.app.state.pool
    kn_codes = list(body.get("knCodeList") or ())
    if not kn_codes:
        return success({"data": []})
    pids: set[int] = set()
    for kc in kn_codes:
        ids = await sync_mod.list_synced_property_ids_for_kn(pool, kc)
        pids.update(ids)
    if not pids:
        return success({"data": []})
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT property_name, value_type, description "
                "FROM kgw_metadata_property "
                "WHERE property_id = ANY(%s) AND status='ACTIVE'",
                (list(pids),),
            )
            rows = await cur.fetchall()
    return success(
        {
            "data": [
                {
                    "propertyName": r["property_name"],
                    "valueType": r["value_type"],
                    "description": r.get("description"),
                }
                for r in rows
            ]
        }
    )
