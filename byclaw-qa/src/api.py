"""API wrapper that adds resourceId-based endpoints.

New endpoints accept external resourceId, look up the internal knCode
(resourceCode) from MinIO config files, then delegate to the original
route handler logic.

New routes:
  POST /api/v1/knowledgeItems/importByResourceId
  POST /api/v1/fileToMarkdownIndexByResourceId
  POST /api/v1/knowledgeItems/searchByResourceId
  POST /api/v1/directories/createByResourceId
  POST /api/v1/directories/updateByResourceId
  POST /api/v1/directories/deleteByResourceId
  POST /api/v1/listDirByResourceId
  POST /api/v1/readFileByResourceId
  POST /api/v1/downloadFileByResourceId

Usage in start.sh:  uvicorn api:app --host ... --port ...
"""

from __future__ import annotations

import asyncio
import io
import json
import zipfile
from typing import Any

import mimetypes
from pathlib import PurePosixPath

from fastapi import BackgroundTasks, Body, File, Form, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import ValidationError

from by_qa.core import logger
from by_qa.knowledge_base.api.schemas import (
    CreateDirectoryRequest,
    DeleteDirectoryRequest,
    FileToMarkdownIndexRequest,
    KnowledgeItemDownloadRequest,
    KnowledgeItemListDirRequest,
    KnowledgeItemUploadRequest,
    ReadFileRequest,
    SearchRequest,
    UpdateDirectoryRequest,
)
from by_qa.knowledge_base.services.errors import (
    KnowledgeBaseConfigurationError,
    KnowledgeBaseValidationError,
)
from by_qa.knowledge_base.services.zip_batch_import_service import ZipBatchImportService
from by_qa.knowledge_base.infrastructure.storage import (
    StorageError,
    StorageNotFoundError,
)
from byclaw_knowledge_storage import get_kg_doc_from_resourcefs
from byclaw_userfs_storage import (
    RESOURCE_ID_HEADER,
    bind_byclaw_resource_id,
    build_byclaw_userfs_headers,
    reset_byclaw_userfs_headers,
    set_byclaw_userfs_headers,
)
from by_qa.main import (
    app,
    resolve_knowledge_base_service,
    resolve_document_chunking_service,
    resolve_knowledge_item_ingestion_service,
    resolve_knowledge_item_search_service,
)

from redis_agent_config import get_kg_doc_from_redis
from redis_runtime import init_shared_redis_from_env

@app.middleware("http")
async def byclaw_storage_header_context_middleware(request, call_next):
    token = set_byclaw_userfs_headers(
        {
            "beyond-token": request.headers.get("beyond-token", ""),
            RESOURCE_ID_HEADER: request.headers.get(RESOURCE_ID_HEADER, ""),
        }
    )
    try:
        return await call_next(request)
    finally:
        reset_byclaw_userfs_headers(token)
_redis = init_shared_redis_from_env()


def _success(result_object: dict[str, Any] | None = None) -> JSONResponse:
    return JSONResponse(
        status_code=200,
        content={
            "resultCode": "0",
            "resultMsg": "success",
            "resultObject": result_object or {},
        },
    )


def _error(result_msg: str, result_object: dict[str, Any] | None = None) -> JSONResponse:
    return JSONResponse(
        status_code=200,
        content={
            "resultCode": "-1",
            "resultMsg": result_msg,
            "resultObject": result_object or {},
        },
    )


async def _resolve_kn_code(resource_id: str) -> str | None:
    """Resolve resourceCode from canonical ResourceFS, with legacy Redis fallback."""
    source = "ResourceFS"
    try:
        config = await get_kg_doc_from_resourcefs(resource_id)
    except StorageNotFoundError:
        logger.info(
            "KG_DOC config not found in ResourceFS: resourceId=%s; "
            "falling back to Redis",
            resource_id,
        )
        config = None
    except StorageError as exc:
        logger.warning(
            "Failed to read KG_DOC config from ResourceFS: resourceId=%s, "
            "error=%s",
            resource_id,
            exc,
        )
        return None
    if config is None:
        source = "Redis"
        config = await get_kg_doc_from_redis(_redis, resource_id)
        if config is None:
            return None
    code = config.get("resourceCode")
    if not code:
        logger.warning(
            "KG_DOC config from %s missing resourceCode field: resourceId=%s",
            source,
            resource_id,
        )
        return None
    logger.info(
        "Resolved knCode from %s: resourceId=%s -> knCode=%s",
        source,
        resource_id,
        code,
    )
    return str(code)


