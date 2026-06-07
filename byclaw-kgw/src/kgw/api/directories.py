from __future__ import annotations

from posixpath import dirname
from typing import Annotated, Any

from fastapi import APIRouter, Header, Request
from kgw.dispatcher import dispatch_json

router = APIRouter(prefix="/kgw/api/v1")


@router.post("/directories/create")
async def directory_create(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
) -> dict[str, Any]:
    kn_code = str(body.get("knCode", ""))
    return await dispatch_json(
        request,
        operation="directoryCreate",
        kn_code=kn_code,
        user_id=x_user_id,
        body=body,
    )


@router.post("/directories/update")
async def directory_update(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
) -> dict[str, Any]:
    kn_code = str(body.get("knCode", ""))
    old_directory_path = str(body.get("directoryPath") or "")
    directory_name = str(body.get("directoryName") or "")
    resp = await dispatch_json(
        request,
        operation="directoryUpdate",
        kn_code=kn_code,
        user_id=x_user_id,
        body=body,
    )
    if resp.get("resultCode") == "0" and old_directory_path and directory_name:
        # Compose the new absolute path: replace the last segment with directoryName.
        parent = dirname(old_directory_path.rstrip("/")) or "/"
        new_directory_path = (
            parent.rstrip("/") + "/" + directory_name
            if parent != "/"
            else "/" + directory_name
        )
        from kgw.metadata import binding as binding_mod  # noqa: PLC0415

        # Cleanup may raise — fail loud is intentional: a stale binding path
        # is harder to recover from than a client retry.
        await binding_mod.rename_directory_prefix(
            request.app.state.pool,
            kn_code=kn_code,
            old_directory_path=old_directory_path,
            new_directory_path=new_directory_path,
        )
    return resp


@router.post("/directories/delete")
async def directory_delete(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
) -> dict[str, Any]:
    kn_code = str(body.get("knCode", ""))
    directory_path = str(body.get("directoryPath") or "")
    resp = await dispatch_json(
        request,
        operation="directoryDelete",
        kn_code=kn_code,
        user_id=x_user_id,
        body=body,
    )
    if resp.get("resultCode") == "0" and directory_path:
        from kgw.metadata import binding as binding_mod  # noqa: PLC0415

        # Cleanup may raise — fail loud is intentional: an orphaned binding
        # is harder to recover from than a client retry.
        await binding_mod.delete_by_directory(
            request.app.state.pool, kn_code=kn_code, directory_path=directory_path
        )
    return resp
