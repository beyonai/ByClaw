"""Skill 公共库：服务发现、认证、HTTP 请求封装。

服务发现使用 by_framework，Redis 连接参数复用运行环境的 REDIS_* 变量。
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any


logger = logging.getLogger(__name__)

_shared_loop = asyncio.new_event_loop()

# 服务发现目标：对应后端自动注册的服务名
_SERVICE_NAME = "ByaiService"


def _init_discovery_redis() -> None:
    """全局初始化服务发现 Redis（幂等）。

    集群模式：优先读 DATACLOUD_GATEWAY_REDIS_CLUSTER_HOST，再 fallback REDIS_CLUSTER_HOST。
    单机模式：优先读 DATACLOUD_GATEWAY_REDIS_* 系列，再 fallback REDIS_* 系列。
    """
    from by_framework.common.config import RedisConfig  # type: ignore[import-untyped]
    from by_framework.common.redis_client import init_redis  # type: ignore[import-untyped]

    cluster_hosts = (
        os.getenv("DATACLOUD_GATEWAY_REDIS_CLUSTER_HOST", "").strip()
        or os.getenv("REDIS_CLUSTER_HOST", "").strip()
    )
    cluster_nodes = None
    if cluster_hosts:
        cluster_nodes = [
            (host, int(port) if port else 6379)
            for node in cluster_hosts.split(",")
            if node.strip()
            for host, _, port in (node.strip().rpartition(":"),)
        ]

    redis_config = RedisConfig(
            cluster_nodes=cluster_nodes,
            mode="cluster" if cluster_nodes else "standalone",
            host=os.getenv("DATACLOUD_GATEWAY_REDIS_HOST", os.getenv("REDIS_HOST", "localhost")),
            port=int(os.getenv("DATACLOUD_GATEWAY_REDIS_PORT") or os.getenv("REDIS_PORT") or "6379"),
            db=int(os.getenv("DATACLOUD_GATEWAY_REDIS_DB") or os.getenv("REDIS_DATABASE") or "0"),
            password=os.getenv("DATACLOUD_GATEWAY_REDIS_PASSWORD", os.getenv("REDIS_PASSWORD", "")),
            username=os.getenv("DATACLOUD_GATEWAY_REDIS_USERNAME", os.getenv("REDIS_USERNAME")) or None,
        )
    init_redis(config=redis_config)


async def _post_via_discovery(
    service_name: str,
    path: str,
    payload: dict[str, Any],
    headers: dict[str, str],
) -> Any:
    from by_framework.core.discovery import DiscoveryClient  # type: ignore[import-untyped]
    from by_framework.util.discovery_http_client import (
        DiscoveryHttpClient,  # type: ignore[import-untyped]
    )
    from by_framework.util.http_client import RetryConfig  # type: ignore[import-untyped]

    _init_discovery_redis()
    discovery_client = DiscoveryClient(cache_interval=5)
    retry_config = RetryConfig(max_attempts=3, retry_on_status_codes={502, 503, 504})
    try:
        async with DiscoveryHttpClient(
            discovery_client, retry_config=retry_config, health_threshold_ms=-1
        ) as client:
            response = await client.post(service_name, path, headers=headers, json=payload)
    finally:
        await discovery_client.close()

    body: dict[str, Any] = response.data if isinstance(response.data, dict) else {}
    if not response.is_success or body.get("code", 0) != 0:
        raise ValueError(
            f"HTTP {response.status_code} {service_name}{path}: {body.get('msg', body)}"
        )
    if body and "data" in body:
        return body["data"]
    return body


def post_json(path: str, payload: dict[str, Any], service_env: str = "BE_DOMAINNAME") -> Any:
    """通过服务发现调用指定服务的 POST 接口。

    Args:
        path: 接口路径，如 "/auth/privilegeGrant/listResourceUseAuth"
        payload: 请求体
        service_env: 服务名称的环境变量名，默认 BE_DOMAINNAME（本 skill 硬编码为 ByaiService）
    """
    token = os.environ.get("BEYOND_TOKEN", "").strip()
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if token:
        headers["Beyond-Token"] = token

    return _run_async_in_thread(_post_via_discovery(_SERVICE_NAME, path, payload, headers))


def _run_async_in_thread(coro: Any) -> Any:
    """运行协程：使用模块级持久 event loop 避免多次 asyncio.run() 的 loop 交叉污染。

    每次 asyncio.run() 创建新 loop → Redis connection pool 的 Future 绑在旧 loop 上，
    下次 asyncio.run() 访问这些 Future 时触发 "got Future attached to a different loop"。
    用单个 loop 避免此问题。
    """
    return _shared_loop.run_until_complete(coro)
