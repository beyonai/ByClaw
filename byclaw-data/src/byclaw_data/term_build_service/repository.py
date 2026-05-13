"""术语任务与事件的 SQLite 持久化层。

Repository 是整个异步任务状态机的唯一写入口：API 层创建、查询、重试、取消任务，
worker 层领取任务、写心跳、完成或失败任务，最终都通过这里更新 `term_jobs` 和
`term_job_events` 两张表。

这里刻意使用 SQLite，是为了给独立服务提供一个最小可落地的本地任务表实现；后续
如果要迁移到 PostgreSQL/openGauss，只需要保持本模块对外方法语义不变，替换内部
SQL 实现即可。

并发控制要点：
1. 同一 `minio_uri` 在 `pending/running` 状态下只能存在一个活跃任务。
2. worker 领取任务时会把状态改成 `running`，写入 `locked_by`、`heartbeat_at`，
   并增加 `attempts`。
3. `job_lock_ttl_seconds` 用于回收过期 running 任务，避免 worker 崩溃后资源永久
   被占用。
4. worker 后续 heartbeat / complete / fail / cancel 都必须匹配 `worker_id + attempts`，
   防止旧 worker 在任务被重新领取后覆盖新 worker 的结果。
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

from byclaw_data.term_build_service.models import (
    TermJobAction,
    TermJobStage,
    TermJobStatus,
    utc_now,
)

_ACTIVE_STATUSES = (TermJobStatus.PENDING.value, TermJobStatus.RUNNING.value)


class JobConflictError(Exception):
    """Raised when the same MinIO resource already has an active job."""

    def __init__(self, job_id: str) -> None:
        super().__init__(f"active job already exists: {job_id}")
        self.job_id = job_id


class JobNotFoundError(Exception):
    """Raised when a term job cannot be found."""


class StaleJobClaimError(Exception):
    """Raised when a worker tries to update a job it no longer owns."""


class TermJobRepository:
    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.initialize()

    def initialize(self) -> None:
        with self._connect() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS term_jobs (
                    id TEXT PRIMARY KEY,
                    action TEXT NOT NULL,
                    minio_uri TEXT NOT NULL,
                    status TEXT NOT NULL,
                    stage TEXT,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    locked_by TEXT,
                    heartbeat_at TEXT,
                    cancel_requested INTEGER NOT NULL DEFAULT 0,
                    error_message TEXT,
                    result TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    started_at TEXT,
                    finished_at TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS term_job_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL,
                    stage TEXT,
                    level TEXT NOT NULL,
                    message TEXT NOT NULL,
                    payload TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(job_id) REFERENCES term_jobs(id)
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_term_jobs_active_resource "
                "ON term_jobs(minio_uri, status)"
            )
            conn.commit()

    def create_job(
        self,
        action: TermJobAction,
        minio_uri: str,
        *,
        lock_ttl_seconds: int | None = None,
    ) -> dict[str, Any]:
        if lock_ttl_seconds is not None:
            self.requeue_stale_running_jobs(lock_ttl_seconds=lock_ttl_seconds)
        now = _to_db_time(utc_now())
        with self._transaction() as conn:
            active = conn.execute(
                "SELECT id FROM term_jobs WHERE minio_uri = ? AND status IN (?, ?) LIMIT 1",
                (minio_uri, *_ACTIVE_STATUSES),
            ).fetchone()
            if active is not None:
                raise JobConflictError(str(active["id"]))

            job_id = f"tj_{uuid.uuid4().hex[:16]}"
            conn.execute(
                """
                INSERT INTO term_jobs (
                    id, action, minio_uri, status, attempts, cancel_requested,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, 0, 0, ?, ?)
                """,
                (job_id, action.value, minio_uri, TermJobStatus.PENDING.value, now, now),
            )
            self._insert_event(conn, job_id, None, "info", "job created", None)
            return self.get_job(job_id, conn=conn)

    def get_job(self, job_id: str, *, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
        active_conn = conn or self._connect()
        try:
            row = active_conn.execute("SELECT * FROM term_jobs WHERE id = ?", (job_id,)).fetchone()
            if row is None:
                raise JobNotFoundError(job_id)
            return _job_from_row(row)
        finally:
            if conn is None:
                active_conn.close()

    def list_events(self, job_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            self.get_job(job_id, conn=conn)
            rows = conn.execute(
                "SELECT * FROM term_job_events WHERE job_id = ? ORDER BY id ASC",
                (job_id,),
            ).fetchall()
            return [_event_from_row(row) for row in rows]

    def retry_job(self, job_id: str) -> dict[str, Any]:
        now = _to_db_time(utc_now())
        with self._transaction() as conn:
            job = self.get_job(job_id, conn=conn)
            if job["status"] not in {TermJobStatus.FAILED.value, TermJobStatus.CANCELLED.value}:
                return job
            active = conn.execute(
                "SELECT id FROM term_jobs WHERE minio_uri = ? AND status IN (?, ?) AND id <> ? LIMIT 1",
                (job["minio_uri"], *_ACTIVE_STATUSES, job_id),
            ).fetchone()
            if active is not None:
                raise JobConflictError(str(active["id"]))
            conn.execute(
                """
                UPDATE term_jobs
                SET status = ?, stage = NULL, locked_by = NULL, heartbeat_at = NULL,
                    cancel_requested = 0, error_message = NULL, result = NULL,
                    updated_at = ?, started_at = NULL, finished_at = NULL
                WHERE id = ?
                """,
                (TermJobStatus.PENDING.value, now, job_id),
            )
            self._insert_event(conn, job_id, None, "info", "job queued for retry", None)
            return self.get_job(job_id, conn=conn)

    def request_cancel(self, job_id: str) -> dict[str, Any]:
        now = _to_db_time(utc_now())
        with self._transaction() as conn:
            job = self.get_job(job_id, conn=conn)
            if job["status"] == TermJobStatus.PENDING.value:
                conn.execute(
                    """
                    UPDATE term_jobs
                    SET status = ?, cancel_requested = 1, updated_at = ?, finished_at = ?
                    WHERE id = ?
                    """,
                    (TermJobStatus.CANCELLED.value, now, now, job_id),
                )
                self._insert_event(conn, job_id, None, "info", "job cancelled", None)
            elif job["status"] == TermJobStatus.RUNNING.value:
                conn.execute(
                    "UPDATE term_jobs SET cancel_requested = 1, updated_at = ? WHERE id = ?",
                    (now, job_id),
                )
                self._insert_event(conn, job_id, job["stage"], "info", "cancel requested", None)
            return self.get_job(job_id, conn=conn)

    def claim_next_job(self, worker_id: str, *, lock_ttl_seconds: int | None = None) -> dict[str, Any] | None:
        now = _to_db_time(utc_now())
        with self._transaction() as conn:
            if lock_ttl_seconds is not None:
                self.requeue_stale_running_jobs(conn=conn, lock_ttl_seconds=lock_ttl_seconds)
            row = conn.execute(
                "SELECT id FROM term_jobs WHERE status = ? ORDER BY created_at ASC LIMIT 1",
                (TermJobStatus.PENDING.value,),
            ).fetchone()
            if row is None:
                return None
            job_id = str(row["id"])
            conn.execute(
                """
                UPDATE term_jobs
                SET status = ?, attempts = attempts + 1, locked_by = ?, heartbeat_at = ?,
                    updated_at = ?, started_at = COALESCE(started_at, ?)
                WHERE id = ? AND status = ?
                """,
                (
                    TermJobStatus.RUNNING.value,
                    worker_id,
                    now,
                    now,
                    now,
                    job_id,
                    TermJobStatus.PENDING.value,
                ),
            )
            self._insert_event(conn, job_id, None, "info", "job claimed", {"worker_id": worker_id})
            return self.get_job(job_id, conn=conn)

    def requeue_stale_running_jobs(
        self,
        *,
        lock_ttl_seconds: int,
        conn: sqlite3.Connection | None = None,
    ) -> int:
        cutoff = _to_db_time(utc_now() - timedelta(seconds=lock_ttl_seconds))
        active_conn = conn or self._connect()
        try:
            rows = active_conn.execute(
                """
                SELECT id FROM term_jobs
                WHERE status = ? AND heartbeat_at IS NOT NULL AND heartbeat_at < ?
                """,
                (TermJobStatus.RUNNING.value, cutoff),
            ).fetchall()
            if not rows:
                return 0
            now = _to_db_time(utc_now())
            for row in rows:
                job_id = str(row["id"])
                active_conn.execute(
                    """
                    UPDATE term_jobs
                    SET status = ?, stage = NULL, locked_by = NULL, heartbeat_at = NULL,
                        updated_at = ?
                    WHERE id = ? AND status = ?
                    """,
                    (TermJobStatus.PENDING.value, now, job_id, TermJobStatus.RUNNING.value),
                )
                self._insert_event(
                    active_conn,
                    job_id,
                    None,
                    "warn",
                    "stale running job requeued",
                    {"lock_ttl_seconds": lock_ttl_seconds},
                )
            if conn is None:
                active_conn.commit()
            return len(rows)
        finally:
            if conn is None:
                active_conn.close()

    def heartbeat(self, job_id: str, stage: TermJobStage, worker_id: str, attempts: int) -> None:
        now = _to_db_time(utc_now())
        with self._transaction() as conn:
            cursor = conn.execute(
                """
                UPDATE term_jobs SET stage = ?, locked_by = ?, heartbeat_at = ?, updated_at = ?
                WHERE id = ? AND status = ? AND locked_by = ? AND attempts = ?
                """,
                (
                    stage.value,
                    worker_id,
                    now,
                    now,
                    job_id,
                    TermJobStatus.RUNNING.value,
                    worker_id,
                    attempts,
                ),
            )
            if cursor.rowcount != 1:
                raise StaleJobClaimError(job_id)
            self._insert_event(conn, job_id, stage.value, "info", f"stage: {stage.value}", None)

    def complete_job(
        self,
        job_id: str,
        result: dict[str, Any] | None,
        *,
        worker_id: str,
        attempts: int,
    ) -> dict[str, Any]:
        now = _to_db_time(utc_now())
        with self._transaction() as conn:
            cursor = conn.execute(
                """
                UPDATE term_jobs
                SET status = ?, locked_by = NULL, heartbeat_at = NULL,
                    error_message = NULL, result = ?, updated_at = ?, finished_at = ?
                WHERE id = ? AND status = ? AND locked_by = ? AND attempts = ?
                """,
                (
                    TermJobStatus.SUCCEEDED.value,
                    _json_dumps(result),
                    now,
                    now,
                    job_id,
                    TermJobStatus.RUNNING.value,
                    worker_id,
                    attempts,
                ),
            )
            if cursor.rowcount != 1:
                raise StaleJobClaimError(job_id)
            self._insert_event(conn, job_id, None, "info", "job succeeded", result)
            return self.get_job(job_id, conn=conn)

    def fail_job(
        self,
        job_id: str,
        message: str,
        payload: dict[str, Any] | None = None,
        *,
        worker_id: str,
        attempts: int,
    ) -> dict[str, Any]:
        now = _to_db_time(utc_now())
        with self._transaction() as conn:
            cursor = conn.execute(
                """
                UPDATE term_jobs
                SET status = ?, locked_by = NULL, heartbeat_at = NULL,
                    error_message = ?, result = ?, updated_at = ?, finished_at = ?
                WHERE id = ? AND status = ? AND locked_by = ? AND attempts = ?
                """,
                (
                    TermJobStatus.FAILED.value,
                    message,
                    _json_dumps(payload),
                    now,
                    now,
                    job_id,
                    TermJobStatus.RUNNING.value,
                    worker_id,
                    attempts,
                ),
            )
            if cursor.rowcount != 1:
                raise StaleJobClaimError(job_id)
            self._insert_event(conn, job_id, None, "error", message, payload)
            return self.get_job(job_id, conn=conn)

    def is_cancel_requested(self, job_id: str) -> bool:
        job = self.get_job(job_id)
        return bool(job["cancel_requested"])

    def mark_cancelled(self, job_id: str, *, worker_id: str, attempts: int) -> dict[str, Any]:
        now = _to_db_time(utc_now())
        with self._transaction() as conn:
            cursor = conn.execute(
                """
                UPDATE term_jobs
                SET status = ?, locked_by = NULL, heartbeat_at = NULL,
                    updated_at = ?, finished_at = ?
                WHERE id = ? AND status = ? AND locked_by = ? AND attempts = ?
                """,
                (
                    TermJobStatus.CANCELLED.value,
                    now,
                    now,
                    job_id,
                    TermJobStatus.RUNNING.value,
                    worker_id,
                    attempts,
                ),
            )
            if cursor.rowcount != 1:
                raise StaleJobClaimError(job_id)
            self._insert_event(conn, job_id, None, "info", "job cancelled", None)
            return self.get_job(job_id, conn=conn)

    @contextmanager
    def _transaction(self) -> Iterator[sqlite3.Connection]:
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.database_path, timeout=30)
        conn.row_factory = sqlite3.Row
        return conn

    def _insert_event(
        self,
        conn: sqlite3.Connection,
        job_id: str,
        stage: str | None,
        level: str,
        message: str,
        payload: dict[str, Any] | None,
    ) -> None:
        conn.execute(
            """
            INSERT INTO term_job_events (job_id, stage, level, message, payload, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (job_id, stage, level, message, _json_dumps(payload), _to_db_time(utc_now())),
        )


