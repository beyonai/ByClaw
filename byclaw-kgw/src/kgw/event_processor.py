from __future__ import annotations

import asyncio
import base64
from dataclasses import dataclass
from datetime import datetime as _dt
from datetime import timezone as _tz
from typing import Any

import httpx
import yaml
from kgw import idempotency
from kgw.audit import AuditEntry
from kgw.dispatcher import _DEFAULT_KB_PATHS, KbOp
from kgw.envelope import METADATA_PROPERTY_NOT_REGISTERED, KBNotFound
from kgw.metadata import binding as binding_mod
from kgw.metadata import registry
from kgw.metadata import sync as sync_mod
from kgw.observability.logger import get_logger
from kgw.observability.metrics import kgw_ingest_events_total
from kgw.schemas.standard_item import (
    InlineBase64Content,
    RemoteUrlContent,
    StandardItem,
)
from kgw.upstream import call_backend_json, resolve_base_url

_log = get_logger(__name__)


# ---------------------------------------------------------------------------
# Markdown front-matter helpers (pure functions, no IO)
# ---------------------------------------------------------------------------


def _is_markdown(file_path: str) -> bool:
    lower = file_path.lower()
    return lower.endswith(".md") or lower.endswith(".markdown")


def _parse_front_matter(content: bytes) -> dict[str, Any]:
    """Return parsed YAML front-matter dict, or {} if none / invalid."""
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
    return parsed if isinstance(parsed, dict) else {}


def _rewrite_front_matter(content: bytes, name_to_backend: dict[str, str]) -> bytes:
    """Replace propertyName keys in YAML front-matter with backend_name keys."""
    text = content.decode("utf-8")
    end_idx = text.find("---", 3)
    if end_idx == -1:
        return content
    body_start = end_idx + 3
    yaml_block = text[3:end_idx].strip()
    original = yaml.safe_load(yaml_block) or {}
    rewritten = {name_to_backend.get(k, k): v for k, v in original.items()}
    new_yaml = yaml.dump(
        rewritten, allow_unicode=True, default_flow_style=False
    ).rstrip()
    return f"---\n{new_yaml}\n---{text[body_start:]}".encode("utf-8")


@dataclass
class EventResult:
    event_id: int
    status: str  # done / failed / already_processed / in_progress
    error_type: str | None = None
    error_message: str | None = None
    retry_count: int = 0


@dataclass(frozen=True)
class _CreatedBinding:
    property_id: int
    kn_code: str
    file_path: str
    updated_at: Any


