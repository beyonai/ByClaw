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


def _init_discovery_redis() -> None:
    """全局初始化服务发现 Redis（幂等）。"""
    from by_framework.common.redis_client import init_redis  # type: ignore[import-untyped]

    init_redis(
        host=os.getenv("REDIS_HOST", "localhost"),
        port=int(os.getenv("REDIS_PORT", "6379")),
        db=int(os.getenv("REDIS_DATABASE", "0")),
        password=os.getenv("REDIS_PASSWORD") or None,
        username=os.getenv("REDIS_USERNAME") or None,
    )


def post_json(path: str, payload: dict[str, Any], service_env: str = "BE_DOMAINNAME") -> Any:
    """通过服务发现调用指定服务的 POST 接口。

    Args:
        path: 接口路径，如 "/auth/privilegeGrant/listResourceUseAuth"
        payload: 请求体
        service_env: 服务名称的环境变量名，默认 BE_DOMAINNAME
    """
    service_name = os.environ.get(service_env, "").strip()
    if not service_name:
        raise ValueError(f"{service_env} 环境变量未配置")

    token = os.environ.get("BEYOND_TOKEN", "").strip()
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if token:
        headers["Beyond-Token"] = token

    return _run_async_in_thread(_post_via_discovery(service_name, path, payload, headers))


async def _post_via_discovery(
    service_name: str,
    path: str,
    payload: dict[str, Any],
    headers: dict[str, str],
) -> Any:
    from by_framework.core.discovery import DiscoveryClient  # type: ignore[import-untyped]
    from by_framework.util.discovery_http_client import DiscoveryHttpClient  # type: ignore[import-untyped]
    from by_framework.util.http_client import RetryConfig  # type: ignore[import-untyped]

    _init_discovery_redis()
    discovery_client = DiscoveryClient(cache_interval=5)
    retry_config = RetryConfig(max_attempts=3, retry_on_status_codes={502, 503, 504})
    try:
        async with DiscoveryHttpClient(discovery_client, retry_config=retry_config, health_threshold_ms=-1) as client:
            response = await client.post(service_name, path, headers=headers, json=payload)
    finally:
        await discovery_client.close()

    body: dict[str, Any] = response.data if isinstance(response.data, dict) else {}
    if not response.is_success or body.get("code", 0) != 0:
        raise ValueError(f"HTTP {response.status_code} {service_name}{path}: {body.get('msg', body)}")
    return body.get("data")


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


def delete_resource_by_code(resource_code: str) -> None:
    """通过 resourceCode 直接下架个人本体。"""
    data = post_json(
        path="/byaiService/tool/deleteResourceByCodeAndOwnerType",
        payload={"resourceCode": resource_code, "ownerType": "personal"},
    )
    if not data or data.get("code") != 0:
        raise RuntimeError(f"下架本体失败: {data}")


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
            host=os.environ.get("REDIS_HOST", "localhost"),
            port=int(os.environ.get("REDIS_PORT", "6379")),
            db=int(os.environ.get("REDIS_DATABASE", "0")),
            password=os.environ.get("REDIS_PASSWORD") or None,
            username=os.environ.get("REDIS_USERNAME") or None,
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

