"""Redis-backed digital employee agent config helpers."""

from __future__ import annotations

import asyncio
import json
from typing import Any, TypedDict

from by_framework.core.extensions import AgentConfig
from by_qa.core import logger
from by_qa.qa.common.operation_registry import OperationType
from exceptions import ModelConfigError


class DigEmployeeSkillExtDocSchema(TypedDict, total=False):
    targetContent: str


class DigEmployeeSkillItemSchema(TypedDict, total=False):
    resourceCode: str
    resourceName: str
    resourceDesc: str
    extDoc: DigEmployeeSkillExtDocSchema


DigEmployeeSkillDataSchema = list[DigEmployeeSkillItemSchema]


def validate_dig_employee_skill_payload(
    payload: Any,
) -> DigEmployeeSkillDataSchema:
    if not isinstance(payload, list):
        raise ModelConfigError("Redis digital employee payload must be a data list")
    return payload


def _decode_redis_json(value: Any) -> DigEmployeeSkillDataSchema | None:
    if value is None:
        return None
    if isinstance(value, bytes):
        value = value.decode("utf-8")
    if isinstance(value, str):
        value = json.loads(value)
    return validate_dig_employee_skill_payload(value)


def _decode_redis_json_dict(value: Any) -> dict[str, Any] | None:
    """Decode a Redis value into a JSON dict, or return None on failure."""
    if value is None:
        return None
    if isinstance(value, bytes):
        value = value.decode("utf-8")
    if isinstance(value, str):
        value = json.loads(value)
    if isinstance(value, dict):
        return value
    return None


def _kg_doc_to_skill_item(
    kg_doc_rel: dict[str, Any],
    kg_doc_config: dict[str, Any],
) -> dict[str, Any]:
    """Convert a KG_DOC config into the Redis skill-item format."""
    target_content = {
        "domainName": kg_doc_config.get("domainName"),
        "domainURL": kg_doc_config.get("domainURL"),
        "headers": kg_doc_config.get("headers"),
        "resourceService": kg_doc_config.get("resourceService", []),
    }
    return {
        "resourceCode": kg_doc_rel.get("resourceCode"),
        "resourceName": kg_doc_rel.get("resourceName"),
        "resourceDesc": kg_doc_rel.get("resourceDesc"),
        "extDoc": {
            "targetContent": json.dumps(target_content, ensure_ascii=False),
        },
    }


def extract_knowledge_bases_from_agent_payload(
    payload: DigEmployeeSkillDataSchema,
) -> list[dict[str, Any]]:
    knowledge_bases: list[dict[str, Any]] = []
    for item in payload or []:
        try:
            services: dict[OperationType, str] = {}
            target_content = json.loads(
                ((item or {}).get("extDoc") or {}).get("targetContent") or "{}"
            )
            domain_name = target_content.get("domainName", None)
            domain_url = target_content.get("domainURL", None)
            headers = target_content.get("headers", None)
            kb_code = item.get("resourceCode", None)
            kb_name = item.get("resourceName", None)
            kb_desc = item.get("resourceDesc", None)
            if not kb_code or not kb_name:
                logger.warning("Skip knowledge base item without resourceCode, resourceName")
                continue
            for service in target_content.get("resourceService", []):
                paths = service.get("openapiSchema", {}).get("paths", {})
                for path, path_item in paths.items():
                    action = path_item.get("post", {}).get("operationId", None)
                    if not action:
                        continue
                    try:
                        operation_type = OperationType(action)
                    except ValueError:
                        logger.warning(f"Skip unknown action: {action}")
                        continue
                    if operation_type is not OperationType.KNOWLEDGE_SEARCH:
                        logger.warning(f"Skip unknown action: {action}")
                        continue
                    services[operation_type] = path

            if OperationType.KNOWLEDGE_SEARCH not in services:
                logger.warning(
                    "Knowledge base %s(%s) does not provide %s service",
                    kb_code,
                    kb_name,
                    OperationType.KNOWLEDGE_SEARCH.value,
                )

            knowledge_base = {
                "kb_code": str(kb_code),
                "kb_name": str(kb_name),
                "kb_desc": str(kb_desc),
                "urls": services,
                "service_name": domain_name,
                "base_url": domain_url
            }
            if headers is not None:
                knowledge_base["headers"] = headers
            knowledge_bases.append(knowledge_base)
        except Exception as exc:
            logger.warning(f"Skip malformed knowledge base item: {exc}")
    return knowledge_bases


async def get_dig_employee_from_redis(
    redis_client: Any, agent_id: str
) -> dict[str, Any] | None:
    """Read DIG_EMPLOYEE_{agent_id} JSON from Redis."""
    key = f"DIG_EMPLOYEE_{agent_id}"
    logger.info("Fetching employee config from Redis key=%s", key)
    try:
        raw = await redis_client.get(key)
    except Exception as exc:
        logger.warning("Failed to read Redis key %s: %s", key, exc)
        return None
    config = _decode_redis_json_dict(raw)
    if config is not None:
        logger.info("Loaded employee config from Redis key=%s", key)
    else:
        logger.warning("Employee config not found in Redis key=%s", key)
    return config