async def _resolve_kn_codes(resource_ids: list[str]) -> list[str] | None:
    """Resolve a list of resourceIds concurrently. Returns None if any fails."""
    tasks = [_resolve_kn_code(rid) for rid in resource_ids]
    results = await asyncio.gather(*tasks)
    codes = []
    for rid, code in zip(resource_ids, results):
        if code is None:
            return None
        codes.append(code)
    return codes


# -- importByResourceId -------------------------------------------------------

@app.post("/api/v1/knowledgeItems/importByResourceId")
@app.post("/api/v1/knowledge-items/importByResourceId")
async def import_by_resource_id(
    resource_id: str | None = Form(None, alias="resourceId"),
    file_path: str | None = Form(None, alias="filePath"),
    file_description: str | None = Form(None, alias="fileDescription"),
    process_front_matter: bool = Form(True, alias="processFrontMatter"),
    file_content: UploadFile | None = File(None, alias="fileContent"),
):
    if not resource_id:
        return _error("resourceId is required")

    kn_code = await _resolve_kn_code(resource_id)
    if kn_code is None:
        return _error(f"cannot resolve resourceId: {resource_id}")

    try:
        payload = await file_content.read() if file_content is not None else None
        request = KnowledgeItemUploadRequest.model_validate(
            {
                "knCode": kn_code,
                "filePath": file_path,
                "fileDescription": file_description,
                "processFrontMatter": process_front_matter,
                "fileContent": payload,
                "fileName": file_content.filename if file_content is not None else None,
                "contentType": file_content.content_type if file_content is not None else None,
            }
        )
    except ValidationError as exc:
        return _error("request validation failed", {"errors": json.loads(exc.json())})

    try:
        with bind_byclaw_resource_id(resource_id):
            service = await resolve_knowledge_item_ingestion_service()
            filename = file_content.filename if file_content is not None else ""
            if filename.lower().endswith(".zip"):
                if not zipfile.is_zipfile(io.BytesIO(payload or b"")):
                    return _error("invalid zip file")
                batch_service = ZipBatchImportService(ingestion_service=service)
                result = await batch_service.import_zip(
                    kb_code=request.kb_code,
                    target_dir=request.file_path,
                    zip_bytes=payload,
                    process_front_matter=request.process_front_matter,
                    file_description=request.file_description,
                )
                result_object = {
                    "data": [item.model_dump(by_alias=True) for item in result.data],
                    "summary": result.summary.model_dump(by_alias=True),
                }
                if result.post_process_errors:
                    result_object["postProcessErrors"] = result.post_process_errors
                return _success(result_object)
            await service.upload_file(request)
    except KnowledgeBaseConfigurationError:
        logger.exception("importByResourceId configuration error: resourceId=%s", resource_id)
        return _error("knowledge base configuration error")
    except KnowledgeBaseValidationError:
        logger.exception("importByResourceId validation error: resourceId=%s", resource_id)
        return _error("knowledge base validation failed")
    except Exception:
        logger.exception("importByResourceId unexpected error: resourceId=%s", resource_id)
        return _error("internal error")

    normalized_path = "/" + request.file_path.strip("/")
    return _success(
        {
            "data": [
                {
                    "filePath": normalized_path,
                    "success": True,
                    "error": None,
                }
            ],
            "summary": {"total": 1, "succeeded": 1, "failed": 0},
        }
    )


# -- fileToMarkdownIndexByResourceId -------------------------------------------

