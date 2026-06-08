"""Shared test fixtures for byclaw-kgw integration tests.

Automatically starts a **real byclaw-qa backend** on port 8000 via uvicorn,
then builds the byclaw-kgw gateway app.  Two KB configs are seeded in MinIO.

Requires: OpenGauss :15432, Redis :6379, MinIO :19000.
"""

# pylint: disable=redefined-outer-name,invalid-name

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest
import pytest_asyncio
import redis.asyncio as redis_async
import uvicorn
from httpx import ASGITransport

_SQL_DIR = Path(__file__).resolve().parent.parent.parent / "sql"

# ---------------------------------------------------------------------------
# KB config constants
# ---------------------------------------------------------------------------

_KN_DIRECT = "200001"
_KN_DISCOV = "300001"
_RESOURCE_CODE_DIRECT = "2"
_RESOURCE_CODE_DISCOV = "3"
# Service name used by byclaw-qa lifespan to register in Redis
_QA_SVC_NAME = os.environ.get("QA_DOMAINNAME", "byclaw-qa-manager")
_QA_PORT = int(os.environ.get("BYCLAW_QA_PORT", "8000"))
_QA_URL = f"http://127.0.0.1:{_QA_PORT}"

_ALL_SERVICES: list[dict[str, str]] = [
    {"name": "directoryCreate", "path": "/api/v1/directories/create"},
    {"name": "directoryUpdate", "path": "/api/v1/directories/update"},
    {"name": "directoryDelete", "path": "/api/v1/directories/delete"},
    {"name": "fileImport", "path": "/api/v1/knowledgeItems/import"},
    {"name": "fileDelete", "path": "/api/v1/knowledgeItems/delete"},
    {"name": "buildTrigger", "path": "/api/v1/fileToMarkdownIndex"},
    {"name": "buildStatus", "path": "/api/v1/fileBuildStatus"},
    {"name": "knowledgeSearch", "path": "/api/v1/knowledgeItems/search"},
    {"name": "metadataSearch", "path": "/api/v1/knowledgeItems/metadataSearch"},
    {"name": "searchFile", "path": "/api/v1/knowledgeItems/searchFile"},
    {"name": "listDir", "path": "/api/v1/listDir"},
    {"name": "glob", "path": "/api/v1/glob"},
    {"name": "readFile", "path": "/api/v1/readFile"},
    {"name": "downloadFile", "path": "/api/v1/downloadFile"},
    {
        "name": "metadataPropertiesBatchCreate",
        "path": "/api/v1/metadataProperties/batchCreate",
    },
    {"name": "metadataPropertiesDelete", "path": "/api/v1/metadataProperties/delete"},
    {
        "name": "knowledgeItemsMetadataUpdate",
        "path": "/api/v1/knowledgeItems/metadata/update",
    },
    {
        "name": "knowledgeItemsMetadataGet",
        "path": "/api/v1/knowledgeItems/metadata/get",
    },
]

_DIRECT_MINIO_KEY = f"resource/doc/KG_DOC_{_KN_DIRECT}.json"
_DISCOV_MINIO_KEY = f"resource/doc/KG_DOC_{_KN_DISCOV}.json"

_TABLES_TO_DROP = (
    "kgw_ingest_event",
    "kgw_metadata_property_sync",
    "kgw_metadata_property_binding",
    "kgw_metadata_binding_outbox",
    "kgw_metadata_property",
    "kgw_audit_log",
    "kgw_kb_write_history",
    "kgw_kb_source_lock",
    "kgw_kb_conflict_log",
    "kgw_migration",
)

# ---------------------------------------------------------------------------
# Helpers (importable by test modules)
# ---------------------------------------------------------------------------

_USER_ID = "test_user"


def hdrs(extra: dict | None = None) -> dict[str, str]:
    h = {"X-User-Id": _USER_ID}
    if extra:
        h.update(extra)
    return h


def ok_resp(obj: dict | None = None) -> dict[str, Any]:
    return {"resultCode": "0", "resultMsg": "success", "resultObject": obj or {}}


def fail_resp(msg: str = "error") -> dict[str, Any]:
    return {"resultCode": "-1", "resultMsg": msg, "resultObject": {}}


async def _retry_on_loop_error(factory, max_retries=3):
    """Retry *factory* if RuntimeError("Event loop is closed") is raised.

    pytest-asyncio module-scoped fixtures may reuse an event loop that the
    previous module left in a partially-closed state.  A brief pause and
    retry lets the new loop fully initialise.
    """
    for attempt in range(max_retries):
        try:
            return factory()
        except RuntimeError:
            if attempt < max_retries - 1:
                await asyncio.sleep(0.1 * (attempt + 1))
            else:
                raise


