"""独立术语构建服务的 FastAPI 路由层。

本模块是 HTTP 调用进入异步任务系统的入口。`create_app()` 会组装三类对象：
1. `TermJobRepository`：负责 SQLite 任务表和事件表。
2. `TermJobService`：负责 API 语义到 Repository 操作的转换。
3. `TermJobWorker`：在 lifespan 中按配置启动，后台领取并执行任务。

对外接口与设计文档保持一致：
- `POST /term-jobs`：提交 build/delete 异步任务。
- `GET /term-jobs/{job_id}`：查询任务状态。
- `POST /term-jobs/{job_id}/retry`：重试 failed/cancelled 任务。
- `POST /term-jobs/{job_id}/cancel`：取消 pending 或请求取消 running 任务。
- `GET /term-jobs/{job_id}/events`：查看任务阶段事件，便于排错。

注意：这里不调用 MCP 的 `OntologyLoader` / `TermLoader`，也不挂载 MCP JSON-RPC。
OWL 解析和术语入库由 worker 间接调用 datacloud-knowledge importer 完成。
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException

from byclaw_data.term_build_service.models import (
    TermJobCreateRequest,
    TermJobCreateResponse,
    TermJobEventResponse,
    TermJobResponse,
)
from byclaw_data.term_build_service.repository import (
    JobConflictError,
    JobNotFoundError,
    TermJobRepository,
)
from byclaw_data.term_build_service.service import TermJobService
from byclaw_data.term_build_service.settings import TermBuildSettings, get_settings
from byclaw_data.term_build_service.worker import TermJobWorker


def create_app(settings: TermBuildSettings | None = None) -> FastAPI:
    resolved_settings = settings or get_settings()
    repository = TermJobRepository(resolved_settings.database_path)
    service = TermJobService(repository, resolved_settings)
    worker = TermJobWorker(repository, resolved_settings) if resolved_settings.worker_enabled else None

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        application.state.term_job_service = service
        application.state.term_job_worker = worker
        if worker is not None:
            worker.start()
        try:
            yield
        finally:
            if worker is not None:
                await worker.stop()

    app = FastAPI(title="byclaw term build service", lifespan=lifespan)

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/term-jobs", response_model=TermJobCreateResponse)
    def create_term_job(request: TermJobCreateRequest) -> dict:
        try:
            job = service.create_job(request.action, request.minio_uri)
        except JobConflictError as exc:
            raise HTTPException(
                status_code=409,
                detail={"message": str(exc), "job_id": exc.job_id},
            ) from exc
        return {"job_id": job["id"], "status": job["status"]}

    @app.get("/term-jobs/{job_id}", response_model=TermJobResponse)
    def get_term_job(job_id: str) -> dict:
        return _get_or_404(service, job_id)

    @app.get("/term-jobs/{job_id}/events", response_model=list[TermJobEventResponse])
    def list_term_job_events(job_id: str) -> list[dict]:
        try:
            return service.list_events(job_id)
        except JobNotFoundError as exc:
            raise HTTPException(status_code=404, detail="job not found") from exc

    @app.post("/term-jobs/{job_id}/retry", response_model=TermJobResponse)
    def retry_term_job(job_id: str) -> dict:
        try:
            return service.retry_job(job_id)
        except JobNotFoundError as exc:
            raise HTTPException(status_code=404, detail="job not found") from exc
        except JobConflictError as exc:
            raise HTTPException(
                status_code=409,
                detail={"message": str(exc), "job_id": exc.job_id},
            ) from exc

    @app.post("/term-jobs/{job_id}/cancel", response_model=TermJobResponse)
    def cancel_term_job(job_id: str) -> dict:
        try:
            return service.cancel_job(job_id)
        except JobNotFoundError as exc:
            raise HTTPException(status_code=404, detail="job not found") from exc

    return app


def _get_or_404(service: TermJobService, job_id: str) -> dict:
    try:
        return service.get_job(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail="job not found") from exc
