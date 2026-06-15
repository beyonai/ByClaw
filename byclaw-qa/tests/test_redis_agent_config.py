import json
import pytest
from unittest.mock import AsyncMock, patch
from by_qa.qa.common.operation_registry import OperationType

from exceptions import ModelConfigError
from redis_agent_config import (
    validate_dig_employee_skill_payload,
    _decode_redis_json,
    _decode_redis_json_dict,
    _kg_doc_to_skill_item,
    extract_knowledge_bases_from_agent_payload,
    convert_agent_config_to_engine_config,
    load_agent_config_from_redis,
    get_dig_employee_from_redis,
    get_kg_doc_from_redis,
    extract_prologue_model_id,
)


# --- validate_dig_employee_skill_payload ---

def test_validate_payload_list_passes():
    payload = [{"resourceCode": "kb1", "resourceName": "KB One"}]
    result = validate_dig_employee_skill_payload(payload)
    assert result is payload


def test_validate_payload_non_list_raises():
    with pytest.raises(ModelConfigError, match="must be a data list"):
        validate_dig_employee_skill_payload({"key": "value"})


def test_validate_payload_string_raises():
    with pytest.raises(ModelConfigError):
        validate_dig_employee_skill_payload("not a list")


# --- _decode_redis_json ---

def test_decode_redis_json_none_returns_none():
    assert _decode_redis_json(None) is None


def test_decode_redis_json_bytes():
    data = [{"resourceCode": "kb1", "resourceName": "KB One"}]
    result = _decode_redis_json(json.dumps(data).encode("utf-8"))
    assert result == data


def test_decode_redis_json_str():
    data = [{"resourceCode": "kb1", "resourceName": "KB One"}]
    result = _decode_redis_json(json.dumps(data))
    assert result == data


def test_decode_redis_json_already_list():
    data = [{"resourceCode": "kb1", "resourceName": "KB One"}]
    result = _decode_redis_json(data)
    assert result == data


def test_decode_redis_json_non_list_raises():
    with pytest.raises(ModelConfigError):
        _decode_redis_json(json.dumps({"key": "value"}))


# --- _decode_redis_json_dict ---

def test_decode_redis_json_dict_none_returns_none():
    assert _decode_redis_json_dict(None) is None


def test_decode_redis_json_dict_bytes():
    data = {"resourceCode": "kb1", "resourceName": "KB One"}
    result = _decode_redis_json_dict(json.dumps(data).encode("utf-8"))
    assert result == data


def test_decode_redis_json_dict_str():
    data = {"resourceCode": "kb1", "resourceName": "KB One"}
    result = _decode_redis_json_dict(json.dumps(data))
    assert result == data


def test_decode_redis_json_dict_already_dict():
    data = {"resourceCode": "kb1"}
    result = _decode_redis_json_dict(data)
    assert result == data


def test_decode_redis_json_dict_non_dict_returns_none():
    assert _decode_redis_json_dict(json.dumps([1, 2, 3])) is None


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


# --- extract_knowledge_bases_from_agent_payload ---

def _make_kb_item(
    resource_code="kb1",
    resource_name="KB One",
    resource_desc="desc",
    domain_name="svc.local",
    operation_id=OperationType.KNOWLEDGE_SEARCH.value,
    path="/search",
    headers=None,
):
    target_content = {
        "domainName": domain_name,
        "resourceService": [
            {
                "openapiSchema": {
                    "paths": {
                        path: {
                            "post": {"operationId": operation_id}
                        }
                    }
                }
            }
        ],
    }
    if headers is not None:
        target_content["headers"] = headers
    return {
        "resourceCode": resource_code,
        "resourceName": resource_name,
        "resourceDesc": resource_desc,
        "extDoc": {"targetContent": json.dumps(target_content)},
    }


def test_extract_knowledge_bases_normal():
    payload = [_make_kb_item()]
    result = extract_knowledge_bases_from_agent_payload(payload)
    assert len(result) == 1
    kb = result[0]
    assert kb["kb_code"] == "kb1"
    assert kb["kb_name"] == "KB One"
    assert kb["service_name"] == "svc.local"
    assert OperationType.KNOWLEDGE_SEARCH in kb["urls"]


def test_extract_knowledge_bases_missing_resource_code_skipped():
    payload = [_make_kb_item(resource_code="")]
    result = extract_knowledge_bases_from_agent_payload(payload)
    assert result == []


def test_extract_knowledge_bases_missing_resource_name_skipped():
    payload = [_make_kb_item(resource_name="")]
    result = extract_knowledge_bases_from_agent_payload(payload)
    assert result == []


def test_extract_knowledge_bases_unknown_action_skipped():
    payload = [_make_kb_item(operation_id="unknownAction")]
    result = extract_knowledge_bases_from_agent_payload(payload)
    assert len(result) == 1
    assert OperationType.KNOWLEDGE_SEARCH not in result[0]["urls"]