# ---------------------------------------------------------------------------
# Fixture: app with real byclaw-qa backend
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def _app_resources(
    pg_dsn: str,
    redis_url: str,
    minio_settings: dict[str, str],
) -> AsyncIterator[tuple[httpx.AsyncClient, Any, Any]]:
    """Build the gateway app wired to the running byclaw-qa backend.

    1. Verify byclaw-qa is reachable
    2. Seed KB configs in MinIO
    3. Build byclaw-kgw app
    4. Yield (client, pool, app)
    5. Teardown: drop kgw tables, cleanup MinIO
    """
    import aioboto3
    from kgw.audit import AuditWriter
    from kgw.auth_provider import AuthProvider
    from kgw.config_provider import KbConfigProvider
    from kgw.db import build_pool, run_migrations
    from kgw.http_client import build_http_client
    from kgw.main import build_app
    from kgw.resilience.circuit_breaker import CircuitBreakerRegistry
    from kgw.settings import get_settings

    # ---- 1. Start byclaw-qa automatically ----
    qa_port = _QA_PORT

    # Map kgw-style env vars to by_qa.config.Settings
    minio_host = minio_settings["endpoint_url"].split("://")[1].split(":")[0]
    minio_api_port = minio_settings["endpoint_url"].split(":")[-1]
    os.environ.setdefault("MINIO_ENDPOINT", f"{minio_host}:{minio_api_port}")
    os.environ.setdefault("MINIO_ACCESS_KEY", minio_settings["access_key"])
    os.environ.setdefault("MINIO_SECRET_KEY", minio_settings["secret_key"])
    os.environ.setdefault("MINIO_SECURE", "false")
    os.environ.setdefault("KB_MINIO_BUCKET", minio_settings["bucket"])
    os.environ.setdefault("KB_MINIO_MARKDOWN_BUCKET", minio_settings["bucket"])
    os.environ.setdefault("HOST", "127.0.0.1")
    os.environ.setdefault("PORT", str(qa_port))
    os.environ.setdefault("SERVICE_NAME", _QA_SVC_NAME)
    os.environ.setdefault("AGENT_DATA_PATH", "/tmp/kgw_test_agent_data")
    os.environ.setdefault("EMBEDDING_MODEL_NAME", "text-embedding-3-small")
    os.environ.setdefault("EMBEDDING_DIMENSION", "1024")
    os.environ.setdefault("EMBEDDING_BASE_URL", "http://localhost:9999/v1")
    os.environ.setdefault("EMBEDDING_API_KEY", "sk-placeholder")
    os.environ.setdefault("LLM_BASE_URL", "http://localhost:9999/v1")
    os.environ.setdefault("LLM_API_KEY", "sk-placeholder")

    # Monkeypatch byclaw-qa's lifespan Redis registration to no-ops
    import by_qa.main as qa_main  # noqa: PLC0415

    qa_main._register_service = lambda app: asyncio.sleep(0)  # noqa: ARG005
    qa_main._unregister_service = lambda app: asyncio.sleep(0)  # noqa: ARG005
    from by_qa.config import get_settings as qa_get_settings  # noqa: PLC0415

    qa_get_settings.cache_clear()

    qa_app = qa_main.create_app()
    qa_config = uvicorn.Config(
        qa_app, host="127.0.0.1", port=qa_port, log_level="warning"
    )
    qa_server = uvicorn.Server(qa_config)
    qa_task = asyncio.create_task(qa_server.serve(), name="byclaw-qa-server")

    # Wait healthy
    deadline = asyncio.get_event_loop().time() + 30.0
    async with httpx.AsyncClient() as check:
        while True:
            try:
                resp = await check.get(f"{_QA_URL}/health", timeout=2.0)
                if resp.status_code == 200:
                    break
            except Exception:  # noqa: BLE001
                pass
            if asyncio.get_event_loop().time() > deadline:
                qa_server.should_exit = True
                pytest.fail(f"byclaw-qa unhealthy after 30s at {_QA_URL}")
            await asyncio.sleep(0.5)

    # ---- 2. Create KBs dynamically via byclaw-qa API ----
    _resource_codes: dict[str, str] = {}
    async with httpx.AsyncClient() as direct:
        for label, kb_name in [("direct", "kgw-it-direct"), ("disc", "kgw-it-disc")]:
            resp = await direct.post(
                f"{_QA_URL}/api/v1/knowledgeBases/create",
                json={"knName": kb_name},
                timeout=30.0,
            )
            body = resp.json()
            if body.get("resultCode") == "0":
                _rc = body["resultObject"]["knCode"]
                _resource_codes[label] = str(_rc)

    # ---- 3. Seed KB configs in MinIO (with dynamic resourceCode) ----
    direct_config = {
        "resourceId": int(_KN_DIRECT),
        "resourceCode": _resource_codes.get("direct", _RESOURCE_CODE_DIRECT),
        "domainURL": _QA_URL,
        "domainName": "",
        "headers": {},
        "resourceService": _ALL_SERVICES,
    }
    discov_config = {
        "resourceId": int(_KN_DISCOV),
        "resourceCode": _resource_codes.get("disc", _RESOURCE_CODE_DISCOV),
        "domainURL": "",
        "domainName": _QA_SVC_NAME,
        "headers": {},
        "resourceService": _ALL_SERVICES,
    }
    bucket = minio_settings["bucket"]
    async with aioboto3.Session().client(
        "s3",
        endpoint_url=minio_settings["endpoint_url"],
        aws_access_key_id=minio_settings["access_key"],
        aws_secret_access_key=minio_settings["secret_key"],
    ) as s3:
        for key, config in [
            (_DIRECT_MINIO_KEY, direct_config),
            (_DISCOV_MINIO_KEY, discov_config),
        ]:
            await s3.put_object(
                Bucket=bucket,
                Key=key,
                Body=json.dumps(config).encode(),
                ContentType="application/json",
            )

    # ---- 4. Build byclaw-kgw gateway ----
    get_settings.cache_clear()
    settings = get_settings()

    pool = await build_pool(pg_dsn, min_size=1, max_size=5)
    await run_migrations(pool, _SQL_DIR)

    redis_client = await _retry_on_loop_error(
        lambda: redis_async.from_url(redis_url, decode_responses=False)
    )
    http_client = build_http_client(
        timeout_seconds=30.0, max_connections=20, max_keepalive=5
    )

    scheme = "https" if settings.file_storage_minio_secure else "http"
    minio_ep = (
        f"{scheme}://{settings.file_storage_minio_host}"
        f":{settings.file_storage_minio_api_port}"
    )
    config_provider = KbConfigProvider(
        endpoint_url=minio_ep,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        bucket=settings.minio_bucket,
        prefix=settings.minio_kg_doc_prefix,
    )
    auth_provider = AuthProvider(
        redis_client, key_template=settings.redis_auth_key_template
    )
    audit_writer = AuditWriter(pool, queue_max_size=1000)
    await audit_writer.start()
    circuit_breakers = CircuitBreakerRegistry(failure_threshold=5, open_duration=30.0)

    app = build_app()
    app.state.settings = settings
    app.state.pool = pool
    app.state.redis = redis_client
    app.state.http = http_client
    app.state.config_provider = config_provider
    app.state.auth_provider = auth_provider
    app.state.audit = audit_writer
    app.state.circuit_breakers = circuit_breakers
    app.state.ingest_semaphore = asyncio.Semaphore(100)

    # ---- 5. Yield ----
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client, pool, app

    # ---- 5. Teardown ----
    qa_server.should_exit = True
    try:
        await asyncio.wait_for(qa_task, timeout=5.0)
    except (asyncio.TimeoutError, RuntimeError):
        qa_task.cancel()

    await audit_writer.stop()
    try:
        await http_client.aclose()
    except RuntimeError:
        pass  # event loop may already be closing
    try:
        await redis_client.aclose()
    except RuntimeError:
        pass

    async with pool.connection() as conn:
        for table in _TABLES_TO_DROP:
            await conn.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
        await conn.commit()

    try:
        await pool.close()
    except RuntimeError:
        pass

    # Cleanup MinIO KB configs
    try:
        async with aioboto3.Session().client(
            "s3",
            endpoint_url=minio_settings["endpoint_url"],
            aws_access_key_id=minio_settings["access_key"],
            aws_secret_access_key=minio_settings["secret_key"],
        ) as s3:
            for key in [_DIRECT_MINIO_KEY, _DISCOV_MINIO_KEY]:
                await s3.delete_object(Bucket=bucket, Key=key)
    except Exception:  # noqa: BLE001
        pass


# ---- Convenience fixtures ----


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def client(_app_resources: tuple) -> httpx.AsyncClient:
    return _app_resources[0]


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def pool(_app_resources: tuple) -> Any:
    return _app_resources[1]


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def app(_app_resources: tuple) -> Any:
    return _app_resources[2]
