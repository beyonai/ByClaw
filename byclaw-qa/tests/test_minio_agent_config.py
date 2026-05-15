"""Tests for minio_agent_config.py."""

import json
import pytest
from unittest.mock import AsyncMock, patch

from minio_agent_config import (
    _kg_doc_to_skill_item,
    extract_prologue_model_id,
    load_agent_config_from_minio,
    resolve_call_kb_ids,
)


# --- _kg_doc_to_skill_item ---

def test_kg_doc_to_skill_item_builds_redis_format():
    rel = {
        "resourceCode": "1",
        "resourceName": "test-kb",
        "resourceDesc": "test description",
    }
    kg_config = {
        "domainName": "qa-service",
        "headers": {"X-Token": "abc"},
        "resourceService": [{"openapiSchema": {"paths": {}}}],
    }
    result = _kg_doc_to_skill_item(rel, kg_config)

    assert result["resourceCode"] == "1"
    assert result["resourceName"] == "test-kb"
    assert result["resourceDesc"] == "test description"

    target = json.loads(result["extDoc"]["targetContent"])
    assert target["domainName"] == "qa-service"
    assert target["headers"] == {"X-Token": "abc"}
    assert len(target["resourceService"]) == 1


def test_kg_doc_to_skill_item_handles_missing_fields():
    rel = {"resourceCode": "2"}
    kg_config = {}
    result = _kg_doc_to_skill_item(rel, kg_config)

    assert result["resourceCode"] == "2"
    assert result["resourceName"] is None
    target = json.loads(result["extDoc"]["targetContent"])
    assert target["domainName"] is None
    assert target["resourceService"] == []


# --- load_agent_config_from_minio ---

def _make_minio_mock() -> AsyncMock:
    mock = AsyncMock()
    mock.get_dig_employee_config = AsyncMock()
    mock.get_kg_doc_config = AsyncMock()
    return mock


def _make_kg_doc_config(resource_code="1", domain="qa-service"):
    return {
        "resourceCode": resource_code,
        "domainName": domain,
        "headers": {},
        "resourceService": [
            {
                "openapiSchema": {
                    "paths": {
                        "/api/v1/knowledge-items/search": {
                            "post": {"operationId": "knowledgeSearch"}
                        }
                    }
                }
            }
        ],
    }


def _make_dig_employee_config(rel_resources=None):
    return {
        "resourceId": "10000432",
        "resourceName": "test-employee",
        "relResourceList": rel_resources or [],
    }


@pytest.mark.asyncio
async def test_load_config_employee_not_found():
    minio = _make_minio_mock()
    minio.get_dig_employee_config.return_value = None

    result = await load_agent_config_from_minio(minio, "999")
    assert result is None


@pytest.mark.asyncio
async def test_load_config_no_kg_doc_resources():
    minio = _make_minio_mock()
    minio.get_dig_employee_config.return_value = _make_dig_employee_config(
        rel_resources=[{"resourceBizType": "TOOLKIT", "resourceId": "100"}]
    )

    result = await load_agent_config_from_minio(minio, "432")
    assert result is None


@pytest.mark.asyncio
async def test_load_config_kg_doc_config_fetch_fails():
    minio = _make_minio_mock()
    minio.get_dig_employee_config.return_value = _make_dig_employee_config(
        rel_resources=[
            {"resourceBizType": "KG_DOC", "resourceId": "10000003", "resourceCode": "1",
             "resourceName": "kb1", "resourceDesc": "desc"},
        ]
    )
    minio.get_kg_doc_config.return_value = None

    result = await load_agent_config_from_minio(minio, "432")
    assert result is None


@pytest.mark.asyncio
async def test_load_config_success_single_kb():
    minio = _make_minio_mock()
    minio.get_dig_employee_config.return_value = _make_dig_employee_config(
        rel_resources=[
            {"resourceBizType": "KG_DOC", "resourceId": "10000003", "resourceCode": "1",
             "resourceName": "kb1", "resourceDesc": "desc1"},
        ]
    )
    minio.get_kg_doc_config.return_value = _make_kg_doc_config("1", "qa-svc")

    result = await load_agent_config_from_minio(minio, "432")
    assert result is not None
    assert result.agent_id == "432"
    kbs = result.knowledge_bases["432"]
    assert len(kbs) == 1
    assert kbs[0]["kb_code"] == "1"
    assert kbs[0]["kb_name"] == "kb1"
    assert kbs[0]["service_name"] == "qa-svc"