def test_extract_knowledge_bases_legacy_knowledge_search_maps_to_search():
    payload = [_make_kb_item(operation_id="knowledgeSearch")]
    result = extract_knowledge_bases_from_agent_payload(payload)
    assert len(result) == 1
    assert result[0]["urls"][OperationType.KNOWLEDGE_SEARCH] == "/search"


def test_extract_knowledge_bases_headers_passed_through():
    headers = {"Authorization": "Bearer token"}
    payload = [_make_kb_item(headers=headers)]
    result = extract_knowledge_bases_from_agent_payload(payload)
    assert result[0]["headers"] == headers


def test_extract_knowledge_bases_no_headers_key_absent():
    payload = [_make_kb_item()]
    result = extract_knowledge_bases_from_agent_payload(payload)
    assert "headers" not in result[0]


def test_extract_knowledge_bases_empty_payload():
    assert extract_knowledge_bases_from_agent_payload([]) == []


def test_extract_knowledge_bases_none_payload():
    assert extract_knowledge_bases_from_agent_payload(None) == []


# --- convert_agent_config_to_engine_config ---

class _FakeAgentConfig:
    def __init__(self, knowledge_bases):
        self.knowledge_bases = knowledge_bases


def test_convert_agent_config_normal():
    kb = {
        "kb_code": "kb1",
        "kb_name": "KB One",
        "kb_desc": "desc",
        "urls": {OperationType.KNOWLEDGE_SEARCH: "/search"},
        "service_name": "svc.local",
    }
    config = _FakeAgentConfig({"agent1": [kb]})
    result = convert_agent_config_to_engine_config(config)
    kbs = result["retrieval"]["knowledge_bases"]
    assert len(kbs) == 1
    assert kbs[0]["kb_code"] == "kb1"
    assert kbs[0]["operations"] == {OperationType.KNOWLEDGE_SEARCH: "/search"}
    assert kbs[0]["service_name"] == "svc.local"


def test_convert_agent_config_missing_service_name_skipped():
    kb = {
        "kb_code": "kb1",
        "kb_name": "KB One",
        "kb_desc": "desc",
        "urls": {OperationType.KNOWLEDGE_SEARCH: "/search"},
        "service_name": None,
    }
    config = _FakeAgentConfig({"agent1": [kb]})
    result = convert_agent_config_to_engine_config(config)
    assert result["retrieval"]["knowledge_bases"] == []


def test_convert_agent_config_missing_kb_url_skipped():
    kb = {
        "kb_code": "kb1",
        "kb_name": "KB One",
        "kb_desc": "desc",
        "urls": {},
        "service_name": "svc.local",
    }
    config = _FakeAgentConfig({"agent1": [kb]})
    result = convert_agent_config_to_engine_config(config)
    assert result["retrieval"]["knowledge_bases"] == []


def test_convert_agent_config_headers_passed_through():
    kb = {
        "kb_code": "kb1",
        "kb_name": "KB One",
        "kb_desc": "desc",
        "urls": {OperationType.KNOWLEDGE_SEARCH: "/search"},
        "service_name": "svc.local",
        "headers": {"X-Token": "abc"},
    }
    config = _FakeAgentConfig({"agent1": [kb]})
    result = convert_agent_config_to_engine_config(config)
    assert result["retrieval"]["knowledge_bases"][0]["headers"] == {"X-Token": "abc"}


# --- get_dig_employee_from_redis ---

@pytest.mark.asyncio
async def test_get_dig_employee_redis_key_format():
    redis = AsyncMock()
    redis.get.return_value = json.dumps({"resourceId": "100", "resourceName": "test"}).encode("utf-8")
    result = await get_dig_employee_from_redis(redis, "agent-1")
    redis.get.assert_called_once_with("DIG_EMPLOYEE_agent-1")
    assert result == {"resourceId": "100", "resourceName": "test"}


@pytest.mark.asyncio
async def test_get_dig_employee_redis_returns_none_on_miss():
    redis = AsyncMock()
    redis.get.return_value = None
    result = await get_dig_employee_from_redis(redis, "agent-1")
    assert result is None


@pytest.mark.asyncio
async def test_get_dig_employee_redis_handles_exception():
    redis = AsyncMock()
    redis.get.side_effect = Exception("connection refused")
    result = await get_dig_employee_from_redis(redis, "agent-1")
    assert result is None


# --- get_kg_doc_from_redis ---

@pytest.mark.asyncio
async def test_get_kg_doc_redis_key_format():
    redis = AsyncMock()
    redis.get.return_value = json.dumps({"resourceCode": "1", "domainName": "qa"}).encode("utf-8")
    result = await get_kg_doc_from_redis(redis, "10000003")
    redis.get.assert_called_once_with("KG_DOC_10000003")
    assert result == {"resourceCode": "1", "domainName": "qa"}


@pytest.mark.asyncio
async def test_get_kg_doc_redis_returns_none_on_miss():
    redis = AsyncMock()
    redis.get.return_value = None
    result = await get_kg_doc_from_redis(redis, "10000003")
    assert result is None