async def process_event(
    state: Any,
    item: StandardItem,
    *,
    user_code: str,
    trace_id: str | None = None,
) -> EventResult:
    """Core ingest pipeline. Steps 1-2 raise KgwError (422). Steps 3-7 catch internally."""
    pool = state.pool

    # Step 1: knCode validation
    config = await state.config_provider.get_kb_config(item.kn_code)
    if config is None:
        raise KBNotFound(f"unknown knCode: {item.kn_code}", kn_code=item.kn_code)

    # Step 2: metadata key validation (upsert only, only if item.metadata is non-empty)
    if item.op == "upsert" and item.metadata:
        active = await registry.list_active_properties(pool, list(item.metadata.keys()))
        found = {p.property_name for p in active}
        missing = [k for k in item.metadata if k not in found]
        if missing:
            raise METADATA_PROPERTY_NOT_REGISTERED(
                f"metadataProperty '{missing[0]}' not declared in gateway master catalog",
                property_name=missing[0],
            )

    # Step 3: idempotent INSERT
    size = len(item.model_dump_json().encode())
    try:
        event_id = await idempotency.insert_received(
            pool, item, payload_size_bytes=size
        )
    except idempotency.DuplicateEvent:
        existing = await idempotency.get_by_idempotency_key(
            pool, source_id=item.source_id, item_id=item.item_id, version=item.version
        )
        if existing is None:
            return EventResult(event_id=0, status="in_progress")
        label = {"done": "already_processed", "received": "in_progress"}.get(
            existing.status, existing.status
        )
        kgw_ingest_events_total.labels(operation=item.op, result=label).inc()
        return EventResult(
            event_id=existing.event_id,
            status=label,
            error_type=existing.error_type,
            error_message=existing.error_message,
            retry_count=existing.retry_count,
        )

    # Step 4: source_lock check
    lock_row = await _get_source_lock(
        pool, kn_code=item.kn_code, file_path=item.file_path
    )
    if (
        lock_row
        and not _is_lock_expired(lock_row)
        and lock_row["lock_owner"] != user_code
    ):
        await _write_conflict(
            pool,
            item=item,
            reason="SOURCE_LOCKED",
            writer=user_code,
            current_writer=lock_row["lock_owner"],
        )
        await idempotency.mark_failed(
            pool,
            event_id,
            error_type="SOURCE_LOCKED",
            error_message=f"file locked by {lock_row['lock_owner']}",
        )
        kgw_ingest_events_total.labels(operation=item.op, result="source_locked").inc()
        return EventResult(
            event_id=event_id,
            status="failed",
            error_type="SOURCE_LOCKED",
            error_message=f"file locked by {lock_row['lock_owner']}",
        )

    # Step 5: version monotonicity (only if item.version is not None)
    if item.version is not None:
        last_ver = await _get_latest_done_version(
            pool, kn_code=item.kn_code, file_path=item.file_path
        )
        if last_ver is not None and item.version <= last_ver:
            await _write_conflict(
                pool,
                item=item,
                reason="STALE_VERSION",
                writer=user_code,
                current_writer=None,
            )
            await idempotency.mark_failed(
                pool,
                event_id,
                error_type="STALE_VERSION",
                error_message=f"version {item.version!r} <= existing {last_ver!r}",
            )
            kgw_ingest_events_total.labels(
                operation=item.op, result="stale_version"
            ).inc()
            return EventResult(
                event_id=event_id,
                status="failed",
                error_type="STALE_VERSION",
                error_message=f"version {item.version!r} <= existing {last_ver!r}",
            )

    # Steps 6-7: KB write — wrapped in 30s timeout
    try:
        async with asyncio.timeout(30):
            if item.op == "upsert":
                await _process_upsert(
                    state,
                    item,
                    event_id=event_id,
                    config=config,
                    user_code=user_code,
                    trace_id=trace_id,
                )
            else:
                await _process_delete(
                    state,
                    item,
                    event_id=event_id,
                    config=config,
                    user_code=user_code,
                    trace_id=trace_id,
                )
    except asyncio.TimeoutError:
        await idempotency.mark_failed(
            pool,
            event_id,
            error_type="PROCESSING_TIMEOUT",
            error_message="event processing exceeded 30s",
        )
        kgw_ingest_events_total.labels(
            operation=item.op, result="processing_timeout"
        ).inc()
        return EventResult(
            event_id=event_id, status="failed", error_type="PROCESSING_TIMEOUT"
        )

    row = await idempotency.get_by_id(pool, event_id)
    kgw_ingest_events_total.labels(operation=item.op, result=row.status).inc()
    return EventResult(
        event_id=event_id,
        status=row.status,
        error_type=row.error_type,
        error_message=row.error_message,
        retry_count=row.retry_count,
    )