@pytest.mark.asyncio
async def test_load_config_success_multiple_kbs():
    minio = _make_minio_mock()
    minio.get_dig_employee_config.return_value = _make_dig_employee_config(
        rel_resources=[
            {"resourceBizType": "KG_DOC", "resourceId": "10000003", "resourceCode": "1",
             "resourceName": "kb1", "resourceDesc": "d1"},
            {"resourceBizType": "KG_DOC", "resourceId": "10000004", "resourceCode": "2",
             "resourceName": "kb2", "resourceDesc": "d2"},
            {"resourceBizType": "TOOLKIT", "resourceId": "10000005"},
        ]
    )
    minio.get_kg_doc_config.side_effect = [
        _make_kg_doc_config("1", "svc1"),
        _make_kg_doc_config("2", "svc2"),
    ]

    result = await load_agent_config_from_minio(minio, "432")
    assert result is not None
    kbs = result.knowledge_bases["432"]
    assert len(kbs) == 2
    assert {kb["kb_code"] for kb in kbs} == {"1", "2"}


@pytest.mark.asyncio
async def test_load_config_partial_failure_still_returns():
    minio = _make_minio_mock()
    minio.get_dig_employee_config.return_value = _make_dig_employee_config(
        rel_resources=[
            {"resourceBizType": "KG_DOC", "resourceId": "10000003", "resourceCode": "1",
             "resourceName": "kb1", "resourceDesc": "d1"},
            {"resourceBizType": "KG_DOC", "resourceId": "10000004", "resourceCode": "2",
             "resourceName": "kb2", "resourceDesc": "d2"},
        ]
    )
    minio.get_kg_doc_config.side_effect = [
        _make_kg_doc_config("1", "svc1"),
        None,
    ]

    result = await load_agent_config_from_minio(minio, "432")
    assert result is not None
    kbs = result.knowledge_bases["432"]
    assert len(kbs) == 1
    assert kbs[0]["kb_code"] == "1"


# --- resolve_call_kb_ids ---

@pytest.mark.asyncio
async def test_resolve_call_kb_ids_none_input():
    minio = _make_minio_mock()
    codes, failed = await resolve_call_kb_ids(minio, None)
    assert codes == []
    assert failed == []


@pytest.mark.asyncio
async def test_resolve_call_kb_ids_empty_list():
    minio = _make_minio_mock()
    codes, failed = await resolve_call_kb_ids(minio, [])
    assert codes == []
    assert failed == []


@pytest.mark.asyncio
async def test_resolve_call_kb_ids_success():
    minio = _make_minio_mock()
    minio.get_kg_doc_config.side_effect = [
        {"resourceCode": "1"},
        {"resourceCode": "2"},
    ]

    codes, failed = await resolve_call_kb_ids(minio, [10000003, 10000004])
    assert codes == ["1", "2"]
    assert failed == []


@pytest.mark.asyncio
async def test_resolve_call_kb_ids_one_fails():
    minio = _make_minio_mock()
    minio.get_kg_doc_config.side_effect = [
        {"resourceCode": "1"},
        None,
    ]

    codes, failed = await resolve_call_kb_ids(minio, [10000003, 10000004])
    assert codes == ["1"]
    assert failed == ["10000004"]


@pytest.mark.asyncio
async def test_resolve_call_kb_ids_missing_resource_code():
    minio = _make_minio_mock()
    minio.get_kg_doc_config.return_value = {"resourceId": 10000003}

    codes, failed = await resolve_call_kb_ids(minio, [10000003])
    assert codes == []
    assert failed == ["10000003"]


# --- extract_prologue_model_id ---


def test_extract_prologue_model_id_normal():
    config = {"prologue": json.dumps({"modelInfo": {"modelId": -2000}})}
    assert extract_prologue_model_id(config) == "-2000"


def test_extract_prologue_model_id_none_config():
    assert extract_prologue_model_id(None) is None


def test_extract_prologue_model_id_missing_prologue():
    assert extract_prologue_model_id({"other": "field"}) is None


def test_extract_prologue_model_id_missing_model_id():
    config = {"prologue": json.dumps({"modelInfo": {}})}
    assert extract_prologue_model_id(config) is None


def test_extract_prologue_model_id_invalid_json():
    config = {"prologue": "not-json"}
    assert extract_prologue_model_id(config) is None


def test_extract_prologue_model_id_dict_prologue():
    """prologue 已经是 dict（非字符串）时也能处理。"""
    config = {"prologue": {"modelInfo": {"modelId": 100}}}
    assert extract_prologue_model_id(config) == "100"