@app.post("/api/v1/fileToMarkdownIndexByResourceId")
async def file_to_markdown_index_by_resource_id(
    background_tasks: BackgroundTasks,
    body: dict[str, Any] = Body(...),
):
    resource_id = body.get("resourceId")
    if not resource_id:
        return _error("resourceId is required")

    kn_code = await _resolve_kn_code(str(resource_id))
    if kn_code is None:
        return _error(f"cannot resolve resourceId: {resource_id}")

    body_mapped = {**body, "knCode": kn_code}
    body_mapped.pop("resourceId", None)

    try:
        request = FileToMarkdownIndexRequest.model_validate(body_mapped)
    except ValidationError as exc:
        return _error("request validation failed", {"errors": json.loads(exc.json())})

    try:
        with bind_byclaw_resource_id(resource_id):
            service = await resolve_knowledge_item_ingestion_service()
            build_task_id = await service.create_file_to_markdown_index_task(request)
            background_headers = build_byclaw_userfs_headers()

        async def _run_task():
            context_token = set_byclaw_userfs_headers(background_headers)
            try:
                with bind_byclaw_resource_id(resource_id):
                    chunking_service = await resolve_document_chunking_service()
                    await service.execute_file_to_markdown_index_task(
                        request,
                        document_chunking_service=chunking_service,
                        build_task_id=build_task_id,
                    )
            finally:
                reset_byclaw_userfs_headers(context_token)

        background_tasks.add_task(_run_task)
    except KnowledgeBaseConfigurationError:
        logger.exception("fileToMarkdownIndexByResourceId configuration error: resourceId=%s", resource_id)
        return _error("knowledge base configuration error")
    except KnowledgeBaseValidationError:
        logger.exception("fileToMarkdownIndexByResourceId validation error: resourceId=%s", resource_id)
        return _error("knowledge base validation failed")

    return _success()


# -- searchByResourceId --------------------------------------------------------

@app.post("/api/v1/knowledgeItems/searchByResourceId")
@app.post("/api/v1/knowledge-items/searchByResourceId")
async def search_by_resource_id(body: dict[str, Any] = Body(...)):
    resource_id_list = body.get("resourceIdList")
    if not resource_id_list or not isinstance(resource_id_list, list):
        return _error("resourceIdList is required")

    str_resource_ids = [str(rid) for rid in resource_id_list]
    kn_codes = await _resolve_kn_codes(str_resource_ids)
    if kn_codes is None:
        return _error(f"cannot resolve one or more resourceIds: {resource_id_list}")

    # knCode -> resourceId reverse mapping for response rewriting
    code_to_resource_id: dict[str, str] = {}
    for rid, code in zip(str_resource_ids, kn_codes):
        code_to_resource_id[code] = rid

    body_mapped = {**body, "knCodeList": kn_codes}
    body_mapped.pop("resourceIdList", None)

    try:
        request = SearchRequest.model_validate(body_mapped)
    except ValidationError as exc:
        return _error("request validation failed", {"errors": json.loads(exc.json())})

    try:
        service = await resolve_knowledge_item_search_service()
        items = await service.search(request)
    except KnowledgeBaseConfigurationError:
        logger.exception("searchByResourceIdList configuration error")
        return _error("knowledge base configuration error")
    except KnowledgeBaseValidationError:
        logger.exception("searchByResourceIdList validation error")
        return _error("knowledge base validation failed")

    data = []
    for item in items:
        row = item.model_dump(by_alias=True)
        kn_code = row.get("knCode", "")
        row["knCode"] = code_to_resource_id.get(kn_code, kn_code)
        data.append(row)

    return _success({"data": data})


# -- directories/createByResourceId -------------------------------------------

