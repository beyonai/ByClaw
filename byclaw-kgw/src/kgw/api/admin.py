from __future__ import annotations

from datetime import datetime as _dt
from datetime import timezone as _tz
from typing import Any

from fastapi import APIRouter, Query, Request

router = APIRouter(prefix="/kgw/admin/v1")


@router.get("/audit")
async def query_audit(
    request: Request,
    source: str | None = None,
    kn_code: str | None = Query(default=None, alias="knCode"),
    operation_type: str | None = Query(default=None, alias="operationType"),
    actor_user_id: str | None = Query(default=None, alias="actorUserId"),
    from_time: str | None = Query(default=None, alias="fromTime"),
    to_time: str | None = Query(default=None, alias="toTime"),
    page_size: int = Query(default=20, alias="pageSize", le=100),
    page: int = Query(default=1, alias="page", ge=1),
) -> dict[str, Any]:
    conditions: list[str] = []
    params: list[Any] = []
    if source:
        conditions.append("source=%s")
        params.append(source)
    if kn_code:
        conditions.append("kn_code=%s")
        params.append(kn_code)
    if operation_type:
        conditions.append("operation_type=%s")
        params.append(operation_type)
    if actor_user_id:
        conditions.append("actor_user_id=%s")
        params.append(actor_user_id)
    if from_time:
        conditions.append("created_at>=%s")
        params.append(from_time)
    if to_time:
        conditions.append("created_at<=%s")
        params.append(to_time)
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    offset = (page - 1) * page_size
    pool = request.app.state.pool
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(f"SELECT COUNT(*) FROM kgw_audit_log {where}", params)
            total = (await cur.fetchone())["count"]
            await cur.execute(
                f"SELECT id, source, trace_id, actor_user_id, actor_kind, "
                f"source_connector, source_id, source_item_id, source_version, "
                f"operation_type, kn_code, file_path, payload_size_bytes, "
                f"result_code, result_msg, latency_ms, created_at "
                f"FROM kgw_audit_log {where} "
                f"ORDER BY created_at DESC LIMIT %s OFFSET %s",
                params + [page_size, offset],
            )
            rows = await cur.fetchall()
    return {
        "resultCode": "0",
        "resultMsg": "success",
        "resultObject": {
            "data": [_audit_row_to_dict(r) for r in rows],
            "total": total,
            "page": page,
            "pageSize": page_size,
        },
    }


@router.get("/conflicts")
async def query_conflicts(
    request: Request,
    kn_code: str | None = Query(default=None, alias="knCode"),
    reason: str | None = None,
    from_time: str | None = Query(default=None, alias="fromTime"),
    to_time: str | None = Query(default=None, alias="toTime"),
    page_size: int = Query(default=20, alias="pageSize", le=100),
    page: int = Query(default=1, alias="page", ge=1),
) -> dict[str, Any]:
    conditions: list[str] = []
    params: list[Any] = []
    if kn_code:
        conditions.append("kn_code=%s")
        params.append(kn_code)
    if reason:
        conditions.append("reason=%s")
        params.append(reason)
    if from_time:
        conditions.append("attempted_at>=%s")
        params.append(from_time)
    if to_time:
        conditions.append("attempted_at<=%s")
        params.append(to_time)
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    offset = (page - 1) * page_size
    pool = request.app.state.pool
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                f"SELECT COUNT(*) FROM kgw_kb_conflict_log {where}", params
            )
            total = (await cur.fetchone())["count"]
            await cur.execute(
                f"SELECT id, kn_code, file_path, current_writer, attempted_writer, "
                f"attempted_version, reason, attempted_at "
                f"FROM kgw_kb_conflict_log {where} "
                f"ORDER BY attempted_at DESC LIMIT %s OFFSET %s",
                params + [page_size, offset],
            )
            rows = await cur.fetchall()
    return {
        "resultCode": "0",
        "resultMsg": "success",
        "resultObject": {
            "data": [_conflict_row_to_dict(r) for r in rows],
            "total": total,
            "page": page,
            "pageSize": page_size,
        },
    }


