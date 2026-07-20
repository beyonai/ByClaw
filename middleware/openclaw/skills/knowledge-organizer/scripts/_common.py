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


async def _get_via_discovery(
    service_name: str,
    path: str,
    headers: dict[str, str],
) -> Any:
    """通过服务发现调用指定服务的 GET 接口。"""
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
            response = await client.get(service_name, path, headers=headers)
    finally:
        await discovery_client.close()

    body: dict[str, Any] = response.data if isinstance(response.data, dict) else {}
    if not response.is_success or body.get("code") != 200:
        raise ValueError(
            f"HTTP {response.status_code} {service_name}{path}: {body.get('message', body)}"
        )
    return body.get("data")


async def _post_via_discovery(
    service_name: str,
    path: str,
    payload: dict[str, Any],
    headers: dict[str, str],
) -> Any:
    """通过服务发现调用指定服务的 POST 接口。"""
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

    if isinstance(response.data, str):
        return response.data
    body: dict[str, Any] = response.data if isinstance(response.data, dict) else {}
    code = body.get("code", 0)
    if not response.is_success or (code != 0 and code != 200 and not body.get("success")):
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
        service_env: 服务名称的环境变量名，默认 BE_DOMAINNAME
    """
    service_name = os.environ.get(service_env, "").strip()
    if not service_name:
        raise ValueError(f"{service_env} 环境变量未配置")

    token = os.environ.get("BEYOND_TOKEN", "").strip()
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if token:
        headers["Beyond-Token"] = token
    else:
        headers["Beyond-Token"] = "${Beyond-Token}"

    return _run_async_in_thread(_post_via_discovery(service_name, path, payload, headers))


def post_ontology_api(path: str, payload: dict[str, Any]) -> Any:
    """调用 datacloud_platform 的 ontology-manager API。

    通过 DATACLOUD_SERVICE_NAME 环境变量指定服务发现名，默认 byclaw-datacloud。

    Args:
        path: API 路径，如 "/object/collect"
        payload: 请求体
    """
    service_name = os.environ.get("DATACLOUD_DOMAINNAME", _DEFAULT_ONTOLOGY_SERVICE).strip()

    token = os.environ.get("BEYOND_TOKEN", "").strip()
    user_code = os.environ.get("USER_CODE", "").strip()
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if token:
        headers["Beyond-Token"] = token
    if user_code:
        headers["X-User-Code"] = user_code

    api_path = f"/api/v1/ontology-manager{path}"
    return _run_async_in_thread(_post_via_discovery(service_name, api_path, payload, headers))


def get_kb_resource_from_redis(kb_resource_id: str) -> dict[str, Any]:
    """从 Redis 读取知识库资源信息，key 为 KG_DOC_{kb_resource_id}。

    Args:
        kb_resource_id: 知识库资源 ID，如 "10000003"

    Returns:
        资源信息字典，包含 resourceCode、resourceName 等字段

    Raises:
        ValueError: key 不存在或数据格式异常时
    """
    import redis as _redis

    client = _redis.Redis(
        host=os.getenv("DATACLOUD_GATEWAY_REDIS_HOST", os.getenv("REDIS_HOST", "localhost")),
        port=int(os.getenv("DATACLOUD_GATEWAY_REDIS_PORT", os.getenv("REDIS_PORT", "6379"))),
        db=int(os.getenv("DATACLOUD_GATEWAY_REDIS_DATABASE", os.getenv("REDIS_DATABASE", "0"))),
        password=os.getenv("DATACLOUD_GATEWAY_REDIS_PASSWORD", os.getenv("REDIS_PASSWORD")) or None,
        username=os.getenv("DATACLOUD_GATEWAY_REDIS_USERNAME", os.getenv("REDIS_USERNAME")) or None,
        decode_responses=True,
    )

    key = f"KG_DOC_{kb_resource_id}"
    raw = client.get(key)
    if not raw:
        raise ValueError(f"Redis 中未找到知识库资源: {key}")

    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError(f"Redis key {key} 数据格式异常，期望 dict，实际: {type(data).__name__}")
    return data


def get_ontology_base(path: str) -> Any:
    """GET /api/v1/ontologyBases/{path}。

    Args:
        path: 不含前缀的路径，如 "objects/my_code"
    """
    service_name = os.environ.get("DATACLOUD_DOMAINNAME", _DEFAULT_ONTOLOGY_SERVICE).strip()

    token = os.environ.get("BEYOND_TOKEN", "").strip()
    user_code = os.environ.get("USER_CODE", "").strip()
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if token:
        headers["Beyond-Token"] = token
    if user_code:
        headers["X-User-Code"] = user_code

    api_path = f"/api/v1/ontologyBases/{path.lstrip('/')}"
    return _run_async_in_thread(_get_via_discovery(service_name, api_path, headers))


def post_rpc(path: str, payload: dict[str, Any]) -> Any:
    """POST /api/v1/rpc/{path}。

    Args:
        path: 不含前缀的路径，如 "term/list"
        payload: 请求体
    """
    service_name = os.environ.get("DATACLOUD_DOMAINNAME", _DEFAULT_ONTOLOGY_SERVICE).strip()

    token = os.environ.get("BEYOND_TOKEN", "").strip()
    user_code = os.environ.get("USER_CODE", "").strip()
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if token:
        headers["Beyond-Token"] = token
    if user_code:
        headers["X-User-Code"] = user_code

    api_path = f"/api/v1/rpc/{path.lstrip('/')}"
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


def download_kb_file(
    kb_resource_id: str,
    kb_file_path: str,
    output_path: str,
) -> bool:
    """下载知识库文件到本地。

    通过服务发现调用 GET /datasetController/download?resourceId=&directoryPath=，
    将响应字节写入 output_path。返回 True 表示成功，False 表示失败（不抛异常）。

    Args:
        kb_resource_id: 知识库资源 ID
        kb_file_path: 知识库内文件路径，如 /TechSpec/xxx.md
        output_path: 本地输出路径
    """
    from pathlib import Path as _Path

    _Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    try:
        _run_async_in_thread(_download_kb_file_async(kb_resource_id, kb_file_path, output_path))
        return True
    except Exception as exc:
        logger.warning("下载 KB 文件失败 %s: %s", kb_file_path, exc)
        return False


async def _download_kb_file_async(
    kb_resource_id: str,
    kb_file_path: str,
    output_path: str,
) -> None:
    """异步执行 KB 文件下载。"""
    from by_framework.core.discovery import DiscoveryClient  # type: ignore[import-untyped]
    from by_framework.util.discovery_http_client import (
        DiscoveryHttpClient,  # type: ignore[import-untyped]
    )
    from by_framework.util.http_client import RetryConfig  # type: ignore[import-untyped]

    service_name = os.environ.get("BE_DOMAINNAME", "").strip()
    if not service_name:
        raise ValueError("BE_DOMAINNAME 环境变量未配置")

    token = os.environ.get("BEYOND_TOKEN", "").strip()
    user_code = os.environ.get("USER_CODE", "").strip()
    headers: dict[str, str] = {}
    if token:
        headers["Beyond-Token"] = token
    else:
        headers["Beyond-Token"] = "${Beyond-Token}"
    if user_code:
        headers["X-User-Code"] = user_code

    _init_discovery_redis()
    discovery_client = DiscoveryClient(cache_interval=5)
    retry_config = RetryConfig(max_attempts=3, retry_on_status_codes={502, 503, 504})
    try:
        async with DiscoveryHttpClient(
            discovery_client, retry_config=retry_config, health_threshold_ms=-1
        ) as client:
            path = (
                f"/byaiService/datasetController/download"
                f"?resourceId={kb_resource_id}"
                f"&directoryPath={kb_file_path}"
            )
            response = await client.get(service_name, path, headers=headers)
    finally:
        await discovery_client.close()

    if not response.is_success:
        raise ValueError(f"HTTP {response.status_code}: 下载失败")

    # response.data 可能是 bytes 或 str
    # 先检查是否是 JSON 错误响应
    raw_data = response.data
    if isinstance(raw_data, str):
        try:
            body = json.loads(raw_data)
            if isinstance(body, dict):
                code = body.get("code")
                if code is not None and code not in (0, 200):
                    raise ValueError(f"下载失败 code={code}: {body.get('msg', body.get('message', ''))}")
        except json.JSONDecodeError:
            pass
        # 就是文件内容（文本），直接写
        from pathlib import Path as _Path
        _Path(output_path).write_text(raw_data, encoding="utf-8")
    elif isinstance(raw_data, bytes):
        from pathlib import Path as _Path
        _Path(output_path).write_bytes(raw_data)
    elif isinstance(raw_data, dict):
        code = raw_data.get("code")
        if code is not None and code not in (0, 200):
            raise ValueError(f"下载失败 code={code}: {raw_data.get('msg', raw_data.get('message', ''))}")
        raise ValueError(f"下载返回非预期格式: {type(raw_data).__name__}")
    else:
        raise ValueError(f"下载返回未知类型: {type(raw_data).__name__}")


def stdout_json(data: Any) -> None:
    """向 stdout 输出 JSON 并 flush。"""
    print(json.dumps(data, ensure_ascii=False), flush=True)
