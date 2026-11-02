#!/usr/bin/env python3
"""
ByClaw 服务发现模块（基于 Redis 服务注册中心）

与 by-framework-java 的 ServiceRegistry / DiscoveryClient 共享同一套
Redis Key 协议，用于从 Redis 动态发现 byclaw-be（ByaiService）的真实网络地址。
"""

import os
import json
import time
import random
import threading
from typing import Optional

try:
    import redis
    from redis.cluster import RedisCluster, ClusterNode
except ImportError:
    redis = None

REDIS_PREFIX = "byai_gateway:"
V2_PREFIX = "byai_gateway:v2:"


class ServiceDiscoveryError(Exception):
    pass


def _env(key: str, default: str = None) -> Optional[str]:
    """
    读取环境变量，空字符串视为未设置
    """
    value = os.getenv(key)
    if value is None or value.strip() == '':
        return default
    return value


def _env_int(key: str, default: int) -> int:
    value = _env(key)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


class ByClawServiceDiscovery:
    """
    Redis 服务发现客户端

    Redis 连接模式判定（对齐 RedisConnectionConfig.fromEnv()）：
    1. REDIS_MODE 显式设置 → 直接使用
    2. REDIS_MODE 未设置但 REDIS_CLUSTER_HOST 非空 → 隐式 cluster
    3. 都未满足 → standalone
    """

    DEFAULT_SERVICE_NAME = "ByaiService"
    DEFAULT_HEALTH_THRESHOLD_MS = 30000
    CACHE_TTL_SECONDS = 5

    def __init__(self, redis_client=None):
        self._is_cluster = False
        self._redis = redis_client or self._build_redis_client()
        self._schema_version = self._resolve_key_schema_version()
        self._cache = {}
        self._rr_counters = {}
        self._lock = threading.Lock()

    def _build_redis_client(self):
        """构建 Redis 客户端（standalone / cluster 双模式）"""
        if redis is None:
            raise ServiceDiscoveryError(
                "需要安装 redis-py: pip install 'redis>=4.5.0'")

        mode = (_env('REDIS_MODE') or '').lower()
        cluster_host = _env('REDIS_CLUSTER_HOST')
        has_cluster_host = bool(cluster_host)

        if not mode:
            mode = 'cluster' if has_cluster_host else 'standalone'

        username = _env('REDIS_USERNAME')
        password = _env('REDIS_PASSWORD')

        if mode == 'cluster':
            if not cluster_host:
                raise ServiceDiscoveryError(
                    "REDIS_MODE=cluster 但 REDIS_CLUSTER_HOST 未配置")
            self._is_cluster = True
            nodes = []
            for hp in cluster_host.split(','):
                hp = hp.strip()
                if not hp:
                    continue
                h, _, p = hp.rpartition(':')
                nodes.append(ClusterNode(host=h, port=int(p)))
            if not nodes:
                raise ServiceDiscoveryError(
                    f"REDIS_CLUSTER_HOST 格式非法: {cluster_host!r}")
            return RedisCluster(
                startup_nodes=nodes,
                username=username,
                password=password,
                decode_responses=True,
            )

        # standalone
        self._is_cluster = False
        host = _env('REDIS_HOST', 'localhost')
        port = _env_int('REDIS_PORT', 6379)
        db = _env_int('REDIS_DATABASE', _env_int('REDIS_DB', 0))
        return redis.Redis(
            host=host,
            port=port,
            db=db,
            username=username,
            password=password,
            decode_responses=True,
        )

    def _resolve_key_schema_version(self) -> str:
        """解析 Key Schema 版本（v1 / v2）"""
        version = _env('REDIS_KEY_SCHEMA_VERSION')
        if not version:
            version = 'v2' if _env('REDIS_CLUSTER_HOST') else 'v1'
        if version not in ('v1', 'v2'):
            raise ServiceDiscoveryError(f"非法 REDIS_KEY_SCHEMA_VERSION: {version}")
        return version

    def _key_active_instances(self, service_name: str) -> str:
        if self._schema_version == 'v2':
            return f"{V2_PREFIX}sd:{{{service_name}}}:active"
        return f"{REDIS_PREFIX}sd:active:{service_name}"

    def _key_instance_details(self, service_name: str) -> str:
        if self._schema_version == 'v2':
            return f"{V2_PREFIX}sd:{{{service_name}}}:instances"
        return f"{REDIS_PREFIX}sd:instances:{service_name}"

    def discover(self, service_name: str = DEFAULT_SERVICE_NAME,
                 strategy: str = 'random',
                 health_threshold_ms: int = DEFAULT_HEALTH_THRESHOLD_MS,
                 force_refresh: bool = False) -> dict:
        """
        发现一个健康的服务实例

        Returns:
            {"id": "...", "protocol": "http", "host": "...", "port": 8086,
             "path_prefix": "/byaiService", ...}
        """
        instances = self._get_healthy_instances(
            service_name, health_threshold_ms, force_refresh)
        if not instances:
            raise ServiceDiscoveryError(
                f"服务发现失败: 未找到健康的 '{service_name}' 实例")

        if strategy == 'round-robin':
            idx = self._next_round_robin_index(service_name, len(instances))
            return instances[idx]

        return random.choice(instances)

    def get_base_url(self, service_name: str = DEFAULT_SERVICE_NAME) -> str:
        """返回 base_url，如 http://10.0.1.23:8086/byaiService"""
        instance = self.discover(service_name)
        protocol = instance.get('protocol', 'http')
        host = instance['host']
        port = instance['port']
        path_prefix = instance.get('path_prefix') or ''
        return f"{protocol}://{host}:{port}{path_prefix}"

    def _get_healthy_instances(self, service_name, health_threshold_ms,
                                force_refresh) -> list:
        now_ms = int(time.time() * 1000)
        with self._lock:
            cached = self._cache.get(service_name)
            if (not force_refresh and cached
                    and (now_ms - cached[1]) < self.CACHE_TTL_SECONDS * 1000):
                instances = cached[0]
            else:
                instances = self._fetch_active_instances(service_name)
                self._cache[service_name] = (instances, now_ms)

        min_score = now_ms - health_threshold_ms
        return [i for i in instances if i.get('_last_heartbeat_ms', 0) >= min_score]

    def _fetch_active_instances(self, service_name: str) -> list:
        """从 Redis 获取活跃实例列表"""
        active_key = self._key_active_instances(service_name)
        details_key = self._key_instance_details(service_name)

        active = self._redis.zrange(active_key, 0, -1, withscores=True)
        if not active:
            return []

        instance_ids = [instance_id for instance_id, _ in active]
        payloads = self._redis.hmget(details_key, instance_ids)

        instances = []
        for (instance_id, score), payload in zip(active, payloads):
            if not payload:
                continue
            try:
                instance = json.loads(payload)
            except json.JSONDecodeError:
                continue
            instance['_last_heartbeat_ms'] = int(score)
            instances.append(instance)
        return instances

    def _next_round_robin_index(self, service_name: str, size: int) -> int:
        counter = self._rr_counters.get(service_name, 0)
        self._rr_counters[service_name] = counter + 1
        return counter % size


if __name__ == '__main__':
    # 测试服务发现
    try:
        discovery = ByClawServiceDiscovery()
        base_url = discovery.get_base_url()
        print(f"✅ 发现 ByaiService 地址: {base_url}")
    except ServiceDiscoveryError as e:
        print(f"❌ 服务发现失败: {e}")
        exit(1)
