from __future__ import annotations

import json
import logging
import os
from typing import Any

try:
    import redis
except ImportError:  # pragma: no cover - only used when dependency is missing locally
    redis = None

logger = logging.getLogger(__name__)

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

    cluster_hosts = (
        os.environ.get("DATACLOUD_GATEWAY_REDIS_CLUSTER_HOST", "").strip()
        or os.environ.get("REDIS_CLUSTER_HOST", "").strip()
    )
    if cluster_hosts:
        from redis.cluster import RedisCluster, ClusterNode
        startup_nodes = []
        for node in cluster_hosts.split(","):
            node = node.strip()
            if not node:
                continue
            host, _, port = node.rpartition(":")
            startup_nodes.append(ClusterNode(host, int(port) if port else 6379))
        return RedisCluster(
            startup_nodes=startup_nodes,
            password=os.environ.get("DATACLOUD_GATEWAY_REDIS_PASSWORD", "") or None,
            decode_responses=True,
        )

    return redis.Redis(
        host=os.environ.get("DATACLOUD_GATEWAY_REDIS_HOST", ""),
        port=_as_int("DATACLOUD_GATEWAY_REDIS_PORT", 6379),
        db=_as_int("DATACLOUD_GATEWAY_REDIS_DB", 0),
        username=os.environ.get("DATACLOUD_GATEWAY_REDIS_USERNAME", ""),
        password=os.environ.get("DATACLOUD_GATEWAY_REDIS_PASSWORD", ""),
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


def get_model_by_instance_id(client, instance_id: str | int) -> dict[str, Any] | None:
    """从 Redis LLM 列表中按 instanceId 精确匹配模型。未找到返回 None。"""
    if client is None:
        client = build_redis_client()
    target = str(instance_id).strip()
    for model in get_models_by_type(client, "LLM"):
        if str(model.get("instanceId") or "").strip() == target:
            return model
    return None


def get_default_llm(client) -> dict[str, Any] | None:
    if client is None:
        client = build_redis_client()

    dc_models = get_models_by_ability(client, "LLM", ABILITY_DATA_CLOUD)
    if dc_models:
        logger.debug(
            "[model_env] get_default_llm: found %d DATA_CLOUD LLM(s), using first: instanceId=%s modelCode=%s",
            len(dc_models),
            dc_models[0].get("instanceId"),
            dc_models[0].get("modelCode"),
        )
        return dc_models[0]

    llm_models = get_models_by_type(client, "LLM")
    logger.debug(
        "[model_env] get_default_llm: no DATA_CLOUD LLM found, scanning %d LLM(s) for default",
        len(llm_models),
    )
    for model in llm_models:
        if model.get("isDefault") == 1:
            logger.debug(
                "[model_env] get_default_llm: using isDefault model instanceId=%s modelCode=%s",
                model.get("instanceId"),
                model.get("modelCode"),
            )
            return model
    result = llm_models[0] if llm_models else None
    if result:
        logger.debug(
            "[model_env] get_default_llm: fallback to first LLM instanceId=%s modelCode=%s",
            result.get("instanceId"),
            result.get("modelCode"),
        )
    else:
        logger.warning("[model_env] get_default_llm: no LLM model found in Redis")
    return result


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
        logger.warning("[model_env] build_llm_config: no LLM model available, returning empty config")
        return {}
    instance_param = model.get("instanceParam") or {}
    auth_token = model.get("authToken")
    api_base = model.get("url")
    model_code = model.get("modelCode")
    logger.info(
        "[model_env] build_llm_config: instanceId=%s modelCode=%s url=%s authToken=%s",
        model.get("instanceId"),
        model_code,
        api_base,
        "***" if auth_token else "<EMPTY>",
    )
    if not auth_token:
        logger.warning(
            "[model_env] build_llm_config: authToken is empty for instanceId=%s modelCode=%s — "
            "LLM calls will fail with 401",
            model.get("instanceId"),
            model_code,
        )
    config: dict[str, Any] = {
        "DATACLOUD_LLM_MODEL": model_code,
        "DATACLOUD_LLM_API_BASE": api_base,
        "DATACLOUD_LLM_API_KEY": auth_token,
    }
    config["DATACLOUD_LLM_MODEL_PROVIDER"] = str(instance_param.get("providerName", "openai")).lower()
    config["DATACLOUD_LLM_TEMPERATURE"] = str(instance_param.get("temperature", "0.0"))
    if instance_param.get("extendParam") is not None:
        config["DATACLOUD_LLM_MODEL_KWARGS"] = json.dumps(
            instance_param.get("extendParam"), ensure_ascii=False
        )
    applied = _apply_config_to_environment(config)
    logger.debug("[model_env] build_llm_config: applied env keys=%s", sorted(applied.keys()))
    return applied


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
