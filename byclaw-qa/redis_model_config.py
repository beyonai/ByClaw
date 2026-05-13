"""Redis-backed by_qa model config provider."""

from __future__ import annotations

import inspect
import json
import os
import asyncio
from dataclasses import fields, is_dataclass
from typing import Any

from by_qa.config import get_settings
from by_qa.core import logger
from by_qa.core.model_config import ModelConfig, ModelConfigProvider


AI_MODEL_TYPE_REDIS_KEY = "byai:aimodel:typelist"
LLM_MODEL_TYPE = "LLM"
EMBEDDING_MODEL_TYPE = "EMBEDDING"
LLM_REQUIRED_ABILITY = "6"

LLM_MODEL_TYPES = {
    "classifier",
    "retrieval",
    "generator",
    "quality",
    "decomposer",
    "aggregator",
}


class RedisModelConfigProvider(ModelConfigProvider):
    """Load by_qa model settings from the byclaw Redis model type hash."""

    def __init__(self, redis_client: Any | None = None):
        self._redis = redis_client or _create_redis_client_from_env()
        self._models_by_type: dict[str, list[dict[str, Any]]] = {}
        self._cache_loaded = False
        self._cache_lock = asyncio.Lock()

    async def load_cache(self) -> None:
        if self._cache_loaded:
            return
        async with self._cache_lock:
            if self._cache_loaded:
                return
            payload = await self._redis.hgetall(AI_MODEL_TYPE_REDIS_KEY)
            self._models_by_type = _decode_model_type_hash(payload)
            self._cache_loaded = True
            self._log_loaded_cache()

    async def get_config(self, model_type: str) -> ModelConfig:
        await self.load_cache()
        if model_type in LLM_MODEL_TYPES:
            model = await self._load_first_llm_model()
            return self._build_model_config(
                model,
                temperature=_extract_temperature(model),
            )
        if model_type == "embedding":
            settings = get_settings()
            model = await self._load_first_model_by_type(EMBEDDING_MODEL_TYPE)
            return self._build_model_config(
                model,
                temperature=0.0,
                dimension=_extract_embedding_dimension(
                    model,
                    fallback=getattr(settings, "embedding_dimension", None),
                ),
                distance_metric=getattr(settings, "embedding_distance_metric", None),
            )
        raise ValueError(f"Unknown model_type: {model_type!r}")

    async def _load_first_llm_model(self) -> dict[str, Any]:
        models = await self._load_models_by_type(LLM_MODEL_TYPE)
        for model in models:
            if LLM_REQUIRED_ABILITY in _extract_abilities(model):
                return model
        raise ValueError(
            f"No {LLM_MODEL_TYPE} model with ability {LLM_REQUIRED_ABILITY!r} "
            f"found in Redis key {AI_MODEL_TYPE_REDIS_KEY}"
        )

    async def _load_first_model_by_type(self, redis_model_type: str) -> dict[str, Any]:
        models = await self._load_models_by_type(redis_model_type)
        if not models:
            raise ValueError(
                f"No {redis_model_type} model found in Redis key {AI_MODEL_TYPE_REDIS_KEY}"
            )
        return models[0]

    async def _load_models_by_type(self, redis_model_type: str) -> list[dict[str, Any]]:
        models = self._models_by_type.get(redis_model_type, [])
        if not isinstance(models, list):
            raise ValueError(
                f"Redis model payload for {redis_model_type} must be a JSON list"
            )
        return [model for model in models if isinstance(model, dict)]

    def _build_model_config(
        self,
        model: dict[str, Any],
        *,
        temperature: float,
        dimension: int | None = None,
        distance_metric: str | None = None,
        batch_max_texts: int | None = None,
    ) -> ModelConfig:
        kwargs: dict[str, Any] = {
            "model_name": _first_non_empty(model.get("modelCode"), model.get("modelName")),
            "temperature": temperature,
            "base_url": _first_non_empty(model.get("url")),
            "api_key": _first_non_empty(model.get("authToken")),
            "dimension": dimension,
            "distance_metric": distance_metric,
            "batch_max_texts": batch_max_texts,
        }
        max_model_len = _parse_positive_int(model.get("maxContentToken"))
        if max_model_len is not None and _model_config_accepts("max_model_len"):
            kwargs["max_model_len"] = max_model_len
        return ModelConfig(**kwargs)

    def _log_loaded_cache(self) -> None:
        logger.info(
            "Loaded Redis model config: key=%s, model_configs=%s",
            AI_MODEL_TYPE_REDIS_KEY,
            _build_logged_model_configs(self._models_by_type),
        )


def _decode_redis_json(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, bytes):
        value = value.decode("utf-8")
    if isinstance(value, str):
        return json.loads(value)
    return value