async def _process_upsert(
    state: Any,
    item: StandardItem,
    *,
    event_id: int,
    config: Any,
    user_code: str,
    trace_id: str | None,
) -> None:
    pool = state.pool
    content_bytes, content_type = await _resolve_content(state.http, item)

    import_op_path = config.operation_path(KbOp.FILE_IMPORT) or _DEFAULT_KB_PATHS.get(
        KbOp.FILE_IMPORT, "/api/v1/knowledgeItems/import"
    )
    base_url = await resolve_base_url(config)
    url = base_url + import_op_path
    headers = await state.auth_provider.resolve_headers(
        config.headers, user_code=user_code
    )
    endpoint_key = config.domain_url or config.domain_name
    cb = state.circuit_breakers.get(endpoint_key)

    if not cb.before_call():
        await idempotency.mark_failed(
            pool,
            event_id,
            error_type="CIRCUIT_OPEN",
            error_message="circuit breaker OPEN",
        )
        await _audit(
            state,
            item=item,
            op_type="ingest.upsert",
            result_code="-1",
            result_msg="circuit breaker OPEN",
            size=0,
            trace_id=trace_id,
            user_code=user_code,
        )
        return

    created_bindings: list[_CreatedBinding] = []
    restored_deleting_bindings: list[_CreatedBinding] = []

    if _is_markdown(item.file_path):
        # --- Markdown path: parse + rewrite front matter, embed metadata in file ---
        front_matter = _parse_front_matter(content_bytes)

        # Merge: front matter keys + item.metadata keys (item.metadata wins on conflict)
        all_meta_keys = list(
            dict.fromkeys(
                list(front_matter.keys()) + list((item.metadata or {}).keys())
            )
        )

        upload_bytes = content_bytes

        if all_meta_keys:
            # Validate all keys are registered
            active = await registry.list_active_properties(pool, all_meta_keys)
            found = {p.property_name for p in active}
            missing = [k for k in all_meta_keys if k not in found]
            if missing:
                await idempotency.mark_failed(
                    pool,
                    event_id,
                    error_type="MetadataPropertyNotFound",
                    error_message=f"metadata property not found: {missing[0]}",
                )
                return

            props_by_name = {p.property_name: p for p in active}
            n2b = {p.property_name: p.backend_name for p in active}

            # Bind usage before lazy sync/backend import. Only rows created by
            # this request are rolled back if the backend write fails.
            async with pool.connection() as conn:
                async with conn.transaction():
                    for p in props_by_name.values():
                        bind_result = await binding_mod.bind_usage_with_previous_status(
                            conn,
                            property_id=p.property_id,
                            kn_code=item.kn_code,
                            file_path=item.file_path,
                        )
                        if bind_result.created:
                            updated_at = await _binding_updated_at(
                                conn,
                                property_id=p.property_id,
                                kn_code=item.kn_code,
                                file_path=item.file_path,
                            )
                            created_bindings.append(
                                _CreatedBinding(
                                    p.property_id,
                                    item.kn_code,
                                    item.file_path,
                                    updated_at,
                                )
                            )
                        elif bind_result.previous_status == binding_mod.DELETING:
                            updated_at = await _binding_updated_at(
                                conn,
                                property_id=p.property_id,
                                kn_code=item.kn_code,
                                file_path=item.file_path,
                            )
                            restored_deleting_bindings.append(
                                _CreatedBinding(
                                    p.property_id,
                                    item.kn_code,
                                    item.file_path,
                                    updated_at,
                                )
                            )

            try:
                # Lazy sync each property to the target KB
                for p in props_by_name.values():
                    await sync_mod.ensure_synced(
                        state,
                        property_id=p.property_id,
                        kn_code=item.kn_code,
                        user_code=user_code,
                    )
            except asyncio.CancelledError:
                await _rollback_failed_bindings(
                    pool, created_bindings, restored_deleting_bindings
                )
                raise
            except Exception as exc:  # noqa: BLE001
                await _rollback_failed_bindings(
                    pool, created_bindings, restored_deleting_bindings
                )
                await idempotency.mark_failed(
                    pool,
                    event_id,
                    error_type="MetadataPropertySyncFailed",
                    error_message=str(exc)[:500],
                )
                return

            # Build merged front matter (item.metadata overrides front_matter on conflict)
            merged_front_matter = {**front_matter, **(item.metadata or {})}

            if front_matter:
                # Rewrite existing front matter block with merged + backend-renamed keys
                # Build a full n2b for the merged set (all keys are in n2b already)
                upload_bytes = _rewrite_front_matter(content_bytes, n2b)
                # If item.metadata added keys not in the original front matter, inject them
                extra_keys = [k for k in (item.metadata or {}) if k not in front_matter]
                if extra_keys:
                    # Re-parse the already-rewritten front matter and add extra keys
                    extra_fm = {n2b[k]: merged_front_matter[k] for k in extra_keys}
                    upload_bytes = _inject_extra_front_matter(upload_bytes, extra_fm)
            else:
                # No existing front matter — prepend a new block with item.metadata
                new_fm = {n2b[k]: v for k, v in (item.metadata or {}).items()}
                upload_bytes = _prepend_front_matter(content_bytes, new_fm)

        # Upload the (possibly rewritten) bytes
        filename = item.file_path.split("/")[-1] or "file"
        try:
            resp = await state.http.post(
                url,
                headers=headers,
                files={"fileContent": (filename, upload_bytes, "text/markdown")},
                data={"knCode": config.resource_code, "filePath": item.file_path},
                timeout=25.0,
            )
            if resp.status_code in (401, 403):
                cb.record_failure()
                await _rollback_failed_bindings(
                    pool, created_bindings, restored_deleting_bindings
                )
                await idempotency.mark_failed(
                    pool,
                    event_id,
                    error_type="BACKEND_AUTH_FAILED",
                    error_message=f"backend auth {resp.status_code}",
                )
                await _audit(
                    state,
                    item=item,
                    op_type="ingest.upsert",
                    result_code="-1",
                    result_msg=f"auth {resp.status_code}",
                    size=len(upload_bytes),
                    trace_id=trace_id,
                    user_code=user_code,
                )
                return
            try:
                result = resp.json()
            except ValueError as exc:
                cb.record_failure()
                await _rollback_failed_bindings(
                    pool, created_bindings, restored_deleting_bindings
                )
                await idempotency.mark_failed(
                    pool,
                    event_id,
                    error_type="UPSTREAM_INVALID_JSON",
                    error_message=str(exc)[:500],
                )
                await _audit(
                    state,
                    item=item,
                    op_type="ingest.upsert",
                    result_code="-1",
                    result_msg="invalid backend JSON",
                    size=len(upload_bytes),
                    trace_id=trace_id,
                    user_code=user_code,
                )
                return
            cb.record_success()
        except asyncio.CancelledError:
            await _rollback_failed_bindings(
                pool, created_bindings, restored_deleting_bindings
            )
            raise
        except (httpx.TimeoutException, httpx.ConnectError, httpx.NetworkError) as exc:
            cb.record_failure()
            await _rollback_failed_bindings(
                pool, created_bindings, restored_deleting_bindings
            )
            await idempotency.mark_failed(
                pool,
                event_id,
                error_type="UPSTREAM_ERROR",
                error_message=str(exc)[:500],
            )
            await _audit(
                state,
                item=item,
                op_type="ingest.upsert",
                result_code="-1",
                result_msg=str(exc)[:200],
                size=len(upload_bytes),
                trace_id=trace_id,
                user_code=user_code,
            )
            return

        if result.get("resultCode") != "0":
            cb.record_failure()
            await _rollback_failed_bindings(
                pool, created_bindings, restored_deleting_bindings
            )
            await idempotency.mark_failed(
                pool,
                event_id,
                error_type="UPSTREAM_ERROR",
                error_message=result.get("resultMsg", "")[:500],
            )
            await _audit(
                state,
                item=item,
                op_type="ingest.upsert",
                result_code="-1",
                result_msg=result.get("resultMsg", ""),
                size=len(upload_bytes),
                trace_id=trace_id,
                user_code=user_code,
            )
            return

        content_bytes = upload_bytes  # for audit size

    else:
        # --- Non-markdown path: upload original bytes, then separate metadata/update ---
        active = []
        props_by_name = {}

        if item.metadata:
            active = await registry.list_active_properties(
                pool, list(item.metadata.keys())
            )
            found = {p.property_name for p in active}
            missing = [k for k in item.metadata if k not in found]
            if missing:
                await idempotency.mark_failed(
                    pool,
                    event_id,
                    error_type="MetadataPropertyNotFound",
                    error_message=f"metadata property not found: {missing[0]}",
                )
                return

            props_by_name = {p.property_name: p for p in active}

            async with pool.connection() as conn:
                async with conn.transaction():
                    for p in props_by_name.values():
                        bind_result = await binding_mod.bind_usage_with_previous_status(
                            conn,
                            property_id=p.property_id,
                            kn_code=item.kn_code,
                            file_path=item.file_path,
                        )
                        if bind_result.created:
                            updated_at = await _binding_updated_at(
                                conn,
                                property_id=p.property_id,
                                kn_code=item.kn_code,
                                file_path=item.file_path,
                            )
                            created_bindings.append(
                                _CreatedBinding(
                                    p.property_id,
                                    item.kn_code,
                                    item.file_path,
                                    updated_at,
                                )
                            )
                        elif bind_result.previous_status == binding_mod.DELETING:
                            updated_at = await _binding_updated_at(
                                conn,
                                property_id=p.property_id,
                                kn_code=item.kn_code,
                                file_path=item.file_path,
                            )
                            restored_deleting_bindings.append(
                                _CreatedBinding(
                                    p.property_id,
                                    item.kn_code,
                                    item.file_path,
                                    updated_at,
                                )
                            )

            try:
                for p in props_by_name.values():
                    await sync_mod.ensure_synced(
                        state,
                        property_id=p.property_id,
                        kn_code=item.kn_code,
                        user_code=user_code,
                    )
            except asyncio.CancelledError:
                await _rollback_failed_bindings(
                    pool, created_bindings, restored_deleting_bindings
                )
                raise
            except Exception as exc:  # noqa: BLE001
                await _rollback_failed_bindings(
                    pool, created_bindings, restored_deleting_bindings
                )
                await idempotency.mark_failed(
                    pool,
                    event_id,
                    error_type="MetadataPropertySyncFailed",
                    error_message=str(exc)[:500],
                )
                return

        filename = item.file_path.split("/")[-1] or "file"
        try:
            resp = await state.http.post(
                url,
                headers=headers,
                files={
                    "fileContent": (
                        filename,
                        content_bytes,
                        content_type or "application/octet-stream",
                    )
                },
                data={"knCode": config.resource_code, "filePath": item.file_path},
                timeout=25.0,
            )
            if resp.status_code in (401, 403):
                cb.record_failure()
                await _rollback_failed_bindings(
                    pool, created_bindings, restored_deleting_bindings
                )
                await idempotency.mark_failed(
                    pool,
                    event_id,
                    error_type="BACKEND_AUTH_FAILED",
                    error_message=f"backend auth {resp.status_code}",
                )
                await _audit(
                    state,
                    item=item,
                    op_type="ingest.upsert",
                    result_code="-1",
                    result_msg=f"auth {resp.status_code}",
                    size=len(content_bytes),
                    trace_id=trace_id,
                    user_code=user_code,
                )
                return
            try:
                result = resp.json()
            except ValueError as exc:
                cb.record_failure()
                await _rollback_failed_bindings(
                    pool, created_bindings, restored_deleting_bindings
                )
                await idempotency.mark_failed(
                    pool,
                    event_id,
                    error_type="UPSTREAM_INVALID_JSON",
                    error_message=str(exc)[:500],
                )
                await _audit(
                    state,
                    item=item,
                    op_type="ingest.upsert",
                    result_code="-1",
                    result_msg="invalid backend JSON",
                    size=len(content_bytes),
                    trace_id=trace_id,
                    user_code=user_code,
                )
                return
            cb.record_success()
        except asyncio.CancelledError:
            await _rollback_failed_bindings(
                pool, created_bindings, restored_deleting_bindings
            )
            raise
        except (httpx.TimeoutException, httpx.ConnectError, httpx.NetworkError) as exc:
            cb.record_failure()
            await _rollback_failed_bindings(
                pool, created_bindings, restored_deleting_bindings
            )
            await idempotency.mark_failed(
                pool,
                event_id,
                error_type="UPSTREAM_ERROR",
                error_message=str(exc)[:500],
            )
            await _audit(
                state,
                item=item,
                op_type="ingest.upsert",
                result_code="-1",
                result_msg=str(exc)[:200],
                size=len(content_bytes),
                trace_id=trace_id,
                user_code=user_code,
            )
            return

        if result.get("resultCode") != "0":
            cb.record_failure()
            await _rollback_failed_bindings(
                pool, created_bindings, restored_deleting_bindings
            )
            await idempotency.mark_failed(
                pool,
                event_id,
                error_type="UPSTREAM_ERROR",
                error_message=result.get("resultMsg", "")[:500],
            )
            await _audit(
                state,
                item=item,
                op_type="ingest.upsert",
                result_code="-1",
                result_msg=result.get("resultMsg", ""),
                size=len(content_bytes),
                trace_id=trace_id,
                user_code=user_code,
            )
            return

        # Separate metadata/update call for non-markdown files
        if item.metadata:
            n2b = {p.property_name: p.backend_name for p in active}
            meta_op_path = config.operation_path(
                KbOp.KNOWLEDGE_ITEMS_METADATA_UPDATE
            ) or _DEFAULT_KB_PATHS.get(
                KbOp.KNOWLEDGE_ITEMS_METADATA_UPDATE,
                "/api/v1/knowledgeItems/metadata/update",
            )
            meta_body = {
                "knCode": config.resource_code,
                "filePath": item.file_path,
                "operationList": [
                    {"propertyName": n2b[k], "operation": "set", "value": v}
                    for k, v in item.metadata.items()
                ],
            }
            try:
                meta_resp = await call_backend_json(
                    config=config,
                    op_path=meta_op_path,
                    body=meta_body,
                    headers=headers,
                    http=state.http,
                )
            except asyncio.CancelledError:
                await _rollback_failed_bindings(
                    pool, created_bindings, restored_deleting_bindings
                )
                raise
            except Exception as exc:  # noqa: BLE001
                await _rollback_failed_bindings(
                    pool, created_bindings, restored_deleting_bindings
                )
                await idempotency.mark_failed(
                    pool,
                    event_id,
                    error_type="UPSTREAM_ERROR",
                    error_message=str(exc)[:500],
                )
                await _audit(
                    state,
                    item=item,
                    op_type="ingest.upsert",
                    result_code="-1",
                    result_msg=str(exc)[:200],
                    size=len(content_bytes),
                    trace_id=trace_id,
                    user_code=user_code,
                )
                return

            if meta_resp.get("resultCode") != "0":
                cb.record_failure()
                await _rollback_failed_bindings(
                    pool, created_bindings, restored_deleting_bindings
                )
                await idempotency.mark_failed(
                    pool,
                    event_id,
                    error_type="UPSTREAM_ERROR",
                    error_message=meta_resp.get("resultMsg", "")[:500],
                )
                await _audit(
                    state,
                    item=item,
                    op_type="ingest.upsert",
                    result_code="-1",
                    result_msg=meta_resp.get("resultMsg", ""),
                    size=len(content_bytes),
                    trace_id=trace_id,
                    user_code=user_code,
                )
                return

    # Fire-and-forget build trigger (both paths)
    build_op_path = config.operation_path(KbOp.BUILD_TRIGGER) or _DEFAULT_KB_PATHS.get(
        KbOp.BUILD_TRIGGER, "/api/v1/fileToMarkdownIndex"
    )
    try:
        await call_backend_json(
            config=config,
            op_path=build_op_path,
            body={"knCode": config.resource_code, "filePath": item.file_path},
            headers=headers,
            http=state.http,
        )
    except Exception as exc:  # noqa: BLE001
        _log.warning(
            "event_processor.build_trigger_failed",
            kn_code=item.kn_code,
            file_path=item.file_path,
            error=str(exc)[:200],
        )

    await idempotency.mark_done(pool, event_id)
    await _audit(
        state,
        item=item,
        op_type="ingest.upsert",
        result_code="0",
        result_msg="success",
        size=len(content_bytes),
        trace_id=trace_id,
        user_code=user_code,
    )


