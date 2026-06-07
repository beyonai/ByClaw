"""metadataProperty 主目录 4 个端点(网关全局口径)。"""

from __future__ import annotations

from typing import Any

import psycopg
from fastapi import APIRouter, Request
from kgw.envelope import (
    INVALID_BATCH_DUPLICATE_NAME,
    INVALID_PROPERTY_NAME,
    INVALID_VALUE_TYPE,
    MetadataPropertyAlreadyExists,
    MetadataPropertyInUse,
    MetadataPropertyNotFound,
    success,
)
from kgw.metadata import binding as binding_mod
from kgw.metadata import registry
from kgw.metadata import sync as sync_mod
from kgw.metadata.registry import derive_backend_name
from kgw.metadata.types import MetadataValueType

router = APIRouter(prefix="/kgw/api/v1/metadataProperties")

_VALID_VALUE_TYPES: frozenset[MetadataValueType] = frozenset(MetadataValueType)


def _validate_value_type(value_type: str) -> None:
    if value_type not in _VALID_VALUE_TYPES:
        raise INVALID_VALUE_TYPE(
            f"invalid valueType: {value_type!r}; "
            f"must be one of {sorted(_VALID_VALUE_TYPES)}",
            value_type=value_type,
        )


def _property_to_dict(p) -> dict[str, Any]:
    return {
        "propertyName": p.property_name,
        "valueType": p.value_type,
        "description": p.description,
        "extParams": p.ext_params,
    }


@router.post("/create")
async def metadata_property_create(
    request: Request,
    body: dict[str, Any],
) -> dict[str, Any]:
    pool = request.app.state.pool
    property_name: str = str(body.get("propertyName", ""))
    value_type: str = str(body.get("valueType", ""))
    description: str | None = body.get("description")
    ext_params: dict[str, Any] | None = body.get("extParams")

    if not property_name:
        raise INVALID_PROPERTY_NAME(
            f"propertyName missing or empty: {body.get('propertyName')!r}",
            property_name=property_name,
        )
    _validate_value_type(value_type)

    prop = await registry.create_property(
        pool,
        property_name=property_name,
        value_type=value_type,
        description=description,
        ext_params=ext_params,
    )
    return success(_property_to_dict(prop))


@router.post("/batchCreate")
async def metadata_property_batch_create(
    request: Request,
    body: dict[str, Any],
) -> dict[str, Any]:
    pool = request.app.state.pool
    property_list: list[dict[str, Any]] = body.get("propertyList", [])

    # Pre-validate: in-batch duplicate names
    seen: set[str] = set()
    for item in property_list:
        name = item.get("propertyName", "")
        if not isinstance(name, str) or not name:
            raise INVALID_PROPERTY_NAME(
                f"propertyName missing or empty in batch item: {item!r}",
                property_name=str(name),
            )
        if name in seen:
            raise INVALID_BATCH_DUPLICATE_NAME(
                f"duplicate property_name in batch: {name!r}",
                property_name=name,
            )
        seen.add(name)

    # Per-item valueType validation before touching the DB
    for item in property_list:
        _validate_value_type(str(item.get("valueType", "")))

    created: list[dict[str, Any]] = []

    async with pool.connection() as conn:
        async with conn.transaction():
            current_name = ""
            try:
                async with conn.cursor() as cur:
                    for item in property_list:
                        p_name = str(item["propertyName"])
                        p_type = str(item["valueType"])
                        p_desc: str | None = item.get("description")
                        p_ext = item.get("extParams")
                        current_name = p_name

                        await cur.execute(
                            """
                            INSERT INTO kgw_metadata_property
                                (property_name, backend_name, value_type,
                                 description, ext_params, status)
                            VALUES (%s, '__placeholder__', %s, %s, %s, 'ACTIVE')
                            RETURNING property_id
                            """,
                            (
                                p_name,
                                p_type,
                                p_desc,
                                psycopg.types.json.Jsonb(p_ext)
                                if p_ext is not None
                                else None,
                            ),
                        )
                        row = await cur.fetchone()
                        pid = row["property_id"]
                        bname = derive_backend_name(p_name, pid)
                        await cur.execute(
                            "UPDATE kgw_metadata_property SET backend_name=%s "
                            "WHERE property_id=%s",
                            (bname, pid),
                        )
                        created.append(
                            {
                                "propertyName": p_name,
                                "valueType": p_type,
                                "description": p_desc,
                                "extParams": p_ext,
                            }
                        )
            except psycopg.errors.UniqueViolation as exc:
                # Whole transaction will be rolled back by the context manager
                raise MetadataPropertyAlreadyExists(
                    f"metadata property already exists: {current_name}",
                    property_name=current_name,
                ) from exc

    return success({"data": created})


@router.post("/list")
async def metadata_property_list(
    request: Request,
    body: dict[str, Any],
) -> dict[str, Any]:
    pool = request.app.state.pool
    name_list: list[str] | None = body.get("propertyNameList")

    props = await registry.list_active_properties(pool, name_list)
    return success({"data": [_property_to_dict(p) for p in props]})


@router.post("/delete")
async def metadata_property_delete(
    request: Request,
    body: dict[str, Any],
) -> dict[str, Any]:
    pool = request.app.state.pool
    property_name: str = str(body.get("propertyName", ""))

    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cur:
                # a. Lock the row
                await cur.execute(
                    "SELECT property_id FROM kgw_metadata_property "
                    "WHERE property_name=%s AND status='ACTIVE' FOR UPDATE",
                    (property_name,),
                )
                row = await cur.fetchone()
                if not row:
                    raise MetadataPropertyNotFound(
                        f"metadata property not found: {property_name}",
                        property_name=property_name,
                    )
                pid: int = row["property_id"]

                # b. Check if in use
                # Must run on same conn as FOR UPDATE to avoid a TOCTOU race with concurrent binds.
                await cur.execute(
                    "SELECT COUNT(*) AS c FROM kgw_metadata_property_binding "
                    "WHERE property_id=%s AND status IN ('PENDING','SYNCED')",
                    (pid,),
                )
                count_row = await cur.fetchone()
                count = int(count_row["c"])
                if count > 0:
                    samples = await binding_mod.sample_in_use(pool, pid, limit=5)
                    raise MetadataPropertyInUse(
                        f"metadata property {property_name!r} is in use "
                        f"({count} references)",
                        property_name=property_name,
                        in_use_samples=samples,
                        total_references=count,
                    )

                # c. Soft-delete the main row
                await cur.execute(
                    "UPDATE kgw_metadata_property "
                    "SET status='DELETED', deleted_at=NOW() "
                    "WHERE property_id=%s",
                    (pid,),
                )

                # d. Flip SYNCED→PURGING; remove FAILED/SYNCING rows
                await sync_mod.upsert_purging_for_synced(conn, pid)

    return success({})
