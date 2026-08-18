"""byclaw-data MCP service app factory."""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager, suppress
from collections.abc import Callable
from typing import Any, AsyncIterator, Awaitable

from by_framework.core.discovery import ServiceRegistry

from byclaw_data.redis_client import create_redis_client, get_redis_settings
from byclaw_data.runtime import normalize_runtime_environment

logger = logging.getLogger(__name__)

create_discovery_redis = create_redis_client


def _configure_platform_logging(
    *,
    setup_logging_func: Callable[..., None] | None = None,
) -> None:
    """Initialize application loggers for the platform HTTP service."""
    if setup_logging_func is None:
        from datacloud_analysis.logging_setup import setup_logging  # noqa: PLC0415

        setup_logging_func = setup_logging

    log_level = (
        os.environ.get("DATACLOUD_DATA_SERVICE_LOG_LEVEL")
        or os.environ.get("DATACLOUD_LOG_LEVEL")
        or "info"
    ).upper()
    setup_logging_func(
        level=log_level,
        extra_namespaces=("byclaw_data", "datacloud_knowledge"),
    )


def _get_service_port() -> int:
    return int(
        os.environ.get("DATACLOUD_DATA_SERVICE_PORT")
        or os.environ.get("DATACLOUD_PORT")
        or "0"
    )


def create_app(**kwargs):
    """Create the byclaw MCP app on top of datacloud_platform."""

    os.environ.setdefault("DATACLOUD_LOG_DIR", "logs/service")
    from datacloud_analysis.logging_setup import setup_logging  # noqa: PLC0415
    setup_logging(extra_namespaces=("byclaw_data",))

    normalize_runtime_environment()
    _configure_platform_logging()

    # Inject ByClaw result_file_storage BEFORE get_platform() initialises the singleton.
    # loader_runtime._configure_runtime_services() reads build_result_file_storage at
    # platform-init time, so the override must be in place before that call.
    import datacloud_platform.platform_file_storage as pf_storage
    from byclaw_data.platform.result_file_storage import build_result_file_storage

    pf_storage.build_result_file_storage = build_result_file_storage

    from datacloud_platform import get_platform
    from datacloud_platform.api.server import create_app as create_platform_app

    platform = get_platform()

    app = create_platform_app(platform, **kwargs)
    _wrap_lifespan_with_discovery(app)

    # 挂载代码查询路由（无需额外端口）
    from byclaw_data.code_api import _mount_code_api

    _mount_code_api(app)

    return app


def _wrap_lifespan_with_discovery(app) -> None:
    """Wrap the app's lifespan with discovery and background workers."""
    platform_lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def _lifespan(application) -> AsyncIterator[None]:
        async with platform_lifespan(application):
            await register_service(application)
            _start_term_sync_worker(application)
            try:
                yield
            finally:
                await _stop_term_sync_worker(application)
                await unregister_service(application)

    app.router.lifespan_context = _lifespan


async def _run_term_sync_worker(
    worker: Callable[..., Awaitable[None]],
    handler: Any,
) -> None:
    """Run the term-sync worker and log an unexpected termination."""
    try:
        await worker(handler=handler)
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.warning("PlatformService: term_sync_worker 非预期退出", exc_info=True)


def _start_term_sync_worker(application) -> asyncio.Task[None] | None:
    """Start the process-local term synchronization consumer."""
    try:
        from datacloud_knowledge.sync import term_sync_worker  # noqa: PLC0415
        from datacloud_platform import get_platform  # noqa: PLC0415

        task = asyncio.create_task(
            _run_term_sync_worker(term_sync_worker, get_platform()),
            name="term_sync_worker",
        )
        application.state.term_sync_worker_task = task
        logger.info(
            "PlatformService: term_sync_worker started with platform handler"
        )
        return task
    except ImportError:
        logger.debug(
            "PlatformService: datacloud_knowledge.sync not available, "
            "term sync disabled"
        )
    except Exception:
        logger.warning("PlatformService: term_sync_worker 启动失败", exc_info=True)
    return None


async def _stop_term_sync_worker(application) -> None:
    """Cancel and await the process-local term synchronization consumer."""
    task = getattr(application.state, "term_sync_worker_task", None)
    if task is None:
        return

    task.cancel()
    with suppress(asyncio.CancelledError):
        await task
    del application.state.term_sync_worker_task
    logger.info("PlatformService: term_sync_worker stopped")


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
    redis_settings = get_redis_settings()
    logger.info(
        "service registry redis configured: cluster_hosts=%s host=%s, port=%s, db=%s",
        redis_settings.cluster_hosts,
        redis_settings.host,
        redis_settings.port,
        redis_settings.db,
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
