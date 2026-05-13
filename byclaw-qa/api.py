"""API wrapper that adds resourceId-based endpoints.

New endpoints accept external resourceId, look up the internal knCode
(resourceCode) from MinIO config files, then delegate to the original
route handler logic.

New routes:
  POST /api/v1/knowledgeItems/importByResourceId
  POST /api/v1/fileToMarkdownIndexByResourceId
  POST /api/v1/knowledgeItems/searchByResourceId

Usage in start.sh:  uvicorn api:app --host ... --port ...
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import BackgroundTasks, Body, File, Form, UploadFile
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from by_qa.core import logger
from by_qa.knowledge_base.api.schemas import (
    FileToMarkdownIndexRequest,
    KnowledgeItemUploadRequest,
    SearchRequest,
)
from by_qa.knowledge_base.services.errors import (
    KnowledgeBaseConfigurationError,
    KnowledgeBaseValidationError,
)
from by_qa.main import (
    app,
    resolve_document_chunking_service,
    resolve_knowledge_item_ingestion_service,
    resolve_knowledge_item_search_service,
)
from minio_client import MinioResourceClient

_minio = MinioResourceClient()


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
    """Look up resourceCode from MinIO. Returns None on failure."""
    config = await _minio.get_kg_doc_config(resource_id)
    if config is None:
        return None
    code = config.get("resourceCode")
    if not code:
        logger.warning("KG_DOC_%s.json missing resourceCode field", resource_id)
        return None
    logger.info("Mapped resourceId %s -> knCode %s", resource_id, code)
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
                "fileContent": payload,
                "fileName": file_content.filename if file_content is not None else None,
                "contentType": file_content.content_type if file_content is not None else None,
            }
        )
    except ValidationError as exc:
        return _error("request validation failed", {"errors": json.loads(exc.json())})

    try:
        service = await resolve_knowledge_item_ingestion_service()
        await service.upload_file(request)
    except KnowledgeBaseConfigurationError as exc:
        return _error(str(exc))
    except KnowledgeBaseValidationError as exc:
        return _error(str(exc))
    except Exception as exc:
        logger.exception("importByResourceId error: resourceId=%s, error=%s", resource_id, exc)
        return _error(str(exc) or "internal error")

    return _success()


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
        service = await resolve_knowledge_item_ingestion_service()
        build_task_id = await service.create_file_to_markdown_index_task(request)

        async def _run_task():
            chunking_service = await resolve_document_chunking_service()
            await service.execute_file_to_markdown_index_task(
                request,
                document_chunking_service=chunking_service,
                build_task_id=build_task_id,
            )

        background_tasks.add_task(_run_task)
    except KnowledgeBaseConfigurationError as exc:
        return _error(str(exc))
    except KnowledgeBaseValidationError as exc:
        return _error(str(exc))

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
        items = await service.search_v2(request)
    except KnowledgeBaseConfigurationError as exc:
        return _error(str(exc))
    except KnowledgeBaseValidationError as exc:
        return _error(str(exc))

    data = []
    for item in items:
        row = item.model_dump(by_alias=True)
        kn_code = row.get("knCode", "")
        row["knCode"] = code_to_resource_id.get(kn_code, kn_code)
        data.append(row)

    return _success({"data": data})
