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
from httpx import ASGITransport

_SQL_DIR = Path(__file__).resolve().parent.parent.parent / "sql"

# ---------------------------------------------------------------------------
# KB config constants
# ---------------------------------------------------------------------------

_KN_DIRECT = "200001"
_KN_DISCOV = "300001"
_RESOURCE_CODE_DIRECT = "1"
_RESOURCE_CODE_DISCOV = "2"
# Service name used by byclaw-qa lifespan to register in Redis
_QA_SVC_NAME = os.environ.get("QA_DOMAINNAME", "byclaw-qa-manager")
_QA_PORT = int(os.environ.get("BYCLAW_QA_PORT", "8000"))
_QA_URL = f"http://127.0.0.1:{_QA_PORT}"


def _make_openapi(op_id: str, path: str, title: str, desc: str) -> dict:
    """Build a single OpenAPI-schema resourceService entry (KG_DOC format)."""
    return {
        "openapiSchema": {
            "openapi": "3.0.1",
            "info": {"title": title, "description": desc, "version": "1.0.0"},
            "servers": [{}],
            "paths": {
                path: {
                    "post": {
                        "operationId": op_id,
                        "summary": title,
                        "description": desc,
                        "responses": {"200": {"description": "操作成功"}},
                    }
                }
            },
        }
    }


_ALL_SERVICES: list[dict] = [
    _make_openapi(
        "createDir",
        "/api/v1/directories/create",
        "创建目录",
        "在指定的知识库下面创建目录",
    ),
    _make_openapi(
        "editDir", "/api/v1/directories/update", "修改目录", "修改指定知识库的目录"
    ),
    _make_openapi(
        "deleteDir", "/api/v1/directories/delete", "删除目录", "删除指定知识库的目录"
    ),
    _make_openapi(
        "uploadFile",
        "/api/v1/knowledgeItems/import",
        "上传文档",
        "将文档上传到指定的知识库下面",
    ),
    _make_openapi(
        "deleteFile",
        "/api/v1/knowledgeItems/delete",
        "删除文档",
        "删除指定知识库下面的文档",
    ),
    _make_openapi(
        "knowledgeBuild",
        "/api/v1/fileToMarkdownIndex",
        "知识构建",
        "根据文件路径异步构建指定知识库下面的文件",
    ),
    _make_openapi(
        "buildStatusQuery",
        "/api/v1/fileBuildStatus",
        "构建状态查询",
        "查询文档的构建状态",
    ),
    _make_openapi(
        "knowledgeSearch",
        "/api/v1/knowledgeItems/search",
        "知识检索",
        "根据用户提问召回对应的知识chunk",
    ),
    _make_openapi(
        "listDir",
        "/api/v1/listDir",
        "获取目录内容",
        "获取指定知识库目录下的所有文件和文件夹",
    ),
    _make_openapi(
        "glob",
        "/api/v1/glob",
        "按路径模式匹配",
        "基于路径模式匹配查找指定知识库下面的文件或目录",
    ),
    _make_openapi(
        "readFile",
        "/api/v1/readFile",
        "读取文件内容",
        "根据文件路径读取指定知识库下的原始文件内容",
    ),
    _make_openapi(
        "downloadFile",
        "/api/v1/downloadFile",
        "下载原始文件",
        "根据文件路径下载指定知识库下的原始文件",
    ),
    _make_openapi(
        "metadataPropertiesBatchCreate",
        "/api/v1/metadataProperties/batchCreate",
        "批量创建元数据属性",
        "批量声明元数据属性",
    ),
    _make_openapi(
        "metadataPropertiesDelete",
        "/api/v1/metadataProperties/delete",
        "删除元数据属性",
        "删除元数据属性",
    ),
    _make_openapi(
        "knowledgeItemsMetadataUpdate",
        "/api/v1/knowledgeItems/metadata/update",
        "更新文件元数据",
        "更新文件元数据",
    ),
    _make_openapi(
        "knowledgeItemsMetadataGet",
        "/api/v1/knowledgeItems/metadata/get",
        "获取文件元数据",
        "获取文件元数据",
    ),
    _make_openapi(
        "metadataSearch",
        "/api/v1/knowledgeItems/metadataSearch",
        "元数据检索",
        "多知识库并行纯元数据检索",
    ),
    _make_openapi(
        "searchFile",
        "/api/v1/knowledgeItems/searchFile",
        "文件级检索",
        "多知识库并行文件级检索",
    ),
    _make_openapi(
        "metadataFieldsList",
        "/api/v1/knowledgeItems/metadataFields/list",
        "列出元数据字段",
        "列出已同步的元数据属性",
    ),
]

