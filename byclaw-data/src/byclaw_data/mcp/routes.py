"""byclaw-data MCP service app factory."""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

from dotenv import load_dotenv
from redis.asyncio import Redis

from by_framework.core.discovery import ServiceRegistry

from byclaw_data.runtime import normalize_runtime_environment

logger = logging.getLogger(__name__)

def _load_local_env() -> None:
    pkg_dir = Path(__file__).resolve().parents[1]
    src_dir = pkg_dir.parent
    project_dir = src_dir.parent
    for env_path in (project_dir / ".env", src_dir / ".env"):
        if env_path.is_file():
            load_dotenv(dotenv_path=env_path, override=False)


def _get_service_port() -> int:
    return int(
        os.environ.get("DATACLOUD_DATA_SERVICE_PORT")
        or os.environ.get("DATACLOUD_PORT")
        or "0"
    )


def create_app(
    *,
    datasource_configs: dict | None = None,
    loader_override: Any | None = None,
):
    """Create the byclaw MCP app on top of datacloud_data_service."""

    # _load_local_env()
    normalize_runtime_environment()

    from datacloud_data_sdk.ontology.loader import OntologyLoader
    from datacloud_data_service.config import get_settings
    from datacloud_data_service.api.routes import create_app as create_datacloud_app
    from byclaw_data.mcp.result_file_storage import build_result_file_storage

    settings = get_settings()
    loader = OntologyLoader()

    from datacloud_data_sdk.ontology.term_loader import TermLoader

    term_loader = TermLoader.from_config({})
    loader.configure(term_loader=term_loader)

    ontology_path = Path(settings.ontology_path)
    loader.configure(result_file_storage=build_result_file_storage(settings=settings))
    if ontology_path.exists():
        loader.load_from_owl_directory(ontology_path)
        logger.info("Loaded ontology from %s", ontology_path)

    # scene_path = Path(settings.scene_path)
    # if scene_path.exists():
    #     loader.load_scene_from_path(scene_path)
    #     logger.info("Loaded scene from %s", scene_path)

    app = create_datacloud_app(
        datasource_configs=datasource_configs,
        loader_override=loader,
    )
    datacloud_lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def _lifespan(application) -> AsyncIterator[None]:
        async with datacloud_lifespan(application):
            await register_service(application)
            try:
                yield
            finally:
                await unregister_service(application)

    app.router.lifespan_context = _lifespan
    return app


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
        redis_db
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
