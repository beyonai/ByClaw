"""Skill 公共库：服务发现、认证、HTTP 请求封装。

服务发现使用 by_framework，Redis 连接参数复用运行环境的 REDIS_* 变量。
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
from typing import Any

logger = logging.getLogger(__name__)

_DEFAULT_ONTOLOGY_SERVICE = "byclaw-datacloud"
_REQUEST_TIMEOUT = 360.0  # 6 分钟

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


async def _get_via_discovery(
    service_name: str,
    path: str,
    headers: dict[str, str],
) -> Any:
    """通过服务发现调用指定服务的 GET 接口。"""
    from by_framework.core.discovery import DiscoveryClient  # type: ignore[import-untyped]
    from by_framework.util.discovery_http_client import DiscoveryHttpClient  # type: ignore[import-untyped]
    from by_framework.util.http_client import ByHttpClient, RetryConfig  # type: ignore[import-untyped]

    _init_discovery_redis()
    discovery_client = DiscoveryClient(cache_interval=5)
    retry_config = RetryConfig(max_attempts=3, retry_on_status_codes={502, 503, 504})
    try:
        async with ByHttpClient("", timeout=_REQUEST_TIMEOUT) as http_client:
            async with DiscoveryHttpClient(discovery_client, http_client=http_client, retry_config=retry_config, health_threshold_ms=-1) as client:
                response = await client.get(service_name, path, headers=headers)
    finally:
        await discovery_client.close()

    body: dict[str, Any] = response.data if isinstance(response.data, dict) else {}
    if not response.is_success or body.get("code", 0) != 0:
        raise ValueError(f"HTTP {response.status_code} {service_name}{path}: {body.get('msg', body)}")
    if body and "data" in body:
        return body["data"]
    return body


async def _post_via_discovery(
    service_name: str,
    path: str,
    payload: dict[str, Any],
    headers: dict[str, str],
) -> Any:
    """通过服务发现调用指定服务的 POST 接口。"""
    from by_framework.core.discovery import DiscoveryClient  # type: ignore[import-untyped]
    from by_framework.util.discovery_http_client import DiscoveryHttpClient  # type: ignore[import-untyped]
    from by_framework.util.http_client import ByHttpClient, RetryConfig  # type: ignore[import-untyped]

    _init_discovery_redis()
    discovery_client = DiscoveryClient(cache_interval=5)
    retry_config = RetryConfig(max_attempts=3, retry_on_status_codes={502, 503, 504})
    try:
        async with ByHttpClient("", timeout=_REQUEST_TIMEOUT) as http_client:
            async with DiscoveryHttpClient(discovery_client, http_client=http_client, retry_config=retry_config, health_threshold_ms=-1) as client:
                response = await client.post(service_name, path, headers=headers, json=payload)
    finally:
        await discovery_client.close()

    body: dict[str, Any] = response.data if isinstance(response.data, dict) else {}
    if not response.is_success or body.get("code", 0) != 0:
        raise ValueError(f"HTTP {response.status_code} {service_name}{path}: {body.get('msg', body)}")
    if body and "data" in body:
        return body["data"]
    return body


def _build_ontology_headers(tenant_id: str | None = None) -> dict[str, str]:
    token = os.environ.get("BEYOND_TOKEN", "").strip()
    user_code = os.environ.get("USER_CODE", "").strip()
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if token:
        headers["Beyond-Token"] = token
    if user_code:
        headers["X-User-Code"] = user_code
    if tenant_id and tenant_id.strip():
        headers["X-Tenant-Id"] = tenant_id.strip()
    return headers


def _ontology_service_name() -> str:
    return os.environ.get("DATACLOUD_DOMAINNAME", _DEFAULT_ONTOLOGY_SERVICE).strip()


def post_json(path: str, payload: dict[str, Any], service_env: str = "BE_DOMAINNAME") -> Any:
    """通过服务发现调用任意服务的 POST 接口（用于 mount_resource 等非 ontology 接口）。"""
    service_name = os.environ.get(service_env, "").strip()
    if not service_name:
        raise ValueError(f"{service_env} 环境变量未配置")

    token = os.environ.get("BEYOND_TOKEN", "").strip()
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if token:
        headers["Beyond-Token"] = token

    return _run_async_in_thread(_post_via_discovery(service_name, path, payload, headers))


def get_ontology_api(path: str) -> Any:
    """调用 ontology-manager GET 接口。

    Args:
        path: API 路径（不含 /api/v1/ontology-manager 前缀），如 "/workspace/my_ws"
    """
    api_path = f"/api/v1/ontology-manager{path}"
    return _run_async_in_thread(
        _get_via_discovery(_ontology_service_name(), api_path, _build_ontology_headers())
    )


async def _post_ontology_api_async(
    path: str, payload: dict[str, Any], tenant_id: str | None = None
) -> Any:
    api_path = f"/api/v1/ontology-manager{path}"
    return await _post_via_discovery(
        _ontology_service_name(), api_path, payload, _build_ontology_headers(tenant_id)
    )


def post_ontology_api(
    path: str, payload: dict[str, Any], tenant_id: str | None = None
) -> Any:
    """调用 ontology-manager POST 接口，自动注入 base_id。

    Args:
        path: API 路径（不含 /api/v1/ontology-manager 前缀），如 "/workspace/object/collect"
        payload: 请求体
    """
    return _run_async_in_thread(_post_ontology_api_async(path, payload, tenant_id))


def _run_async_in_thread(coro: Any) -> Any:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    result: dict[str, Any] = {}
    error: dict[str, BaseException] = {}

    def runner() -> None:
        try:
            result["value"] = asyncio.run(coro)
        except BaseException as exc:  # noqa: BLE001
            error["exc"] = exc

    thread = threading.Thread(target=runner, daemon=True)
    thread.start()
    thread.join()
    if "exc" in error:
        raise error["exc"]
    return result.get("value")


def stdout_json(data: Any) -> None:
    """向 stdout 输出 JSON 并 flush。"""
    print(json.dumps(data, ensure_ascii=False), flush=True)
