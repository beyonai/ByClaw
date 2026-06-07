from __future__ import annotations

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
    return await dispatch_json(
        request,
        operation="directoryUpdate",
        kn_code=kn_code,
        user_id=x_user_id,
        body=body,
    )


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
