"""State track 3 — metadata property binding CRUD + outbox helpers.

A *binding row* records that a specific (property_id, kn_code, file_path)
triple has been, or is being, synced to a backend KB document.  The lifecycle
is:

    PENDING  ->  SYNCED

``PENDING`` means the binding instruction has been written locally but has not
yet been confirmed by the backend.  ``SYNCED`` means the backend acknowledged
the update.

Design constraints
------------------
* ``upsert_pending`` intentionally takes a raw ``psycopg`` connection (not a
  pool) and executes within the **caller's transaction**.  This lets the caller
  atomically bind a property assignment to the same transaction that writes
  the document record, giving "binding-then-backend" atomicity for free.
* Pool-taking helpers (``mark_synced_by_attempt``, ``delete_by_attempt``,
  ``delete_by_file``, ``delete_by_directory``, ``count_in_use``,
  ``sample_in_use``, ``write_outbox``) open their own short-lived connection
  and commit independently — they are safe to call from background workers.
* OpenGauss does **not** support ``ON CONFLICT … DO UPDATE``.  Every upsert
  uses the UPDATE-then-INSERT pattern (same approach as
  ``kgw.metadata.sync``).
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass

from psycopg_pool import AsyncConnectionPool


@dataclass(frozen=True)
class BindingRow:
    property_id: int
    kn_code: str
    file_path: str
    status: str
    attempt_id: int


def new_attempt_id() -> int:
    """Return a monotonic-within-Pod attempt ID that fits in a BIGINT column.

    Format: low 47 bits of ``time.monotonic_ns()`` shifted left by 16 bits,
    with 16 random bits in the low positions.  The mask keeps the result
    within PostgreSQL/OpenGauss BIGINT range (2^63-1).  Values are
    monotonically increasing within a process and unique enough across
    concurrent tasks.
    """
    return ((time.monotonic_ns() & 0x7FFFFFFFFFFF) << 16) | random.getrandbits(16)


async def upsert_pending(
    conn,
    *,
    property_id: int,
    kn_code: str,
    file_path: str,
    attempt_id: int,
) -> None:
    """Insert or update a binding row as PENDING within the caller's transaction.

    Executes UPDATE first; if no row matched, falls back to INSERT.
    OpenGauss does not support ON CONFLICT DO UPDATE.

    This function does **not** commit — it runs within the caller's
    transaction so the write is atomically bound to the surrounding
    operation.
    """
    async with conn.cursor() as cur:
        await cur.execute(
            "UPDATE kgw_metadata_property_binding "
            "SET status='PENDING', attempt_id=%s, bound_at=NOW() "
            "WHERE property_id=%s AND kn_code=%s AND file_path=%s",
            (attempt_id, property_id, kn_code, file_path),
        )
        if cur.rowcount == 0:
            await cur.execute(
                "INSERT INTO kgw_metadata_property_binding "
                "(property_id, kn_code, file_path, status, attempt_id, bound_at) "
                "VALUES (%s, %s, %s, 'PENDING', %s, NOW())",
                (property_id, kn_code, file_path, attempt_id),
            )


async def mark_synced_by_attempt(
    pool: AsyncConnectionPool,
    *,
    attempt_id: int,
) -> int:
    """Set status='SYNCED' for the row identified by attempt_id.

    Returns the number of rows updated (0 or 1).
    """
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE kgw_metadata_property_binding "
                "SET status='SYNCED' "
                "WHERE attempt_id=%s",
                (attempt_id,),
            )
            n = cur.rowcount
        await conn.commit()
    return n


async def delete_by_attempt(
    pool: AsyncConnectionPool,
    attempt_id: int,
) -> int:
    """Delete the binding row identified by attempt_id.

    Returns the number of rows deleted (0 or 1).
    """
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM kgw_metadata_property_binding WHERE attempt_id=%s",
                (attempt_id,),
            )
            n = cur.rowcount
        await conn.commit()
    return n


async def delete_by_file(
    pool: AsyncConnectionPool,
    *,
    kn_code: str,
    file_path: str,
) -> int:
    """Delete all binding rows for the given (kn_code, file_path).

    Returns the number of rows deleted.
    """
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM kgw_metadata_property_binding "
                "WHERE kn_code=%s AND file_path=%s",
                (kn_code, file_path),
            )
            n = cur.rowcount
        await conn.commit()
    return n


async def delete_by_directory(
    pool: AsyncConnectionPool,
    *,
    kn_code: str,
    directory_path: str,
) -> int:
    """按目录前缀删除该目录下所有文件的 binding。``directory_path`` 不含尾斜杠。

    ``directory_path`` 中的 LIKE 元字符(``\\`` / ``%`` / ``_``)按字面值处理,
    避免越界匹配。
    """
    escaped = (
        directory_path.rstrip("/")
        .replace("\\", "\\\\")
        .replace("%", "\\%")
        .replace("_", "\\_")
    )
    prefix = escaped + "/"
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM kgw_metadata_property_binding "
                "WHERE kn_code=%s AND file_path LIKE %s ESCAPE '\\'",
                (kn_code, prefix + "%"),
            )
            n = cur.rowcount
        await conn.commit()
    return n


async def rename_directory_prefix(
    pool: AsyncConnectionPool,
    *,
    kn_code: str,
    old_directory_path: str,
    new_directory_path: str,
) -> int:
    """Rewrite ``file_path`` prefixes after a directory rename.

    Every binding under ``old_directory_path + "/"`` becomes
    ``new_directory_path + "/" + suffix``. LIKE metachars in
    ``old_directory_path`` are escaped before matching, so names containing
    ``%`` / ``_`` / ``\\`` are handled literally. Returns the row count.
    """
    old_escaped = (
        old_directory_path.rstrip("/")
        .replace("\\", "\\\\")
        .replace("%", "\\%")
        .replace("_", "\\_")
    )
    old_prefix_for_like = old_escaped + "/"
    old_prefix_literal = old_directory_path.rstrip("/") + "/"
    new_prefix_literal = new_directory_path.rstrip("/") + "/"
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            # PG SUBSTRING is 1-indexed; +1 keeps the suffix after the old prefix.
            await cur.execute(
                "UPDATE kgw_metadata_property_binding "
                "SET file_path = %s || substring(file_path FROM %s) "
                "WHERE kn_code=%s AND file_path LIKE %s ESCAPE '\\'",
                (
                    new_prefix_literal,
                    len(old_prefix_literal) + 1,
                    kn_code,
                    old_prefix_for_like + "%",
                ),
            )
            n = cur.rowcount
        await conn.commit()
    return n


async def delete_by_property_op(
    conn,
    *,
    property_id: int,
    kn_code: str,
    file_path: str,
) -> None:
    """Delete the binding row for (property_id, kn_code, file_path).

    Intended for use inside a caller's transaction (e.g. metadata/update
    unset/clear).  Does **not** commit.
    """
    async with conn.cursor() as cur:
        await cur.execute(
            "DELETE FROM kgw_metadata_property_binding "
            "WHERE property_id=%s AND kn_code=%s AND file_path=%s",
            (property_id, kn_code, file_path),
        )


async def count_in_use(
    pool: AsyncConnectionPool,
    property_id: int,
) -> int:
    """Return the count of PENDING or SYNCED rows for property_id."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT COUNT(*) AS c FROM kgw_metadata_property_binding "
                "WHERE property_id=%s AND status IN ('PENDING','SYNCED')",
                (property_id,),
            )
            row = await cur.fetchone()
    return int(row["c"])