@app.post("/api/v1/directories/createByResourceId")
async def create_directory_by_resource_id(body: dict[str, Any] = Body(...)):
    resource_id = body.get("resourceId")
    if not resource_id:
        return _error("resourceId is required")

    kn_code = await _resolve_kn_code(str(resource_id))
    if kn_code is None:
        return _error(f"cannot resolve resourceId: {resource_id}")

    body_mapped = {**body, "knCode": kn_code}
    body_mapped.pop("resourceId", None)

    try:
        request = CreateDirectoryRequest.model_validate(body_mapped)
    except ValidationError as exc:
        return _error("request validation failed", {"errors": json.loads(exc.json())})

    try:
        with bind_byclaw_resource_id(resource_id):
            service = await resolve_knowledge_base_service()
            await service.create_directory(request)
    except KnowledgeBaseConfigurationError as exc:
        logger.exception("createDirectoryByResourceId configuration error: resourceId=%s", resource_id)
        return _error(str(exc))
    except KnowledgeBaseValidationError as exc:
        logger.exception("createDirectoryByResourceId validation error: resourceId=%s", resource_id)
        return _error(str(exc))

    return _success()


# -- directories/updateByResourceId -------------------------------------------

@app.post("/api/v1/directories/updateByResourceId")
async def update_directory_by_resource_id(body: dict[str, Any] = Body(...)):
    resource_id = body.get("resourceId")
    if not resource_id:
        return _error("resourceId is required")

    kn_code = await _resolve_kn_code(str(resource_id))
    if kn_code is None:
        return _error(f"cannot resolve resourceId: {resource_id}")

    body_mapped = {**body, "knCode": kn_code}
    body_mapped.pop("resourceId", None)

    try:
        request = UpdateDirectoryRequest.model_validate(body_mapped)
    except ValidationError as exc:
        return _error("request validation failed", {"errors": json.loads(exc.json())})

    try:
        with bind_byclaw_resource_id(resource_id):
            service = await resolve_knowledge_base_service()
            await service.update_directory(request)
    except KnowledgeBaseConfigurationError as exc:
        logger.exception("updateDirectoryByResourceId configuration error: resourceId=%s", resource_id)
        return _error(str(exc))
    except KnowledgeBaseValidationError as exc:
        logger.exception("updateDirectoryByResourceId validation error: resourceId=%s", resource_id)
        return _error(str(exc))

    return _success()


# -- directories/deleteByResourceId -------------------------------------------

@app.post("/api/v1/directories/deleteByResourceId")
async def delete_directory_by_resource_id(body: dict[str, Any] = Body(...)):
    resource_id = body.get("resourceId")
    if not resource_id:
        return _error("resourceId is required")

    kn_code = await _resolve_kn_code(str(resource_id))
    if kn_code is None:
        return _error(f"cannot resolve resourceId: {resource_id}")

    body_mapped = {**body, "knCode": kn_code}
    body_mapped.pop("resourceId", None)

    try:
        request = DeleteDirectoryRequest.model_validate(body_mapped)
    except ValidationError as exc:
        return _error("request validation failed", {"errors": json.loads(exc.json())})

    try:
        with bind_byclaw_resource_id(resource_id):
            service = await resolve_knowledge_base_service()
            await service.delete_directory(request)
    except KnowledgeBaseConfigurationError as exc:
        logger.exception("deleteDirectoryByResourceId configuration error: resourceId=%s", resource_id)
        return _error(str(exc))
    except KnowledgeBaseValidationError as exc:
        logger.exception("deleteDirectoryByResourceId validation error: resourceId=%s", resource_id)
        return _error(str(exc))

    return _success()


# -- listDirByResourceId ------------------------------------------------------

@app.post("/api/v1/listDirByResourceId")
async def list_dir_by_resource_id(body: dict[str, Any] = Body(...)):
    resource_id = body.get("resourceId")
    if not resource_id:
        return _error("resourceId is required")

    kn_code = await _resolve_kn_code(str(resource_id))
    if kn_code is None:
        return _error(f"cannot resolve resourceId: {resource_id}")

    body_mapped = {**body, "knCode": kn_code}
    body_mapped.pop("resourceId", None)

    try:
        request = KnowledgeItemListDirRequest.model_validate(body_mapped)
    except ValidationError as exc:
        return _error("request validation failed", {"errors": json.loads(exc.json())})

    try:
        with bind_byclaw_resource_id(resource_id):
            service = await resolve_knowledge_base_service()
            result = await service.list_dir(request)
    except KnowledgeBaseConfigurationError as exc:
        logger.exception("listDirByResourceId configuration error: resourceId=%s", resource_id)
        return _error(str(exc))
    except KnowledgeBaseValidationError as exc:
        logger.exception("listDirByResourceId validation error: resourceId=%s", resource_id)
        return _error(str(exc))

    data = []
    for item in result.data:
        row = item.model_dump(by_alias=True)
        row["knCode"] = str(resource_id)
        data.append(row)

    return _success({"data": data})


