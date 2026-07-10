"""Redis-backed digital employee agent config loader for ByClaw Data worker.

Mirrors byclaw-qa/src/redis_agent_config.py, but filters for
OBJECT/VIEW/SCENE/ONTOLOGY_BASE instead of KG_DOC.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

DATA_RESOURCE_TYPES = frozenset({"OBJECT", "VIEW", "SCENE", "ONTOLOGY_BASE"})


async def get_dig_employee_from_redis(
    redis_client: Any, agent_id: str, resource_path: str | None = None
) -> dict[str, Any] | None:
    """Read DIG_EMPLOYEE_{agent_id} JSON from local resource path first, then Redis."""
    key = f"DIG_EMPLOYEE_{agent_id}"
    if resource_path:
        local_employee = _load_dig_employee_from_local(resource_path, key)
        if local_employee is not None:
            return local_employee

    try:
        raw = await redis_client.get(key)
    except Exception:
        logger.warning("Failed to read Redis key %s", key, exc_info=True)
        return None
    if raw is None:
        return None
    return _decode_redis_json(raw)


def _load_dig_employee_from_local(
    resource_path: str, key: str
) -> dict[str, Any] | None:
    file_path = Path(resource_path) / "dig_employee" / f"{key}.json"
    if not file_path.is_file():
        return None
    try:
        return _decode_redis_json(file_path.read_text(encoding="utf-8"))
    except Exception:
        logger.warning("Failed to read local DIG employee file %s", file_path, exc_info=True)
        return None


def _decode_redis_json(value: Any) -> dict[str, Any] | None:
    if isinstance(value, bytes):
        value = value.decode("utf-8")
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (json.JSONDecodeError, TypeError):
            # 双重转义修复：部分 Redis 数据的字段值经过二次 json.dumps
            # 导致 \\" 出现于本应是 \" 的位置，json.loads 解析失败。
            # 将 \\\\" 还原为 \\" 后再试一次。
            try:
                value = json.loads(value.replace('\\\\"', '\\"'))
            except (json.JSONDecodeError, TypeError):
                return None
    return value if isinstance(value, dict) else None


async def load_data_rel_resources_from_redis(
    redis_client: Any,
    agent_id: str,
    resource_path: str | None = None,
) -> list[dict[str, Any]]:
    """Load OBJECT/VIEW/SCENE/ONTOLOGY_BASE resources from Redis.

    Returns filtered relResourceList items with systemCode mapped to
    ontologyBaseCode for _build_scope_entries compatibility.

    Mirrors QA's load_agent_config_from_redis, filtering for Data resource types
    instead of KG_DOC.
    """
    employee = await get_dig_employee_from_redis(redis_client, agent_id, resource_path)
    if not employee:
        return []

    rel_list = employee.get("relResourceList") or []
    result: list[dict[str, Any]] = []
    for r in rel_list:
        if not isinstance(r, dict):
            continue
        biz_type = str(r.get("resourceBizType") or "")
        if biz_type not in DATA_RESOURCE_TYPES:
            continue
        item = dict(r)
        _normalize_ontology_base_code(item)
        result.append(item)

    if result:
        logger.info(
            "Loaded %d Data resource(s) from Redis DIG_EMPLOYEE_%s",
            len(result),
            agent_id,
        )
    return result


def _normalize_ontology_base_code(item: dict[str, Any]) -> None:
    """Map systemCode → ontologyBaseCode for _build_scope_entries compatibility.

    The stored data uses ``systemCode`` as the base/tenant identifier
    (baiying-enhance/agent-adapter.ts:414).
    ``ontologyBaseCode`` is the field name expected by _build_scope_entries.
    """
    if not item.get("ontologyBaseCode"):
        system_code = item.get("systemCode")
        if system_code:
            item["ontologyBaseCode"] = system_code


__all__ = [
    "DATA_RESOURCE_TYPES",
    "get_dig_employee_from_redis",
    "load_data_rel_resources_from_redis",
]