async def get_kg_doc_from_redis(
    redis_client: Any, kg_id: str
) -> dict[str, Any] | None:
    """Read KG_DOC_{kg_id} JSON from Redis."""
    key = f"KG_DOC_{kg_id}"
    logger.info("Fetching KG_DOC config from Redis key=%s", key)
    try:
        raw = await redis_client.get(key)
    except Exception as exc:
        logger.warning("Failed to read Redis key %s: %s", key, exc)
        return None
    config = _decode_redis_json_dict(raw)
    if config is not None:
        logger.info("Loaded KG_DOC config from Redis key=%s", key)
    else:
        logger.warning("KG_DOC config not found in Redis key=%s", key)
    return config


async def load_agent_config_from_redis(
    redis_client: Any,
    agent_id: str,
) -> tuple[AgentConfig | None, dict[str, Any] | None]:
    """Load digital employee config from Redis and build AgentConfig.

    Returns (AgentConfig, employee_config) on success, or (None, None) on failure.
    The employee_config is returned alongside AgentConfig so callers can extract
    prologue modelId / corePersonaDefinition without a second Redis read.
    """
    logger.info("Loading agent config from Redis for agent_id=%s", agent_id)
    employee_config = await get_dig_employee_from_redis(redis_client, agent_id)
    if employee_config is None:
        logger.warning("Digital employee config not found in Redis: DIG_EMPLOYEE_%s", agent_id)
        return None, None

    rel_list = employee_config.get("relResourceList") or []
    kg_doc_rels = [r for r in rel_list if r.get("resourceBizType") == "KG_DOC"]
    logger.info(
        "Found %d KG_DOC resource(s) for agent_id=%s in Redis employee config",
        len(kg_doc_rels),
        agent_id,
    )
    if not kg_doc_rels:
        logger.warning("Digital employee %s has no KG_DOC resources in Redis", agent_id)
        return None, employee_config

    async def _fetch_and_convert(rel: dict[str, Any]) -> dict[str, Any] | None:
        resource_id = str(rel.get("resourceId", ""))
        if not resource_id:
            return None
        kg_config = await get_kg_doc_from_redis(redis_client, resource_id)
        if kg_config is None:
            logger.warning(
                "KG_DOC config not found in Redis for resourceId=%s", resource_id
            )
            return None
        return _kg_doc_to_skill_item(rel, kg_config)

    results = await asyncio.gather(*[_fetch_and_convert(r) for r in kg_doc_rels])
    skill_items = [r for r in results if r is not None]
    if not skill_items:
        logger.warning("Digital employee %s: all KG_DOC configs failed to load", agent_id)
        return None, employee_config

    knowledge_bases = extract_knowledge_bases_from_agent_payload(skill_items)
    if not knowledge_bases:
        logger.warning("Digital employee %s has no valid knowledge bases from Redis", agent_id)
        return None, employee_config

    logger.info(
        "Loaded agent config from Redis: agent_id=%s, knowledge_base_count=%d",
        agent_id,
        len(knowledge_bases),
    )
    return AgentConfig(
        agent_id=str(agent_id),
        knowledge_bases={str(agent_id): knowledge_bases},
    ), employee_config


def convert_agent_config_to_engine_config(agent_config: Any) -> dict[str, Any]:
    knowledge_bases: list[dict[str, Any]] = []
    for employee_knowledge_bases in (agent_config.knowledge_bases or {}).values():
        for knowledge_base in employee_knowledge_bases or []:
            operations = dict(knowledge_base.get("urls") or {})
            kb_url = operations.get(OperationType.KNOWLEDGE_SEARCH)
            kb_service_name = knowledge_base.get("service_name", None)
            if not kb_url or not kb_service_name:
                continue
            engine_knowledge_base = {
                "kb_code": str(knowledge_base.get("kb_code") or ""),
                "kb_name": str(knowledge_base.get("kb_name") or ""),
                "kb_description": str(knowledge_base.get("kb_desc") or ""),
                "base_url": knowledge_base.get("base_url", None),
                "service_name": str(kb_service_name or ""),
                "operations": {
                    OperationType.KNOWLEDGE_SEARCH: str(kb_url),
                },
            }
            headers = knowledge_base.get("headers", None)
            if headers is not None:
                engine_knowledge_base["headers"] = headers
            knowledge_bases.append(engine_knowledge_base)
    return {
        "retrieval": {
            "knowledge_bases": knowledge_bases,
        }
    }


def extract_prologue_model_id(employee_config: dict[str, Any] | None) -> str | None:
    """Extract modelId from the employee config's prologue field.

    prologue is a JSON string like:
    {"modelInfo": {...}, "modelId": -2000, ...}
    Returns modelId as string, or None if parsing fails / field is absent.
    """
    if not employee_config:
        return None
    prologue_raw = employee_config.get("prologue")
    if prologue_raw is None:
        return None
    try:
        prologue = json.loads(prologue_raw) if isinstance(prologue_raw, str) else prologue_raw
        model_id = prologue.get("modelInfo", {}).get("modelId")
        if model_id is None:
            return None
        return str(model_id)
    except (json.JSONDecodeError, AttributeError):
        return None
