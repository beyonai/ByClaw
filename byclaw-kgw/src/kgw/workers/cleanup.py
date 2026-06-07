"""metadataProperty cleanup worker — async background task.

Scans kgw_metadata_property_sync for PURGING/PURGE_FAILED rows and calls
the backend metadataPropertiesDelete endpoint to remove the __byclaw_kgw__
columns.  Once all sync rows for a property are PURGED, physically deletes
the main kgw_metadata_property row.  Uses SELECT…FOR UPDATE SKIP LOCKED
for multi-Pod safety.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
from kgw.config_provider import KbConfig
from kgw.dispatcher import _DEFAULT_KB_PATHS, KbOp
from kgw.observability.logger import get_logger
from kgw.upstream import BackendAuthError, call_backend_json
from psycopg_pool import AsyncConnectionPool

_log = get_logger(__name__)

_DELETE_OP = KbOp.METADATA_PROPERTIES_DELETE


def _config_from_endpoint(endpoint_key: str) -> KbConfig:
    """Synthesize a minimal KbConfig from an endpoint_key for worker calls."""
    is_url = endpoint_key.startswith("http://") or endpoint_key.startswith("https://")
    return KbConfig(
        kn_code="",
        resource_code="",
        domain_url=endpoint_key if is_url else "",
        domain_name="" if is_url else endpoint_key,
        headers={},
        operations=frozenset(),
        operation_paths={},
        raw={},
    )


async def cleanup_iteration(
    state: Any,  # app.state — has pool, http, circuit_breakers, auth_provider
    *,
    batch_size: int = 50,
    backoff_minutes: int = 5,
) -> int:
    """Run one cleanup pass. Returns number of sync rows processed."""
    pool: AsyncConnectionPool = state.pool
    processed = 0

    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT s.property_id, s.endpoint_key, p.backend_name "
                    "FROM kgw_metadata_property_sync s "
                    "JOIN kgw_metadata_property p USING (property_id) "
                    "WHERE s.sync_status IN ('PURGING','PURGE_FAILED') "
                    "  AND (s.last_sync_at IS NULL OR "
                    "       s.last_sync_at < NOW() - INTERVAL '%s minutes') "
                    "ORDER BY s.last_sync_at NULLS FIRST "
                    "LIMIT %s "
                    "FOR UPDATE SKIP LOCKED",
                    (backoff_minutes, batch_size),
                )
                rows = await cur.fetchall()

            for row in rows:
                await _purge_one(
                    conn,
                    state,
                    property_id=row["property_id"],
                    endpoint_key=row["endpoint_key"],
                    backend_name=row["backend_name"],
                )
                processed += 1

    await _physical_delete_when_all_purged(pool)
    return processed


async def _purge_one(
    conn: Any,
    state: Any,
    *,
    property_id: int,
    endpoint_key: str,
    backend_name: str,
) -> None:
    """Call backend delete, then flip sync row to PURGED or PURGE_FAILED."""
    config = _config_from_endpoint(endpoint_key)
    op_path = _DEFAULT_KB_PATHS.get(_DELETE_OP, f"/{_DELETE_OP.value}")

    cb = state.circuit_breakers.get(endpoint_key)
    if not cb.before_call():
        # Circuit OPEN — leave as PURGING for next iteration
        _log.warning("cleanup.circuit_open", endpoint_key=endpoint_key)
        return

    headers = await state.auth_provider.resolve_headers({}, user_code="kgw_worker")

    try:
        resp = await call_backend_json(
            config=config,
            op_path=op_path,
            body={"propertyName": backend_name},
            headers=headers,
            http=state.http,
        )
        cb.record_success()
        ok = resp.get("resultCode") == "0"
        # Treat "not found" as success — the column no longer exists, which is what we want.
        not_found_msg = (resp.get("resultMsg") or "").lower()
        if ok or "not found" in not_found_msg or "does not exist" in not_found_msg:
            async with conn.cursor() as cur:
                await cur.execute(
                    "UPDATE kgw_metadata_property_sync "
                    "SET sync_status='PURGED', last_sync_at=NOW(), last_error=NULL "
                    "WHERE property_id=%s AND endpoint_key=%s",
                    (property_id, endpoint_key),
                )
            return
        msg = resp.get("resultMsg") or str(resp)[:200]
    except httpx.TimeoutException as exc:
        cb.record_failure()
        msg = f"timeout: {exc!r}"
    except (httpx.ConnectError, httpx.NetworkError) as exc:
        cb.record_failure()
        msg = f"connect: {exc!r}"
    except BackendAuthError as exc:
        cb.record_failure()
        msg = f"auth: {exc!r}"
    except ValueError as exc:
        cb.record_failure()
        msg = f"decode: {exc!r}"

    _log.warning(
        "cleanup.purge_failed",
        property_id=property_id,
        endpoint_key=endpoint_key,
        error=msg,
    )
    async with conn.cursor() as cur:
        await cur.execute(
            "UPDATE kgw_metadata_property_sync "
            "SET sync_status='PURGE_FAILED', last_sync_at=NOW(), last_error=%s "
            "WHERE property_id=%s AND endpoint_key=%s",
            (msg, property_id, endpoint_key),
        )


async def _physical_delete_when_all_purged(pool: AsyncConnectionPool) -> None:
    """Physically delete DELETED properties whose ALL sync rows are PURGED."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM kgw_metadata_property "
                "WHERE status='DELETED' "
                "AND property_id NOT IN ("
                "  SELECT DISTINCT property_id FROM kgw_metadata_property_sync "
                "  WHERE sync_status != 'PURGED'"
                ")"
            )
        await conn.commit()


async def run_cleanup_loop(
    state: Any,
    *,
    interval_seconds: float = 30.0,
    stop_event: asyncio.Event | None = None,
) -> None:
    """Background loop. Runs cleanup_iteration every interval_seconds."""
    while True:
        if stop_event is not None and stop_event.is_set():
            return
        try:
            n = await cleanup_iteration(state)
            if n:
                _log.info("cleanup.iteration.done", processed=n)
        except Exception:  # noqa: BLE001
            _log.exception("cleanup.iteration.error")
        await asyncio.sleep(interval_seconds)
        if stop_event is not None and stop_event.is_set():
            return
