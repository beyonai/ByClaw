"""metadataProperty admin endpoints (read + state flip, no backend calls)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query, Request
from kgw.envelope import MetadataPropertyNotFound, success

router = APIRouter(prefix="/kgw/admin/v1/metadata-properties")


@router.get("")
async def admin_list_all(request: Request) -> dict[str, Any]:
    """List all metadataProperty rows (ACTIVE + DELETED) with sync details."""
    pool = request.app.state.pool

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT
                    p.property_name,
                    p.backend_name,
                    p.value_type,
                    p.status,
                    s.endpoint_key,
                    s.sync_status,
                    s.last_error
                FROM kgw_metadata_property p
                LEFT JOIN kgw_metadata_property_sync s
                    ON s.property_id = p.property_id
                ORDER BY p.property_id, s.endpoint_key
                """
            )
            rows = await cur.fetchall()

    # Group sync rows under each property
    props: dict[str, dict[str, Any]] = {}
    for row in rows:
        name = row["property_name"]
        if name not in props:
            props[name] = {
                "propertyName": name,
                "backendName": row["backend_name"],
                "valueType": row["value_type"],
                "status": row["status"],
                "syncDetails": [],
            }
        if row["endpoint_key"] is not None:
            props[name]["syncDetails"].append(
                {
                    "endpointKey": row["endpoint_key"],
                    "syncStatus": row["sync_status"],
                    "lastError": row["last_error"],
                }
            )

    return success({"data": list(props.values())})


@router.post("/{property_name}/sync-retry")
async def admin_sync_retry(
    request: Request,
    property_name: str,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Flip FAILED sync rows to SYNCING for a given property.

    Optional body ``{"knCode": "..."}`` restricts the flip to the endpoint
    associated with that KB config.
    """
    if body is None:
        body = {}

    pool = request.app.state.pool
    kn_code: str | None = body.get("knCode")

    # Step 1: look up property_id (must be ACTIVE)
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT property_id FROM kgw_metadata_property "
                "WHERE property_name=%s AND status='ACTIVE'",
                (property_name,),
            )
            row = await cur.fetchone()

    if row is None:
        raise MetadataPropertyNotFound(
            f"metadata property not found or not active: {property_name}",
            property_name=property_name,
        )
    pid: int = row["property_id"]

    # Step 2: optionally resolve endpoint_key from knCode
    endpoint_key: str | None = None
    if kn_code is not None:
        cfg = await request.app.state.config_provider.get_kb_config(kn_code)
        if cfg is None:
            raise MetadataPropertyNotFound(
                f"KB config not found for knCode: {kn_code}",
                property_name=property_name,
            )
        endpoint_key = cfg.domain_url or cfg.domain_name

    # Step 3: flip FAILED → SYNCING
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            if endpoint_key is not None:
                await cur.execute(
                    "UPDATE kgw_metadata_property_sync "
                    "SET sync_status='SYNCING', last_error=NULL "
                    "WHERE property_id=%s AND sync_status='FAILED' "
                    "AND endpoint_key=%s",
                    (pid, endpoint_key),
                )
            else:
                await cur.execute(
                    "UPDATE kgw_metadata_property_sync "
                    "SET sync_status='SYNCING', last_error=NULL "
                    "WHERE property_id=%s AND sync_status='FAILED'",
                    (pid,),
                )
            rowcount = cur.rowcount
        await conn.commit()

    return success({"updated": rowcount})


@router.post("/{property_name}/purge-retry")
async def admin_purge_retry(
    request: Request,
    property_name: str,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Flip PURGE_FAILED sync rows to PURGING for a given property.

    Works for both ACTIVE and DELETED properties.
    Optional body ``{"knCode": "..."}`` restricts the flip to one endpoint.
    """
    if body is None:
        body = {}

    pool = request.app.state.pool
    kn_code: str | None = body.get("knCode")

    # Look up property_id (any status — DELETED properties can also need purge-retry)
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT property_id FROM kgw_metadata_property "
                "WHERE property_name=%s ORDER BY property_id DESC LIMIT 1",
                (property_name,),
            )
            row = await cur.fetchone()

    if row is None:
        raise MetadataPropertyNotFound(
            f"metadata property not found: {property_name}",
            property_name=property_name,
        )
    pid: int = row["property_id"]

    # Optionally resolve endpoint_key from knCode
    endpoint_key: str | None = None
    if kn_code is not None:
        cfg = await request.app.state.config_provider.get_kb_config(kn_code)
        if cfg is None:
            raise MetadataPropertyNotFound(
                f"KB config not found for knCode: {kn_code}",
                property_name=property_name,
            )
        endpoint_key = cfg.domain_url or cfg.domain_name

    # Flip PURGE_FAILED → PURGING
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            if endpoint_key is not None:
                await cur.execute(
                    "UPDATE kgw_metadata_property_sync "
                    "SET sync_status='PURGING', last_error=NULL "
                    "WHERE property_id=%s AND sync_status='PURGE_FAILED' "
                    "AND endpoint_key=%s",
                    (pid, endpoint_key),
                )
            else:
                await cur.execute(
                    "UPDATE kgw_metadata_property_sync "
                    "SET sync_status='PURGING', last_error=NULL "
                    "WHERE property_id=%s AND sync_status='PURGE_FAILED'",
                    (pid,),
                )
            rowcount = cur.rowcount
        await conn.commit()

    return success({"updated": rowcount})


