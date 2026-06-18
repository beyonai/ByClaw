from __future__ import annotations

from typing import Annotated, Any

import httpx
import yaml
from fastapi import APIRouter, File, Form, Header, Request, UploadFile
from kgw.dispatcher import (
    _DEFAULT_KB_PATHS,
    GatewayOp,
    KbOp,
    _remap_kn_code,
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
    UploadStreamBroken,
    UpstreamConnectError,
    UpstreamTimeout,
    success,
)
from kgw.metadata import binding as binding_mod
from kgw.metadata import registry
from kgw.metadata import sync as sync_mod
from kgw.metadata.translator import (
    _DSL_BOOL_OPS,
    _DSL_LEAF_OPS,
    translate_request_dsl_where,
    translate_request_metadata,
    translate_response_metadata,
)
from kgw.metadata.types import MetadataOperation, MetadataValueType
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
_OPS_FOR_TYPE: dict[MetadataValueType, frozenset[MetadataOperation]] = {
    MetadataValueType.STRING: frozenset(
        {MetadataOperation.SET, MetadataOperation.UNSET}
    ),
    MetadataValueType.NUMBER: frozenset(
        {MetadataOperation.SET, MetadataOperation.UNSET}
    ),
    MetadataValueType.BOOLEAN: frozenset(
        {MetadataOperation.SET, MetadataOperation.UNSET}
    ),
    MetadataValueType.DATETIME: frozenset(
        {MetadataOperation.SET, MetadataOperation.UNSET}
    ),
    MetadataValueType.STRING_LIST: frozenset(
        {
            MetadataOperation.SET,
            MetadataOperation.UNSET,
            MetadataOperation.APPEND,
            MetadataOperation.REMOVE,
            MetadataOperation.CLEAR,
        }
    ),
}
# Fallback for unknown value_types — only set/unset allowed
_DEFAULT_OPS: frozenset[MetadataOperation] = frozenset(
    {MetadataOperation.SET, MetadataOperation.UNSET}
)


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _is_markdown(file_path: str) -> bool:
    """Return True if the file path looks like a Markdown file."""
    lower = file_path.lower()
    return lower.endswith(".md") or lower.endswith(".markdown")


def _parse_front_matter(content: bytes) -> dict[str, Any]:
    """Parse YAML front matter from markdown content. Returns {} if none."""
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        return {}
    if not text.startswith("---"):
        return {}
    end_idx = text.find("---", 3)
    if end_idx == -1:
        return {}
    yaml_block = text[3:end_idx].strip()
    if not yaml_block:
        return {}
    try:
        parsed = yaml.safe_load(yaml_block)
    except yaml.YAMLError:
        return {}
    if not isinstance(parsed, dict):
        return {}
    return parsed


def _rewrite_front_matter(content: bytes, name_to_backend: dict[str, str]) -> bytes:
    """Replace propertyName keys in YAML front matter with backend_name keys."""
    text = content.decode("utf-8")
    end_idx = text.find("---", 3)
    if end_idx == -1:
        return content  # no closing delimiter; nothing to rewrite
    body_start = end_idx + 3
    yaml_block = text[3:end_idx].strip()
    original = yaml.safe_load(yaml_block)
    rewritten = {name_to_backend.get(k, k): v for k, v in original.items()}
    new_yaml = yaml.dump(
        rewritten, allow_unicode=True, default_flow_style=False
    ).rstrip()
    new_text = f"---\n{new_yaml}\n---{text[body_start:]}"
    return new_text.encode("utf-8")


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


def _collect_dsl_field_names(where: Any) -> list[str]:
    """Walk DSL ``where`` AST and return all leaf ``fieldName`` values.

    Uses the same operator sets as ``translate_request_dsl_where`` so the
    collector and translator never disagree on which nodes are leaves.
    """
    out: list[str] = []

    def _walk(node: Any) -> None:
        if not isinstance(node, dict) or len(node) != 1:
            return
        op, body = next(iter(node.items()))
        if op in _DSL_BOOL_OPS:
            if op == "not":
                _walk(body)
            elif isinstance(body, list):
                for child in body:
                    _walk(child)
        elif op in _DSL_LEAF_OPS and isinstance(body, dict) and "fieldName" in body:
            field = body["fieldName"]
            if isinstance(field, str):
                out.append(field)

    _walk(where)
    return out


async def _resolve_known_property_map(
    pool: Any, names: list[str]
) -> tuple[dict[str, str], dict[str, str]]:
    """Resolve only the names that ARE active in the registry.

    Unlike ``_resolve_property_map``, this never raises for unknown names — they
    are silently dropped from the maps so callers (read path) pass them through
    untranslated. Returns (name_to_backend, backend_to_name).
    """
    if not names:
        return {}, {}
    props = await registry.list_active_properties(pool, names)
    n2b = {p.property_name: p.backend_name for p in props}
    b2n = {b: n for n, b in n2b.items()}
    return n2b, b2n


