"""术语任务的应用服务层。

本模块位于 HTTP 路由和 Repository 之间，负责把 API 调用转成业务语义清晰的方法，
例如创建任务、查询任务、重试任务、取消任务和读取事件。

它目前保持很薄，主要有两个目的：
1. 路由层不直接依赖 Repository 的全部细节，后续替换持久化实现时影响更小。
2. 在创建任务时统一注入 `job_lock_ttl_seconds`，让提交新任务前先触发 stale
   running job 回收逻辑，避免崩溃 worker 长期阻塞同一 `minio_uri`。
"""

from __future__ import annotations

from typing import Any

from byclaw_data.term_build_service.models import TermJobAction
from byclaw_data.term_build_service.repository import TermJobRepository


class TermJobService:
    def __init__(self, repository: TermJobRepository, settings: Any) -> None:
        self.repository = repository
        self.settings = settings

    def create_job(self, action: TermJobAction, minio_uri: str) -> dict:
        return self.repository.create_job(
            action,
            minio_uri,
            lock_ttl_seconds=self.settings.job_lock_ttl_seconds,
        )

    def get_job(self, job_id: str) -> dict:
        return self.repository.get_job(job_id)

    def retry_job(self, job_id: str) -> dict:
        return self.repository.retry_job(job_id)

    def cancel_job(self, job_id: str) -> dict:
        return self.repository.request_cancel(job_id)

    def list_events(self, job_id: str) -> list[dict]:
        return self.repository.list_events(job_id)
