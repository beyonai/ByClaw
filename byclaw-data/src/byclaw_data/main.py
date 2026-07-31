"""byclaw-data Gateway Worker 入口。

在 **项目根目录** ``byclaw-data/``（与 ``pyproject.toml`` 同级）执行::

    uv sync
    uv run python -m byclaw_data.main

或使用根目录 ``start.sh`` / ``start.bat``。
"""

from __future__ import annotations

import logging
import os
import socket
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from by_framework import run_worker
from by_framework_history_byclaw.byclaw_history import ByClawHistoryBackend
from dotenv import load_dotenv

from byclaw_data.redis_client import get_redis_settings

# by_framework 在模块导入时创建 RotatingFileHandler("by-framework.log")，
# Windows 下多进程共用同一文件会在轮转时触发 WinError 32。
# 此处将其替换为带 PID 后缀的文件，各进程独立写入。
def _fix_framework_log_handler() -> None:
    from logging.handlers import RotatingFileHandler

    fw_logger = logging.getLogger("by-framework")
    for h in fw_logger.handlers[:]:
        if isinstance(h, RotatingFileHandler) and h.baseFilename.endswith("by-framework.log"):
            fw_logger.removeHandler(h)
            h.close()
            new_h = RotatingFileHandler(
                f"by-framework.{os.getpid()}.log",
                maxBytes=h.maxBytes,
                backupCount=h.backupCount,
            )
            new_h.setLevel(h.level)
            new_h.setFormatter(h.formatter)
            fw_logger.addHandler(new_h)
            break

_fix_framework_log_handler()

from byclaw_data.runtime import normalize_runtime_environment  # noqa: E402

logger = logging.getLogger(__name__)

# worker_id Redis 锁 TTL 为 60s，进程异常退出后锁不会主动释放，
# 需要等待过期。默认 10s × 7 次 = 70s 覆盖窗口足够等锁自动过期。
_WORKER_RETRY_MAX = int(os.environ.get("DATACLOUD_WORKER_RETRY_MAX", "7"))
_WORKER_RETRY_INTERVAL = int(os.environ.get("DATACLOUD_WORKER_RETRY_INTERVAL", "10"))


def _default_worker_id() -> str:
    try:
        ip = socket.gethostbyname(socket.gethostname())
    except OSError:
        ip = "unknown"
    base = os.environ.get("DATACLOUD_GATEWAY_WORKER_ID", "datacloud")
    return f"{base}-{ip}-{os.getpid()}"


@dataclass(frozen=True)
class WorkerConfig:
    """Gateway worker settings read from os.environ (after backend/.env is loaded)."""

    api_key: str | None
    base_url: str | None
    model_name: str
    worker_id: str
    redis_host: str
    redis_port: int
    redis_db: int
    redis_password: str | None
    redis_username: str | None
    redis_mode: Literal["standalone", "cluster"]
    redis_cluster_nodes: list[tuple[str, int]] | None
    consumer_group: str
    workspace_dir: str
    be_domainname_url: str

    @classmethod
    def from_environ(cls) -> WorkerConfig:
        """Build config from the current environment."""

        def opt(key: str) -> str | None:
            raw = os.environ.get(key)
            return raw.strip() if raw and raw.strip() else None

        redis_settings = get_redis_settings()
        redis_cluster_nodes = (
            list(redis_settings.cluster_hosts) if redis_settings.cluster_hosts else None
        )

        return cls(
            api_key=opt("OPENAI_API_KEY"),
            base_url=opt("OPENAI_BASE_URL"),
            model_name=os.environ.get("DATACLOUD_LLM_MODEL", "main.py未设置"),
            worker_id=_default_worker_id(),
            redis_host=redis_settings.host,
            redis_port=redis_settings.port,
            redis_db=redis_settings.db,
            redis_password=redis_settings.password or None,
            redis_username=redis_settings.username or None,
            redis_mode="cluster" if redis_cluster_nodes else "standalone",
            redis_cluster_nodes=redis_cluster_nodes,
            consumer_group=os.environ.get(
                "DATACLOUD_GATEWAY_CONSUMER_GROUP", "datacloud"
            ),
            workspace_dir=os.environ.get(
                "DATACLOUD_GATEWAY_WORKSPACE_DIR", "/tmp/datacloud"
            ),
            be_domainname_url=os.environ.get(
                "BE_DOMAINNAME_URL", "http://10.10.168.203:8080"
            ),
        )

    def run_worker_kwargs(self) -> dict[str, Any]:
        """Arguments for ``run_worker`` from ``by_framework`` (excluding ``worker_class``)."""
        return {
            "worker_id": self.worker_id,
            "redis_host": self.redis_host,
            "redis_port": self.redis_port,
            "redis_db": self.redis_db,
            "redis_password": self.redis_password,
            "redis_username": self.redis_username,
            "redis_mode": self.redis_mode,
            "redis_cluster_nodes": self.redis_cluster_nodes,
            "consumer_group": self.consumer_group,
            "workspace_dir": self.workspace_dir,
            "api_key": self.api_key,
            "base_url": self.base_url,
            "model_name": self.model_name,
        }


def main() -> None:
    """Load environment variables and start the DataCloud gateway worker."""
    _pkg_dir = Path(__file__).resolve().parent
    _src_dir = _pkg_dir.parent
    _project_dir = _src_dir.parent
    for env_path in (_project_dir / ".env", _src_dir / ".env"):
        if env_path.is_file():
            load_dotenv(dotenv_path=env_path)

    os.environ.setdefault("DATACLOUD_LOG_DIR", "logs/worker")

    normalize_runtime_environment()

    from byclaw_data.plugins.recommended_question_plugins import (
        RecommendedQuestionsPlugin,
    )
    from byclaw_data.plugins.worker_plugins.init_agent_conf import (
        InitDataCloudDigitalEmployeePlugin,
    )
    from byclaw_data.worker import DataCloudWorker

    cfg = WorkerConfig.from_environ()

    if not cfg.api_key:
        pass

    # LangfusePlugin 由 run_worker 通过 _build_auto_trace_plugin() 自动发现并注册，
    # 无需手动添加。只要 LANGFUSE_SECRET_KEY / LANGFUSE_PUBLIC_KEY / LANGFUSE_BASE_URL
    # 均已配置，框架启动时会自动激活。
    _plugin_list: list[Any] = [
        InitDataCloudDigitalEmployeePlugin(),
        RecommendedQuestionsPlugin(),
    ]

    for attempt in range(1, _WORKER_RETRY_MAX + 1):
        run_worker(
            worker_class=DataCloudWorker,
            plugin_list=_plugin_list,
            history_backend=ByClawHistoryBackend(base_url=cfg.be_domainname_url),
            **cfg.run_worker_kwargs(),
        )
        if attempt >= _WORKER_RETRY_MAX:
            logger.error(
                "Worker exited unexpectedly after %d attempts, giving up.", attempt
            )
            break
        logger.warning(
            "Worker exited unexpectedly (attempt %d/%d), retrying in %ds...",
            attempt,
            _WORKER_RETRY_MAX,
            _WORKER_RETRY_INTERVAL,
        )
        time.sleep(_WORKER_RETRY_INTERVAL)


if __name__ == "__main__":
    main()
