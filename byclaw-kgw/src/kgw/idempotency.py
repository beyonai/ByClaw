from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

import psycopg.errors
from kgw.schemas.standard_item import StandardItem
from psycopg_pool import AsyncConnectionPool


class DuplicateEvent(Exception):
    """Raised by insert_received when UNIQUE (source_id, item_id, version) conflicts."""


@dataclass
class IngestEventRow:
    event_id: int
    source_id: str
    item_id: str
    version: str | None
    op: str
    kn_code: str
    file_path: str
    status: str
    error_type: str | None
    error_message: str | None
    retry_count: int
    done_at: datetime | None


async def insert_received(
    pool: AsyncConnectionPool,
    item: StandardItem,
    *,
    payload_size_bytes: int,
) -> int:
    """INSERT a new event row with status='received'. Returns event_id.

    Raises DuplicateEvent on UNIQUE (source_id, item_id, version) conflict.
    version=NULL rows do NOT conflict with each other (PG NULL semantics).
    """
    try:
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "INSERT INTO kgw_ingest_event "
                    "(source_id, item_id, version, op, kn_code, file_path, "
                    " status, payload_size_bytes) "
                    "VALUES (%s, %s, %s, %s, %s, %s, 'received', %s) "
                    "RETURNING event_id",
                    (
                        item.source_id,
                        item.item_id,
                        item.version,
                        item.op,
                        item.kn_code,
                        item.file_path,
                        payload_size_bytes,
                    ),
                )
                row = await cur.fetchone()
            await conn.commit()
        return row["event_id"]
    except psycopg.errors.UniqueViolation as exc:
        raise DuplicateEvent(
            f"duplicate event: source_id={item.source_id} "
            f"item_id={item.item_id} version={item.version}"
        ) from exc


async def get_by_id(
    pool: AsyncConnectionPool,
    event_id: int,
) -> IngestEventRow | None:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT event_id, source_id, item_id, version, op, kn_code, file_path, "
                "status, error_type, error_message, retry_count, done_at "
                "FROM kgw_ingest_event WHERE event_id=%s",
                (event_id,),
            )
            row = await cur.fetchone()
    if row is None:
        return None
    return _row_to_dataclass(row)


async def get_by_idempotency_key(
    pool: AsyncConnectionPool,
    *,
    source_id: str,
    item_id: str,
    version: str | None,
) -> IngestEventRow | None:
    if version is None:
        return None
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT event_id, source_id, item_id, version, op, kn_code, file_path, "
                "status, error_type, error_message, retry_count, done_at "
                "FROM kgw_ingest_event "
                "WHERE source_id=%s AND item_id=%s AND version=%s",
                (source_id, item_id, version),
            )
            row = await cur.fetchone()
    if row is None:
        return None
    return _row_to_dataclass(row)


async def mark_done(pool: AsyncConnectionPool, event_id: int) -> None:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE kgw_ingest_event SET status='done', done_at=NOW() "
                "WHERE event_id=%s",
                (event_id,),
            )
        await conn.commit()


async def mark_failed(
    pool: AsyncConnectionPool,
    event_id: int,
    *,
    error_type: str,
    error_message: str,
) -> None:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE kgw_ingest_event "
                "SET status='failed', error_type=%s, error_message=%s "
                "WHERE event_id=%s",
                (error_type, error_message[:2000], event_id),
            )
        await conn.commit()


async def reset_for_replay(pool: AsyncConnectionPool, event_id: int) -> None:
    """Set status='received', increment retry_count, clear error fields."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE kgw_ingest_event "
                "SET status='received', retry_count=retry_count+1, "
                "    error_type=NULL, error_message=NULL "
                "WHERE event_id=%s",
                (event_id,),
            )
        await conn.commit()


async def list_events(
    pool: AsyncConnectionPool,
    *,
    source_id: str | None = None,
    item_id: str | None = None,
    kn_code: str | None = None,
    status: str | None = None,
    from_time: str | None = None,
    to_time: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[IngestEventRow], int]:
    conditions: list[str] = []
    params: list[Any] = []
    if source_id:
        conditions.append("source_id=%s")
        params.append(source_id)
    if item_id:
        conditions.append("item_id=%s")
        params.append(item_id)
    if kn_code:
        conditions.append("kn_code=%s")
        params.append(kn_code)
    if status:
        conditions.append("status=%s")
        params.append(status)
    if from_time:
        conditions.append("received_at>=%s")
        params.append(from_time)
    if to_time:
        conditions.append("received_at<=%s")
        params.append(to_time)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    offset = (page - 1) * page_size

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(f"SELECT COUNT(*) FROM kgw_ingest_event {where}", params)
            total = (await cur.fetchone())["count"]
            await cur.execute(
                f"SELECT event_id, source_id, item_id, version, op, kn_code, file_path, "
                f"status, error_type, error_message, retry_count, done_at "
                f"FROM kgw_ingest_event {where} "
                f"ORDER BY received_at DESC LIMIT %s OFFSET %s",
                params + [page_size, offset],
            )
            rows = await cur.fetchall()
    return [_row_to_dataclass(r) for r in rows], total


def _row_to_dataclass(row: Any) -> IngestEventRow:
    # pool uses dict_row factory — access by column name, not position
    return IngestEventRow(
        event_id=row["event_id"],
        source_id=row["source_id"],
        item_id=row["item_id"],
        version=row["version"],
        op=row["op"],
        kn_code=row["kn_code"],
        file_path=row["file_path"],
        status=row["status"],
        error_type=row["error_type"],
        error_message=row["error_message"],
        retry_count=row["retry_count"],
        done_at=row["done_at"],
    )
