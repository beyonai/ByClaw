"""术语构建/删除任务的实际执行入口。

worker 领取到任务后不会直接写导入逻辑，而是调用本模块的 `execute_term_job()`：
1. 先根据 `minio_uri` 解析出本地知识包目录。
   - `file://` 或普通路径：直接当成本地目录使用。
   - `s3://` / `minio://`：通过 `FILE_STORAGE_MINIO_MOUNT_PATH` +
     `FILE_STORAGE_MINIO_BUCKET_NAME` + URI 相对路径，推导出本地挂载目录。
     本服务不做真实 MinIO SDK 上传/下载，只读取已经挂载到容器内的目录。
2. `build` 动作直接调用
   `datacloud_knowledge.knowledge_build.importer.executor.run()`，复用
   datacloud-knowledge 现有 OWL 解析、转换和批量入库链路。
3. `delete` 动作不臆造 datacloud-knowledge 的底层删除 SQL，而是要求配置
   `DATACLOUD_TERM_BUILD_DELETE_COMMAND`，由外部明确的删除执行器负责。

因此，本模块是“异步任务系统”和“datacloud-knowledge 导入链路”之间的边界层。
"""

from __future__ import annotations

import os
import shlex
import subprocess
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from byclaw_data.term_build_service.models import TermJobAction


class TermJobExecutionError(Exception):
    """Raised when a term job cannot be executed."""


def execute_term_job(action: TermJobAction, minio_uri: str, settings: Any) -> dict:
    package_dir = resolve_minio_uri_to_local_path(minio_uri, settings)
    if action == TermJobAction.BUILD:
        return execute_build(package_dir, settings)
    if action == TermJobAction.DELETE:
        return execute_delete(package_dir, minio_uri, settings)
    raise TermJobExecutionError(f"unsupported action: {action}")


def resolve_minio_uri_to_local_path(minio_uri: str, settings: Any) -> Path:
    parsed = urlparse(minio_uri)
    if parsed.scheme in {"", "file"}:
        path = Path(unquote(parsed.path if parsed.scheme == "file" else minio_uri))
    elif parsed.scheme in {"s3", "minio"}:
        if settings.minio_mount_path is None:
            raise TermJobExecutionError(
                "FILE_STORAGE_MINIO_MOUNT_PATH is required for s3/minio URIs"
            )
        bucket = parsed.netloc or settings.minio_bucket_name
        if not bucket:
            raise TermJobExecutionError("FILE_STORAGE_MINIO_BUCKET_NAME is required for s3/minio URIs")
        object_path = unquote(parsed.path.lstrip("/"))
        path = settings.minio_mount_path / bucket / object_path
    else:
        raise TermJobExecutionError(f"unsupported minio_uri scheme: {parsed.scheme}")

    if not path.exists():
        raise TermJobExecutionError(f"resolved package path does not exist: {path}")
    if not path.is_dir():
        raise TermJobExecutionError(f"resolved package path is not a directory: {path}")
    return path


def execute_build(package_dir: Path, settings: Any) -> dict:
    from datacloud_knowledge.knowledge_build.importer.executor import run as import_package

    result = import_package(
        str(package_dir),
        schema=settings.knowledge_schema,
        db_url=settings.knowledge_db_url,
    )
    if result.get("status") == "failed":
        raise TermJobExecutionError(str(result.get("error") or "term import failed"))
    return result


def execute_delete(package_dir: Path, minio_uri: str, settings: Any) -> dict:
    if not settings.delete_command:
        raise TermJobExecutionError("DATACLOUD_TERM_BUILD_DELETE_COMMAND is required for delete jobs")

    env = os.environ.copy()
    env["DATACLOUD_TERM_BUILD_PACKAGE_DIR"] = str(package_dir)
    env["DATACLOUD_TERM_BUILD_MINIO_URI"] = minio_uri
    completed = subprocess.run(
        shlex.split(settings.delete_command),
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )
    payload = {
        "returncode": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
    }
    if completed.returncode != 0:
        raise TermJobExecutionError(completed.stderr.strip() or "delete command failed")
    return {"status": "success", "delete": payload}
