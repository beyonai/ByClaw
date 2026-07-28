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
_DEFAULT_ONTOLOGY_SERVICE = "byclaw-datacloud"


def _init_discovery_redis() -> None:
    """全局初始化服务发现 Redis（幂等）。"""
    from by_framework.common.redis_client import init_redis  # type: ignore[import-untyped]

    init_redis(
        host=os.getenv("DATACLOUD_GATEWAY_REDIS_HOST", os.getenv("REDIS_HOST", "localhost")),
        port=int(os.getenv("DATACLOUD_GATEWAY_REDIS_PORT", os.getenv("REDIS_PORT", "6379"))),
        db=int(os.getenv("DATACLOUD_GATEWAY_REDIS_DATABASE", os.getenv("REDIS_DATABASE", "0"))),
        password=os.getenv("DATACLOUD_GATEWAY_REDIS_PASSWORD", os.getenv("REDIS_PASSWORD")) or None,
        username=os.getenv("DATACLOUD_GATEWAY_REDIS_USERNAME", os.getenv("REDIS_USERNAME")) or None,
    )


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


_base_id_cache: list[str] = []


def get_default_base_id() -> str:
    """静默获取用户第一个个人本体库 ID，结果缓存。

    调用门户服务 /byaiService/ontology/base/list，
    取返回列表第一项的 baseId。失败时返回空字符串，
    此时平台将回落至 _default_base_id()。
    """
    if _base_id_cache:
        return _base_id_cache[0]

    try:
        data = post_json(
            path="/byaiService/ontology/base/list",
            payload={"ownerType": "personal", "queryKeyword": ""},
        )
        items: list[dict] = []
        if isinstance(data, list):
            items = data
        elif isinstance(data, dict):
            items = data.get("list", data.get("data", []))
        if items:
            base_id = str(items[0].get("baseId", "") or items[0].get("id", ""))
            if base_id:
                _base_id_cache.append(base_id)
    except Exception:
        logger.warning("获取本体库列表失败，将使用平台默认库", exc_info=True)

    return _base_id_cache[0] if _base_id_cache else ""


def post_ontology_api(path: str, payload: dict[str, Any]) -> Any:
    """调用 datacloud_platform 的 ontology-manager API。

    通过 DATACLOUD_SERVICE_NAME 环境变量指定服务发现名，默认 byclaw-datacloud。
    自动注入 base_id（静默从门户服务获取第一个个人本体库 ID）。

    Args:
        path: API 路径，如 "/object/collect"
        payload: 请求体
    """
    # 自动注入 base_id
    if "base_id" not in payload:
        payload["base_id"] = get_default_base_id()

    service_name = os.environ.get("DATACLOUD_SERVICE_NAME", _DEFAULT_ONTOLOGY_SERVICE).strip()

    token = os.environ.get("BEYOND_TOKEN", "").strip()
    user_code = os.environ.get("USER_CODE", "").strip()
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if token:
        headers["Beyond-Token"] = token
    if user_code:
        headers["X-User-Code"] = user_code

    api_path = f"/api/v1/ontology-manager{path}"
    return _run_async_in_thread(_post_via_discovery(service_name, api_path, payload, headers))


def _run_async_in_thread(coro: Any) -> Any:
    """运行协程：使用模块级持久 event loop 避免多次 asyncio.run() 的 loop 交叉污染。

    每次 asyncio.run() 创建新 loop → Redis connection pool 的 Future 绑在旧 loop 上，
    下次 asyncio.run() 访问这些 Future 时触发 "got Future attached to a different loop"。
    用单个 loop 避免此问题。
    """
    return _shared_loop.run_until_complete(coro)


def delete_resource_by_code(resource_code: str) -> None:
    """通过 resourceCode 直接下架个人本体。"""
    post_json(
        path="/byaiService/tool/deleteResourceByCodeAndOwnerType",
        payload={"resourceCode": resource_code, "ownerType": "personal"},
    )
    # post_json 内部已校验 HTTP 状态码和 body.code != 0，抛异常即为失败，无需再检查返回值


def load_embedding_model_from_redis() -> bool:
    """从 Redis 读取 embedding 模型配置并设置环境变量。

    直接读取 Redis hash key ``byai:aimodel:typelist`` 中的 EMBEDDING 模型列表，
    取第一个带 ABILITY_DATA_CLOUD("5") 标签的模型，将 api_base/api_key/model/dims
    写入 DATACLOUD_EMBEDDING_* 环境变量。

    不依赖 byclaw_data 包，逻辑与 model_environment.build_embedding_config() 等价。

    Returns:
        True 表示成功加载，False 表示跳过（不会抛异常）。
    """
    try:
        import redis as _redis
    except ImportError:
        logger.warning("redis 包未安装，跳过 Embedding 模型加载")
        return False

    if os.environ.get("DATACLOUD_LLM_MODEL_LOAD_MODE", "ONLINE") == "LOCAL":
        logger.warning("Embedding 模型加载模式为 LOCAL，跳过")
        return False

    try:
        client = _redis.Redis(
            host=os.getenv("DATACLOUD_GATEWAY_REDIS_HOST", os.getenv("REDIS_HOST", "localhost")),
            port=int(os.getenv("DATACLOUD_GATEWAY_REDIS_PORT", os.getenv("REDIS_PORT", "6379"))),
            db=int(os.getenv("DATACLOUD_GATEWAY_REDIS_DATABASE", os.getenv("REDIS_DATABASE", "0"))),
            password=os.getenv("DATACLOUD_GATEWAY_REDIS_PASSWORD", os.getenv("REDIS_PASSWORD"))
            or None,
            username=os.getenv("DATACLOUD_GATEWAY_REDIS_USERNAME", os.getenv("REDIS_USERNAME"))
            or None,
            decode_responses=True,
        )

        raw = client.hget("byai:aimodel:typelist", "EMBEDDING")
        if not raw:
            logger.warning("Redis 中未找到 EMBEDDING 类型模型")
            return False

        models: list[dict] = json.loads(raw)
        if not isinstance(models, list) or not models:
            logger.warning("Redis 中 EMBEDDING 模型列表为空")
            return False

        # 优先取带 "5" (ABILITY_DATA_CLOUD) 标签的模型
        model = next(
            (m for m in models if "5" in (m.get("instanceParam") or {}).get("abilities", [])),
            None,
        )
        # 其次取 isDefault=1 的
        if not model:
            model = next((m for m in models if m.get("isDefault") == 1), None)
        # 兜底取第一个
        if not model:
            model = models[0]

        instance_param = model.get("instanceParam") or {}
        dims = (
            instance_param.get("dimensions")
            or instance_param.get("dimension")
            or instance_param.get("dims")
            or 1024
        )

        os.environ["DATACLOUD_EMBEDDING_MODEL"] = str(model.get("modelCode", ""))
        os.environ["DATACLOUD_EMBEDDING_API_BASE"] = str(model.get("url", ""))
        os.environ["DATACLOUD_EMBEDDING_API_KEY"] = str(model.get("authToken", ""))
        os.environ["DATACLOUD_EMBEDDING_DIMS"] = str(dims)

        logger.info(
            "已加载 Embedding 模型: %s (dims=%s)",
            model.get("modelCode"),
            dims,
        )
        return True
    except Exception:
        logger.warning("从 Redis 加载 Embedding 模型失败，向量回填将跳过", exc_info=True)
        return False