async def _process_delete(
    state: Any,
    item: StandardItem,
    *,
    event_id: int,
    config: Any,
    user_code: str,
    trace_id: str | None,
) -> None:
    pool = state.pool
    op_path = config.operation_path(KbOp.FILE_DELETE) or _DEFAULT_KB_PATHS.get(
        KbOp.FILE_DELETE, "/api/v1/knowledgeItems/delete"
    )
    headers = await state.auth_provider.resolve_headers(
        config.headers, user_code=user_code
    )
    endpoint_key = config.domain_url or config.domain_name
    cb = state.circuit_breakers.get(endpoint_key)

    if not cb.before_call():
        await idempotency.mark_failed(
            pool,
            event_id,
            error_type="CIRCUIT_OPEN",
            error_message="circuit breaker OPEN",
        )
        await _audit(
            state,
            item=item,
            op_type="ingest.delete",
            result_code="-1",
            result_msg="circuit breaker OPEN",
            size=0,
            trace_id=trace_id,
            user_code=user_code,
        )
        return

    body = {"knCode": config.resource_code, "filePath": item.file_path}
    try:
        resp = await call_backend_json(
            config=config,
            op_path=op_path,
            body=body,
            headers=headers,
            http=state.http,
        )
        cb.record_success()
    except Exception as exc:  # noqa: BLE001
        cb.record_failure()
        await idempotency.mark_failed(
            pool,
            event_id,
            error_type="UPSTREAM_ERROR",
            error_message=str(exc)[:500],
        )
        await _audit(
            state,
            item=item,
            op_type="ingest.delete",
            result_code="-1",
            result_msg=str(exc)[:200],
            size=0,
            trace_id=trace_id,
            user_code=user_code,
        )
        return

    if resp.get("resultCode") != "0":
        await idempotency.mark_failed(
            pool,
            event_id,
            error_type="UPSTREAM_ERROR",
            error_message=resp.get("resultMsg", "")[:500],
        )
        await _audit(
            state,
            item=item,
            op_type="ingest.delete",
            result_code="-1",
            result_msg=resp.get("resultMsg", ""),
            size=0,
            trace_id=trace_id,
            user_code=user_code,
        )
        return

    await binding_mod.delete_by_file(
        pool, kn_code=item.kn_code, file_path=item.file_path
    )
    await idempotency.mark_done(pool, event_id)
    await _audit(
        state,
        item=item,
        op_type="ingest.delete",
        result_code="0",
        result_msg="success",
        size=0,
        trace_id=trace_id,
        user_code=user_code,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _inject_extra_front_matter(content: bytes, extra: dict) -> bytes:
    """Add extra key/value pairs into an existing YAML front matter block."""
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        return content
    if not text.startswith("---"):
        return content
    end_idx = text.find("---", 3)
    if end_idx == -1:
        return content
    body_start = end_idx + 3
    yaml_block = text[3:end_idx].strip()
    try:
        parsed = yaml.safe_load(yaml_block) or {}
    except yaml.YAMLError:
        return content
    merged = {**parsed, **extra}
    new_yaml = yaml.dump(merged, allow_unicode=True, default_flow_style=False).rstrip()
    new_text = f"---\n{new_yaml}\n---{text[body_start:]}"
    return new_text.encode("utf-8")


def _prepend_front_matter(content: bytes, front_matter: dict) -> bytes:
    """Prepend a YAML front matter block to content that has none."""
    if not front_matter:
        return content
    new_yaml = yaml.dump(
        front_matter, allow_unicode=True, default_flow_style=False
    ).rstrip()
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        return content
    new_text = f"---\n{new_yaml}\n---\n{text}"
    return new_text.encode("utf-8")


async def _resolve_content(
    http: httpx.AsyncClient, item: StandardItem
) -> tuple[bytes, str | None]:
    if isinstance(item.content, str):
        return item.content.encode("utf-8"), item.content_type or "text/plain"
    if isinstance(item.content, InlineBase64Content):
        return base64.b64decode(
            item.content.data
        ), item.content_type or "application/octet-stream"
    if isinstance(item.content, RemoteUrlContent):
        resp = await http.get(item.content.url, timeout=30.0, follow_redirects=True)
        resp.raise_for_status()
        data = resp.content
        if len(data) > 50 * 1024 * 1024:
            raise ValueError(f"remote content too large: {len(data)} bytes > 50MB")
        return data, item.content_type or resp.headers.get(
            "content-type", "application/octet-stream"
        )
    return b"", None


async def _get_source_lock(pool: Any, *, kn_code: str, file_path: str) -> dict | None:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT lock_owner, locked_at, expires_at FROM kgw_kb_source_lock "
                "WHERE kn_code=%s AND file_path=%s",
                (kn_code, file_path),
            )
            return await cur.fetchone()


