from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, File, Form, Header, Request, UploadFile
from kgw.dispatcher import _write_history, dispatch_json
from kgw.envelope import CircuitOpen, KBNotFound, OperationNotSupported
from kgw.observability.logger import get_logger
from kgw.stream_proxy import proxy_upload

_log = get_logger(__name__)
router = APIRouter(prefix="/kgw/api/v1")


@router.post("/knowledgeItems/delete")
async def knowledge_item_delete(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
) -> dict[str, Any]:
    kn_code = str(body.get("knCode", ""))
    file_path = str(body.get("filePath") or "")
    return await dispatch_json(
        request,
        operation="fileDelete",
        kn_code=kn_code,
        user_id=x_user_id,
        body=body,
        file_path=file_path,
    )


@router.post("/knowledgeItems/import")
async def knowledge_item_import(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    kn_code: Annotated[str, Form(alias="knCode")],
    file_path: Annotated[str, Form(alias="filePath")],
    file_content: Annotated[UploadFile, File(alias="fileContent")],
) -> dict[str, Any]:
    """Stream multipart upload to the KB backend without buffering full file in RAM."""
    import asyncio

    from kgw.audit import AuditEntry

    state = request.app.state

    config = await state.config_provider.get_kb_config(kn_code)
    if config is None:
        raise KBNotFound(f"unknown knCode: {kn_code}", kn_code=kn_code)
    if "fileImport" not in config.operations:
        raise OperationNotSupported(
            f"fileImport not supported by {kn_code}",
            kn_code=kn_code,
            operation="fileImport",
        )

    cb = state.circuit_breakers.get(config.domain_url or config.domain_name)
    if not cb.before_call():
        raise CircuitOpen(f"circuit OPEN for {kn_code}", kn_code=kn_code)

    headers = await state.auth_provider.resolve_headers(
        config.headers, user_code=x_user_id
    )
    op_path = config.operation_path("fileImport") or "/api/v1/knowledgeItems/import"
    url = f"{config.domain_url.rstrip('/')}{op_path}"

    try:
        # Replace portal kn_code with backend resource_code in form fields
        form = {"knCode": config.resource_code, "filePath": file_path}
        result = await proxy_upload(
            url=url,
            upstream_headers=headers,
            http=state.http,
            form_fields=form,
            upload_file=file_content,
            kn_code=kn_code,
            operation="fileImport",
        )
        cb.record_success()
    except Exception:
        cb.record_failure()
        raise

    await state.audit.record(
        AuditEntry(
            source="serve",
            trace_id=request.headers.get("X-Trace-Id"),
            actor_user_id=x_user_id,
            actor_kind="user",
            operation_type="fileImport",
            kn_code=kn_code,
            file_path=file_path,
            payload_size_bytes=None,
            row_count=None,
            payload_redacted={"knCode": kn_code, "filePath": file_path},
            result_code=str(result.get("resultCode", "0")),
            result_msg=result.get("resultMsg"),
            latency_ms=None,
        )
    )
    asyncio.create_task(
        _write_history(state.pool, kn_code=kn_code, file_path=file_path),
        name=f"write_history:{kn_code}:fileImport",
    )

    return result
