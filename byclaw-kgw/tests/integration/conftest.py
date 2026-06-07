"""Shared test fixtures for byclaw-kgw integration tests.

Two KB backends:

* **200001** — direct mode (domainURL = ``http://kb-direct.test``)
* **300001** — discovery mode (domainName = ``kgw-int-kb-svc``)

Both use numeric knCodes matching the production ``resourceId`` pattern.
The gateway maps portal ``knCode`` → MinIO config → backend ``resourceCode``
(``"2"`` and ``"3"`` respectively).

Usage in test files::

    pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

    async def test_something(client_200001):
        resp = await client_200001.post("/kgw/api/v1/listDir", json={...})
        assert resp.json()["resultCode"] == "0"

Requires real OpenGauss + Redis + MinIO from repo-level ``.env``.
Run with:  uv run pytest -m integration tests/integration/ -v
"""

# pylint: disable=redefined-outer-name,invalid-name

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest_asyncio
import redis.asyncio as redis_async
from httpx import ASGITransport

_SQL_DIR = Path(__file__).resolve().parent.parent.parent / "sql"

# ---------------------------------------------------------------------------
# KB config constants
# ---------------------------------------------------------------------------

_KN_DIRECT = "200001"
_KN_DISCOV = "300001"
_RESOURCE_CODE_DIRECT = "2"
_RESOURCE_CODE_DISCOV = "3"
_KB_DIRECT_URL = "http://kb-direct.test"
_KB_DISCOV_DOMAIN = "kgw-int-kb-svc"

# All 18 KB operations (the full set a byclaw-qa backend exposes)
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

_DIRECT_CONFIG = {
    "resourceId": int(_KN_DIRECT),
    "resourceCode": _RESOURCE_CODE_DIRECT,
    "domainURL": _KB_DIRECT_URL,
    "domainName": "",
    "headers": {},
    "resourceService": _ALL_SERVICES,
}

_DISCOV_CONFIG = {
    "resourceId": int(_KN_DISCOV),
    "resourceCode": _RESOURCE_CODE_DISCOV,
    "domainURL": "",
    "domainName": _KB_DISCOV_DOMAIN,
    "headers": {},
    "resourceService": _ALL_SERVICES,
}

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
# Module-scoped fixture: full app with both KB configs seeded
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def _app_resources(
    pg_dsn: str,
    redis_url: str,
    minio_settings: dict[str, str],
) -> AsyncIterator[tuple[httpx.AsyncClient, Any, Any]]:
    """Build the gateway app wired to real DB/Redis/MinIO.

    Seeds TWO KB configs: 200001 (direct) and 300001 (discovery).
    Yields (client, pool, app).  Drops all kgw tables on teardown.
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

    get_settings.cache_clear()
    settings = get_settings()
    bucket = minio_settings["bucket"]

    # Seed both KB configs in MinIO
    async with aioboto3.Session().client(
        "s3",
        endpoint_url=minio_settings["endpoint_url"],
        aws_access_key_id=minio_settings["access_key"],
        aws_secret_access_key=minio_settings["secret_key"],
    ) as s3:
        for key, config in [
            (_DIRECT_MINIO_KEY, _DIRECT_CONFIG),
            (_DISCOV_MINIO_KEY, _DISCOV_CONFIG),
        ]:
            await s3.put_object(
                Bucket=bucket,
                Key=key,
                Body=json.dumps(config).encode(),
                ContentType="application/json",
            )

    pool = await build_pool(pg_dsn, min_size=1, max_size=5)
    await run_migrations(pool, _SQL_DIR)

    redis_client = redis_async.from_url(redis_url, decode_responses=False)
    http_client = build_http_client(
        timeout_seconds=10.0, max_connections=20, max_keepalive=5
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

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client, pool, app

    await audit_writer.stop()
    await http_client.aclose()
    await redis_client.aclose()

    async with pool.connection() as conn:
        for table in _TABLES_TO_DROP:
            await conn.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
        await conn.commit()

    await pool.close()

    # Cleanup MinIO
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


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def client(_app_resources: tuple) -> httpx.AsyncClient:
    return _app_resources[0]


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def pool(_app_resources: tuple) -> Any:
    return _app_resources[1]


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def app(_app_resources: tuple) -> Any:
    return _app_resources[2]


# ---------------------------------------------------------------------------
# Auth header helpers
# ---------------------------------------------------------------------------

_USER_ID = "test_user"


def _hdrs(extra: dict | None = None) -> dict[str, str]:
    h = {"X-User-Id": _USER_ID}
    if extra:
        h.update(extra)
    return h


def _ok_resp(obj: dict | None = None) -> dict[str, Any]:
    return {"resultCode": "0", "resultMsg": "success", "resultObject": obj or {}}


def _fail_resp(msg: str = "error") -> dict[str, Any]:
    return {"resultCode": "-1", "resultMsg": msg, "resultObject": {}}