def _is_lock_expired(lock_row: dict) -> bool:
    if lock_row["expires_at"] is None:
        return False
    return _dt.now(_tz.utc) > lock_row["expires_at"]


async def _get_latest_done_version(
    pool: Any, *, kn_code: str, file_path: str
) -> str | None:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT version FROM kgw_ingest_event "
                "WHERE kn_code=%s AND file_path=%s AND status='done' AND version IS NOT NULL "
                "ORDER BY done_at DESC LIMIT 1",
                (kn_code, file_path),
            )
            row = await cur.fetchone()
    return row["version"] if row else None


async def _write_conflict(
    pool: Any,
    *,
    item: StandardItem,
    reason: str,
    writer: str,
    current_writer: str | None,
) -> None:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO kgw_kb_conflict_log "
                "(kn_code, file_path, current_writer, attempted_writer, attempted_version, reason) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (
                    item.kn_code,
                    item.file_path,
                    current_writer,
                    writer,
                    item.version,
                    reason,
                ),
            )
        await conn.commit()


async def _binding_updated_at(
    conn: Any, *, property_id: int, kn_code: str, file_path: str
) -> Any:
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT updated_at FROM kgw_metadata_property_binding "
            "WHERE property_id=%s AND kn_code=%s AND file_path=%s",
            (property_id, kn_code, file_path),
        )
        row = await cur.fetchone()
    return row["updated_at"] if row else None


