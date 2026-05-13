"""MinIO-backed digital employee agent config helpers.

Replaces redis_agent_config for loading agent configuration from MinIO
instead of Redis.  Produces the same AgentConfig structure so the rest
of the worker pipeline (convert_agent_config_to_engine_config, etc.)
works unchanged.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from by_framework.core.extensions import AgentConfig
from by_qa.core import logger

from minio_client import MinioResourceClient
from redis_agent_config import extract_knowledge_bases_from_agent_payload


def _kg_doc_to_skill_item(
    kg_doc_rel: dict[str, Any],
    kg_doc_config: dict[str, Any],
) -> dict[str, Any]:
    """Convert a MinIO KG_DOC config into the Redis skill-item format.

    This lets us reuse extract_knowledge_bases_from_agent_payload without
    duplicating the OpenAPI parsing logic.
    """
    target_content = {
        "domainName": kg_doc_config.get("domainName"),
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


async def load_agent_config_from_minio(
    minio: MinioResourceClient,
    agent_id: str,
) -> AgentConfig | None:
    """Load digital employee config from MinIO and build AgentConfig."""
    employee_config = await minio.get_dig_employee_config(agent_id)
    if employee_config is None:
        logger.warning("Digital employee config not found in MinIO: %s", agent_id)
        return None

    rel_list = employee_config.get("relResourceList") or []
    kg_doc_rels = [r for r in rel_list if r.get("resourceBizType") == "KG_DOC"]
    if not kg_doc_rels:
        logger.warning("Digital employee %s has no KG_DOC resources in MinIO", agent_id)
        return None

    async def _fetch_and_convert(rel: dict[str, Any]) -> dict[str, Any] | None:
        resource_id = str(rel.get("resourceId", ""))
        if not resource_id:
            return None
        kg_config = await minio.get_kg_doc_config(resource_id)
        if kg_config is None:
            logger.warning(
                "KG_DOC config not found in MinIO for resourceId=%s", resource_id
            )
            return None
        return _kg_doc_to_skill_item(rel, kg_config)

    results = await asyncio.gather(*[_fetch_and_convert(r) for r in kg_doc_rels])
    skill_items = [r for r in results if r is not None]
    if not skill_items:
        logger.warning("Digital employee %s: all KG_DOC configs failed to load", agent_id)
        return None

    knowledge_bases = extract_knowledge_bases_from_agent_payload(skill_items)
    if not knowledge_bases:
        logger.warning("Digital employee %s has no valid knowledge bases from MinIO", agent_id)
        return None

    return AgentConfig(
        agent_id=str(agent_id),
        knowledge_bases={str(agent_id): knowledge_bases},
    )


async def resolve_call_kb_ids(
    minio: MinioResourceClient,
    call_kb_ids: list[Any],
) -> tuple[list[str], list[str]]:
    """Map a list of resourceIds to resourceCodes via MinIO KG_DOC configs.

    Returns (mapped_codes, failed_ids).  When failed_ids is non-empty the
    caller should treat the resolution as failed.
    """
    if not call_kb_ids:
        return [], []

    str_ids = [str(kid) for kid in call_kb_ids]

    async def _resolve_one(resource_id: str) -> str | None:
        config = await minio.get_kg_doc_config(resource_id)
        if config is None:
            return None
        code = config.get("resourceCode")
        if not code:
            logger.warning("KG_DOC_%s.json missing resourceCode field", resource_id)
            return None
        return str(code)

    results = await asyncio.gather(*[_resolve_one(rid) for rid in str_ids])
    codes: list[str] = []
    failed: list[str] = []
    for rid, code in zip(str_ids, results):
        if code is None:
            failed.append(rid)
        else:
            codes.append(code)
    return codes, failed