async def _prepare_search_body(
    pool: Any, body: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, str]]:
    """Resolve declared field names from body, return (rewritten_body, b2n).

    The rewritten body has DSL `where` fieldNames and `metadataFieldList` entries
    rewritten to backend names. Unknown names pass through unchanged (read-path
    semantics — no MetadataPropertyNotFound).
    """
    where = body.get("where")
    field_list = list(body.get("metadataFieldList") or ())
    declared: list[str] = []
    if isinstance(where, dict):
        declared.extend(_collect_dsl_field_names(where))
    declared.extend(field_list)
    n2b, b2n = await _resolve_known_property_map(pool, list(dict.fromkeys(declared)))
    if not n2b:
        return body, b2n
    backend_body = dict(body)
    if isinstance(where, dict) and where:
        backend_body["where"] = translate_request_dsl_where(where, n2b)
    if field_list:
        backend_body = translate_request_metadata(backend_body, n2b)
    return backend_body, b2n


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
    pool: Any,
    *,
    attempt_id: int,
    pending_keys: list[tuple[int, str, str]],  # (property_id, kn_code, file_path)
) -> None:
    """Roll back PENDING bindings for an attempt_id.

    Tries delete_by_attempt first. On DB failure, writes an outbox row per
    affected (property_id, kn_code, file_path) so the reconcile worker can
    finish the cleanup later.
    """
    try:
        await binding_mod.delete_by_attempt(pool, attempt_id)
    except Exception as exc:  # noqa: BLE001
        _log.warning(
            "metadata.update.rollback_failed",
            attempt_id=attempt_id,
            error=str(exc),
        )
        for property_id, kn_code, file_path in pending_keys:
            try:
                await binding_mod.write_outbox(
                    pool,
                    property_id=property_id,
                    kn_code=kn_code,
                    file_path=file_path,
                    attempt_id=attempt_id,
                )
            except Exception as outbox_exc:  # noqa: BLE001
                _log.error(
                    "metadata.update.outbox_failed",
                    attempt_id=attempt_id,
                    property_id=property_id,
                    error=str(outbox_exc),
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
    resp = await dispatch_json(
        request,
        operation=GatewayOp.FILE_DELETE,
        kn_code=kn_code,
        user_id=x_user_id,
        body=body,
        file_path=file_path,
    )
    if resp.get("resultCode") == "0" and file_path:
        # Cleanup may raise — fail loud is intentional: an orphaned binding
        # is harder to recover from than a client retry.
        await binding_mod.delete_by_file(
            request.app.state.pool, kn_code=kn_code, file_path=file_path
        )
    return resp


@router.post("/knowledgeItems/import")
async def knowledge_item_import(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    kn_code: Annotated[str, Form(alias="knCode")],
    file_path: Annotated[str, Form(alias="filePath")],
    file_content: Annotated[UploadFile, File(alias="fileContent")],
    process_front_matter: Annotated[bool, Form(alias="processFrontMatter")] = True,
) -> dict[str, Any]:
    """Stream multipart upload to the KB backend without buffering full file in RAM.

    For markdown files with *process_front_matter* enabled, parses YAML front
    matter and rewrites property names to backend_name keys before uploading.
    When disabled, front matter parsing and metadata registration are skipped
    entirely. Non-markdown files use the original proxy_upload streaming path
    unchanged.
    """
    from kgw.audit import AuditEntry

    state = request.app.state
    pool = state.pool

    config = await state.config_provider.get_kb_config(kn_code)
    if config is None:
        raise KBNotFound(f"unknown knCode: {kn_code}", kn_code=kn_code)
    if KbOp.FILE_IMPORT not in config.operations:
        raise OperationNotSupported(
            f"fileImport not supported by {kn_code}",
            kn_code=kn_code,
            operation=GatewayOp.FILE_IMPORT,
        )

    cb = state.circuit_breakers.get(config.domain_url or config.domain_name)
    if not cb.before_call():
        raise CircuitOpen(f"circuit OPEN for {kn_code}", kn_code=kn_code)

    headers = await state.auth_provider.resolve_headers(
        config.headers, user_code=x_user_id
    )
    op_path = config.operation_path(KbOp.FILE_IMPORT) or _DEFAULT_KB_PATHS.get(
        KbOp.FILE_IMPORT, "/api/v1/knowledgeItems/import"
    )
    # resolve_base_url handles both direct (domain_url) and by-framework
    # service-discovery (domain_name) modes, making multipart upload work
    # correctly in both topologies.
    from kgw.upstream import resolve_base_url  # noqa: PLC0415

    base_url = await resolve_base_url(config)
    url = base_url + op_path

    common_fields = {
        "knCode": config.resource_code,
        "filePath": file_path,
        "processFrontMatter": str(process_front_matter).lower(),
    }

    if _is_markdown(file_path) and process_front_matter:
        # Buffer the full file — required for front-matter parsing and rewriting
        raw_content: bytes = await file_content.read()
        front_matter = _parse_front_matter(raw_content)

        modified_content = raw_content
        attempt_id: int | None = None
        pending_keys: list[tuple[int, str, str]] = []

        if front_matter:
            _log.info(
                "import.front_matter.found",
                kn_code=kn_code,
                file_path=file_path,
                keys=list(front_matter.keys()),
            )
            # Q1=A: reject unregistered field names
            n2b, _, props_by_name = await _resolve_property_map(
                pool, list(front_matter.keys())
            )
            # Lazy sync: ensure each property is synced to the backend endpoint
            for prop in props_by_name.values():
                await sync_mod.ensure_synced(
                    state,
                    property_id=prop.property_id,
                    kn_code=kn_code,
                    user_code=x_user_id,
                )
            # Write PENDING bindings atomically
            attempt_id = binding_mod.new_attempt_id()
            pending_keys = [
                (p.property_id, kn_code, file_path) for p in props_by_name.values()
            ]
            async with pool.connection() as conn:
                async with conn.transaction():
                    for prop in props_by_name.values():
                        await binding_mod.upsert_pending(
                            conn,
                            property_id=prop.property_id,
                            kn_code=kn_code,
                            file_path=file_path,
                            attempt_id=attempt_id,
                        )
            # Rewrite front-matter keys to backend names
            modified_content = _rewrite_front_matter(raw_content, n2b)
        else:
            _log.info(
                "import.front_matter.skipped",
                kn_code=kn_code,
                file_path=file_path,
                reason="no frontmatter in markdown file",
            )

        # Upload buffered bytes via httpx directly (stream already consumed)
        try:
            resp = await state.http.post(
                url,
                headers=headers,
                files={
                    "fileContent": (
                        file_content.filename or "file",
                        modified_content,
                        "text/markdown",
                    )
                },
                data=common_fields,
                timeout=60.0,
            )
            if resp.status_code in (401, 403):
                raise BackendAuthFailed(
                    f"backend auth failed uploading to {url}", kn_code=kn_code
                )
            result = resp.json()
            cb.record_success()
        except (httpx.TimeoutException, httpx.StreamError, httpx.ReadError) as exc:
            cb.record_failure()
            if attempt_id is not None:
                await _rollback_binding(
                    pool, attempt_id=attempt_id, pending_keys=pending_keys
                )
            raise UploadStreamBroken(
                f"upload stream broken: {url}", kn_code=kn_code
            ) from exc
        except BackendAuthFailed:
            cb.record_failure()
            if attempt_id is not None:
                await _rollback_binding(
                    pool, attempt_id=attempt_id, pending_keys=pending_keys
                )
            raise

        if attempt_id is not None:
            result_ok = result.get("resultCode") == "0"
            if result_ok:
                _log.info(
                    "import.metadata.synced",
                    kn_code=kn_code,
                    file_path=file_path,
                    keys=list(front_matter.keys()),
                )
                await binding_mod.mark_synced_by_attempt(pool, attempt_id=attempt_id)
            else:
                await _rollback_binding(
                    pool, attempt_id=attempt_id, pending_keys=pending_keys
                )
    else:
        _log.info(
            "import.front_matter.skipped",
            kn_code=kn_code,
            file_path=file_path,
            reason=(
                "processFrontMatter disabled"
                if not process_front_matter
                else "not a markdown file"
            ),
        )
        # Streaming proxy_upload path (no buffering, no front matter processing)
        try:
            result = await proxy_upload(
                url=url,
                upstream_headers=headers,
                http=state.http,
                form_fields=common_fields,
                upload_file=file_content,
                kn_code=kn_code,
                operation=GatewayOp.FILE_IMPORT,
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
            operation_type=GatewayOp.FILE_IMPORT.value,
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
    return result


@router.post("/knowledgeItems/search")
async def knowledge_search(
    request: Request,
    body: dict[str, Any],
    x_user_id: Annotated[str, Header(alias="X-User-Id")] = "",
) -> dict[str, Any]:
    """Multi-KB parallel semantic search."""
    kn_code_list = list(body.get("knCodeList") or [])
    backend_body, b2n = await _prepare_search_body(request.app.state.pool, body)
    resp = await dispatch_fanout_json(
        request,
        operation=GatewayOp.KNOWLEDGE_SEARCH,
        kn_code_list=kn_code_list,
        user_id=x_user_id,
        body=backend_body,
    )
    return translate_response_metadata(resp, b2n) if b2n else resp


@router.post("/knowledgeItems/metadataSearch")
async def metadata_search(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
) -> dict[str, Any]:
    """Multi-KB parallel metadata-only search."""
    kn_code_list = list(body.get("knCodeList") or [])
    backend_body, b2n = await _prepare_search_body(request.app.state.pool, body)
    resp = await dispatch_fanout_json(
        request,
        operation=GatewayOp.METADATA_SEARCH,
        kn_code_list=kn_code_list,
        user_id=x_user_id,
        body=backend_body,
    )
    return translate_response_metadata(resp, b2n) if b2n else resp


@router.post("/knowledgeItems/searchFile")
async def search_file(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
) -> dict[str, Any]:
    """Multi-KB parallel file-level search."""
    kn_code_list = list(body.get("knCodeList") or [])
    backend_body, b2n = await _prepare_search_body(request.app.state.pool, body)
    resp = await dispatch_fanout_json(
        request,
        operation=GatewayOp.SEARCH_FILE,
        kn_code_list=kn_code_list,
        user_id=x_user_id,
        body=backend_body,
    )
    return translate_response_metadata(resp, b2n) if b2n else resp


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

    op_id = KbOp.KNOWLEDGE_ITEMS_METADATA_UPDATE
    op_path = cfg.operation_path(op_id) or _DEFAULT_KB_PATHS.get(
        op_id, f"/{op_id.value}"
    )

    # 4. Lazy sync for each unique property_id
    unique_props = {p.property_id: p for p in props_by_name.values()}
    for p in unique_props.values():
        await sync_mod.ensure_synced(
            state, property_id=p.property_id, kn_code=kn_code, user_code=x_user_id
        )

    # 5. Generate attempt_id and write PENDING bindings for set/append ops
    attempt_id = binding_mod.new_attempt_id()
    set_or_append_names = [
        op["propertyName"]
        for op in op_list
        if op.get("operation") in {MetadataOperation.SET, MetadataOperation.APPEND}
    ]

    pending_keys: list[tuple[int, str, str]] = [
        (props_by_name[name].property_id, kn_code, file_path)
        for name in set_or_append_names
    ]

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
        if pending_keys:
            await _rollback_binding(
                pool, attempt_id=attempt_id, pending_keys=pending_keys
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
        if pending_keys:
            await _rollback_binding(
                pool, attempt_id=attempt_id, pending_keys=pending_keys
            )
        raise UpstreamTimeout(
            f"timeout calling {cfg.domain_url or cfg.domain_name}{op_path}",
            kn_code=kn_code,
        ) from exc
    except (httpx.ConnectError, httpx.NetworkError) as exc:
        cb.record_failure()
        if pending_keys:
            await _rollback_binding(
                pool, attempt_id=attempt_id, pending_keys=pending_keys
            )
        raise UpstreamConnectError(
            f"connect error calling {cfg.domain_url or cfg.domain_name}{op_path}",
            kn_code=kn_code,
        ) from exc
    except BackendAuthError as exc:
        cb.record_failure()
        if pending_keys:
            await _rollback_binding(
                pool, attempt_id=attempt_id, pending_keys=pending_keys
            )
        raise BackendAuthFailed(str(exc), kn_code=kn_code) from exc

    # 10. Backend resultCode check — passthrough on failure
    if resp.get("resultCode") != "0":
        if pending_keys:
            await _rollback_binding(
                pool, attempt_id=attempt_id, pending_keys=pending_keys
            )
        _remap_kn_code(resp, resource_code=cfg.resource_code, portal_kn_code=kn_code)
        return resp

    # 11. Mark SYNCED
    if set_or_append_names:
        await binding_mod.mark_synced_by_attempt(pool, attempt_id=attempt_id)

    # 12. Process unset/clear — delete binding rows
    unset_or_clear_ops = [
        op
        for op in op_list
        if op.get("operation") in {MetadataOperation.UNSET, MetadataOperation.CLEAR}
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

    op_id = KbOp.KNOWLEDGE_ITEMS_METADATA_GET
    op_path = cfg.operation_path(op_id) or _DEFAULT_KB_PATHS.get(
        op_id, f"/{op_id.value}"
    )

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
    state = request.app.state
    pool = state.pool
    kn_codes = list(body.get("knCodeList") or ())
    if not kn_codes:
        return success({"data": []})

    # knCode → endpoint_key; dedupe so N knCodes sharing one backend hit the DB once
    endpoint_keys: set[str] = set()
    for kc in kn_codes:
        cfg = await state.config_provider.get_kb_config(kc)
        if cfg is None:
            continue
        endpoint_keys.add(cfg.domain_url or cfg.domain_name)
    if not endpoint_keys:
        return success({"data": []})

    pids: set[int] = set()
    for ep in endpoint_keys:
        ids = await sync_mod.list_synced_property_ids_for_endpoint(pool, ep)
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
