"""metadataProperty per-KB 同步状态 + lazy sync(ensure_synced)。

状态轨 2:SYNCING / SYNCED / FAILED / PURGING / PURGED / PURGE_FAILED。
``ensure_synced`` 是 lazy sync 入口,被写路径在写 binding 之前调用,
保证目标后端已物化对应的 ``__byclaw_kgw__{name}__v{id}`` 列。
"""

from __future__ import annotations

import enum
import hashlib
from typing import Any

import httpx
from kgw.dispatcher import _DEFAULT_KB_PATHS
from kgw.envelope import CircuitOpen, KBNotFound, MetadataPropertySyncFailed
from kgw.metadata.registry import get_property_by_id
from kgw.observability.logger import get_logger
from kgw.upstream import BackendAuthError, call_backend_json
from psycopg_pool import AsyncConnectionPool

_log = get_logger(__name__)

_OP_ID = "metadataPropertiesBatchCreate"


class SyncStatus(str, enum.Enum):
    SYNCING = "SYNCING"
    SYNCED = "SYNCED"
    FAILED = "FAILED"
    PURGING = "PURGING"
    PURGED = "PURGED"
    PURGE_FAILED = "PURGE_FAILED"


def _advisory_lock_key(property_id: int, kn_code: str) -> int:
    """Pack (property_id, kn_code) into a 63-bit signed bigint for PG advisory lock."""
    digest = hashlib.blake2b(
        f"{property_id}:{kn_code}".encode(), digest_size=8
    ).digest()
    val = int.from_bytes(digest, "big", signed=False) & ((1 << 63) - 1)
    return val


async def get_sync_status(
    pool: AsyncConnectionPool, property_id: int, kn_code: str
) -> SyncStatus | None:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT sync_status FROM kgw_metadata_property_sync "
                "WHERE property_id=%s AND kn_code=%s",
                (property_id, kn_code),
            )
            row = await cur.fetchone()
    return SyncStatus(row["sync_status"]) if row else None


async def list_synced_property_ids_for_kn(
    pool: AsyncConnectionPool, kn_code: str
) -> list[int]:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT property_id FROM kgw_metadata_property_sync "
                "WHERE kn_code=%s AND sync_status='SYNCED'",
                (kn_code,),
            )
            rows = await cur.fetchall()
    return [r["property_id"] for r in rows]


async def upsert_purging_for_synced(conn, property_id: int) -> None:
    """delete API 同事务调用:SYNCED → PURGING;FAILED/SYNCING → 直接 DELETE。

    ``conn`` 必须由调用方提供并在外层事务内,保证与主目录 status 翻转
    + binding 校验在同一事务原子提交。
    """
    async with conn.cursor() as cur:
        await cur.execute(
            "UPDATE kgw_metadata_property_sync SET sync_status='PURGING' "
            "WHERE property_id=%s AND sync_status='SYNCED'",
            (property_id,),
        )
        await cur.execute(
            "DELETE FROM kgw_metadata_property_sync "
            "WHERE property_id=%s AND sync_status IN ('FAILED','SYNCING')",
            (property_id,),
        )


