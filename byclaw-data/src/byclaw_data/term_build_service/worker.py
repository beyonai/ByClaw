"""异步术语任务的后台 worker。

Worker 在 FastAPI lifespan 中启动，循环执行以下流程：
1. 调用 Repository 领取最早的 `pending` 任务，并在领取前回收过期的 `running` 任务。
2. 写入 `validating` 心跳，检查是否已请求取消。
3. 根据 action 进入 `building` 或 `deleting` 阶段。
4. 在线程池中调用 `executor.execute_term_job()`，避免阻塞事件循环。
5. 根据执行结果把任务标记为 `succeeded`、`failed` 或 `cancelled`。

并发安全依赖 Repository 的 fencing：worker 每次更新任务时都带上领取时的
`worker_id + attempts`。如果任务已经因为心跳超时被重新排队并由新 worker 领取，
旧 worker 的 heartbeat / complete / fail / cancel 会被拒绝，避免覆盖新结果。
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import suppress
from typing import Any

from byclaw_data.term_build_service.executor import TermJobExecutionError, execute_term_job
from byclaw_data.term_build_service.models import TermJobAction, TermJobStage
from byclaw_data.term_build_service.repository import StaleJobClaimError, TermJobRepository

logger = logging.getLogger(__name__)


class TermJobWorker:
    def __init__(self, repository: TermJobRepository, settings: Any) -> None:
        self.repository = repository
        self.settings = settings
        self._task: asyncio.Task[None] | None = None
        self._stop_event = asyncio.Event()

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self.run(), name="term-job-worker")

    async def stop(self) -> None:
        self._stop_event.set()
        if self._task is not None:
            self._task.cancel()
            with suppress(asyncio.CancelledError):
                await self._task

    async def run(self) -> None:
        while not self._stop_event.is_set():
            job = self.repository.claim_next_job(
                self.settings.worker_id,
                lock_ttl_seconds=self.settings.job_lock_ttl_seconds,
            )
            if job is None:
                await asyncio.sleep(self.settings.worker_poll_interval_seconds)
                continue
            await self._execute_claimed_job(job)

    async def _execute_claimed_job(self, job: dict) -> None:
        job_id = str(job["id"])
        action = TermJobAction(str(job["action"]))
        attempts = int(job["attempts"])
        try:
            self.repository.heartbeat(
                job_id,
                TermJobStage.VALIDATING,
                self.settings.worker_id,
                attempts,
            )
            if self.repository.is_cancel_requested(job_id):
                self.repository.mark_cancelled(
                    job_id,
                    worker_id=self.settings.worker_id,
                    attempts=attempts,
                )
                return
            stage = TermJobStage.BUILDING if action == TermJobAction.BUILD else TermJobStage.DELETING
            self.repository.heartbeat(job_id, stage, self.settings.worker_id, attempts)
            result = await asyncio.to_thread(
                execute_term_job,
                action,
                str(job["minio_uri"]),
                self.settings,
            )
            if self.repository.is_cancel_requested(job_id):
                self.repository.mark_cancelled(
                    job_id,
                    worker_id=self.settings.worker_id,
                    attempts=attempts,
                )
                return
            self.repository.complete_job(
                job_id,
                result,
                worker_id=self.settings.worker_id,
                attempts=attempts,
            )
        except TermJobExecutionError as exc:
            self.repository.fail_job(
                job_id,
                str(exc),
                worker_id=self.settings.worker_id,
                attempts=attempts,
            )
        except StaleJobClaimError:
            logger.info("term job claim is stale: %s", job_id)
        except Exception as exc:  # noqa: BLE001
            logger.exception("term job failed: %s", job_id)
            try:
                self.repository.fail_job(
                    job_id,
                    str(exc),
                    worker_id=self.settings.worker_id,
                    attempts=attempts,
                )
            except StaleJobClaimError:
                logger.info("term job claim became stale while failing: %s", job_id)