@router.get("/orphans")
async def admin_orphans(
    request: Request,
    kn_code: str | None = Query(default=None, alias="knCode"),
) -> dict[str, Any]:
    """Return stuck orphan rows visible in the gateway's own tables.

    No backend HTTP calls. Purely local DB queries.

    purgeFailed  — sync rows with sync_status='PURGE_FAILED'
    stalePending — binding rows with status='PENDING' older than 5 minutes
    """
    pool = request.app.state.pool

    # Optionally resolve endpoint_key for purgeFailed filter
    endpoint_key: str | None = None
    if kn_code is not None:
        cfg = await request.app.state.config_provider.get_kb_config(kn_code)
        if cfg is not None:
            endpoint_key = cfg.domain_url or cfg.domain_name
        # If config not found, skip the endpoint_key filter (per spec)

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            # --- purgeFailed ---
            if endpoint_key is not None:
                await cur.execute(
                    """
                    SELECT
                        p.property_name,
                        p.backend_name,
                        s.endpoint_key,
                        s.last_error
                    FROM kgw_metadata_property_sync s
                    JOIN kgw_metadata_property p ON p.property_id = s.property_id
                    WHERE s.sync_status = 'PURGE_FAILED'
                      AND s.endpoint_key = %s
                    ORDER BY p.property_name, s.endpoint_key
                    """,
                    (endpoint_key,),
                )
            else:
                await cur.execute(
                    """
                    SELECT
                        p.property_name,
                        p.backend_name,
                        s.endpoint_key,
                        s.last_error
                    FROM kgw_metadata_property_sync s
                    JOIN kgw_metadata_property p ON p.property_id = s.property_id
                    WHERE s.sync_status = 'PURGE_FAILED'
                    ORDER BY p.property_name, s.endpoint_key
                    """
                )
            pf_rows = await cur.fetchall()

            # --- stalePending ---
            if kn_code is not None:
                await cur.execute(
                    """
                    SELECT
                        p.property_name,
                        b.kn_code,
                        b.file_path,
                        b.bound_at
                    FROM kgw_metadata_property_binding b
                    JOIN kgw_metadata_property p ON p.property_id = b.property_id
                    WHERE b.status = 'PENDING'
                      AND b.bound_at < NOW() - (5 * INTERVAL '1 minute')
                      AND b.kn_code = %s
                    ORDER BY b.bound_at
                    """,
                    (kn_code,),
                )
            else:
                await cur.execute(
                    """
                    SELECT
                        p.property_name,
                        b.kn_code,
                        b.file_path,
                        b.bound_at
                    FROM kgw_metadata_property_binding b
                    JOIN kgw_metadata_property p ON p.property_id = b.property_id
                    WHERE b.status = 'PENDING'
                      AND b.bound_at < NOW() - (5 * INTERVAL '1 minute')
                    ORDER BY b.bound_at
                    """
                )
            sp_rows = await cur.fetchall()

    purge_failed = [
        {
            "propertyName": row["property_name"],
            "backendName": row["backend_name"],
            "endpointKey": row["endpoint_key"],
            "lastError": row["last_error"],
        }
        for row in pf_rows
    ]

    stale_pending = [
        {
            "propertyName": row["property_name"],
            "knCode": row["kn_code"],
            "filePath": row["file_path"],
            "boundAt": row["bound_at"].isoformat() if row["bound_at"] else None,
        }
        for row in sp_rows
    ]

    return success({"purgeFailed": purge_failed, "stalePending": stale_pending})
