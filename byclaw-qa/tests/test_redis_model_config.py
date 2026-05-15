import json
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from by_qa.core.model_config import LLMModelProfile
from exceptions import ModelConfigError, ModelNotFoundError
from redis_model_config import (
    AI_MODEL_TYPE_REDIS_KEY,
    AI_MODEL_CONFIG_REDIS_KEY,
    RedisModelConfigProvider,
    request_prologue_model_id,
    _decode_redis_json,
    _decode_model_type_hash,
    _extract_abilities,
    _extract_temperature,
    _extract_embedding_dimension,
    _first_non_empty,
    _parse_positive_int,
)


# --- _decode_redis_json ---

def test_decode_redis_json_none():
    assert _decode_redis_json(None) is None


def test_decode_redis_json_bytes():
    assert _decode_redis_json(b'{"key": "val"}') == {"key": "val"}


def test_decode_redis_json_str():
    assert _decode_redis_json('{"key": "val"}') == {"key": "val"}


def test_decode_redis_json_dict_passthrough():
    d = {"key": "val"}
    assert _decode_redis_json(d) is d


# --- _decode_model_type_hash ---

def test_decode_model_type_hash_empty():
    assert _decode_model_type_hash({}) == {}
    assert _decode_model_type_hash(None) == {}


def test_decode_model_type_hash_normal():
    models = [{"modelCode": "gpt4", "modelName": "GPT-4"}]
    payload = {b"LLM": json.dumps(models).encode("utf-8")}
    result = _decode_model_type_hash(payload)
    assert "LLM" in result
    assert result["LLM"] == models


def test_decode_model_type_hash_non_dict_raises():
    with pytest.raises(ModelConfigError, match="must be a hash"):
        _decode_model_type_hash("not a dict")


def test_decode_model_type_hash_non_list_value_raises():
    payload = {b"LLM": json.dumps({"not": "a list"}).encode("utf-8")}
    with pytest.raises(ModelConfigError, match="must be a JSON list"):
        _decode_model_type_hash(payload)


# --- _extract_abilities ---

def test_extract_abilities_direct_field():
    model = {"abilities": ["6", "7"]}
    assert _extract_abilities(model) == {"6", "7"}


def test_extract_abilities_from_instance_param():
    model = {"instanceParam": json.dumps({"abilities": ["6"]})}
    assert _extract_abilities(model) == {"6"}


def test_extract_abilities_missing_returns_empty():
    assert _extract_abilities({}) == set()


def test_extract_abilities_non_list_returns_empty():
    assert _extract_abilities({"abilities": "6"}) == set()


# --- _extract_temperature ---

def test_extract_temperature_normal():
    model = {"instanceParam": json.dumps({"temperature": 0.7})}
    assert _extract_temperature(model) == 0.7


def test_extract_temperature_missing_defaults_zero():
    assert _extract_temperature({}) == 0.0


def test_extract_temperature_invalid_defaults_zero():
    model = {"instanceParam": json.dumps({"temperature": "bad"})}
    assert _extract_temperature(model) == 0.0


# --- _extract_embedding_dimension ---

def test_extract_embedding_dimension_from_instance_param():
    model = {"instanceParam": json.dumps({"dimensions": 1536})}
    assert _extract_embedding_dimension(model) == 1536


def test_extract_embedding_dimension_fallback():
    assert _extract_embedding_dimension({}, fallback=768) == 768


def test_extract_embedding_dimension_negative_returns_none():
    model = {"instanceParam": json.dumps({"dimensions": -1})}
    assert _extract_embedding_dimension(model) is None


def test_extract_embedding_dimension_zero_returns_none():
    model = {"instanceParam": json.dumps({"dimensions": 0})}
    assert _extract_embedding_dimension(model) is None


# --- _first_non_empty ---

def test_first_non_empty_returns_first_non_empty():
    assert _first_non_empty(None, "", "hello", "world") == "hello"


def test_first_non_empty_all_empty_returns_empty_string():
    assert _first_non_empty(None, "", "  ") == ""


