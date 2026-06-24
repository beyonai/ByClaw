"""Metadata property binding usage projection helpers.

A binding row records that a metadata property is currently used by, or is in
the process of being removed from, a KB document path. The lifecycle is:

    BOUND  ->  DELETING  ->  row removed

``BOUND`` means the usage is present. ``DELETING`` means a caller has requested
removal but backend confirmation is still pending; it continues to count as
in-use until confirmed absent. Helpers that take a raw connection run inside
the caller's transaction. Pool-taking helpers open their own connection and
commit independently.

OpenGauss does not support ``ON CONFLICT``, so first-bind races are handled by
attempting INSERT inside a savepoint, catching unique-key conflicts, then
locking and updating the existing row.
"""

from __future__ import annotations

from dataclasses import dataclass

from psycopg.errors import UniqueViolation
from psycopg_pool import AsyncConnectionPool

BOUND = "BOUND"
DELETING = "DELETING"


@dataclass(frozen=True)
class BindingRow:
    property_id: int
    kn_code: str
    file_path: str
    status: str


@dataclass(frozen=True)
class BindUsageResult:
    created: bool
    previous_status: str | None


async def bind_usage(
    conn,
    *,
    property_id: int,
    kn_code: str,
    file_path: str,
) -> bool:
    """Create or restore a binding row as BOUND inside the caller transaction.

    Returns True when a new row was inserted, False when an existing row was
    updated or already BOUND.
    """
    result = await bind_usage_with_previous_status(
        conn,
        property_id=property_id,
        kn_code=kn_code,
        file_path=file_path,
    )
    return result.created


async def bind_usage_with_previous_status(
    conn,
    *,
    property_id: int,
    kn_code: str,
    file_path: str,
) -> BindUsageResult:
    """Create/restore a BOUND row and report the previous status.

    ``previous_status`` lets callers roll a failed write back to DELETING when
    this request only temporarily restored a deletion-in-progress row.
    """
    try:
        async with conn.transaction():
            async with conn.cursor() as cur:
                await cur.execute(
                    "INSERT INTO kgw_metadata_property_binding "
                    "(property_id, kn_code, file_path, status, bound_at, updated_at) "
                    "VALUES (%s, %s, %s, %s, NOW(), NOW())",
                    (property_id, kn_code, file_path, BOUND),
                )
                return BindUsageResult(created=True, previous_status=None)
    except UniqueViolation:
        pass

    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT status FROM kgw_metadata_property_binding "
            "WHERE property_id=%s AND kn_code=%s AND file_path=%s "
            "FOR UPDATE",
            (property_id, kn_code, file_path),
        )
        row = await cur.fetchone()
        if row is None:
            return await bind_usage_with_previous_status(
                conn,
                property_id=property_id,
                kn_code=kn_code,
                file_path=file_path,
            )
        previous_status = row["status"] if row else None
        await cur.execute(
            "UPDATE kgw_metadata_property_binding "
            "SET status=%s, updated_at=clock_timestamp() "
            "WHERE property_id=%s AND kn_code=%s AND file_path=%s",
            (BOUND, property_id, kn_code, file_path),
        )
    return BindUsageResult(created=False, previous_status=previous_status)


async def mark_deleting_by_property_op(
    conn,
    *,
    property_id: int,
    kn_code: str,
    file_path: str,
) -> None:
    """Mark one binding row as DELETING inside the caller transaction."""
    async with conn.cursor() as cur:
        await cur.execute(
            "UPDATE kgw_metadata_property_binding "
            "SET status=%s, updated_at=clock_timestamp() "
            "WHERE property_id=%s AND kn_code=%s AND file_path=%s",
            (DELETING, property_id, kn_code, file_path),
        )


async def mark_deleting_by_file(
    pool: AsyncConnectionPool,
    *,
    kn_code: str,
    file_path: str,
) -> int:
    """Mark all bindings for a file as DELETING and return the row count."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE kgw_metadata_property_binding "
                "SET status=%s, updated_at=clock_timestamp() "
                "WHERE kn_code=%s AND file_path=%s",
                (DELETING, kn_code, file_path),
            )
            n = cur.rowcount
        await conn.commit()
    return n


async def confirm_deleting_absent(
    pool: AsyncConnectionPool,
    *,
    property_id: int,
    kn_code: str,
    file_path: str,
) -> int:
    """Delete one DELETING row after backend confirms the usage is absent."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM kgw_metadata_property_binding "
                "WHERE property_id=%s AND kn_code=%s AND file_path=%s AND status=%s",
                (property_id, kn_code, file_path, DELETING),
            )
            n = cur.rowcount
        await conn.commit()
    return n


async def restore_bound(
    pool: AsyncConnectionPool,
    *,
    property_id: int,
    kn_code: str,
    file_path: str,
) -> int:
    """Restore one DELETING row to BOUND and return the row count."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE kgw_metadata_property_binding "
                "SET status=%s, updated_at=clock_timestamp() "
                "WHERE property_id=%s AND kn_code=%s AND file_path=%s AND status=%s",
                (BOUND, property_id, kn_code, file_path, DELETING),
            )
            n = cur.rowcount
        await conn.commit()
    return n


async def restore_bound_if_unchanged(
    pool: AsyncConnectionPool,
    *,
    property_id: int,
    kn_code: str,
    file_path: str,
    updated_at,
) -> int:
    """Restore one DELETING row to BOUND only if its row-version marker matches."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE kgw_metadata_property_binding "
                "SET status=%s, updated_at=clock_timestamp() "
                "WHERE property_id=%s AND kn_code=%s AND file_path=%s "
                "AND status=%s AND updated_at=%s",
                (BOUND, property_id, kn_code, file_path, DELETING, updated_at),
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
    """Hard-delete all backend-confirmed clean binding rows for a file."""
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
    """Hard-delete backend-confirmed clean binding rows under a directory.

    LIKE metacharacters in ``directory_path`` are treated literally so the
    delete cannot match sibling paths accidentally.
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

    Current binding statuses are preserved. LIKE metacharacters in
    ``old_directory_path`` are matched literally.
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
            await cur.execute(
                "UPDATE kgw_metadata_property_binding "
                "SET file_path = %s || substring(file_path FROM %s), "
                "    updated_at=clock_timestamp() "
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


async def count_in_use(
    pool: AsyncConnectionPool,
    property_id: int,
) -> int:
    """Return the count of BOUND or DELETING rows for property_id."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT COUNT(*) AS c FROM kgw_metadata_property_binding "
                "WHERE property_id=%s AND status IN (%s, %s)",
                (property_id, BOUND, DELETING),
            )
            row = await cur.fetchone()
    return int(row["c"])


async def sample_in_use(
    pool: AsyncConnectionPool,
    property_id: int,
    *,
    limit: int = 5,
) -> list[dict]:
    """Return up to *limit* BOUND/DELETING rows for property_id."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT kn_code, file_path, status "
                "FROM kgw_metadata_property_binding "
                "WHERE property_id=%s AND status IN (%s, %s) "
                "ORDER BY updated_at DESC, bound_at DESC "
                "LIMIT %s",
                (property_id, BOUND, DELETING, limit),
            )
            rows = await cur.fetchall()
    return [
        {"knCode": r["kn_code"], "filePath": r["file_path"], "status": r["status"]}
        for r in rows
    ]
