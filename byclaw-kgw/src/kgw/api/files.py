from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Header, Request
from kgw.dispatcher import dispatch_json

router = APIRouter(prefix="/kgw/api/v1")


@router.post("/fileToMarkdownIndex")
async def file_to_markdown_index(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
) -> dict[str, Any]:
    kn_code = str(body.get("knCode", ""))
    file_path = str(body.get("filePath") or "")
    return await dispatch_json(
        request,
        operation="fileToMarkdownIndex",
        kn_code=kn_code,
        user_id=x_user_id,
        body=body,
        file_path=file_path,
    )


@router.post("/fileBuildStatus")
async def file_build_status(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
) -> dict[str, Any]:
    kn_code = str(body.get("knCode", ""))
    return await dispatch_json(
        request,
        operation="fileBuildStatus",
        kn_code=kn_code,
        user_id=x_user_id,
        body=body,
    )


@router.post("/listDir")
async def list_dir(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
) -> dict[str, Any]:
    kn_code = str(body.get("knCode", ""))
    return await dispatch_json(
        request,
        operation="listDir",
        kn_code=kn_code,
        user_id=x_user_id,
        body=body,
    )


@router.post("/glob")
async def glob_files(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
) -> dict[str, Any]:
    kn_code = str(body.get("knCode", ""))
    return await dispatch_json(
        request,
        operation="glob",
        kn_code=kn_code,
        user_id=x_user_id,
        body=body,
    )


@router.post("/readFile")
async def read_file(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
) -> dict[str, Any]:
    kn_code = str(body.get("knCode", ""))
    file_path = str(body.get("filePath") or "")
    return await dispatch_json(
        request,
        operation="readFile",
        kn_code=kn_code,
        user_id=x_user_id,
        body=body,
        file_path=file_path,
    )


@router.post("/dslGuide")
async def dsl_guide(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
) -> dict[str, Any]:
    kn_code = str(body.get("knCode", ""))
    return await dispatch_json(
        request,
        operation="dslGuide",
        kn_code=kn_code,
        user_id=x_user_id,
        body=body,
    )