def test_first_non_empty_strips_whitespace():
    assert _first_non_empty("  hi  ") == "hi"


# --- _parse_positive_int ---

def test_parse_positive_int_normal():
    assert _parse_positive_int(42) == 42
    assert _parse_positive_int("100") == 100


def test_parse_positive_int_zero_returns_none():
    assert _parse_positive_int(0) is None


def test_parse_positive_int_negative_returns_none():
    assert _parse_positive_int(-5) is None


def test_parse_positive_int_non_numeric_returns_none():
    assert _parse_positive_int("abc") is None
    assert _parse_positive_int(None) is None


# --- RedisModelConfigProvider (async) ---

def _make_llm_model(model_code="gpt4", url="http://llm", token="key", abilities=None):
    if abilities is None:
        abilities = ["6"]
    return {
        "modelCode": model_code,
        "modelName": model_code,
        "url": url,
        "authToken": token,
        "abilities": abilities,
        "instanceParam": json.dumps({"temperature": 0.5}),
    }


def _make_embedding_model(model_code="emb", url="http://emb", token="key", dimensions=1536):
    return {
        "modelCode": model_code,
        "modelName": model_code,
        "url": url,
        "authToken": token,
        "instanceParam": json.dumps({"dimensions": dimensions}),
    }


def _make_redis_payload(llm_models=None, embedding_models=None):
    payload = {}
    if llm_models is not None:
        payload[b"LLM"] = json.dumps(llm_models).encode("utf-8")
    if embedding_models is not None:
        payload[b"EMBEDDING"] = json.dumps(embedding_models).encode("utf-8")
    return payload


@pytest.mark.asyncio
async def test_load_cache_idempotent(mock_redis):
    mock_redis.hgetall.return_value = _make_redis_payload(
        llm_models=[_make_llm_model()]
    )
    provider = RedisModelConfigProvider(mock_redis)
    await provider.load_cache()
    await provider.load_cache()
    mock_redis.hgetall.assert_called_once_with(AI_MODEL_TYPE_REDIS_KEY)


@pytest.mark.asyncio
async def test_get_config_llm_type(mock_redis):
    mock_redis.hgetall.return_value = _make_redis_payload(
        llm_models=[_make_llm_model()]
    )
    provider = RedisModelConfigProvider(mock_redis)
    with patch("redis_model_config.get_settings") as mock_settings:
        mock_settings.return_value = MagicMock(
            embedding_dimension=None, embedding_distance_metric=None
        )
        config = await provider.get_config("standard")
    assert config.model_name == "gpt4"
    assert config.base_url == "http://llm"
    assert config.temperature == 0.5


@pytest.mark.asyncio
async def test_get_config_lightweight_uses_same_llm_pool(mock_redis):
    mock_redis.hgetall.return_value = _make_redis_payload(
        llm_models=[_make_llm_model()]
    )
    provider = RedisModelConfigProvider(mock_redis)
    with patch("redis_model_config.get_settings") as mock_settings:
        mock_settings.return_value = MagicMock(
            embedding_dimension=None, embedding_distance_metric=None
        )
        config = await provider.get_config(LLMModelProfile.LIGHTWEIGHT)
    assert config.model_name == "gpt4"


@pytest.mark.asyncio
async def test_get_config_accepts_profile_enum(mock_redis):
    mock_redis.hgetall.return_value = _make_redis_payload(
        llm_models=[_make_llm_model()]
    )
    provider = RedisModelConfigProvider(mock_redis)
    with patch("redis_model_config.get_settings") as mock_settings:
        mock_settings.return_value = MagicMock(
            embedding_dimension=None, embedding_distance_metric=None
        )
        config = await provider.get_config(LLMModelProfile.STANDARD)
    assert config.model_name == "gpt4"


