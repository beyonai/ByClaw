import json
import pytest
from unittest.mock import AsyncMock, patch
from by_qa.qa.instant.runtime.operation_registry import OperationType

from redis_agent_config import (
    RESOURCE_DIG_EMPLOYEE_REDIS_KEY_PREFIX,
    build_dig_employee_redis_key,
    validate_dig_employee_skill_payload,
    _decode_redis_json,
    extract_knowledge_bases_from_agent_payload,
    convert_agent_config_to_engine_config,
    load_agent_config_from_redis,
)


# --- build_dig_employee_redis_key ---

def test_build_dig_employee_redis_key_format():
    key = build_dig_employee_redis_key("agent-123")
    assert key == f"{RESOURCE_DIG_EMPLOYEE_REDIS_KEY_PREFIX}agent-123"


# --- validate_dig_employee_skill_payload ---

def test_validate_payload_list_passes():
    payload = [{"resourceCode": "kb1", "resourceName": "KB One"}]
    result = validate_dig_employee_skill_payload(payload)
    assert result is payload


def test_validate_payload_non_list_raises():
    with pytest.raises(ValueError, match="must be a data list"):
        validate_dig_employee_skill_payload({"key": "value"})


def test_validate_payload_string_raises():
    with pytest.raises(ValueError):
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
    with pytest.raises(ValueError):
        _decode_redis_json(json.dumps({"key": "value"}))


# --- extract_knowledge_bases_from_agent_payload ---

def _make_kb_item(
    resource_code="kb1",
    resource_name="KB One",
    resource_desc="desc",
    domain_name="svc.local",
    operation_id=OperationType.SEARCH.value,
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
    assert OperationType.SEARCH in kb["urls"]


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
    assert OperationType.SEARCH not in result[0]["urls"]


def test_extract_knowledge_bases_legacy_knowledge_search_maps_to_search():
    payload = [_make_kb_item(operation_id="knowledgeSearch")]
    result = extract_knowledge_bases_from_agent_payload(payload)
    assert len(result) == 1
    assert result[0]["urls"][OperationType.SEARCH] == "/search"


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
        "urls": {OperationType.SEARCH: "/search"},
        "service_name": "svc.local",
    }
    config = _FakeAgentConfig({"agent1": [kb]})
    result = convert_agent_config_to_engine_config(config)
    kbs = result["retrieval"]["knowledge_bases"]
    assert len(kbs) == 1
    assert kbs[0]["kb_code"] == "kb1"
    assert kbs[0]["operations"] == {OperationType.SEARCH: "/search"}
    assert kbs[0]["service_name"] == "svc.local"


def test_convert_agent_config_missing_service_name_skipped():
    kb = {
        "kb_code": "kb1",
        "kb_name": "KB One",
        "kb_desc": "desc",
        "urls": {OperationType.SEARCH: "/search"},
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
        "urls": {OperationType.SEARCH: "/search"},
        "service_name": "svc.local",
        "headers": {"X-Token": "abc"},
    }
    config = _FakeAgentConfig({"agent1": [kb]})
    result = convert_agent_config_to_engine_config(config)
    assert result["retrieval"]["knowledge_bases"][0]["headers"] == {"X-Token": "abc"}


# --- load_agent_config_from_redis (async) ---

@pytest.mark.asyncio
async def test_load_agent_config_redis_returns_none(mock_redis):
    mock_redis.get.return_value = None
    result = await load_agent_config_from_redis(mock_redis, "agent-1")
    assert result is None


@pytest.mark.asyncio
async def test_load_agent_config_valid_payload(mock_redis):
    payload = [_make_kb_item()]
    mock_redis.get.return_value = json.dumps(payload).encode("utf-8")
    result = await load_agent_config_from_redis(mock_redis, "agent-1")
    assert result is not None
    assert result.agent_id == "agent-1"
    assert "agent-1" in result.knowledge_bases
