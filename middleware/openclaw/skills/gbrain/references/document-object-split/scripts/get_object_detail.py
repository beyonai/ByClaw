#!/usr/local/bin/python3
"""从 Redis 查询 Ontology 对象详情（含属性字段定义）。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON）:
    # 传 resource_id，自动拼接 Redis key：OBJECT_{resource_id}
    {"resource_id": "10042459"}

    # 或直接传完整 Redis key
    {"key": "OBJECT_10042459"}

    # 批量查询
    {"resource_ids": ["10042459", "10042460"]}
    {"keys": ["OBJECT_10042459", "OBJECT_10042460"]}

出参（stdout JSON）:
    # 单个
    {
        "ok": true,
        "key": "OBJECT_10042459",
        "resource_id": "10042459",
        "object_code": "p_bug_0027024630_5406b7",
        "object_name": "Bug",
        "object_source": "KNOWLEDGE_BASE",
        "object_desc": "...",
        "base_id": "",
        "actions": [],
        "properties": [...],
        "fields": ["handler", "deadline", "title"]
    }

    # 批量
    {
        "ok": true,
        "objects": [ { ... 同上 ... }, ... ]
    }

Redis 示例:
    GET OBJECT_10042459
    → {"objectCode":"p_bug_...","objectName":"Bug","resourceBizType":"OBJECT",...}
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))

from _common import object_redis_key, redis_get, stdout_json


def _normalize_property(prop: dict[str, Any]) -> dict[str, Any]:
    return {
        "property_code": prop.get("propertyCode", prop.get("property_code", "")),
        "property_name": prop.get("propertyName", prop.get("property_name", "")),
        "data_type": prop.get("dataType", prop.get("data_type", "")),
        "is_required": bool(prop.get("isRequired") or prop.get("is_required")),
        "is_name": bool(prop.get("isName") or prop.get("is_name")),
        "business_key": bool(prop.get("businessKey") or prop.get("business_key")),
        "sort_no": prop.get("sortNo", prop.get("sort_no", 0)),
        "status": prop.get("status", 0),
    }


def _resolve_redis_key(params: dict[str, Any]) -> str:
    key = str(params.get("key", "")).strip()
    if key:
        return key

    resource_id = str(params.get("resource_id", "")).strip()
    if resource_id:
        return object_redis_key(resource_id)

    return ""


def _resolve_redis_keys(params: dict[str, Any]) -> list[str]:
    keys_raw = params.get("keys")
    if isinstance(keys_raw, list):
        keys = [str(k).strip() for k in keys_raw if str(k).strip()]
        if keys:
            return keys

    resource_ids = params.get("resource_ids")
    if isinstance(resource_ids, list):
        ids = [str(rid).strip() for rid in resource_ids if str(rid).strip()]
        if ids:
            return [object_redis_key(rid) for rid in ids]

    single = _resolve_redis_key(params)
    return [single] if single else []


def _resource_id_from_key(key: str) -> str:
    prefix = "OBJECT_"
    if key.startswith(prefix):
        return key[len(prefix) :]
    return ""


def _fetch_from_redis(key: str) -> dict[str, Any]:
    raw = redis_get(key)
    if not raw:
        raise ValueError(f"Redis 未找到 key: {key}")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError(f"Redis {key} 内容非 JSON 对象: {data!r}")
    return data


def _build_response(key: str, data: dict[str, Any]) -> dict[str, Any]:
    properties_raw = data.get("properties") or []
    properties = [_normalize_property(p) for p in properties_raw if isinstance(p, dict)]
    fields = [p["property_code"] for p in properties if p["property_code"]]

    result: dict[str, Any] = {
        "ok": True,
        "key": key,
        "object_code": data.get("objectCode", data.get("object_code", "")),
        "object_name": data.get("objectName", data.get("object_name", data.get("resourceName", ""))),
        "object_source": data.get("objectSource", data.get("object_source", "")),
        "object_desc": data.get("objectDesc", data.get("object_desc", data.get("resourceDesc", ""))),
        "base_id": data.get("baseId", data.get("base_id", "")),
        "actions": data.get("actions") or [],
        "properties": properties,
        "fields": fields,
    }
    resource_id = _resource_id_from_key(key)
    if resource_id:
        result["resource_id"] = resource_id
    return result


def main() -> None:
    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
    if not raw:
        stdout_json({"ok": False, "error": "缺少入参，需要 key 或 resource_id"})
        sys.exit(1)

    params: dict[str, Any] = json.loads(raw)
    keys = _resolve_redis_keys(params)
    if not keys:
        stdout_json({"ok": False, "error": "缺少入参，需要 key、resource_id、keys 或 resource_ids"})
        sys.exit(1)

    if len(keys) == 1:
        data = _fetch_from_redis(keys[0])
        stdout_json(_build_response(keys[0], data))
        return

    objects: list[dict[str, Any]] = []
    errors: list[str] = []
    for key in keys:
        try:
            data = _fetch_from_redis(key)
            objects.append(_build_response(key, data))
        except (ValueError, json.JSONDecodeError) as exc:
            errors.append(f"{key}: {exc}")

    if not objects:
        stdout_json({"ok": False, "error": "; ".join(errors) if errors else "未查询到任何对象"})
        sys.exit(1)

    result: dict[str, Any] = {
        "ok": True,
        "objects": objects,
        "object_codes": [obj["object_code"] for obj in objects if obj.get("object_code")],
    }
    if errors:
        result["errors"] = errors
    stdout_json(result)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        stdout_json({"ok": False, "error": str(exc)})
        sys.exit(1)