@pytest.mark.asyncio
async def test_get_kg_doc_redis_handles_exception():
    redis = AsyncMock()
    redis.get.side_effect = Exception("connection refused")
    result = await get_kg_doc_from_redis(redis, "10000003")
    assert result is None


# --- load_agent_config_from_redis (async, new two-step flow) ---

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
async def test_load_agent_config_redis_employee_not_found():
    redis = AsyncMock()
    redis.get.return_value = None
    agent_config, employee_config = await load_agent_config_from_redis(redis, "999")
    assert agent_config is None
    assert employee_config is None


@pytest.mark.asyncio
async def test_load_agent_config_redis_no_kg_doc_resources():
    redis = AsyncMock()
    redis.get.return_value = json.dumps(_make_dig_employee_config(
        rel_resources=[{"resourceBizType": "TOOLKIT", "resourceId": "100"}]
    )).encode("utf-8")
    agent_config, employee_config = await load_agent_config_from_redis(redis, "432")
    assert agent_config is None
    assert employee_config is not None


@pytest.mark.asyncio
async def test_load_agent_config_redis_kg_doc_fetch_fails():
    redis = AsyncMock()
    redis.get.side_effect = [
        json.dumps(_make_dig_employee_config(
            rel_resources=[
                {"resourceBizType": "KG_DOC", "resourceId": "10000003", "resourceCode": "1",
                 "resourceName": "kb1", "resourceDesc": "desc"},
            ]
        )).encode("utf-8"),
        None,
    ]
    agent_config, employee_config = await load_agent_config_from_redis(redis, "432")
    assert agent_config is None
    assert employee_config is not None


@pytest.mark.asyncio
async def test_load_agent_config_redis_success_single_kb():
    redis = AsyncMock()
    redis.get.side_effect = [
        json.dumps(_make_dig_employee_config(
            rel_resources=[
                {"resourceBizType": "KG_DOC", "resourceId": "10000003", "resourceCode": "1",
                 "resourceName": "kb1", "resourceDesc": "desc1"},
            ]
        )).encode("utf-8"),
        json.dumps(_make_kg_doc_config("1", "qa-svc")).encode("utf-8"),
    ]
    agent_config, employee_config = await load_agent_config_from_redis(redis, "432")
    assert agent_config is not None
    assert employee_config is not None
    assert agent_config.agent_id == "432"
    kbs = agent_config.knowledge_bases["432"]
    assert len(kbs) == 1
    assert kbs[0]["kb_code"] == "1"
    assert kbs[0]["kb_name"] == "kb1"
    assert kbs[0]["service_name"] == "qa-svc"


@pytest.mark.asyncio
async def test_load_agent_config_redis_success_multiple_kbs():
    redis = AsyncMock()
    redis.get.side_effect = [
        json.dumps(_make_dig_employee_config(
            rel_resources=[
                {"resourceBizType": "KG_DOC", "resourceId": "10000003", "resourceCode": "1",
                 "resourceName": "kb1", "resourceDesc": "d1"},
                {"resourceBizType": "KG_DOC", "resourceId": "10000004", "resourceCode": "2",
                 "resourceName": "kb2", "resourceDesc": "d2"},
                {"resourceBizType": "TOOLKIT", "resourceId": "10000005"},
            ]
        )).encode("utf-8"),
        json.dumps(_make_kg_doc_config("1", "svc1")).encode("utf-8"),
        json.dumps(_make_kg_doc_config("2", "svc2")).encode("utf-8"),
    ]
    agent_config, employee_config = await load_agent_config_from_redis(redis, "432")
    assert agent_config is not None
    assert employee_config is not None
    kbs = agent_config.knowledge_bases["432"]
    assert len(kbs) == 2
    assert {kb["kb_code"] for kb in kbs} == {"1", "2"}


@pytest.mark.asyncio
async def test_load_agent_config_redis_partial_failure_still_returns():
    redis = AsyncMock()
    redis.get.side_effect = [
        json.dumps(_make_dig_employee_config(
            rel_resources=[
                {"resourceBizType": "KG_DOC", "resourceId": "10000003", "resourceCode": "1",
                 "resourceName": "kb1", "resourceDesc": "d1"},
                {"resourceBizType": "KG_DOC", "resourceId": "10000004", "resourceCode": "2",
                 "resourceName": "kb2", "resourceDesc": "d2"},
            ]
        )).encode("utf-8"),
        json.dumps(_make_kg_doc_config("1", "svc1")).encode("utf-8"),
        None,
    ]
    agent_config, employee_config = await load_agent_config_from_redis(redis, "432")
    assert agent_config is not None
    assert employee_config is not None
    kbs = agent_config.knowledge_bases["432"]
    assert len(kbs) == 1
    assert kbs[0]["kb_code"] == "1"


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
    """prologue is already a dict (not a string)."""
    config = {"prologue": {"modelInfo": {"modelId": 100}}}
    assert extract_prologue_model_id(config) == "100"
