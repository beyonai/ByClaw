"""Redis-backed digital employee agent config helpers."""

from __future__ import annotations

import json
from typing import Any, TypedDict

from by_framework.core.extensions import AgentConfig
from by_qa.core import logger
from by_qa.qa.instant.runtime.operation_registry import OperationType


RESOURCE_DIG_EMPLOYEE_REDIS_KEY_PREFIX = "RESOURCE_DIG_EMPLOYEE_"

class DigEmployeeSkillExtDocSchema(TypedDict, total=False):
    targetContent: str


class DigEmployeeSkillItemSchema(TypedDict, total=False):
    resourceCode: str
    resourceName: str
    resourceDesc: str
    extDoc: DigEmployeeSkillExtDocSchema


DigEmployeeSkillDataSchema = list[DigEmployeeSkillItemSchema]


def build_dig_employee_redis_key(agent_id: str) -> str:
    return f"{RESOURCE_DIG_EMPLOYEE_REDIS_KEY_PREFIX}{agent_id}"


def validate_dig_employee_skill_payload(
    payload: Any,
) -> DigEmployeeSkillDataSchema:
    if not isinstance(payload, list):
        raise ValueError("Redis digital employee payload must be a data list")
    return payload


def _decode_redis_json(value: Any) -> DigEmployeeSkillDataSchema | None:
    if value is None:
        return None
    if isinstance(value, bytes):
        value = value.decode("utf-8")
    if isinstance(value, str):
        value = json.loads(value)
    return validate_dig_employee_skill_payload(value)


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
                    if action == "knowledgeSearch":
                        operation_type = OperationType.SEARCH
                    else:
                        try:
                            operation_type = OperationType(action)
                        except ValueError:
                            logger.warning(f"Skip unknown action: {action}")
                            continue
                    if operation_type is not OperationType.SEARCH:
                        logger.warning(f"Skip unknown action: {action}")
                        continue
                    services[operation_type] = path

            if OperationType.SEARCH not in services:
                logger.warning(
                    "Knowledge base %s(%s) does not provide %s service",
                    kb_code,
                    kb_name,
                    OperationType.SEARCH.value,
                )

            knowledge_base = {
                "kb_code": str(kb_code),
                "kb_name": str(kb_name),
                "kb_desc": str(kb_desc),
                "urls": services,
                "service_name": domain_name,
            }
            if headers is not None:
                knowledge_base["headers"] = headers
            knowledge_bases.append(knowledge_base)
        except Exception as exc:
            logger.warning(f"Skip malformed knowledge base item: {exc}")
    return knowledge_bases


async def load_agent_config_from_redis(
    redis_client: Any, agent_id: str
) -> AgentConfig | None:
    redis_key = build_dig_employee_redis_key(agent_id)
    payload = _decode_redis_json(await redis_client.get(redis_key))
    if payload is None:
        logger.warning("Digital employee config not found in Redis: %s", redis_key)
        return None

    knowledge_bases = extract_knowledge_bases_from_agent_payload(payload)
    if not knowledge_bases:
        logger.warning("Digital employee %s has no valid knowledge bases", agent_id)
        return None

    return AgentConfig(
        agent_id=str(agent_id),
        knowledge_bases={
            str(agent_id): knowledge_bases,
        },
    )


def convert_agent_config_to_engine_config(agent_config: Any) -> dict[str, Any]:
    knowledge_bases: list[dict[str, Any]] = []
    for employee_knowledge_bases in (agent_config.knowledge_bases or {}).values():
        for knowledge_base in employee_knowledge_bases or []:
            operations = dict(knowledge_base.get("urls") or {})
            kb_url = operations.get(OperationType.SEARCH)
            kb_service_name = knowledge_base.get("service_name", None)
            if not kb_url or not kb_service_name:
                continue
            engine_knowledge_base = {
                "kb_code": str(knowledge_base.get("kb_code") or ""),
                "kb_name": str(knowledge_base.get("kb_name") or ""),
                "kb_description": str(knowledge_base.get("kb_desc") or ""),
                "service_name": str(kb_service_name or ""),
                "operations": {
                    OperationType.SEARCH: str(kb_url),
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
