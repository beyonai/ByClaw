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


def _build_ontology_headers() -> dict[str, str]:
    token = os.environ.get("BEYOND_TOKEN", "").strip()
    user_code = os.environ.get("USER_CODE", "").strip()
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if token:
        headers["Beyond-Token"] = token
    if user_code:
        headers["X-User-Code"] = user_code
    return headers


def _ontology_service_name() -> str:
    return os.environ.get("DATACLOUD_DOMAINNAME", _DEFAULT_ONTOLOGY_SERVICE).strip()


def get_ontology_api(path: str) -> Any:
    """调用 ontology-manager GET 接口。

    Args:
        path: API 路径（不含 /api/v1/ontology-manager 前缀），如 "/workspace/my_ws"
    """
    api_path = f"/api/v1/ontology-manager{path}"
    return _run_async_in_thread(
        _get_via_discovery(_ontology_service_name(), api_path, _build_ontology_headers())
    )


def post_ontology_api(path: str, payload: dict[str, Any]) -> Any:
    """调用 ontology-manager POST 接口。

    Args:
        path: API 路径（不含 /api/v1/ontology-manager 前缀），如 "/object/collect"
        payload: 请求体
    """
    api_path = f"/api/v1/ontology-manager{path}"
    return _run_async_in_thread(
        _post_via_discovery(_ontology_service_name(), api_path, payload, _build_ontology_headers())
    )


def _byai_service_name() -> str:
    return (
        os.environ.get("OPENCLAW_DOMAINNAME", "").strip()
        or os.environ.get("BYAI_DOMAINNAME", "").strip()
        or os.environ.get("BE_DOMAINNAME", "").strip()
    )


def post_byai_api(path: str, payload: dict[str, Any]) -> Any:
    """调用 byaiService / openclaw POST 接口。

    服务名优先 OPENCLAW_DOMAINNAME，其次 BYAI_DOMAINNAME、BE_DOMAINNAME。
    """
    service_name = _byai_service_name()
    if not service_name:
        raise ValueError("OPENCLAW_DOMAINNAME、BYAI_DOMAINNAME 或 BE_DOMAINNAME 环境变量未配置")
    return _run_async_in_thread(
        _post_via_discovery(service_name, path, payload, _build_ontology_headers())
    )


def get_byai_api(path: str) -> Any:
    """调用 byaiService / openclaw GET 接口。"""
    service_name = _byai_service_name()
    if not service_name:
        raise ValueError("OPENCLAW_DOMAINNAME、BYAI_DOMAINNAME 或 BE_DOMAINNAME 环境变量未配置")
    return _run_async_in_thread(
        _get_via_discovery(service_name, path, _build_ontology_headers())
    )


def redis_get(key: str) -> str | None:
    """从 Redis 读取字符串值（使用 REDIS_* / DATACLOUD_GATEWAY_REDIS_* 连接参数）。"""
    from by_framework.common.redis_client import get_redis  # type: ignore[import-untyped]

    _init_discovery_redis()
    client = get_redis()
    value = client.get(key)
    if value is None:
        return None
    if isinstance(value, bytes):
        return value.decode("utf-8")
    return str(value)


def object_redis_key(resource_id: str | int) -> str:
    """Ontology 对象详情在 Redis 中的 key：OBJECT_{resourceId}。"""
    return f"OBJECT_{resource_id}"


def resolve_employee_id(explicit: str = "") -> str:
    """解析当前数字员工 ID（stdin > 环境变量）。"""
    if explicit.strip():
        return explicit.strip()
    for env_key in ("DIGITAL_EMPLOYEE_ID", "EMPLOYEE_ID", "OPENCLAW_EMPLOYEE_ID"):
        value = os.environ.get(env_key, "").strip()
        if value:
            return value
    return ""


_OPENCLAW_RESOURCE_LIST_PATH = os.getenv(
    "OPENCLAW_RESOURCE_LIST_PATH",
    "/byaiService/digitalEmployee/resource/list",
)

_OBJECT_DETAIL_PATH = os.getenv(
    "OPENCLAW_OBJECT_DETAIL_PATH",
    "/byaiService/ontology/object/detail",
)