def _build_content_disposition(filename: str) -> str:
    normalized = PurePosixPath(filename or "download").name or "download"
    safe_ascii = normalized.encode("ascii", "ignore").decode("ascii")
    if not safe_ascii or safe_ascii.startswith("."):
        suffix = PurePosixPath(normalized).suffix
        safe_ascii = f"download{suffix}" if suffix else "download"
    safe_ascii = safe_ascii.replace('"', "")
    if safe_ascii == normalized:
        return f'attachment; filename="{safe_ascii}"'
    from urllib.parse import quote
    encoded = quote(normalized, safe="")
    return f"attachment; filename=\"{safe_ascii}\"; filename*=UTF-8''{encoded}"


# -- readFileByResourceId -----------------------------------------------------

@app.post("/api/v1/readFileByResourceId")
async def read_file_by_resource_id(body: dict[str, Any] = Body(...)):
    resource_id = body.get("resourceId")
    if not resource_id:
        return _error("resourceId is required")

    kn_code = await _resolve_kn_code(str(resource_id))
    if kn_code is None:
        return _error(f"cannot resolve resourceId: {resource_id}")

    body_mapped = {**body, "knCode": kn_code}
    body_mapped.pop("resourceId", None)

    try:
        request = ReadFileRequest.model_validate(body_mapped)
    except ValidationError as exc:
        return _error("request validation failed", {"errors": json.loads(exc.json())})

    try:
        with bind_byclaw_resource_id(resource_id):
            service = await resolve_knowledge_base_service()
            result = await service.read_file(request)
    except KnowledgeBaseConfigurationError as exc:
        logger.exception("readFileByResourceId configuration error: resourceId=%s", resource_id)
        return _error(str(exc))
    except KnowledgeBaseValidationError as exc:
        logger.exception("readFileByResourceId validation error: resourceId=%s", resource_id)
        return _error(str(exc))

    result["knCode"] = str(resource_id)
    result_object = {k: v for k, v in result.items() if v is not None}
    return _success(result_object)


# -- downloadFileByResourceId -------------------------------------------------

@app.post("/api/v1/downloadFileByResourceId")
async def download_file_by_resource_id(body: dict[str, Any] = Body(...)):
    resource_id = body.get("resourceId")
    if not resource_id:
        return _error("resourceId is required")

    kn_code = await _resolve_kn_code(str(resource_id))
    if kn_code is None:
        return _error(f"cannot resolve resourceId: {resource_id}")

    body_mapped = {**body, "knCode": kn_code}
    body_mapped.pop("resourceId", None)

    try:
        request = KnowledgeItemDownloadRequest.model_validate(body_mapped)
    except ValidationError as exc:
        return _error("request validation failed", {"errors": json.loads(exc.json())})

    try:
        with bind_byclaw_resource_id(resource_id):
            service = await resolve_knowledge_base_service()
            result = await service.download_file(request)
    except KnowledgeBaseConfigurationError as exc:
        logger.exception("downloadFileByResourceId configuration error: resourceId=%s", resource_id)
        return _error(str(exc))
    except KnowledgeBaseValidationError as exc:
        logger.exception("downloadFileByResourceId validation error: resourceId=%s", resource_id)
        return _error(str(exc))

    quoted_filename = PurePosixPath(result["filename"]).name.replace('"', "")
    media_type = result["media_type"] or mimetypes.guess_type(quoted_filename)[0]
    return Response(
        content=result["content"],
        media_type=media_type or "application/octet-stream",
        headers={"Content-Disposition": _build_content_disposition(quoted_filename)},
    )
