"""byclaw-data Gateway Worker 入口。

在 **项目根目录** ``byclaw-data/``（与 ``pyproject.toml`` 同级）执行::

    uv sync
    uv run python -m byclaw_data.main

或使用根目录 ``start.sh`` / ``start.bat``。
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from by_framework import run_worker
from by_framework_history_byclaw.byclaw_history import ByClawHistoryBackend
from dotenv import load_dotenv

from byclaw_data.runtime import normalize_runtime_environment

logger = logging.getLogger(__name__)

# worker_id Redis 锁 TTL 为 60s，进程异常退出后锁不会主动释放，
# 需要等待过期。默认 10s × 7 次 = 70s 覆盖窗口足够等锁自动过期。
_WORKER_RETRY_MAX = int(os.environ.get("DATACLOUD_WORKER_RETRY_MAX", "7"))
_WORKER_RETRY_INTERVAL = int(os.environ.get("DATACLOUD_WORKER_RETRY_INTERVAL", "10"))


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
    consumer_group: str
    workspace_dir: str
    be_domainname_url: str

    @classmethod
    def from_environ(cls) -> WorkerConfig:
        """Build config from the current environment."""

        def opt(key: str) -> str | None:
            raw = os.environ.get(key)
            return raw.strip() if raw and raw.strip() else None

        def as_int(key: str, default: int) -> int:
            raw = os.environ.get(key)
            return int(raw.strip(), 10) if raw and raw.strip() else default

        return cls(
            api_key=opt("OPENAI_API_KEY"),
            base_url=opt("OPENAI_BASE_URL"),
            model_name=os.environ.get("DATACLOUD_LLM_MODEL", "main.py未设置"),
            worker_id=os.environ.get("DATACLOUD_GATEWAY_WORKER_ID", "datacloud"),
            redis_host=os.environ.get("DATACLOUD_GATEWAY_REDIS_HOST", "localhost"),
            redis_port=as_int("DATACLOUD_GATEWAY_REDIS_PORT", 6379),
            redis_db=as_int("DATACLOUD_GATEWAY_REDIS_DB", 0),
            redis_password=opt("DATACLOUD_GATEWAY_REDIS_PASSWORD"),
            redis_username=opt("DATACLOUD_GATEWAY_REDIS_USERNAME"),
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

    for attempt in range(1, _WORKER_RETRY_MAX + 1):
        run_worker(
            worker_class=DataCloudWorker,
            plugin_list=[
                InitDataCloudDigitalEmployeePlugin(),
                RecommendedQuestionsPlugin(),
            ],
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
