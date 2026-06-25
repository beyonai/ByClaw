"""byclaw-data MCP service app factory."""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

from redis.asyncio import Redis

from by_framework.core.discovery import ServiceRegistry

from byclaw_data.runtime import normalize_runtime_environment

logger = logging.getLogger(__name__)


def _get_service_port() -> int:
    return int(
        os.environ.get("DATACLOUD_DATA_SERVICE_PORT")
        or os.environ.get("DATACLOUD_PORT")
        or "0"
    )


def create_app(**kwargs):
    """Create the byclaw MCP app on top of datacloud_platform."""

    normalize_runtime_environment()

    from datacloud_platform import get_platform
    from datacloud_platform.api.server import create_app as create_platform_app

    platform = get_platform()

    # Inject ByClaw result_file_storage before creating app
    import datacloud_platform.platform_file_storage as pf_storage
    from byclaw_data.platform.result_file_storage import build_result_file_storage

    pf_storage.build_result_file_storage = build_result_file_storage

    app = create_platform_app(platform, **kwargs)
    _wrap_lifespan_with_discovery(app)

    # 挂载代码查询路由（无需额外端口）
    from byclaw_data.code_api import _mount_code_api
    _mount_code_api(app)

    return app


def _wrap_lifespan_with_discovery(app) -> None:
    """Wrap the app's lifespan with service discovery registration."""
    platform_lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def _lifespan(application) -> AsyncIterator[None]:
        async with platform_lifespan(application):
            await register_service(application)
            try:
                yield
            finally:
                await unregister_service(application)

    app.router.lifespan_context = _lifespan


async def register_service(application) -> None:
    """Register the running service instance in the service registry."""
    app_name = getattr(application, "title", application.__class__.__name__)
    logger.info("Registering service %s", app_name)
    redis_client = create_discovery_redis()
    registry = ServiceRegistry(redis_client=redis_client)
    service_name = os.environ.get("DATACLOUD_DOMAINNAME")
    host_machine = os.environ.get("HOST")
    port = _get_service_port()
    metadata = {"version": "0.1.1"}
    await registry.register(
        service_name=service_name,
        host=host_machine,
        port=port,
        weight=10,
        metadata=metadata,
    )
    application.state.service_registry = registry
    logger.info(
        "service registry registered: service_name=%s, host=%s, port=%s, metadata=%s",
        service_name,
        host_machine,
        port,
        metadata,
    )
    redis_host = os.getenv("DATACLOUD_GATEWAY_REDIS_HOST", "localhost")
    redis_port = int(os.getenv("DATACLOUD_GATEWAY_REDIS_PORT", 6379))
    redis_db = int(os.getenv("DATACLOUD_GATEWAY_REDIS_DB", 0))
    logger.info(
        "service registry redis configured: host=%s, port=%s, db=%s",
        redis_host,
        redis_port,
        redis_db,
    )


async def unregister_service(application) -> None:
    """Unregister the running service instance from the service registry."""
    registry = getattr(application.state, "service_registry", None)
    if registry is None:
        return

    await registry.unregister()
    await registry.redis.aclose()
    del application.state.service_registry
    logger.info("Service registry unregistered")


def create_discovery_redis() -> Redis:
    redis_host = os.getenv("DATACLOUD_GATEWAY_REDIS_HOST", "localhost")
    redis_port = int(os.getenv("DATACLOUD_GATEWAY_REDIS_PORT", 6379))
    redis_db = int(os.getenv("DATACLOUD_GATEWAY_REDIS_DB", 0))
    redis_password = os.getenv("DATACLOUD_GATEWAY_REDIS_PASSWORD")
    redis_username = os.getenv("DATACLOUD_GATEWAY_REDIS_USERNAME")

    return Redis(
        host=redis_host,
        port=redis_port,
        db=redis_db,
        password=redis_password or None,
        username=redis_username or None,
        decode_responses=True,
    )