async def _delete_created_bindings(pool: Any, records: list[_CreatedBinding]) -> None:
    if not records:
        return
    async with pool.connection() as conn:
        async with conn.transaction():
            for record in records:
                await conn.execute(
                    "DELETE FROM kgw_metadata_property_binding "
                    "WHERE property_id=%s AND kn_code=%s AND file_path=%s "
                    "  AND updated_at=%s "
                    "  AND status IN ('BOUND', 'DELETING')",
                    (
                        record.property_id,
                        record.kn_code,
                        record.file_path,
                        record.updated_at,
                    ),
                )


async def _restore_deleting_bindings(pool: Any, records: list[_CreatedBinding]) -> None:
    if not records:
        return
    async with pool.connection() as conn:
        async with conn.transaction():
            for record in records:
                await conn.execute(
                    "UPDATE kgw_metadata_property_binding "
                    "SET status='DELETING', updated_at=clock_timestamp() "
                    "WHERE property_id=%s AND kn_code=%s AND file_path=%s "
                    "  AND updated_at=%s AND status='BOUND'",
                    (
                        record.property_id,
                        record.kn_code,
                        record.file_path,
                        record.updated_at,
                    ),
                )


async def _rollback_failed_bindings(
    pool: Any,
    created_bindings: list[_CreatedBinding],
    restored_deleting_bindings: list[_CreatedBinding],
) -> None:
    await _delete_created_bindings(pool, created_bindings)
    await _restore_deleting_bindings(pool, restored_deleting_bindings)


async def _audit(
    state: Any,
    *,
    item: StandardItem,
    op_type: str,
    result_code: str,
    result_msg: str,
    size: int,
    trace_id: str | None,
    user_code: str,
) -> None:
    await state.audit.record(
        AuditEntry(
            source="ingest",
            trace_id=trace_id,
            actor_user_id=user_code,
            actor_kind="connector",
            operation_type=op_type,
            kn_code=item.kn_code,
            file_path=item.file_path,
            payload_size_bytes=size,
            row_count=None,
            payload_redacted={
                "knCode": item.kn_code,
                "filePath": item.file_path,
                "sourceId": item.source_id,
                "itemId": item.item_id,
            },
            result_code=result_code,
            result_msg=result_msg,
            latency_ms=None,
            source_id=item.source_id,
            source_item_id=item.item_id,
            source_version=item.version,
        )
    )
