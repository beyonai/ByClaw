"""独立术语构建服务的环境变量配置入口。

本模块只读取 `DATACLOUD_TERM_BUILD_*` 相关配置，并少量兼容已有的
`DATACLOUD_DB_*` 数据库配置；它不调用 `normalize_runtime_environment()`，避免把
MCP / worker / LLM / Redis 等运行时副作用带入这个独立服务。

关键配置分三组：
1. 服务启动：host、port、log_level，控制 Uvicorn 监听地址。
2. 任务系统：database_path、worker_enabled、worker_id、poll_interval、lock_ttl，
   控制 SQLite 任务表和后台 worker 行为。
3. 执行器：minio_mount_path、minio_bucket_name、knowledge_schema、knowledge_db_url、
   delete_command，控制“挂载路径 + bucket 名 + URI 相对路径”的本地目录推导、
   datacloud-knowledge 导入目标库，以及删除任务的外部命令入口。
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class TermBuildSettings:
    host: str
    port: int
    log_level: str
    database_path: Path
    minio_mount_path: Path | None
    minio_bucket_name: str | None
    worker_enabled: bool
    worker_id: str
    worker_poll_interval_seconds: float
    job_lock_ttl_seconds: int
    knowledge_schema: str | None
    knowledge_db_url: str | None
    delete_command: str | None
def get_settings() -> TermBuildSettings:
    return TermBuildSettings(
        host=os.environ.get("DATACLOUD_TERM_BUILD_SERVICE_HOST", "0.0.0.0"),
        port=int(os.environ.get("DATACLOUD_TERM_BUILD_SERVICE_PORT", "18082")),
        log_level=os.environ.get("DATACLOUD_TERM_BUILD_SERVICE_LOG_LEVEL", "info"),
        database_path=Path(
            os.environ.get(
                "DATACLOUD_TERM_BUILD_JOB_DB",
                "/tmp/byclaw-term-build-jobs.sqlite3",
            )
        ),
        minio_mount_path=_optional_path("FILE_STORAGE_MINIO_MOUNT_PATH"),
        minio_bucket_name=_optional_str("FILE_STORAGE_MINIO_BUCKET_NAME") or "byclaw",
        worker_enabled=_bool_env("DATACLOUD_TERM_BUILD_WORKER_ENABLED", default=True),
        worker_id=os.environ.get("DATACLOUD_TERM_BUILD_WORKER_ID", f"worker-{os.getpid()}"),
        worker_poll_interval_seconds=float(
            os.environ.get("DATACLOUD_TERM_BUILD_WORKER_POLL_INTERVAL_SECONDS", "2")
        ),
        job_lock_ttl_seconds=int(os.environ.get("DATACLOUD_TERM_BUILD_JOB_LOCK_TTL_SECONDS", "300")),
        knowledge_schema=os.environ.get("DATACLOUD_TERM_BUILD_KNOWLEDGE_SCHEMA")
        or os.environ.get("DATACLOUD_DB_SCHEMA"),
        knowledge_db_url=os.environ.get("DATACLOUD_TERM_BUILD_KNOWLEDGE_DB_URL")
        or os.environ.get("DATACLOUD_DB_URL"),
        delete_command=os.environ.get("DATACLOUD_TERM_BUILD_DELETE_COMMAND"),
    )


def _optional_path(name: str) -> Path | None:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return None
    return Path(raw)


def _optional_str(name: str) -> str | None:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return None
    return raw


def _bool_env(name: str, *, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}
