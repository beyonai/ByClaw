"""Shared Redis client configuration and construction."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

from redis.asyncio import Redis


@dataclass(frozen=True)
class RedisSettings:
    """Resolved Redis connection settings."""

    cluster_hosts: tuple[tuple[str, int], ...]
    host: str
    port: int
    db: int
    username: str
    password: str


def _first_non_empty(*keys: str, default: str = "") -> str:
    for key in keys:
        value = os.getenv(key, "").strip()
        if value:
            return value
    return default


def _parse_cluster_hosts(value: str) -> tuple[tuple[str, int], ...]:
    nodes: list[tuple[str, int]] = []
    for raw_node in value.split(","):
        node = raw_node.strip()
        if not node:
            continue
        host, separator, port = node.rpartition(":")
        if not separator:
            host, port = node, "6379"
        nodes.append((host, int(port) if port else 6379))
    return tuple(nodes)


def get_redis_settings() -> RedisSettings:
    """Resolve Redis settings using DataCloud variables before generic ones."""

    cluster_hosts = _first_non_empty(
        "DATACLOUD_GATEWAY_REDIS_CLUSTER_HOST",
        "REDIS_CLUSTER_HOST",
    )
    return RedisSettings(
        cluster_hosts=_parse_cluster_hosts(cluster_hosts),
        host=_first_non_empty(
            "DATACLOUD_GATEWAY_REDIS_HOST",
            "REDIS_HOST",
            default="localhost",
        ),
        port=int(
            _first_non_empty(
                "DATACLOUD_GATEWAY_REDIS_PORT",
                "REDIS_PORT",
                default="6379",
            )
        ),
        db=int(
            _first_non_empty(
                "DATACLOUD_GATEWAY_REDIS_DB",
                "REDIS_DATABASE",
                default="0",
            )
        ),
        username=_first_non_empty(
            "DATACLOUD_GATEWAY_REDIS_USERNAME",
            "REDIS_USERNAME",
        ),
        password=_first_non_empty(
            "DATACLOUD_GATEWAY_REDIS_PASSWORD",
            "REDIS_PASSWORD",
        ),
    )


def create_redis_client(settings: RedisSettings | None = None) -> Any:
    """Create an async standalone or cluster Redis client."""

    resolved = settings or get_redis_settings()
    if resolved.cluster_hosts:
        from redis.asyncio.cluster import ClusterNode
        from redis.asyncio.cluster import RedisCluster

        return RedisCluster(
            startup_nodes=[
                ClusterNode(host, port) for host, port in resolved.cluster_hosts
            ],
            username=resolved.username,
            password=resolved.password,
            decode_responses=True,
        )

    return Redis(
        host=resolved.host,
        port=resolved.port,
        db=resolved.db,
        username=resolved.username,
        password=resolved.password,
        decode_responses=True,
    )


def create_sync_redis_client(settings: RedisSettings | None = None) -> Any:
    """Create a synchronous standalone or cluster Redis client."""

    import redis
    from redis.cluster import ClusterNode, RedisCluster

    resolved = settings or get_redis_settings()
    if resolved.cluster_hosts:
        return RedisCluster(
            startup_nodes=[
                ClusterNode(host, port) for host, port in resolved.cluster_hosts
            ],
            username=resolved.username,
            password=resolved.password,
            decode_responses=True,
        )

    return redis.Redis(
        host=resolved.host,
        port=resolved.port,
        db=resolved.db,
        username=resolved.username,
        password=resolved.password,
        decode_responses=True,
    )
