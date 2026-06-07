"""metadataProperty binding reconcile worker — orphan cleanup.

Handles two kinds of orphans without any backend HTTP calls:

1. ``kgw_metadata_binding_outbox`` (ROLLBACK_FAILED): delete the
   corresponding binding row by attempt_id, then drain the outbox entry.

2. Stale PENDING binding rows: any PENDING row older than
   ``pending_threshold_minutes`` is deleted.  Re-running metadata/update
   will recreate the binding in the correct state; the worker's job is only
   to prevent accumulation of zombie PENDING rows.
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import Any

from kgw.observability.logger import get_logger
from kgw.observability.metrics import kgw_metadata_reconcile_total
from psycopg_pool import AsyncConnectionPool

_log = get_logger(__name__)


async def reconcile_iteration(
    pool: AsyncConnectionPool,
    *,
    pending_threshold_minutes: int = 5,
    stale_syncing_threshold_minutes: int = 10,
    batch_size: int = 50,
) -> tuple[int, int, int]:
    """Run one reconcile pass.

    Returns (outbox_drained, stale_pending_deleted, stale_syncing_cleared).
    """
    outbox_n = await _drain_outbox(pool, batch_size)
    stale_n = await _delete_stale_pending(pool, pending_threshold_minutes)
    syncing_n = await _clear_stale_syncing(pool, stale_syncing_threshold_minutes)
    return outbox_n, stale_n, syncing_n


async def _drain_outbox(pool: AsyncConnectionPool, batch_size: int) -> int:
    """Delete binding rows for outbox entries, then remove outbox rows."""
    drained = 0
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT id, property_id, kn_code, file_path, attempt_id "
                    "FROM kgw_metadata_binding_outbox "
                    "ORDER BY created_at "
                    "LIMIT %s "
                    "FOR UPDATE SKIP LOCKED",
                    (batch_size,),
                )
                rows = await cur.fetchall()
            for row in rows:
                async with conn.cursor() as cur2:
                    await cur2.execute(
                        "DELETE FROM kgw_metadata_property_binding "
                        "WHERE property_id=%s AND kn_code=%s "
                        "  AND file_path=%s AND attempt_id=%s",
                        (
                            row["property_id"],
                            row["kn_code"],
                            row["file_path"],
                            row["attempt_id"],
                        ),
                    )
                    await cur2.execute(
                        "DELETE FROM kgw_metadata_binding_outbox WHERE id=%s",
                        (row["id"],),
                    )
                    drained += 1
                    kgw_metadata_reconcile_total.labels(
                        action="outbox_drain", result="success"
                    ).inc()
    return drained


async def _delete_stale_pending(
    pool: AsyncConnectionPool, threshold_minutes: int
) -> int:
    """Delete PENDING binding rows older than threshold."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM kgw_metadata_property_binding "
                "WHERE status='PENDING' "
                "  AND bound_at < NOW() - (%s * INTERVAL '1 minute')",
                (threshold_minutes,),
            )
            n = cur.rowcount
        await conn.commit()
    if n:
        kgw_metadata_reconcile_total.labels(
            action="stale_pending", result="deleted"
        ).inc(n)
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
            outbox_n, stale_n, syncing_n = await reconcile_iteration(pool)
            if outbox_n or stale_n or syncing_n:
                _log.info(
                    "reconcile.iteration.done",
                    outbox_drained=outbox_n,
                    stale_deleted=stale_n,
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
