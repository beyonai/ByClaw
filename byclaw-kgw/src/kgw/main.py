"""FastAPI application factory + lifespan.

The app holds long-lived resources in ``app.state``:

  * pool   — psycopg AsyncConnectionPool
  * redis  — redis.asyncio.Redis
  * http   — shared httpx AsyncClient
  * config_provider — KbConfigProvider
  * auth_provider   — AuthProvider
  * audit  — AuditWriter
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

import redis.asyncio as redis_async
from fastapi import FastAPI
from fastapi.requests import Request
from fastapi.responses import JSONResponse, Response
from kgw.audit import AuditWriter
from kgw.auth_provider import AuthProvider
from kgw.config_provider import KbConfigProvider
from kgw.db import build_pool, run_migrations
from kgw.envelope import KgwError
from kgw.http_client import build_http_client
from kgw.observability.logger import configure_logging, get_logger
from kgw.observability.metrics import REGISTRY
from kgw.observability.tracing import TraceIdMiddleware
from kgw.settings import Settings, get_settings
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

_log = get_logger(__name__)


def _sql_dir() -> Path:
    """Locate the bundled sql/ directory relative to this file."""
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "sql"
        if candidate.is_dir():
            return candidate
    raise FileNotFoundError("sql/ directory not found")


def _build_minio_endpoint(settings: Settings) -> str:
    scheme = "https" if settings.file_storage_minio_secure else "http"
    return f"{scheme}://{settings.file_storage_minio_host}:{settings.file_storage_minio_api_port}"


@asynccontextmanager
async def _lifespan(app: FastAPI):  # pylint: disable=redefined-outer-name
    settings: Settings = get_settings()
    configure_logging(json_logs=True)

    pool = await build_pool(
        settings.db_dsn,
        min_size=settings.db_pool_min_size,
        max_size=settings.db_pool_max_size,
    )
    await run_migrations(pool, _sql_dir())

    redis_client = redis_async.from_url(settings.redis_url, decode_responses=False)

    http_client = build_http_client(
        timeout_seconds=settings.http_default_timeout_seconds,
        max_connections=settings.http_pool_max_connections,
        max_keepalive=settings.http_pool_max_keepalive,
    )

    config_provider = KbConfigProvider(
        endpoint_url=_build_minio_endpoint(settings),
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        bucket=settings.minio_bucket,
        prefix=settings.minio_kg_doc_prefix,
    )
    auth_provider = AuthProvider(
        redis_client, key_template=settings.redis_auth_key_template
    )
    audit_writer = AuditWriter(pool, queue_max_size=settings.audit_queue_max_size)
    await audit_writer.start()

    from kgw.resilience.circuit_breaker import CircuitBreakerRegistry

    circuit_breakers = CircuitBreakerRegistry(
        failure_threshold=settings.circuit_failure_threshold,
        open_duration=settings.circuit_open_duration,
        half_open_max_requests=1,
    )

    app.state.settings = settings
    app.state.pool = pool
    app.state.redis = redis_client
    app.state.http = http_client
    app.state.config_provider = config_provider
    app.state.auth_provider = auth_provider
    app.state.audit = audit_writer
    app.state.circuit_breakers = circuit_breakers

    from kgw.workers.binding_reconcile import run_reconcile_loop  # noqa: PLC0415
    from kgw.workers.cleanup import run_cleanup_loop  # noqa: PLC0415

    stop_event = asyncio.Event()
    app.state.worker_stop = stop_event
    app.state.cleanup_task = asyncio.create_task(
        run_cleanup_loop(app.state, stop_event=stop_event),
        name="cleanup_worker",
    )
    app.state.reconcile_task = asyncio.create_task(
        run_reconcile_loop(app.state, stop_event=stop_event),
        name="reconcile_worker",
    )

    _log.info("kgw.startup_complete")
    try:
        yield
    finally:
        _log.info("kgw.shutdown_begin")
        app.state.worker_stop.set()
        await asyncio.gather(
            app.state.cleanup_task,
            app.state.reconcile_task,
            return_exceptions=True,
        )
        await audit_writer.stop()
        await http_client.aclose()
        await redis_client.aclose()
        await pool.close()
        _log.info("kgw.shutdown_complete")


def build_app() -> FastAPI:
    """Construct the FastAPI app. Used by uvicorn entry point and tests."""
    app = FastAPI(  # pylint: disable=redefined-outer-name
        title="byclaw-kgw", version="0.1.0", lifespan=_lifespan
    )
    app.add_middleware(TraceIdMiddleware)

    @app.exception_handler(KgwError)
    async def _kgw_error_handler(request: Request, exc: KgwError):
        return JSONResponse(status_code=200, content=exc.to_envelope())

    @app.get("/healthz")
    async def _healthz():
        return {"status": "ok"}

    @app.get("/metrics")
    async def _metrics() -> Response:
        data = generate_latest(REGISTRY)
        return Response(content=data, media_type=CONTENT_TYPE_LATEST)

    from kgw.api.internal import router as internal_router  # noqa: PLC0415

    app.include_router(internal_router)

    from kgw.api.directories import router as directories_router
    from kgw.api.files import router as files_router
    from kgw.api.knowledge_items import router as knowledge_items_router
    from kgw.api.metadata_properties import router as metadata_properties_router

    app.include_router(directories_router)
    app.include_router(knowledge_items_router)
    app.include_router(files_router)
    app.include_router(metadata_properties_router)

    return app


app = build_app()
