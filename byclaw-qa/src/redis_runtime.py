"""Shared Redis runtime helpers for byclaw-qa."""

from __future__ import annotations

from typing import Any

from by_framework.common.config import RedisConfig
from by_framework.common.redis_client import init_redis

from by_qa.core import logger


def load_redis_config_from_env() -> RedisConfig:
    """Load Redis config using by-framework's unified environment parsing."""
    redis_config = RedisConfig.from_env()
    target: Any = (
        redis_config.cluster_nodes
        if redis_config.mode == "cluster"
        else f"{redis_config.host}:{redis_config.port}"
    )
    logger.info(
        "Connecting Redis from environment: mode=%s target=%s",
        redis_config.mode,
        target,
    )
    return redis_config


def init_shared_redis_from_env():
    """Initialize the shared by-framework Redis client from env config."""
    redis_config = load_redis_config_from_env()
    return init_redis(config=redis_config)