_DIRECT_REDIS_KEY = f"KG_DOC_{_KN_DIRECT}"
_DISCOV_REDIS_KEY = f"KG_DOC_{_KN_DISCOV}"

_TABLES_TO_DROP = (
    "kgw_ingest_event",
    "kgw_metadata_property_sync",
    "kgw_metadata_property_binding",
    "kgw_metadata_property",
    "kgw_audit_log",
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
) -> AsyncIterator[tuple[httpx.AsyncClient, Any, Any]]:
    """Build the gateway app wired to the running byclaw-qa backend.

    1. Verify byclaw-qa is reachable
    2. Seed KB configs in Redis
    3. Build byclaw-kgw app
    4. Yield (client, pool, app)
    5. Teardown: drop kgw tables, cleanup Redis KB configs
    """
    # ---- 1. Start byclaw-qa as independent subprocess ----
    import subprocess

    from kgw.audit import AuditWriter
    from kgw.auth_provider import AuthProvider
    from kgw.config_provider import KbConfigProvider
    from kgw.db import build_pool, run_migrations
    from kgw.http_client import build_http_client
    from kgw.main import build_app
    from kgw.resilience.circuit_breaker import CircuitBreakerRegistry
    from kgw.settings import get_settings

    qa_port = _QA_PORT
    qa_dir = Path(__file__).resolve().parent.parent.parent.parent / "byclaw-qa"

    # Inherit the current env so byclaw-qa reads the same DB/Redis/MinIO config
    qa_env = os.environ.copy()
    qa_env.setdefault("BYCLAW_QA_PORT", str(qa_port))
    qa_env.setdefault("QA_DOMAINNAME", _QA_SVC_NAME)
    qa_env.setdefault("HOST", "127.0.0.1")

    qa_proc = subprocess.Popen(
        ["bash", "start.sh", "api"],
        cwd=str(qa_dir),
        env=qa_env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

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
                qa_proc.kill()
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

    # ---- 3. Seed KB configs in Redis (with dynamic resourceCode) ----
    direct_config = {
        "resourceId": int(_KN_DIRECT),
        "resourceCode": _resource_codes.get("direct", _RESOURCE_CODE_DIRECT),
        "domainURL": _QA_URL,
        "domainName": "",
        "headers": {"Beyond-Token": "${Beyond-Token}", "Sso-Token": "${Sso-Token}"},
        "resourceService": _ALL_SERVICES,
    }
    discov_config = {
        "resourceId": int(_KN_DISCOV),
        "resourceCode": _resource_codes.get("disc", _RESOURCE_CODE_DISCOV),
        "domainURL": "",
        "domainName": _QA_SVC_NAME,
        "headers": {"Beyond-Token": "${Beyond-Token}", "Sso-Token": "${Sso-Token}"},
        "resourceService": _ALL_SERVICES,
    }

    # ---- 4. Build byclaw-kgw gateway ----
    get_settings.cache_clear()
    settings = get_settings()

    pool = await build_pool(pg_dsn, min_size=1, max_size=5)
    await run_migrations(pool, _SQL_DIR)

    redis_client = await _retry_on_loop_error(
        lambda: redis_async.from_url(redis_url, decode_responses=False)
    )

    # Seed auth for test user so the gateway can resolve ${Beyond-Token} etc.
    await redis_client.hset(
        f"user:{_USER_ID}:login:auth",
        mapping={
            "userId": _USER_ID,
            "userCode": _USER_ID,
            "userName": "TestUser",
            "sessionId": "1",
            "Beyond-Token": "test-beyond-token",
            "Sso-Token": "test-sso-token",
        },
    )

    # Seed KB configs in Redis
    for key, config in [
        (_DIRECT_REDIS_KEY, direct_config),
        (_DISCOV_REDIS_KEY, discov_config),
    ]:
        await redis_client.set(key, json.dumps(config))

    http_client = build_http_client(
        timeout_seconds=30.0, max_connections=20, max_keepalive=5
    )

    config_provider = KbConfigProvider(redis_client=redis_client)
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
    qa_proc.terminate()
    try:
        qa_proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        qa_proc.kill()
        qa_proc.wait()

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

    # Cleanup Redis KB configs
    try:
        for key in [_DIRECT_REDIS_KEY, _DISCOV_REDIS_KEY]:
            await redis_client.delete(key)
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
