"""metadataProperty binding reconcile worker.

Stale ``DELETING`` rows are conservative in-use markers for unbind cleanup in
progress. The worker confirms the backend state for those rows: if the backend
still has the metadata field, the row returns to ``BOUND``; if the field is
absent, the row is removed.
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import Any

from kgw.dispatcher import _DEFAULT_KB_PATHS, KbOp
from kgw.metadata import binding as binding_mod
from kgw.observability.logger import get_logger
from kgw.observability.metrics import kgw_metadata_reconcile_total
from kgw.upstream import call_backend_json
from psycopg_pool import AsyncConnectionPool

_log = get_logger(__name__)


async def reconcile_iteration(
    pool: AsyncConnectionPool,
    *,
    state: Any | None = None,
    deleting_threshold_minutes: int = 5,
    stale_syncing_threshold_minutes: int = 10,
    batch_size: int = 50,
) -> tuple[int, int, int]:
    """Run one reconcile pass.

    Returns (deleting_deleted, deleting_restored, stale_syncing_cleared).
    """
    deleted_n = 0
    restored_n = 0
    if state is not None:
        deleted_n, restored_n = await _reconcile_deleting(
            pool, state, deleting_threshold_minutes, batch_size
        )
    syncing_n = await _clear_stale_syncing(pool, stale_syncing_threshold_minutes)
    return deleted_n, restored_n, syncing_n


async def _fetch_stale_deleting(
    pool: AsyncConnectionPool,
    threshold_minutes: int,
    batch_size: int,
) -> list[dict]:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT b.property_id, b.kn_code, b.file_path, b.updated_at, "
                "p.backend_name "
                "FROM kgw_metadata_property_binding b "
                "JOIN kgw_metadata_property p ON p.property_id = b.property_id "
                "WHERE b.status='DELETING' "
                "  AND b.updated_at < NOW() - (%s * INTERVAL '1 minute') "
                "ORDER BY b.updated_at "
                "LIMIT %s",
                (threshold_minutes, batch_size),
            )
            return list(await cur.fetchall())


async def _backend_has_metadata_field(state: Any, row: dict) -> bool | None:
    cfg = await state.config_provider.get_kb_config(row["kn_code"])
    if cfg is None:
        return None

    op_id = KbOp.KNOWLEDGE_ITEMS_METADATA_GET
    op_path = cfg.operation_path(op_id) or _DEFAULT_KB_PATHS.get(
        op_id, f"/{op_id.value}"
    )
    body = {
        "knCode": cfg.resource_code,
        "filePath": row["file_path"],
        "metadataFieldList": [row["backend_name"]],
    }
    headers = await state.auth_provider.resolve_headers(cfg.headers, user_code=None)

    try:
        resp = await call_backend_json(
            config=cfg,
            op_path=op_path,
            body=body,
            headers=headers,
            http=state.http,
        )
    except Exception:
        _log.exception(
            "binding_reconcile.metadata_get_failed",
            property_id=row["property_id"],
            kn_code=row["kn_code"],
            file_path=row["file_path"],
        )
        return None

    if resp.get("resultCode") != "0":
        return None

    metadata = (resp.get("resultObject") or {}).get("metadata") or {}
    return row["backend_name"] in metadata


async def _reconcile_deleting(
    pool: AsyncConnectionPool,
    state: Any,
    threshold_minutes: int,
    batch_size: int,
) -> tuple[int, int]:
    rows = await _fetch_stale_deleting(pool, threshold_minutes, batch_size)
    deleted = 0
    restored = 0
    for row in rows:
        has_field = await _backend_has_metadata_field(state, row)
        if has_field is True:
            n = await _restore_bound_if_unchanged(
                pool,
                property_id=row["property_id"],
                kn_code=row["kn_code"],
                file_path=row["file_path"],
                updated_at=row["updated_at"],
            )
            restored += n
            if n:
                kgw_metadata_reconcile_total.labels(
                    action="deleting", result="restored"
                ).inc(n)
        elif has_field is False:
            n = await _confirm_deleting_absent_if_unchanged(
                pool,
                property_id=row["property_id"],
                kn_code=row["kn_code"],
                file_path=row["file_path"],
                updated_at=row["updated_at"],
            )
            deleted += n
            if n:
                kgw_metadata_reconcile_total.labels(
                    action="deleting", result="deleted"
                ).inc(n)
    return deleted, restored


async def _restore_bound_if_unchanged(
    pool: AsyncConnectionPool,
    *,
    property_id: int,
    kn_code: str,
    file_path: str,
    updated_at: Any,
) -> int:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE kgw_metadata_property_binding "
                "SET status=%s, updated_at=NOW() "
                "WHERE property_id=%s AND kn_code=%s AND file_path=%s "
                "  AND status=%s AND updated_at=%s",
                (
                    binding_mod.BOUND,
                    property_id,
                    kn_code,
                    file_path,
                    binding_mod.DELETING,
                    updated_at,
                ),
            )
            n = cur.rowcount
        await conn.commit()
    return n


async def _confirm_deleting_absent_if_unchanged(
    pool: AsyncConnectionPool,
    *,
    property_id: int,
    kn_code: str,
    file_path: str,
    updated_at: Any,
) -> int:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM kgw_metadata_property_binding "
                "WHERE property_id=%s AND kn_code=%s AND file_path=%s "
                "  AND status=%s AND updated_at=%s",
                (property_id, kn_code, file_path, binding_mod.DELETING, updated_at),
            )
            n = cur.rowcount
        await conn.commit()
    return n


async def _clear_stale_syncing(
    pool: AsyncConnectionPool, threshold_minutes: int
) -> int:
    """Flip SYNCING rows older than threshold to FAILED.

    Avoids multi-Pod race: a Pod's T2 phase (backend call after T1 commit)
    takes at most ~15 s; 10-minute threshold means only truly orphaned rows
    (where T2 crashed) are cleared.
    """
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE kgw_metadata_property_sync "
                "SET sync_status='FAILED', last_error='stale: SYNCING timeout' "
                "WHERE sync_status='SYNCING' "
                "  AND last_sync_at < NOW() - (%s * INTERVAL '1 minute')",
                (threshold_minutes,),
            )
            n = cur.rowcount
        await conn.commit()
    if n:
        kgw_metadata_reconcile_total.labels(
            action="stale_syncing", result="cleared"
        ).inc(n)
    return n


async def run_reconcile_loop(
    state: Any,
    *,
    interval_seconds: float = 30.0,
    stop_event: asyncio.Event | None = None,
) -> None:
    """Background loop. Runs reconcile_iteration every interval_seconds."""
    pool: AsyncConnectionPool = state.pool
    while True:
        if stop_event is not None and stop_event.is_set():
            return
        try:
            deleted_n, restored_n, syncing_n = await reconcile_iteration(
                pool, state=state
            )
            if deleted_n or restored_n or syncing_n:
                _log.info(
                    "reconcile.iteration.done",
                    deleting_deleted=deleted_n,
                    deleting_restored=restored_n,
                    stale_syncing_cleared=syncing_n,
                )
        except Exception:  # noqa: BLE001
            _log.exception("reconcile.iteration.error")
        if stop_event is not None:
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(stop_event.wait(), timeout=interval_seconds)
        else:
            await asyncio.sleep(interval_seconds)
        if stop_event is not None and stop_event.is_set():
            return
