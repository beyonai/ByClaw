"""pytest 共享配置与 fixture。"""

from __future__ import annotations

import os

import httpx
import pytest


@pytest.fixture(scope="session")
def data_service_base_url() -> str:
    """Data Service 根 URL（与 VSCode launch 默认端口一致）。"""

    return os.environ.get("DATACLOUD_DATA_SERVICE_URL", "http://127.0.0.1:8080").rstrip("/")


@pytest.fixture(scope="session")
def require_data_service(data_service_base_url: str) -> None:
    """未启动服务时跳过集成测试。"""

    try:
        response = httpx.get(f"{data_service_base_url}/health", timeout=3.0)
        response.raise_for_status()
    except (httpx.HTTPError, OSError) as exc:
        pytest.skip(f"Data Service 不可达 ({data_service_base_url}): {exc}")