def _decode_model_type_hash(payload: Any) -> dict[str, list[dict[str, Any]]]:
    if not payload:
        return {}
    if not isinstance(payload, dict):
        raise ValueError("Redis model type payload must be a hash")
    models_by_type: dict[str, list[dict[str, Any]]] = {}
    for raw_key, raw_value in payload.items():
        key = raw_key.decode("utf-8") if isinstance(raw_key, bytes) else str(raw_key)
        value = _decode_redis_json(raw_value)
        if not isinstance(value, list):
            raise ValueError(f"Redis model payload for {key} must be a JSON list")
        models_by_type[key] = [model for model in value if isinstance(model, dict)]
    return models_by_type


def _build_logged_model_configs(
    models_by_type: dict[str, list[dict[str, Any]]]
) -> dict[str, dict[str, Any]]:
    settings = get_settings()
    logged_configs: dict[str, dict[str, Any]] = {}
    llm_model = _select_first_llm_model(models_by_type.get(LLM_MODEL_TYPE, []))
    if llm_model is not None:
        logged_configs[LLM_MODEL_TYPE] = _model_config_log_fields(
            llm_model,
            temperature=_extract_temperature(llm_model),
        )
    embedding_models = models_by_type.get(EMBEDDING_MODEL_TYPE, [])
    if embedding_models:
        logged_configs[EMBEDDING_MODEL_TYPE] = _model_config_log_fields(
            embedding_models[0],
            temperature=0.0,
            dimension=_extract_embedding_dimension(
                embedding_models[0],
                fallback=getattr(settings, "embedding_dimension", None),
            ),
            distance_metric=getattr(settings, "embedding_distance_metric", None),
        )
    return {
        key: logged_configs[key]
        for key in sorted(logged_configs)
    }


def _select_first_llm_model(models: list[dict[str, Any]]) -> dict[str, Any] | None:
    for model in models:
        if LLM_REQUIRED_ABILITY in _extract_abilities(model):
            return model
    return None


def _model_config_log_fields(
    model: dict[str, Any],
    *,
    temperature: float,
    dimension: int | None = None,
    distance_metric: str | None = None,
) -> dict[str, Any]:
    fields_for_log: dict[str, Any] = {
        "model_name": _first_non_empty(model.get("modelCode"), model.get("modelName")),
        "temperature": temperature,
        "base_url": _first_non_empty(model.get("url")),
    }
    if dimension is not None:
        fields_for_log["dimension"] = dimension
    if distance_metric is not None:
        fields_for_log["distance_metric"] = distance_metric
    max_model_len = _parse_positive_int(model.get("maxContentToken"))
    if max_model_len is not None:
        fields_for_log["max_model_len"] = max_model_len
    return fields_for_log


def _extract_abilities(model: dict[str, Any]) -> set[str]:
    raw_abilities = model.get("abilities")
    if raw_abilities is None:
        instance_param = _decode_instance_param(model.get("instanceParam"))
        raw_abilities = instance_param.get("abilities")
    if not isinstance(raw_abilities, list):
        return set()
    return {str(ability) for ability in raw_abilities}


def _decode_instance_param(value: Any) -> dict[str, Any]:
    value = _decode_redis_json(value)
    if isinstance(value, dict):
        return value
    return {}


def _extract_temperature(model: dict[str, Any]) -> float:
    instance_param = _decode_instance_param(model.get("instanceParam"))
    try:
        return float(instance_param.get("temperature", 0.0))
    except (TypeError, ValueError):
        return 0.0


def _extract_embedding_dimension(model: dict[str, Any], *, fallback: Any = None) -> int | None:
    instance_param = _decode_instance_param(model.get("instanceParam"))
    parsed = _parse_positive_int(instance_param.get("dimensions"))
    if parsed is not None:
        return parsed
    return _parse_positive_int(fallback)


def _first_non_empty(*values: Any) -> str:
    for value in values:
        text = "" if value is None else str(value).strip()
        if text:
            return text
    return ""


def _parse_positive_int(value: Any) -> int | None:
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    if parsed <= 0:
        return None
    return parsed


def _model_config_accepts(field_name: str) -> bool:
    if is_dataclass(ModelConfig):
        return field_name in {field.name for field in fields(ModelConfig)}
    return field_name in inspect.signature(ModelConfig).parameters


def _create_redis_client_from_env() -> Any:
    import redis.asyncio as aioredis

    return aioredis.Redis(
        host=os.getenv("BYAI_REDIS_HOST", os.getenv("REDIS_HOST", "localhost")),
        port=int(os.getenv("BYAI_REDIS_PORT", os.getenv("REDIS_PORT", 6379))),
        db=int(
            os.getenv(
                "BYAI_REDIS_DB",
                os.getenv("REDIS_DATABASE", os.getenv("REDIS_DB", 0)),
            )
        ),
        username=os.getenv("BYAI_REDIS_USERNAME", os.getenv("REDIS_USERNAME")) or None,
        password=os.getenv("BYAI_REDIS_PASSWORD", os.getenv("REDIS_PASSWORD")) or None,
    )


__all__ = [
    "AI_MODEL_TYPE_REDIS_KEY",
    "RedisModelConfigProvider",
]