async def sample_in_use(
    pool: AsyncConnectionPool,
    property_id: int,
    *,
    limit: int = 5,
) -> list[dict]:
    """Return up to *limit* PENDING/SYNCED rows for property_id.

    Each element is ``{"knCode": ..., "filePath": ...}`` ordered by
    ``bound_at DESC``.
    """
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT kn_code, file_path "
                "FROM kgw_metadata_property_binding "
                "WHERE property_id=%s AND status IN ('PENDING','SYNCED') "
                "ORDER BY bound_at DESC "
                "LIMIT %s",
                (property_id, limit),
            )
            rows = await cur.fetchall()
    return [{"knCode": r["kn_code"], "filePath": r["file_path"]} for r in rows]


async def write_outbox(
    pool: AsyncConnectionPool,
    *,
    property_id: int,
    kn_code: str,
    file_path: str,
    attempt_id: int,
    reason: str = "ROLLBACK_FAILED",
) -> None:
    """Insert a row into kgw_metadata_binding_outbox for manual reconciliation."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO kgw_metadata_binding_outbox "
                "(property_id, kn_code, file_path, attempt_id, reason) "
                "VALUES (%s, %s, %s, %s, %s)",
                (property_id, kn_code, file_path, attempt_id, reason),
            )
        await conn.commit()
