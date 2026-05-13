from __future__ import annotations

import json
import os
from typing import Any

try:
    import redis
except ImportError:  # pragma: no cover - only used when dependency is missing locally
    redis = None

KEY = "byai:aimodel:typelist"

# MODEL_TAGS: paramValue -> 用途
ABILITY_CHAT_MODEL = "1"
ABILITY_BY_CLAW = "2"
ABILITY_DEFAULT_CHAT = "3"
ABILITY_RERANK = "4"
ABILITY_DATA_CLOUD = "5"
ABILITY_QA = "6"


def _as_int(key: str, default: int) -> int:
    raw = os.environ.get(key, "").strip()
    return int(raw) if raw else default


def build_redis_client():
    if redis is None:
        raise RuntimeError("redis package is not installed")
    return redis.Redis(
        host=os.environ.get("DATACLOUD_GATEWAY_REDIS_HOST", "10.10.168.204"),
        port=_as_int("DATACLOUD_GATEWAY_REDIS_PORT", 6379),
        db=_as_int("DATACLOUD_GATEWAY_REDIS_DB", 0),
        username=os.environ.get("DATACLOUD_GATEWAY_REDIS_USERNAME", "default"),
        password=os.environ.get("DATACLOUD_GATEWAY_REDIS_PASSWORD", "admin123"),
        decode_responses=True,
    )


def get_models_by_type(client, model_type: str) -> list[dict[str, Any]]:
    data = client.hget(KEY, model_type)
    if not data:
        return []
    payload = json.loads(data)
    return payload if isinstance(payload, list) else []


def get_models_by_ability(client, model_type: str, ability: str) -> list[dict[str, Any]]:
    """从指定 modelType 列表中，筛选 instanceParam.abilities 包含指定标签的模型。"""
    return [
        model
        for model in get_models_by_type(client, model_type)
        if ability in (model.get("instanceParam") or {}).get("abilities", [])
    ]


def get_default_llm(client) -> dict[str, Any] | None:
    if client is None:
        client = build_redis_client()

    dc_models = get_models_by_ability(client, "LLM", ABILITY_DATA_CLOUD)
    if dc_models:
        return dc_models[0]

    llm_models = get_models_by_type(client, "LLM")
    for model in llm_models:
        if model.get("isDefault") == 1:
            return model
    return llm_models[0] if llm_models else None


def get_default_embedding(client) -> dict[str, Any] | None:
    if client is None:
        client = build_redis_client()
    embedding_models = get_models_by_ability(client, "EMBEDDING", ABILITY_DATA_CLOUD)
    if embedding_models:
        return embedding_models[0]

    embedding_models = get_models_by_type(client, "EMBEDDING")
    for model in embedding_models:
        if model.get("isDefault") == 1:
            return model
    return embedding_models[0] if embedding_models else None


def get_default_rerank(client) -> dict[str, Any] | None:
    if client is None:
        client = build_redis_client()
    rerank_models = get_models_by_ability(client, "RERANK", ABILITY_DATA_CLOUD)
    if rerank_models:
        return rerank_models[0]

    rerank_models = get_models_by_type(client, "RERANK")
    for model in rerank_models:
        if model.get("isDefault") == 1:
            return model
    return rerank_models[0] if rerank_models else None


def _apply_config_to_environment(config: dict[str, Any]) -> dict[str, str]:
    applied_config: dict[str, str] = {}
    for key, value in config.items():
        if value is None:
            continue
        text = value if isinstance(value, str) else str(value)
        os.environ[key] = text
        applied_config[key] = text
    return applied_config


def build_llm_config(model: dict[str, Any] | None) -> dict[str, Any] | None:
    if os.environ.get("DATACLOUD_LLM_MODEL_LOAD_MODE", "ONLINE") == "LOCAL":
        return None
    if not model:
        model = get_default_llm(None)
    if not model:
        return {}
    instance_param = model.get("instanceParam") or {}
    config: dict[str, Any] = {
        "DATACLOUD_LLM_MODEL": model.get("modelCode"),
        "DATACLOUD_LLM_API_BASE": model.get("url"),
        "DATACLOUD_LLM_API_KEY": model.get("authToken"),
    }
    config["DATACLOUD_LLM_MODEL_PROVIDER"] = str(instance_param.get("providerName", "openai")).lower()
    config["DATACLOUD_LLM_TEMPERATURE"] = str(instance_param.get("temperature", "0.0"))
    if instance_param.get("extends") is not None:
        config["DATACLOUD_LLM_MODEL_KWARGS"] = json.dumps(
            instance_param.get("extends"), ensure_ascii=False
        )
    return _apply_config_to_environment(config)


def build_embedding_config(model: dict[str, Any] | None) -> dict[str, Any] | None:
    if os.environ.get("DATACLOUD_LLM_MODEL_LOAD_MODE", "ONLINE") == "LOCAL":
        return None
    if not model:
        model = get_default_embedding(None)
    if not model:
        return {}

    instance_param = model.get("instanceParam") or {}
    config: dict[str, Any] = {
        "DATACLOUD_EMBEDDING_MODEL_ID": model.get("instanceId"),
        "DATACLOUD_EMBEDDING_MODEL": model.get("modelCode"),
        "DATACLOUD_EMBEDDING_API_BASE": model.get("url"),
        "DATACLOUD_EMBEDDING_API_KEY": model.get("authToken"),
    }

    dims = (
        instance_param.get("dimensions")
        or instance_param.get("dimension")
        or instance_param.get("dims")
    )
    if dims is not None:
        config["DATACLOUD_EMBEDDING_DIMS"] = str(dims)
    else:
        config["DATACLOUD_EMBEDDING_DIMS"] = "1024"

    return _apply_config_to_environment(config)


def build_rerank_config(model: dict[str, Any] | None) -> dict[str, Any] | None:
    if os.environ.get("DATACLOUD_LLM_MODEL_LOAD_MODE", "ONLINE") == "LOCAL":
        return None
    if not model:
        model = get_default_embedding(None)
    if not model:
        return {}

    config: dict[str, Any] = {
        "DATACLOUD_RERANK_MODEL_ID": model.get("instanceId"),
        "DATACLOUD_RERANK_MODEL": model.get("modelCode"),
        "DATACLOUD_RERANK_API_BASE": model.get("url"),
        "DATACLOUD_RERANK_API_KEY": model.get("authToken"),
    }

    return _apply_config_to_environment(config)


def main() -> None:
    client = build_redis_client()

    build_llm_config(get_default_llm(client))
    build_embedding_config(get_default_embedding(client))


if __name__ == "__main__":
    main()