async def ensure_synced(
    state: Any,  # FastAPI app.state — has config_provider, auth_provider, circuit_breakers, http, pool
    *,
    property_id: int,
    kn_code: str,
    user_code: str,  # for resolve_headers (X-User-Id from request, or kgw_service_user_code for workers)
) -> None:
    """Lazy-sync 入口。失败抛 ``MetadataPropertySyncFailed``,业务自上层兜底。"""
    pool: AsyncConnectionPool = state.pool

    # 1. 快路径
    current = await get_sync_status(pool, property_id, kn_code)
    if current == SyncStatus.SYNCED:
        return

    lock_key = _advisory_lock_key(property_id, kn_code)

    # 2. T1:advisory lock + UPSERT SYNCING + commit。lock 在事务结束自动释放。
    async with pool.connection() as conn_t1:
        async with conn_t1.transaction():
            async with conn_t1.cursor() as cur:
                await cur.execute("SELECT pg_advisory_xact_lock(%s)", (lock_key,))
                await cur.execute(
                    "SELECT sync_status FROM kgw_metadata_property_sync "
                    "WHERE property_id=%s AND kn_code=%s",
                    (property_id, kn_code),
                )
                existing = await cur.fetchone()
                if existing and existing["sync_status"] == SyncStatus.SYNCED.value:
                    return  # 双检:其他 Pod 抢先完成
                # OpenGauss does not support ON CONFLICT … DO UPDATE.
                # Use UPDATE-then-INSERT (within the same advisory-lock txn).
                await cur.execute(
                    "UPDATE kgw_metadata_property_sync "
                    "SET sync_status='SYNCING', last_sync_at=NOW(), last_error=NULL "
                    "WHERE property_id=%s AND kn_code=%s",
                    (property_id, kn_code),
                )
                if cur.rowcount == 0:
                    await cur.execute(
                        "INSERT INTO kgw_metadata_property_sync "
                        "(property_id, kn_code, sync_status, last_sync_at, last_error) "
                        "VALUES (%s, %s, 'SYNCING', NOW(), NULL)",
                        (property_id, kn_code),
                    )

    # 3. T2: resolve config → circuit breaker → auth → backend batchCreate
    config = await state.config_provider.get_kb_config(kn_code)
    if config is None:
        await _mark_failed(pool, property_id, kn_code, "KBNotFound")
        raise KBNotFound(f"unknown knCode: {kn_code}", kn_code=kn_code)

    op_path = config.operation_path(_OP_ID) or _DEFAULT_KB_PATHS.get(
        _OP_ID, f"/{_OP_ID}"
    )

    cb_key = config.domain_url or config.domain_name
    cb = state.circuit_breakers.get(cb_key)
    if not cb.before_call():
        # Circuit open — leave row as SYNCING so next call can retry
        raise CircuitOpen(f"circuit OPEN for {kn_code}", kn_code=kn_code)

    headers = await state.auth_provider.resolve_headers(
        config.headers, user_code=user_code
    )

    prop = await get_property_by_id(pool, property_id)
    assert prop is not None, "property must exist when ensure_synced called"

    body = {
        "propertyList": [
            {
                "propertyName": prop.backend_name,
                "valueType": prop.value_type,
            }
        ]
    }

    try:
        resp = await call_backend_json(
            config=config,
            op_path=op_path,
            body=body,
            headers=headers,
            http=state.http,
        )
        cb.record_success()
    except httpx.TimeoutException as exc:
        cb.record_failure()
        reason = "timeout"
        await _mark_failed(pool, property_id, kn_code, reason)
        raise MetadataPropertySyncFailed(
            f"backend sync timed out: {exc!r}",
            property_name=prop.property_name,
            kn_code=kn_code,
        ) from exc
    except (httpx.ConnectError, httpx.NetworkError) as exc:
        cb.record_failure()
        reason = "connect"
        await _mark_failed(pool, property_id, kn_code, reason)
        raise MetadataPropertySyncFailed(
            f"backend sync connect error: {exc!r}",
            property_name=prop.property_name,
            kn_code=kn_code,
        ) from exc
    except BackendAuthError as exc:
        cb.record_failure()
        reason = "auth"
        await _mark_failed(pool, property_id, kn_code, reason)
        raise MetadataPropertySyncFailed(
            f"backend auth error: {exc!r}",
            property_name=prop.property_name,
            kn_code=kn_code,
        ) from exc
    except ValueError as exc:
        cb.record_failure()
        reason = "decode"
        await _mark_failed(pool, property_id, kn_code, reason)
        raise MetadataPropertySyncFailed(
            f"backend response decode error: {exc!r}",
            property_name=prop.property_name,
            kn_code=kn_code,
        ) from exc

    if resp.get("resultCode") != "0":
        error_msg = f"upstream resultCode != 0: {str(resp)[:200]}"
        await _mark_failed(pool, property_id, kn_code, error_msg)
        raise MetadataPropertySyncFailed(
            "backend batchCreate did not return success",
            property_name=prop.property_name,
            kn_code=kn_code,
        )

    await _mark_synced(pool, property_id, kn_code)


async def _mark_synced(
    pool: AsyncConnectionPool, property_id: int, kn_code: str
) -> None:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE kgw_metadata_property_sync SET sync_status='SYNCED', "
                "last_sync_at=NOW(), last_error=NULL "
                "WHERE property_id=%s AND kn_code=%s",
                (property_id, kn_code),
            )


async def _mark_failed(
    pool: AsyncConnectionPool, property_id: int, kn_code: str, error: str
) -> None:
    _log.warning(
        "metadata.sync.failed",
        property_id=property_id,
        kn_code=kn_code,
        error=error,
    )
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE kgw_metadata_property_sync SET sync_status='FAILED', "
                "last_sync_at=NOW(), last_error=%s "
                "WHERE property_id=%s AND kn_code=%s",
                (error, property_id, kn_code),
            )
