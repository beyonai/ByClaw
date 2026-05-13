"""术语构建任务的请求、响应和状态模型。

本模块只定义跨层共享的数据结构，不包含数据库读写、HTTP 路由或任务执行逻辑。
这些模型服务于三类边界：
1. API 边界：`TermJobCreateRequest` / `TermJobCreateResponse` / `TermJobResponse`
   是 FastAPI 路由的输入输出协议。
2. 状态机边界：`TermJobStatus` 表示任务生命周期，`TermJobStage` 表示 worker
   执行过程中的阶段记录。
3. 事件边界：`TermJobEventResponse` 用于返回任务执行日志，便于前端或调用方
   排查异步构建失败原因。

这里的枚举值保持小写字符串，是为了直接落库、直接返回 JSON，并与设计文档中的
`pending/running/succeeded/failed/cancelled` 状态保持一致。
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field


class TermJobAction(StrEnum):
    BUILD = "build"
    DELETE = "delete"


class TermJobStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TermJobStage(StrEnum):
    VALIDATING = "validating"
    FETCHING = "fetching"
    PARSING = "parsing"
    BUILDING = "building"
    DELETING = "deleting"
    NOTIFYING = "notifying"


class TermJobCreateRequest(BaseModel):
    action: TermJobAction
    minio_uri: str = Field(min_length=1)


class TermJobCreateResponse(BaseModel):
    job_id: str
    status: TermJobStatus


class TermJobResponse(BaseModel):
    id: str
    action: TermJobAction
    minio_uri: str
    status: TermJobStatus
    stage: TermJobStage | None = None
    attempts: int
    locked_by: str | None = None
    heartbeat_at: datetime | None = None
    cancel_requested: bool
    error_message: str | None = None
    result: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


class TermJobEventResponse(BaseModel):
    id: int
    job_id: str
    stage: TermJobStage | None = None
    level: Literal["info", "warn", "error"]
    message: str
    payload: dict[str, Any] | None = None
    created_at: datetime


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