@router.post("/kbs/{kn_code}/files/{file_path:path}/lock")
async def lock_file(
    request: Request,
    kn_code: str,
    file_path: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    # FastAPI path params decode %2F; ensure leading slash
    if not file_path.startswith("/"):
        file_path = "/" + file_path
    lock_owner = body.get("lockOwner")
    if not lock_owner:
        return {
            "resultCode": "-1",
            "resultMsg": "lockOwner is required",
            "resultObject": {},
        }
    expires_at = body.get("expiresAt")
    pool = request.app.state.pool
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT lock_owner, locked_at, expires_at FROM kgw_kb_source_lock "
                "WHERE kn_code=%s AND file_path=%s",
                (kn_code, file_path),
            )
            existing = await cur.fetchone()
        if existing:
            expired = (
                existing["expires_at"] is not None
                and _dt.now(_tz.utc) > existing["expires_at"]
            )
            if not expired:
                await conn.rollback()
                return {
                    "resultCode": "-1",
                    "resultMsg": (
                        f"file already locked by {existing['lock_owner']} "
                        f"since {existing['locked_at']}"
                    ),
                    "resultObject": {},
                }
            # Expired lock — replace it
            async with conn.cursor() as cur:
                await cur.execute(
                    "UPDATE kgw_kb_source_lock "
                    "SET lock_owner=%s, locked_at=NOW(), expires_at=%s "
                    "WHERE kn_code=%s AND file_path=%s",
                    (lock_owner, expires_at, kn_code, file_path),
                )
        else:
            async with conn.cursor() as cur:
                await cur.execute(
                    "INSERT INTO kgw_kb_source_lock (kn_code, file_path, lock_owner, expires_at) "
                    "VALUES (%s, %s, %s, %s)",
                    (kn_code, file_path, lock_owner, expires_at),
                )
        await conn.commit()
    return {
        "resultCode": "0",
        "resultMsg": "success",
        "resultObject": {
            "knCode": kn_code,
            "filePath": file_path,
            "lockOwner": lock_owner,
            "expiresAt": expires_at,
        },
    }


@router.post("/kbs/{kn_code}/files/{file_path:path}/unlock")
async def unlock_file(
    request: Request,
    kn_code: str,
    file_path: str,
) -> dict[str, Any]:
    if not file_path.startswith("/"):
        file_path = "/" + file_path
    pool = request.app.state.pool
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM kgw_kb_source_lock WHERE kn_code=%s AND file_path=%s",
                (kn_code, file_path),
            )
            deleted = cur.rowcount
        await conn.commit()
    if deleted == 0:
        return {
            "resultCode": "-1",
            "resultMsg": f"file is not locked: {file_path}",
            "resultObject": {},
        }
    return {"resultCode": "0", "resultMsg": "success", "resultObject": {}}


def _audit_row_to_dict(r: Any) -> dict[str, Any]:
    # pool uses dict_row factory — access by column name
    return {
        "id": r["id"],
        "source": r["source"],
        "traceId": r["trace_id"],
        "actorUserId": r["actor_user_id"],
        "actorKind": r["actor_kind"],
        "sourceConnector": r["source_connector"],
        "sourceId": r["source_id"],
        "sourceItemId": r["source_item_id"],
        "sourceVersion": r["source_version"],
        "operationType": r["operation_type"],
        "knCode": r["kn_code"],
        "filePath": r["file_path"],
        "payloadSizeBytes": r["payload_size_bytes"],
        "resultCode": r["result_code"],
        "resultMsg": r["result_msg"],
        "latencyMs": r["latency_ms"],
        "createdAt": r["created_at"].isoformat() if r["created_at"] else None,
    }


def _conflict_row_to_dict(r: Any) -> dict[str, Any]:
    return {
        "id": r["id"],
        "knCode": r["kn_code"],
        "filePath": r["file_path"],
        "currentWriter": r["current_writer"],
        "attemptedWriter": r["attempted_writer"],
        "attemptedVersion": r["attempted_version"],
        "reason": r["reason"],
        "attemptedAt": r["attempted_at"].isoformat() if r["attempted_at"] else None,
    }