def fetch_employee_resources(employee_id: str = "") -> list[dict[str, Any]]:
    """从 openclaw 获取当前数字员工的资源列表（原始 dict 数组）。"""
    resolved_id = resolve_employee_id(employee_id)
    payload: dict[str, Any] = {}
    if resolved_id:
        payload["employeeId"] = resolved_id

    data = post_byai_api(_OPENCLAW_RESOURCE_LIST_PATH, payload)
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    if isinstance(data, dict):
        for key in ("resources", "resourceList", "list", "rows", "data"):
            nested = data.get(key)
            if isinstance(nested, list):
                return [item for item in nested if isinstance(item, dict)]
        return [data]
    return []


def filter_object_resources(resources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """筛选 resourceBizType == OBJECT 的资源。"""
    objects: list[dict[str, Any]] = []
    for item in resources:
        biz_type = str(item.get("resourceBizType") or item.get("resource_biz_type") or "").upper()
        if biz_type == "OBJECT":
            objects.append(item)
    return objects


def resource_id_from_item(item: dict[str, Any]) -> str:
    """从资源条目提取 resourceId。"""
    for key in ("resourceId", "resource_id", "id"):
        value = item.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    raise ValueError(f"资源条目缺少 resourceId: {item!r}")


def object_code_from_item(item: dict[str, Any]) -> str:
    """从资源条目提取 objectCode（用于与 object_code 入参匹配）。"""
    for key in ("objectCode", "object_code", "resourceCode", "resource_code"):
        value = item.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def fetch_employee_object_entries(employee_id: str = "") -> list[dict[str, Any]]:
    """从 openclaw 获取当前数字员工挂载的 OBJECT 资源条目（含 objectCode）。

    详情接口仅支持按 objectCode 单条查询；调用方应遍历返回列表逐条调接口。
    """
    resources = fetch_employee_resources(employee_id)
    entries: list[dict[str, Any]] = []
    seen_codes: set[str] = set()
    for item in filter_object_resources(resources):
        object_code = object_code_from_item(item)
        if not object_code or object_code in seen_codes:
            continue
        seen_codes.add(object_code)
        entry: dict[str, Any] = {"object_code": object_code}
        try:
            entry["resource_id"] = resource_id_from_item(item)
        except ValueError:
            pass
        entries.append(entry)
    return entries


def fetch_object_detail_from_redis(resource_id: str | int) -> dict[str, Any]:
    """按 OBJECT_{resourceId} 从 Redis 读取对象详情 JSON。"""
    key = object_redis_key(resource_id)
    raw = redis_get(key)
    if not raw:
        raise ValueError(f"Redis 未找到对象详情: {key}")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError(f"Redis {key} 内容非 JSON 对象: {data!r}")
    return data


def build_resource_object_code_map(resources: list[dict[str, Any]] | None = None) -> dict[str, str]:
    """构建 resourceId → objectCode 映射（仅 OBJECT 类型资源）。"""
    items = resources if resources is not None else fetch_employee_resources()
    mapping: dict[str, str] = {}
    for item in filter_object_resources(items):
        try:
            resource_id = resource_id_from_item(item)
        except ValueError:
            continue
        object_code = object_code_from_item(item)
        if object_code:
            mapping[resource_id] = object_code
    return mapping


def resolve_object_code(
    resource_id: str,
    mapping: dict[str, str] | None = None,
) -> str:
    """从 openclaw 资源列表按 resourceId 解析 objectCode。"""
    rid = str(resource_id).strip()
    if not rid:
        raise ValueError("resource_id 不能为空")
    code_map = mapping if mapping is not None else build_resource_object_code_map()
    object_code = code_map.get(rid, "").strip()
    if not object_code:
        raise ValueError(f"未找到 resource_id={rid} 对应的 objectCode")
    return object_code


def fetch_object_detail_api(
    object_code: str,
    base_id: str | None = None,
) -> dict[str, Any]:
    """调用 byaiService POST /ontology/object/detail 获取对象详情。

    请求体 objectCode 为必传；baseId 可选（默认 null）。每次仅查询单个对象。
    """
    code = str(object_code).strip()
    if not code:
        raise ValueError("objectCode 为必传参数，不能为空")

    payload: dict[str, Any] = {
        "baseId": base_id if base_id is not None else None,
        "objectCode": code,
    }
    data = post_byai_api(_OBJECT_DETAIL_PATH, payload)
    if not isinstance(data, dict):
        raise ValueError(f"对象详情响应非 JSON 对象: {data!r}")
    return data


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
