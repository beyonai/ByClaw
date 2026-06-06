"""metadataProperty 全局主目录 CRUD + backend_name 派生。

主键 ``property_id`` 是代理键。``property_name`` 仅在 ``status='ACTIVE'``
范围内唯一(由 partial unique index 强制),DELETED 行不参与名字唯一性,
支持同名再造。``backend_name`` 由 (property_name, property_id) 派生,
保证新旧版本在后端 schema 层永不撞名。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import psycopg
from kgw.envelope import MetadataPropertyAlreadyExists, MetadataPropertyNotFound
from psycopg_pool import AsyncConnectionPool

BACKEND_PREFIX = "__byclaw_kgw__"


def derive_backend_name(property_name: str, property_id: int) -> str:
    return f"{BACKEND_PREFIX}{property_name}__v{property_id}"


@dataclass(frozen=True)
class MetadataProperty:
    property_id: int
    property_name: str
    backend_name: str
    value_type: str
    description: str | None
    ext_params: dict[str, Any] | None
    status: str  # ACTIVE / DELETED


async def create_property(
    pool: AsyncConnectionPool,
    *,
    property_name: str,
    value_type: str,
    description: str | None = None,
    ext_params: dict[str, Any] | None = None,
) -> MetadataProperty:
    """两步插入:先 INSERT 拿 property_id,再 UPDATE 写 backend_name。

    捕获 partial unique index 冲突 → MetadataPropertyAlreadyExists。
    """
    async with pool.connection() as conn:
        async with conn.transaction():
            try:
                async with conn.cursor() as cur:
                    await cur.execute(
                        """
                        INSERT INTO kgw_metadata_property
                            (property_name, backend_name, value_type,
                             description, ext_params, status)
                        VALUES (%s, '__placeholder__', %s, %s, %s, 'ACTIVE')
                        RETURNING property_id
                        """,
                        (
                            property_name,
                            value_type,
                            description,
                            psycopg.types.json.Jsonb(ext_params)
                            if ext_params is not None
                            else None,
                        ),
                    )
                    row = await cur.fetchone()
                    property_id = row["property_id"]
                    backend_name = derive_backend_name(property_name, property_id)
                    await cur.execute(
                        "UPDATE kgw_metadata_property SET backend_name=%s "
                        "WHERE property_id=%s",
                        (backend_name, property_id),
                    )
            except psycopg.errors.UniqueViolation as exc:
                raise MetadataPropertyAlreadyExists(
                    f"metadata property already exists: {property_name}",
                    property_name=property_name,
                ) from exc
    return MetadataProperty(
        property_id=property_id,
        property_name=property_name,
        backend_name=backend_name,
        value_type=value_type,
        description=description,
        ext_params=ext_params,
        status="ACTIVE",
    )


async def get_active_property(
    pool: AsyncConnectionPool, property_name: str
) -> MetadataProperty:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT property_id, property_name, backend_name, value_type, "
                "       description, ext_params, status "
                "FROM kgw_metadata_property "
                "WHERE property_name=%s AND status='ACTIVE'",
                (property_name,),
            )
            row = await cur.fetchone()
    if not row:
        raise MetadataPropertyNotFound(
            f"metadata property not found: {property_name}",
            property_name=property_name,
        )
    return _row_to_property(row)


async def get_property_by_id(
    pool: AsyncConnectionPool, property_id: int
) -> MetadataProperty | None:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT property_id, property_name, backend_name, value_type, "
                "       description, ext_params, status "
                "FROM kgw_metadata_property WHERE property_id=%s",
                (property_id,),
            )
            row = await cur.fetchone()
    return _row_to_property(row) if row else None


async def list_active_properties(
    pool: AsyncConnectionPool,
    property_names: list[str] | None = None,
) -> list[MetadataProperty]:
    sql = (
        "SELECT property_id, property_name, backend_name, value_type, "
        "       description, ext_params, status "
        "FROM kgw_metadata_property WHERE status='ACTIVE'"
    )
    params: tuple[Any, ...] = ()
    if property_names:
        sql += " AND property_name = ANY(%s)"
        params = (list(property_names),)
    sql += " ORDER BY property_name"
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(sql, params)
            rows = await cur.fetchall()
    return [_row_to_property(r) for r in rows]


async def delete_property_to_deleted(
    pool: AsyncConnectionPool, property_id: int
) -> None:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE kgw_metadata_property "
                "SET status='DELETED', deleted_at=NOW() "
                "WHERE property_id=%s AND status='ACTIVE'",
                (property_id,),
            )


async def hard_delete_property(pool: AsyncConnectionPool, property_id: int) -> None:
    """物理删 DELETED 行;仅供 cleanup worker 在 sync 全部 PURGED 后调用。"""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM kgw_metadata_property "
                "WHERE property_id=%s AND status='DELETED'",
                (property_id,),
            )


def _row_to_property(row: dict[str, Any]) -> MetadataProperty:
    return MetadataProperty(
        property_id=row["property_id"],
        property_name=row["property_name"],
        backend_name=row["backend_name"],
        value_type=row["value_type"],
        description=row.get("description"),
        ext_params=row.get("ext_params"),
        status=row["status"],
    )