def _job_from_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "action": str(row["action"]),
        "minio_uri": str(row["minio_uri"]),
        "status": str(row["status"]),
        "stage": row["stage"],
        "attempts": int(row["attempts"]),
        "locked_by": row["locked_by"],
        "heartbeat_at": _from_db_time(row["heartbeat_at"]),
        "cancel_requested": bool(row["cancel_requested"]),
        "error_message": row["error_message"],
        "result": _json_loads(row["result"]),
        "created_at": _from_db_time(row["created_at"]),
        "updated_at": _from_db_time(row["updated_at"]),
        "started_at": _from_db_time(row["started_at"]),
        "finished_at": _from_db_time(row["finished_at"]),
    }


def _event_from_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "job_id": str(row["job_id"]),
        "stage": row["stage"],
        "level": str(row["level"]),
        "message": str(row["message"]),
        "payload": _json_loads(row["payload"]),
        "created_at": _from_db_time(row["created_at"]),
    }


def _to_db_time(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def _from_db_time(value: str | None) -> datetime | None:
    if value is None:
        return None
    return datetime.fromisoformat(value)


def _json_dumps(value: dict[str, Any] | None) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False)


def _json_loads(value: str | None) -> dict[str, Any] | None:
    if value is None:
        return None
    loaded = json.loads(value)
    if isinstance(loaded, dict):
        return loaded
    return {"value": loaded}