@pytest.mark.asyncio
async def test_get_config_embedding_type(mock_redis):
    mock_redis.hgetall.return_value = _make_redis_payload(
        embedding_models=[_make_embedding_model()]
    )
    provider = RedisModelConfigProvider(mock_redis)
    with patch("redis_model_config.get_settings") as mock_settings:
        mock_settings.return_value = MagicMock(
            embedding_dimension=None, embedding_distance_metric=None
        )
        config = await provider.get_config("embedding")
    assert config.model_name == "emb"
    assert config.dimension == 1536
    assert config.temperature == 0.0


@pytest.mark.asyncio
async def test_get_config_unknown_type_raises(mock_redis):
    mock_redis.hgetall.return_value = _make_redis_payload(
        llm_models=[_make_llm_model()]
    )
    provider = RedisModelConfigProvider(mock_redis)
    with pytest.raises(ModelConfigError, match="Unknown model_type"):
        await provider.get_config("classifier")


@pytest.mark.asyncio
async def test_get_config_no_llm_with_required_ability_raises(mock_redis):
    model = _make_llm_model(abilities=["1", "2"])
    mock_redis.hgetall.return_value = _make_redis_payload(llm_models=[model])
    provider = RedisModelConfigProvider(mock_redis)
    with pytest.raises(ModelNotFoundError, match="No LLM model"):
        await provider.get_config("standard")


# --- prologue_model_id priority ---

@pytest.mark.asyncio
async def test_get_config_uses_prologue_model_id_when_found(mock_redis):
    """prologue modelId 命中时，返回该模型而非 type-list 中的模型。"""
    prologue_model = _make_llm_model(model_code="prologue-model", url="http://prologue", token="pkey")
    typelist_model = _make_llm_model(model_code="typelist-model", url="http://typelist", token="tkey")
    mock_redis.hgetall.return_value = _make_redis_payload(llm_models=[typelist_model])
    mock_redis.hget.return_value = json.dumps(prologue_model).encode("utf-8")

    token = request_prologue_model_id.set("42")
    try:
        provider = RedisModelConfigProvider(mock_redis)
        with patch("redis_model_config.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                embedding_dimension=None, embedding_distance_metric=None
            )
            config = await provider.get_config("standard")
    finally:
        request_prologue_model_id.reset(token)

    assert config.model_name == "prologue-model"
    assert config.base_url == "http://prologue"
    mock_redis.hget.assert_called_once_with(AI_MODEL_CONFIG_REDIS_KEY, "42")


@pytest.mark.asyncio
async def test_get_config_falls_back_when_prologue_model_id_not_found(mock_redis):
    """prologue modelId 在 Redis 中不存在时，回退到 type-list 逻辑。"""
    typelist_model = _make_llm_model(model_code="typelist-model", url="http://typelist", token="tkey")
    mock_redis.hgetall.return_value = _make_redis_payload(llm_models=[typelist_model])
    mock_redis.hget.return_value = None  # 未命中

    token = request_prologue_model_id.set("99")
    try:
        provider = RedisModelConfigProvider(mock_redis)
        with patch("redis_model_config.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                embedding_dimension=None, embedding_distance_metric=None
            )
            config = await provider.get_config("standard")
    finally:
        request_prologue_model_id.reset(token)

    assert config.model_name == "typelist-model"
    mock_redis.hget.assert_called_once_with(AI_MODEL_CONFIG_REDIS_KEY, "99")


@pytest.mark.asyncio
async def test_get_config_no_prologue_model_id_uses_type_list(mock_redis):
    """request_prologue_model_id 未设置时，直接走 type-list 逻辑，不调用 hget。"""
    typelist_model = _make_llm_model(model_code="typelist-model", url="http://typelist", token="tkey")
    mock_redis.hgetall.return_value = _make_redis_payload(llm_models=[typelist_model])

    # ContextVar 默认为 None，不需要额外设置
    provider = RedisModelConfigProvider(mock_redis)
    with patch("redis_model_config.get_settings") as mock_settings:
        mock_settings.return_value = MagicMock(
            embedding_dimension=None, embedding_distance_metric=None
        )
        config = await provider.get_config("standard")

    assert config.model_name == "typelist-model"
    mock_redis.hget.assert_not_called()
