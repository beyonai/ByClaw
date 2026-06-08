# KGW S1 · Skeleton & Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the byclaw-kgw single-process FastAPI service skeleton with the four cross-cutting foundations every later slice depends on: KB config provider (MinIO), auth provider (Redis), shared httpx async client, and audit log writer (psycopg async + numbered SQL migrations). Prove the chain end-to-end with one internal `/echo` endpoint that walks all four foundations.

**Architecture:** A single FastAPI app under `src/kgw/` with a lifespan-managed registry of long-lived resources (psycopg `AsyncConnectionPool`, redis client, MinIO async S3 client, httpx `AsyncClient`, audit writer). Each foundation is a self-contained module with one responsibility and a narrow async interface. Numbered SQL files under `sql/` are applied at startup by a tiny idempotent runner (mirrors `by_qa/knowledge_base/sql/` style). All IO is async; no business endpoints land in this slice — only `/healthz`, `/metrics`, and one `/kgw/internal/v1/echo` smoke-test endpoint.

**Tech Stack:** Python 3.12, FastAPI, uvicorn, httpx, psycopg (async, dict_row), aioboto3 (MinIO), redis.asyncio, pydantic v2, pydantic-settings, prometheus_client, structlog, pytest + pytest-asyncio + httpx ASGI + respx + testcontainers, uv for packaging, ruff/pylint/pyink for linting (already configured).

---

## Reference Documents

Read these before starting (paths relative to repo root inside the worktree):

- `docs/superpowers/specs/2026-06-02-knowledge-gateway-design-v5.md` — full v5 design (this slice implements §4.1 module layering for the foundation layer plus the `/healthz`/`/metrics` plumbing)
- `docs/superpowers/specs/2026-06-03-knowledge-gateway-implementation-slicing.md` — slicing rationale; **§4 "S1 · 骨架 + 配置鉴权 Provider + 审计"** is the authoritative scope and acceptance list for this plan
- `byclaw-qa/src/minio_client.py` — reference for MinIO aioboto3 client style
- `byclaw-qa/src/worker.py` lines 98–146 — reference for `${KEY}` Redis hash placeholder resolution

---

## File Structure

All paths below are relative to `byclaw-kgw/`. The worktree root is `.claude/worktrees/kgw-S1-skeleton/`, and `byclaw-kgw/` is a directory under it. Run all commands from `byclaw-kgw/`.

**New files:**

```
byclaw-kgw/
├── pyproject.toml                      # MODIFY: add runtime + test deps
├── pytest.ini                          # CREATE: pytest config (asyncio_mode=auto)
├── .env.example                        # CREATE: env var template
├── sql/
│   ├── 000_extensions.sql              # CREATE: btree_gin / pg_trgm if needed (no-op safe)
│   ├── 001_kgw_audit_log.sql           # CREATE: audit table from v5 spec §5.1
│   ├── 002_kgw_kb_write_history.sql    # CREATE
│   ├── 003_kgw_kb_source_lock.sql      # CREATE
│   └── 004_kgw_kb_conflict_log.sql     # CREATE
├── src/kgw/
│   ├── __init__.py                     # CREATE: package marker + version
│   ├── main.py                         # CREATE: FastAPI app + lifespan + routes
│   ├── settings.py                     # CREATE: pydantic-settings config
│   ├── envelope.py                     # CREATE: unified response envelope + KgwError
│   ├── db.py                           # CREATE: psycopg async pool + migration runner
│   ├── config_provider.py              # CREATE: MinIO KbConfigProvider
│   ├── auth_provider.py                # CREATE: Redis AuthProvider + ${KEY} resolver
│   ├── http_client.py                  # CREATE: shared httpx AsyncClient factory
│   ├── audit/
│   │   ├── __init__.py                 # CREATE
│   │   └── writer.py                   # CREATE: AuditWriter (fire-and-forget)
│   ├── observability/
│   │   ├── __init__.py                 # CREATE
│   │   ├── logger.py                   # CREATE: structlog setup
│   │   ├── metrics.py                  # CREATE: prometheus registry + helpers
│   │   └── tracing.py                  # CREATE: trace_id middleware
│   └── api/
│       ├── __init__.py                 # CREATE
│       └── internal.py                 # CREATE: /kgw/internal/v1/echo
└── tests/
    ├── __init__.py                     # CREATE
    ├── conftest.py                     # CREATE: testcontainers fixtures
    ├── test_settings.py                # CREATE
    ├── test_envelope.py                # CREATE
    ├── test_db_migrations.py           # CREATE
    ├── test_config_provider.py         # CREATE
    ├── test_auth_provider.py           # CREATE
    ├── test_http_client.py             # CREATE
    ├── test_audit_writer.py            # CREATE
    ├── test_observability.py           # CREATE
    └── test_app_smoke.py               # CREATE: /healthz + /echo end-to-end
```

**Responsibilities (one per file):**

- `settings.py` — env-driven config; nothing else reads `os.environ` directly
- `envelope.py` — `success(...)` / `failure(...)` builders + `KgwError` taxonomy used by all error paths
- `db.py` — single `AsyncConnectionPool`; `run_migrations(pool, sql_dir)` applies numbered files once; exposes async context manager `acquire()`
- `config_provider.py` — async `get_kb_config(kn_code) -> KbConfig | None`; reads `resource/doc/KG_DOC_{kn_code}.json` from MinIO; no caching (per spec §3.3)
- `auth_provider.py` — async `get_user_auth(user_code) -> dict[str,str] | None` (raw hash) and `resolve_headers(headers, user_code) -> dict[str,str]` (substitutes `${KEY}` placeholders)
- `http_client.py` — owns one shared `httpx.AsyncClient`; injects `X-Trace-Id`; only retries idempotent reads (GET/HEAD)
- `audit/writer.py` — `AuditWriter.record(entry)` enqueues; background drain task writes to `kgw_audit_log`; failures logged but never raised
- `observability/*` — logger, metrics registry, request-id middleware
- `api/internal.py` — one `/echo` endpoint exercising all foundations; gone after S2 (or kept as smoke test)
- `main.py` — wires everything in lifespan; mounts routers

---

## Conventions

**Commit messages:** Conventional Commits with `kgw` scope, e.g. `feat(kgw): add psycopg async pool and migration runner`. Short subject (≤ 72 chars), no body unless explaining a non-obvious tradeoff.

**Test runner:** All commands assume CWD is `byclaw-kgw/`. Use `uv run pytest -xvs <path>::<test>` for individual tests, `uv run pytest -xvs` for full suite. The `-x` stops at first failure (helpful during TDD), `-v` is verbose, `-s` shows print/log output.

**testcontainers note:** Tasks that need real Postgres / Redis / MinIO use testcontainers fixtures defined in Task 2. Tests are marked `@pytest.mark.integration`. Local docker daemon is required. If unavailable, those tests are skipped (Task 2 sets the skip marker).

**Async test mode:** `pytest-asyncio` is configured in `asyncio_mode=auto` (Task 1) so plain `async def test_*` functions work without decorators.

**Lint discipline:** Pre-commit (husky-driven) runs ruff+pylint+pyink on commit. If a commit fails, fix and re-stage; do NOT use `--no-verify`.

---

## Task Sequence Overview

| # | Task | Outcome |
|---|---|---|
| 1 | Project deps & test config | `uv run pytest` runs an empty suite green; runtime deps installed |
| 2 | Test fixtures (testcontainers) | Postgres/Redis/MinIO fixtures available, gracefully skip when docker absent |
| 3 | Settings module | Env-driven config validated via pydantic-settings |
| 4 | Envelope & error taxonomy | `success()` / `failure()` + `KgwError` ready for all later modules |
| 5 | Observability primitives | structlog, Prometheus registry, trace-id middleware |
| 6 | DB pool + migration runner | psycopg async pool; `run_migrations()` idempotent |
| 7 | SQL migrations 000–004 | Audit + lock + history + conflict tables created at startup |
| 8 | KbConfigProvider | Read `KG_DOC_{knCode}.json` from MinIO; returns `None` when missing |
| 9 | AuthProvider | Read `user:{user_code}:login:auth` hash; resolve `${KEY}` placeholders |
| 10 | HTTP client factory | Shared httpx AsyncClient with trace-id + GET retry |
| 11 | AuditWriter | Fire-and-forget queue → DB; failures logged not raised |
| 12 | FastAPI app & lifespan | `main.py` wires foundations; `/healthz` + `/metrics` live |
| 13 | `/kgw/internal/v1/echo` smoke endpoint | End-to-end happy path through all foundations |
| 14 | App-level smoke test | Single test exercises whole chain via httpx ASGI client |
| 15 | Final acceptance review | Walk v5 spec §S1 acceptance list, confirm each item |

Each task is self-contained: it includes the failing test, the run command with expected output, the implementation, the passing test, and the commit. Tasks 1–7 lay the foundation in dependency order; tasks 8–11 implement the four providers; tasks 12–14 wire and validate.

### Task 1: Project Dependencies & Test Configuration

**Goal:** Add runtime + test dependencies to `pyproject.toml`, add `pytest.ini`, and confirm `uv run pytest` finds an empty suite cleanly.

**Files:**
- Modify: `pyproject.toml`
- Create: `pytest.ini`
- Create: `tests/__init__.py`
- Create: `tests/test_smoke_imports.py`

- [ ] **Step 1: Write a placeholder test that imports the (not-yet-existing) package**

`tests/__init__.py`:

```python
```

`tests/test_smoke_imports.py`:

```python
def test_python_works():
    """Smoke test: pytest discovers and runs tests in this repo."""
    assert 1 + 1 == 2
```

- [ ] **Step 2: Run pytest before any deps to confirm it fails (no pytest installed)**

```bash
uv run pytest -xvs tests/test_smoke_imports.py
```

Expected: error like `error: Failed to spawn: pytest` or `No module named pytest` — pytest is not yet a dependency.

- [ ] **Step 3: Update `pyproject.toml` runtime + dev dependencies**

Replace the `[project]` and `[dependency-groups]` sections. Keep the `[project]` header and metadata fields intact.

```toml
[project]
name = "byclaw-kgw"
version = "0.1.0"
description = "BeyondAI Knowledge Gateway"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.32.0",
    "httpx>=0.27.0",
    "psycopg[binary,pool]>=3.2.0",
    "redis>=5.2.0",
    "aioboto3>=13.2.0",
    "pydantic>=2.9.0",
    "pydantic-settings>=2.6.0",
    "prometheus-client>=0.21.0",
    "structlog>=24.4.0",
    "opentelemetry-api>=1.28.0",
]

[dependency-groups]
dev = [
    "ruff>=0.9.4",
    "pylint>=3.3.1",
    "pyink==25.12.0",
    "isort>=5.13.2",
    "pre-commit>=4.0",
    "pytest>=8.3.0",
    "pytest-asyncio>=0.24.0",
    "respx>=0.21.0",
    "testcontainers[postgres,redis,minio]>=4.8.0",
    "fakeredis>=2.26.0",
]

[tool.setuptools.packages.find]
where = ["src"]
```

- [ ] **Step 4: Create `pytest.ini`**

```ini
[pytest]
asyncio_mode = auto
testpaths = tests
markers =
    integration: marks tests requiring docker (Postgres/Redis/MinIO containers)
addopts = --strict-markers
```

- [ ] **Step 5: Sync deps**

```bash
uv sync --group dev
```

Expected: resolves and installs all packages. If `testcontainers[postgres,redis,minio]` complains about missing extras, fall back to `testcontainers>=4.8.0` (the extras are advisory; the base package is enough since 4.x).

- [ ] **Step 6: Run pytest to confirm green**

```bash
uv run pytest -xvs
```

Expected: `1 passed` (the `test_python_works` smoke test).

- [ ] **Step 7: Commit**

```bash
git add pyproject.toml pytest.ini tests/__init__.py tests/test_smoke_imports.py uv.lock
git commit -m "chore(kgw): add runtime and test dependencies, configure pytest"
```

Note: pre-commit will run ruff/pylint/pyink. Empty `__init__.py` and a one-line test should pass cleanly.

### Task 2: Test Fixtures (testcontainers + Docker availability)

**Goal:** Provide session-scoped Postgres, Redis, and MinIO fixtures via testcontainers; auto-skip integration tests when Docker is unavailable. Later tasks depend on these fixtures.

**Files:**
- Create: `tests/conftest.py`
- Create: `tests/test_fixtures_smoke.py`

- [ ] **Step 1: Write the failing fixture-availability test**

`tests/test_fixtures_smoke.py`:

```python
import pytest


@pytest.mark.integration
async def test_postgres_fixture_alive(pg_dsn: str):
    """The pg fixture should yield a usable DSN."""
    import psycopg

    async with await psycopg.AsyncConnection.connect(pg_dsn) as conn:
        cur = await conn.execute("SELECT 1 AS ok")
        row = await cur.fetchone()
        assert row[0] == 1


@pytest.mark.integration
async def test_redis_fixture_alive(redis_url: str):
    import redis.asyncio as redis_async

    client = redis_async.from_url(redis_url)
    try:
        pong = await client.ping()
        assert pong is True
    finally:
        await client.aclose()


@pytest.mark.integration
async def test_minio_fixture_alive(minio_settings: dict):
    import aioboto3

    session = aioboto3.Session()
    async with session.client(
        "s3",
        endpoint_url=minio_settings["endpoint_url"],
        aws_access_key_id=minio_settings["access_key"],
        aws_secret_access_key=minio_settings["secret_key"],
    ) as s3:
        result = await s3.list_buckets()
        assert "Buckets" in result
```

- [ ] **Step 2: Run tests to verify they fail with "fixture not found"**

```bash
uv run pytest -xvs tests/test_fixtures_smoke.py
```

Expected: `fixture 'pg_dsn' not found` (or similar) for each test.

- [ ] **Step 3: Create `tests/conftest.py` with fixtures**

```python
"""Shared test fixtures for byclaw-kgw.

Integration fixtures use testcontainers to spin up Postgres, Redis, and
MinIO. If Docker is unavailable on the host, integration tests are
skipped instead of failing.
"""

from __future__ import annotations

import shutil
import socket
from collections.abc import Iterator

import pytest


def _docker_available() -> bool:
    """Return True if a docker daemon is reachable."""
    if shutil.which("docker") is None:
        return False
    sock_path = "/var/run/docker.sock"
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.5)
            sock.connect(sock_path)
        return True
    except (OSError, FileNotFoundError):
        # Fall through: docker may be reachable via TCP / Docker Desktop.
        # Try the CLI as a last check.
        import subprocess

        try:
            result = subprocess.run(
                ["docker", "info"],
                capture_output=True,
                timeout=3,
                check=False,
            )
            return result.returncode == 0
        except (subprocess.TimeoutExpired, OSError):
            return False


_DOCKER_AVAILABLE = _docker_available()


def pytest_collection_modifyitems(config, items):
    """Auto-skip integration tests when Docker is unavailable."""
    if _DOCKER_AVAILABLE:
        return
    skip_marker = pytest.mark.skip(
        reason="docker daemon unavailable; skipping integration test"
    )
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip_marker)


@pytest.fixture(scope="session")
def pg_dsn() -> Iterator[str]:
    """Session-scoped Postgres container; yields a DSN string."""
    from testcontainers.postgres import PostgresContainer

    with PostgresContainer("postgres:16-alpine") as pg:
        # testcontainers returns SQLAlchemy-style URL; psycopg wants postgresql://
        url = pg.get_connection_url().replace("postgresql+psycopg2://", "postgresql://")
        yield url


@pytest.fixture(scope="session")
def redis_url() -> Iterator[str]:
    from testcontainers.redis import RedisContainer

    with RedisContainer("redis:7-alpine") as r:
        host = r.get_container_host_ip()
        port = r.get_exposed_port(6379)
        yield f"redis://{host}:{port}/0"


@pytest.fixture(scope="session")
def minio_settings() -> Iterator[dict]:
    """Session-scoped MinIO container; yields connection settings dict."""
    from testcontainers.minio import MinioContainer

    with MinioContainer() as m:
        cfg = m.get_config()
        yield {
            "endpoint_url": f"http://{cfg['endpoint']}",
            "access_key": cfg["access_key"],
            "secret_key": cfg["secret_key"],
            "bucket": "kgw-test",
        }


@pytest.fixture
async def minio_bucket(minio_settings: dict) -> str:
    """Ensure the test bucket exists; return its name."""
    import aioboto3
    from botocore.exceptions import ClientError

    session = aioboto3.Session()
    bucket = minio_settings["bucket"]
    async with session.client(
        "s3",
        endpoint_url=minio_settings["endpoint_url"],
        aws_access_key_id=minio_settings["access_key"],
        aws_secret_access_key=minio_settings["secret_key"],
    ) as s3:
        try:
            await s3.head_bucket(Bucket=bucket)
        except ClientError:
            await s3.create_bucket(Bucket=bucket)
    return bucket
```

- [ ] **Step 4: Run integration tests**

```bash
uv run pytest -xvs tests/test_fixtures_smoke.py
```

Expected (Docker available): `3 passed`. First run pulls images (slow). Subsequent runs ~5s.
Expected (Docker missing): `3 skipped` with reason "docker daemon unavailable".

- [ ] **Step 5: Run full suite to confirm previous test still passes**

```bash
uv run pytest -xvs
```

Expected: `4 passed` (or `1 passed, 3 skipped` if no docker).

- [ ] **Step 6: Commit**

```bash
git add tests/conftest.py tests/test_fixtures_smoke.py
git commit -m "test(kgw): add testcontainers fixtures for pg/redis/minio with docker auto-skip"
```

### Task 3: Settings Module

**Goal:** All env var reads happen in one place. `get_settings()` returns a cached pydantic-settings model.

**Files:**
- Create: `src/kgw/__init__.py`
- Create: `src/kgw/settings.py`
- Create: `tests/test_settings.py`
- Create: `.env.example`

- [ ] **Step 1: Write the failing test**

`tests/test_settings.py`:

```python
from __future__ import annotations

import pytest


def test_settings_loads_from_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("KGW_DB_DSN", "postgresql://u:p@host:5432/kgw")
    monkeypatch.setenv("KGW_REDIS_URL", "redis://r:6379/0")
    monkeypatch.setenv("KGW_MINIO_ENDPOINT", "http://minio:9000")
    monkeypatch.setenv("KGW_MINIO_ACCESS_KEY", "ak")
    monkeypatch.setenv("KGW_MINIO_SECRET_KEY", "sk")
    monkeypatch.setenv("KGW_MINIO_BUCKET", "byclaw")

    # Import inside the test so monkeypatch is in scope before module load.
    from kgw.settings import Settings, get_settings

    get_settings.cache_clear()
    s = get_settings()

    assert isinstance(s, Settings)
    assert s.db_dsn == "postgresql://u:p@host:5432/kgw"
    assert s.redis_url == "redis://r:6379/0"
    assert s.minio_endpoint == "http://minio:9000"
    assert s.minio_access_key == "ak"
    assert s.minio_secret_key == "sk"
    assert s.minio_bucket == "byclaw"
    # Defaults
    assert s.minio_kg_doc_prefix == "resource/doc/KG_DOC_"
    assert s.redis_auth_key_template == "user:{user_code}:login:auth"
    assert s.http_default_timeout_seconds == 30.0


def test_settings_missing_required_field_raises(monkeypatch: pytest.MonkeyPatch):
    # Clear all relevant vars
    for var in [
        "KGW_DB_DSN",
        "KGW_REDIS_URL",
        "KGW_MINIO_ENDPOINT",
        "KGW_MINIO_ACCESS_KEY",
        "KGW_MINIO_SECRET_KEY",
        "KGW_MINIO_BUCKET",
    ]:
        monkeypatch.delenv(var, raising=False)

    from kgw.settings import get_settings
    from pydantic import ValidationError

    get_settings.cache_clear()
    with pytest.raises(ValidationError):
        get_settings()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest -xvs tests/test_settings.py
```

Expected: `ModuleNotFoundError: No module named 'kgw'`.

- [ ] **Step 3: Create `src/kgw/__init__.py`**

```python
"""byclaw-kgw: BeyondAI Knowledge Gateway."""

__version__ = "0.1.0"
```

- [ ] **Step 4: Create `src/kgw/settings.py`**

```python
"""Environment-driven configuration for byclaw-kgw.

All config reads must go through ``get_settings()``. Modules MUST NOT
read os.environ directly; this keeps configuration auditable and
testable via monkeypatch.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration sourced from environment variables.

    Env var prefix is ``KGW_``; field names are lowercased.
    """

    model_config = SettingsConfigDict(
        env_prefix="KGW_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # PostgreSQL / OpenGauss
    db_dsn: str = Field(..., description="psycopg-compatible DSN")
    db_pool_min_size: int = 1
    db_pool_max_size: int = 10
    db_schema: str = ""

    # Redis (auth source)
    redis_url: str = Field(..., description="redis:// URL with db number")
    redis_auth_key_template: str = "user:{user_code}:login:auth"

    # MinIO (KB config source)
    minio_endpoint: str = Field(..., description="MinIO HTTP endpoint, no scheme prefix required")
    minio_access_key: str
    minio_secret_key: str
    minio_bucket: str
    minio_kg_doc_prefix: str = "resource/doc/KG_DOC_"
    minio_secure: bool = False

    # HTTP client
    http_default_timeout_seconds: float = 30.0
    http_pool_max_connections: int = 200
    http_pool_max_keepalive: int = 50

    # Audit
    audit_queue_max_size: int = 10_000


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a process-wide Settings instance."""
    return Settings()
```

- [ ] **Step 5: Create `.env.example`**

```dotenv
# Database (PostgreSQL or OpenGauss with PG-compatible protocol)
KGW_DB_DSN=postgresql://kgw:kgw@localhost:5432/kgw
KGW_DB_POOL_MIN_SIZE=1
KGW_DB_POOL_MAX_SIZE=10
KGW_DB_SCHEMA=

# Redis (read-only; portal writes user auth to user:{user_code}:login:auth)
KGW_REDIS_URL=redis://localhost:6379/0
KGW_REDIS_AUTH_KEY_TEMPLATE=user:{user_code}:login:auth

# MinIO (KB config source: resource/doc/KG_DOC_{knCode}.json)
KGW_MINIO_ENDPOINT=localhost:9000
KGW_MINIO_ACCESS_KEY=minioadmin
KGW_MINIO_SECRET_KEY=minioadmin
KGW_MINIO_BUCKET=byclaw
KGW_MINIO_KG_DOC_PREFIX=resource/doc/KG_DOC_
KGW_MINIO_SECURE=false

# HTTP client
KGW_HTTP_DEFAULT_TIMEOUT_SECONDS=30.0
KGW_HTTP_POOL_MAX_CONNECTIONS=200
KGW_HTTP_POOL_MAX_KEEPALIVE=50

# Audit
KGW_AUDIT_QUEUE_MAX_SIZE=10000
```

- [ ] **Step 6: Verify package is importable via uv**

The package layout is `src/kgw/`. The `[tool.setuptools.packages.find] where=["src"]` from Task 1 makes it discoverable. Re-sync if needed:

```bash
uv sync --group dev
```

- [ ] **Step 7: Run test to verify it passes**

```bash
uv run pytest -xvs tests/test_settings.py
```

Expected: `2 passed`.

- [ ] **Step 8: Commit**

```bash
git add src/kgw/__init__.py src/kgw/settings.py tests/test_settings.py .env.example
git commit -m "feat(kgw): add pydantic-settings configuration module"
```

### Task 4: Unified Envelope & Error Taxonomy

**Goal:** All endpoints return `{resultCode, resultMsg, resultObject}`. All known failure modes are typed `KgwError` subclasses with stable `error_type` strings (per v5 spec §6.6). Later tasks raise these, never bare exceptions.

**Files:**
- Create: `src/kgw/envelope.py`
- Create: `tests/test_envelope.py`

- [ ] **Step 1: Write the failing test**

`tests/test_envelope.py`:

```python
from __future__ import annotations

import pytest


def test_success_envelope_with_object():
    from kgw.envelope import success

    env = success({"foo": 1})
    assert env == {
        "resultCode": "0",
        "resultMsg": "success",
        "resultObject": {"foo": 1},
    }


def test_success_envelope_default_empty_object():
    from kgw.envelope import success

    env = success()
    assert env == {
        "resultCode": "0",
        "resultMsg": "success",
        "resultObject": {},
    }


def test_failure_envelope_basic():
    from kgw.envelope import failure

    env = failure(error_type="KBNotFound", message="kb not found: hr_policy")
    assert env["resultCode"] == "-1"
    assert env["resultMsg"] == "kb not found: hr_policy"
    assert env["resultObject"] == {"errorCode": "KBNotFound"}


def test_failure_envelope_with_extra():
    from kgw.envelope import failure

    env = failure(
        error_type="MetadataPropertyConflict",
        message="type mismatch",
        extra={"propertyName": "status", "expected": "string", "actual": "integer"},
    )
    assert env["resultObject"] == {
        "errorCode": "MetadataPropertyConflict",
        "propertyName": "status",
        "expected": "string",
        "actual": "integer",
    }


def test_kgw_error_carries_metadata():
    from kgw.envelope import KBNotFound, KgwError

    err = KBNotFound("kb not found: hr_policy", kn_code="hr_policy")
    assert isinstance(err, KgwError)
    assert err.error_type == "KBNotFound"
    assert err.message == "kb not found: hr_policy"
    assert err.extra == {"knCode": "hr_policy"}


def test_kgw_error_to_envelope():
    from kgw.envelope import AuthInfoNotFound

    err = AuthInfoNotFound(
        "auth missing for user_0001", user_code="user_0001"
    )
    env = err.to_envelope()
    assert env == {
        "resultCode": "-1",
        "resultMsg": "auth missing for user_0001",
        "resultObject": {"errorCode": "AuthInfoNotFound", "userCode": "user_0001"},
    }


@pytest.mark.parametrize(
    "cls_name,error_type",
    [
        ("KBNotFound", "KBNotFound"),
        ("OperationNotSupported", "OperationNotSupported"),
        ("UpstreamTimeout", "UpstreamTimeout"),
        ("UpstreamConnectError", "UpstreamConnectError"),
        ("UploadStreamBroken", "UploadStreamBroken"),
        ("DownloadStreamBroken", "DownloadStreamBroken"),
        ("AuthInfoNotFound", "AuthInfoNotFound"),
        ("BackendAuthFailed", "BackendAuthFailed"),
        ("CircuitOpen", "CircuitOpen"),
        ("MetadataPropertyNotFound", "MetadataPropertyNotFound"),
        ("MetadataPropertyConflict", "MetadataPropertyConflict"),
        ("MetadataPropertySyncFailed", "MetadataPropertySyncFailed"),
    ],
)
def test_all_error_classes_present(cls_name, error_type):
    """v5 spec §6.6 lists every error type the gateway must expose."""
    import kgw.envelope as envelope_module

    cls = getattr(envelope_module, cls_name)
    instance = cls("msg")
    assert instance.error_type == error_type
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest -xvs tests/test_envelope.py
```

Expected: `ModuleNotFoundError: No module named 'kgw.envelope'`.

- [ ] **Step 3: Create `src/kgw/envelope.py`**

```python
"""Unified response envelope and KGW error taxonomy.

Every endpoint returns ``{resultCode, resultMsg, resultObject}``. Known
failure modes are subclasses of ``KgwError`` with a stable ``error_type``
string matching v5 spec §6.6. Endpoints translate raised KgwErrors into
envelopes; unknown exceptions are translated to a generic 500 envelope by
the FastAPI exception handler (wired in main.py).
"""

from __future__ import annotations

from typing import Any


def success(result_object: Any | None = None) -> dict[str, Any]:
    """Build a success envelope.

    Args:
        result_object: Business payload. Defaults to an empty dict.
    """
    return {
        "resultCode": "0",
        "resultMsg": "success",
        "resultObject": result_object if result_object is not None else {},
    }


def failure(
    *,
    error_type: str,
    message: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a failure envelope with a typed error code.

    The ``resultObject.errorCode`` field is the stable machine-readable
    error type. Additional context goes into other ``resultObject`` keys.
    """
    body: dict[str, Any] = {"errorCode": error_type}
    if extra:
        body.update(extra)
    return {
        "resultCode": "-1",
        "resultMsg": message,
        "resultObject": body,
    }


class KgwError(Exception):
    """Base class for all gateway-typed errors.

    Subclasses MUST set ``error_type`` to the v5 spec §6.6 string.
    Constructor accepts free-form keyword args that are camelCased into
    ``extra`` for the envelope.
    """

    error_type: str = "InternalError"

    def __init__(self, message: str, **extra: Any) -> None:
        super().__init__(message)
        self.message = message
        # Convert snake_case kwargs to camelCase keys for the envelope body.
        self.extra: dict[str, Any] = {_camel(k): v for k, v in extra.items()}

    def to_envelope(self) -> dict[str, Any]:
        return failure(
            error_type=self.error_type, message=self.message, extra=self.extra
        )


def _camel(snake: str) -> str:
    parts = snake.split("_")
    return parts[0] + "".join(p.title() for p in parts[1:])


# v5 spec §6.6 error taxonomy. Each subclass below corresponds to one row.
class KBNotFound(KgwError):
    error_type = "KBNotFound"


class OperationNotSupported(KgwError):
    error_type = "OperationNotSupported"


class UpstreamTimeout(KgwError):
    error_type = "UpstreamTimeout"


class UpstreamConnectError(KgwError):
    error_type = "UpstreamConnectError"


class UploadStreamBroken(KgwError):
    error_type = "UploadStreamBroken"


class DownloadStreamBroken(KgwError):
    error_type = "DownloadStreamBroken"


class AuthInfoNotFound(KgwError):
    error_type = "AuthInfoNotFound"


class BackendAuthFailed(KgwError):
    error_type = "BackendAuthFailed"


class CircuitOpen(KgwError):
    error_type = "CircuitOpen"


class MetadataPropertyNotFound(KgwError):
    error_type = "MetadataPropertyNotFound"


class MetadataPropertyConflict(KgwError):
    error_type = "MetadataPropertyConflict"


class MetadataPropertySyncFailed(KgwError):
    error_type = "MetadataPropertySyncFailed"
```

- [ ] **Step 4: Run test to verify it passes**

```bash
uv run pytest -xvs tests/test_envelope.py
```

Expected: all tests pass (count: 7 + 12 parametrized = 19 passed).

- [ ] **Step 5: Commit**

```bash
git add src/kgw/envelope.py tests/test_envelope.py
git commit -m "feat(kgw): add unified envelope and KgwError taxonomy from v5 spec"
```

### Task 5: Observability Primitives

**Goal:** structlog logger + Prometheus registry + a request-id middleware that injects/forwards `X-Trace-Id`. All later modules log via `get_logger(__name__)` and emit metrics via the shared registry.

**Files:**
- Create: `src/kgw/observability/__init__.py`
- Create: `src/kgw/observability/logger.py`
- Create: `src/kgw/observability/metrics.py`
- Create: `src/kgw/observability/tracing.py`
- Create: `tests/test_observability.py`

- [ ] **Step 1: Write the failing tests**

`tests/test_observability.py`:

```python
from __future__ import annotations

import asyncio


def test_logger_returns_structlog_bound_logger():
    from kgw.observability.logger import configure_logging, get_logger

    configure_logging(json_logs=False)
    log = get_logger("kgw.test")
    # Should not raise
    log.info("hello", k="v")


def test_metrics_registry_singleton():
    from kgw.observability.metrics import get_registry

    r1 = get_registry()
    r2 = get_registry()
    assert r1 is r2


def test_metrics_registry_emits_default_metrics():
    from prometheus_client import generate_latest

    from kgw.observability.metrics import get_registry

    output = generate_latest(get_registry()).decode("utf-8")
    # The registry must be ready to receive new metrics; default content is fine.
    assert isinstance(output, str)


async def test_trace_id_middleware_generates_when_missing():
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from kgw.observability.tracing import (
        TraceIdMiddleware,
        current_trace_id,
        TRACE_HEADER,
    )

    app = FastAPI()
    app.add_middleware(TraceIdMiddleware)

    captured = {}

    @app.get("/x")
    async def x():
        captured["seen"] = current_trace_id()
        return {"ok": True}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        resp = await c.get("/x")
    assert resp.status_code == 200
    assert resp.headers[TRACE_HEADER]
    assert captured["seen"] == resp.headers[TRACE_HEADER]


async def test_trace_id_middleware_propagates_inbound():
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from kgw.observability.tracing import TraceIdMiddleware, TRACE_HEADER

    app = FastAPI()
    app.add_middleware(TraceIdMiddleware)

    @app.get("/x")
    async def x():
        return {"ok": True}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        resp = await c.get("/x", headers={TRACE_HEADER: "trace-abc"})
    assert resp.headers[TRACE_HEADER] == "trace-abc"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest -xvs tests/test_observability.py
```

Expected: `ModuleNotFoundError: No module named 'kgw.observability'`.

- [ ] **Step 3: Create `src/kgw/observability/__init__.py`**

```python
"""Observability primitives: structured logs, Prometheus metrics, tracing."""
```

- [ ] **Step 4: Create `src/kgw/observability/logger.py`**

```python
"""Structured logging via structlog.

Call ``configure_logging()`` once at startup. All other modules use
``get_logger(__name__)``. Bound context (trace_id, kn_code, operation)
is added per-request via ``logger.bind(...)``.
"""

from __future__ import annotations

import logging
import sys

import structlog


def configure_logging(*, json_logs: bool = True, level: str = "INFO") -> None:
    """Configure structlog. Idempotent — safe to call multiple times."""
    timestamper = structlog.processors.TimeStamper(fmt="iso", utc=True)
    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        timestamper,
    ]
    if json_logs:
        renderer = structlog.processors.JSONRenderer()
    else:
        renderer = structlog.dev.ConsoleRenderer(colors=False)

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, level.upper())
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(file=sys.stderr),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    """Return a structlog logger bound to ``name``."""
    return structlog.get_logger(name)
```

- [ ] **Step 5: Create `src/kgw/observability/metrics.py`**

```python
"""Prometheus metrics registry.

A single ``CollectorRegistry`` is shared across the process. Endpoint
modules register their counters/histograms once at import time.
"""

from __future__ import annotations

from prometheus_client import CollectorRegistry

_REGISTRY: CollectorRegistry | None = None


def get_registry() -> CollectorRegistry:
    """Return the process-wide Prometheus registry."""
    global _REGISTRY
    if _REGISTRY is None:
        _REGISTRY = CollectorRegistry(auto_describe=True)
    return _REGISTRY
```

- [ ] **Step 6: Create `src/kgw/observability/tracing.py`**

```python
"""Trace-ID propagation middleware.

Reads ``X-Trace-Id`` from the inbound request; generates a UUID if
absent. Stores the ID in a ContextVar so log calls and downstream
http clients can pick it up. Echoes the ID on the response.
"""

from __future__ import annotations

import contextvars
import uuid

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

TRACE_HEADER = "X-Trace-Id"

_trace_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "kgw_trace_id", default=None
)


def current_trace_id() -> str | None:
    """Return the current request's trace id, or None outside a request."""
    return _trace_id_var.get()


class TraceIdMiddleware(BaseHTTPMiddleware):
    """Inject/forward the trace id and bind it into the structlog context."""

    async def dispatch(self, request: Request, call_next):
        incoming = request.headers.get(TRACE_HEADER)
        trace_id = incoming or uuid.uuid4().hex
        token = _trace_id_var.set(trace_id)
        structlog.contextvars.bind_contextvars(trace_id=trace_id)
        try:
            response: Response = await call_next(request)
        finally:
            _trace_id_var.reset(token)
            structlog.contextvars.unbind_contextvars("trace_id")
        response.headers[TRACE_HEADER] = trace_id
        return response
```

- [ ] **Step 7: Run test to verify it passes**

```bash
uv run pytest -xvs tests/test_observability.py
```

Expected: `5 passed`.

- [ ] **Step 8: Commit**

```bash
git add src/kgw/observability tests/test_observability.py
git commit -m "feat(kgw): add structlog, prometheus registry, trace-id middleware"
```

### Task 6: DB Pool + Migration Runner

**Goal:** A single `AsyncConnectionPool` lives for the app lifetime. `run_migrations(pool, sql_dir)` applies numbered SQL files at startup exactly once each, tracking applied files in a `kgw_migration` table.

**Files:**
- Create: `src/kgw/db.py`
- Create: `tests/test_db_migrations.py`

- [ ] **Step 1: Write the failing test**

`tests/test_db_migrations.py`:

```python
from __future__ import annotations

from pathlib import Path

import pytest


@pytest.mark.integration
async def test_migration_runner_applies_files_once(pg_dsn: str, tmp_path: Path):
    from kgw.db import build_pool, run_migrations

    sql_dir = tmp_path / "sql"
    sql_dir.mkdir()
    (sql_dir / "001_users.sql").write_text(
        "CREATE TABLE kgw_test_users (id INT PRIMARY KEY, name TEXT);"
    )
    (sql_dir / "002_orders.sql").write_text(
        "CREATE TABLE kgw_test_orders (id INT PRIMARY KEY, user_id INT);"
    )

    pool = await build_pool(pg_dsn, min_size=1, max_size=2)
    try:
        # First run applies both
        applied = await run_migrations(pool, sql_dir)
        assert applied == ["001_users.sql", "002_orders.sql"]

        # Second run applies none
        applied = await run_migrations(pool, sql_dir)
        assert applied == []

        # Confirm tables exist
        async with pool.connection() as conn:
            cur = await conn.execute(
                "SELECT to_regclass('kgw_test_users') AS t1, "
                "to_regclass('kgw_test_orders') AS t2"
            )
            row = await cur.fetchone()
            assert row[0] == "kgw_test_users"
            assert row[1] == "kgw_test_orders"
    finally:
        async with pool.connection() as conn:
            await conn.execute("DROP TABLE IF EXISTS kgw_test_users")
            await conn.execute("DROP TABLE IF EXISTS kgw_test_orders")
            await conn.execute("DROP TABLE IF EXISTS kgw_migration")
            await conn.commit()
        await pool.close()


@pytest.mark.integration
async def test_migration_runner_skips_non_sql_files(pg_dsn: str, tmp_path: Path):
    from kgw.db import build_pool, run_migrations

    sql_dir = tmp_path / "sql"
    sql_dir.mkdir()
    (sql_dir / "001_init.sql").write_text(
        "CREATE TABLE kgw_test_init (id INT PRIMARY KEY);"
    )
    (sql_dir / "README.md").write_text("# notes")
    (sql_dir / "002_init.sql.bak").write_text("nonsense")

    pool = await build_pool(pg_dsn, min_size=1, max_size=2)
    try:
        applied = await run_migrations(pool, sql_dir)
        assert applied == ["001_init.sql"]
    finally:
        async with pool.connection() as conn:
            await conn.execute("DROP TABLE IF EXISTS kgw_test_init")
            await conn.execute("DROP TABLE IF EXISTS kgw_migration")
            await conn.commit()
        await pool.close()


@pytest.mark.integration
async def test_pool_acquire_returns_dict_rows(pg_dsn: str):
    from kgw.db import build_pool

    pool = await build_pool(pg_dsn, min_size=1, max_size=2)
    try:
        async with pool.connection() as conn:
            cur = await conn.execute("SELECT 1 AS one, 'x' AS letter")
            row = await cur.fetchone()
            assert row == {"one": 1, "letter": "x"}
    finally:
        await pool.close()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest -xvs tests/test_db_migrations.py
```

Expected: `ModuleNotFoundError: No module named 'kgw.db'`.

- [ ] **Step 3: Create `src/kgw/db.py`**

```python
"""PostgreSQL / OpenGauss async connection pool and migration runner.

Mirrors byclaw-qa's ``by_qa/knowledge_base/infrastructure/database.py``
style: psycopg async with ``dict_row``. Migrations are numbered SQL
files applied in lexical order; applied filenames are recorded in
``kgw_migration`` to make startup idempotent.
"""

from __future__ import annotations

from pathlib import Path

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from kgw.observability.logger import get_logger

_log = get_logger(__name__)

_MIGRATION_TABLE_DDL = """
CREATE TABLE IF NOT EXISTS kgw_migration (
    filename     VARCHAR(256) PRIMARY KEY,
    applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
"""


async def build_pool(
    dsn: str,
    *,
    min_size: int = 1,
    max_size: int = 10,
) -> AsyncConnectionPool:
    """Create and open an async connection pool with dict-row factory."""
    pool = AsyncConnectionPool(
        conninfo=dsn,
        min_size=min_size,
        max_size=max_size,
        open=False,
        kwargs={"row_factory": dict_row, "autocommit": False},
    )
    await pool.open()
    await pool.wait()
    _log.info("db.pool.opened", min_size=min_size, max_size=max_size)
    return pool


async def run_migrations(pool: AsyncConnectionPool, sql_dir: Path) -> list[str]:
    """Apply each ``NNN_*.sql`` in ``sql_dir`` once; return newly applied names.

    Files not matching ``*.sql`` (case-insensitive) are ignored. Files are
    applied in lexical order of filename. Each migration is a single
    transaction; failure aborts startup.
    """
    sql_dir = Path(sql_dir)
    if not sql_dir.is_dir():
        raise FileNotFoundError(f"sql_dir not found: {sql_dir}")

    files = sorted(p for p in sql_dir.iterdir() if p.suffix.lower() == ".sql")

    async with pool.connection() as conn:
        await conn.execute(_MIGRATION_TABLE_DDL)
        await conn.commit()
        cur = await conn.execute("SELECT filename FROM kgw_migration")
        already = {row["filename"] for row in await cur.fetchall()}

    newly_applied: list[str] = []
    for path in files:
        if path.name in already:
            continue
        sql = path.read_text(encoding="utf-8")
        async with pool.connection() as conn:
            try:
                await conn.execute(sql)
                await conn.execute(
                    "INSERT INTO kgw_migration (filename) VALUES (%s)",
                    (path.name,),
                )
                await conn.commit()
            except Exception:
                await conn.rollback()
                _log.error("db.migration.failed", filename=path.name)
                raise
        newly_applied.append(path.name)
        _log.info("db.migration.applied", filename=path.name)

    return newly_applied
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
uv run pytest -xvs tests/test_db_migrations.py
```

Expected (Docker available): `3 passed`. Expected (no Docker): `3 skipped`.

- [ ] **Step 5: Commit**

```bash
git add src/kgw/db.py tests/test_db_migrations.py
git commit -m "feat(kgw): add psycopg async pool and idempotent SQL migration runner"
```

### Task 7: SQL Migrations 000–004

**Goal:** Ship the four S1 storage tables (`kgw_audit_log`, `kgw_kb_write_history`, `kgw_kb_source_lock`, `kgw_kb_conflict_log`) plus an extensions placeholder, all from v5 spec §5.1. They will be applied at startup in Task 12.

**Files:**
- Create: `sql/000_extensions.sql`
- Create: `sql/001_kgw_audit_log.sql`
- Create: `sql/002_kgw_kb_write_history.sql`
- Create: `sql/003_kgw_kb_source_lock.sql`
- Create: `sql/004_kgw_kb_conflict_log.sql`
- Create: `tests/test_sql_migrations.py`

- [ ] **Step 1: Write the failing test**

`tests/test_sql_migrations.py`:

```python
from __future__ import annotations

from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
SQL_DIR = REPO_ROOT / "sql"


@pytest.mark.integration
async def test_s1_migrations_create_expected_tables(pg_dsn: str):
    from kgw.db import build_pool, run_migrations

    pool = await build_pool(pg_dsn, min_size=1, max_size=2)
    try:
        applied = await run_migrations(pool, SQL_DIR)
        assert "001_kgw_audit_log.sql" in applied
        assert "002_kgw_kb_write_history.sql" in applied
        assert "003_kgw_kb_source_lock.sql" in applied
        assert "004_kgw_kb_conflict_log.sql" in applied

        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT to_regclass('kgw_audit_log')         AS audit,
                       to_regclass('kgw_kb_write_history')  AS history,
                       to_regclass('kgw_kb_source_lock')    AS lock,
                       to_regclass('kgw_kb_conflict_log')   AS conflict
                """
            )
            row = await cur.fetchone()
            assert row["audit"] == "kgw_audit_log"
            assert row["history"] == "kgw_kb_write_history"
            assert row["lock"] == "kgw_kb_source_lock"
            assert row["conflict"] == "kgw_kb_conflict_log"
    finally:
        async with pool.connection() as conn:
            for table in (
                "kgw_audit_log",
                "kgw_kb_write_history",
                "kgw_kb_source_lock",
                "kgw_kb_conflict_log",
                "kgw_migration",
            ):
                await conn.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
            await conn.commit()
        await pool.close()


@pytest.mark.integration
async def test_audit_log_columns_present(pg_dsn: str):
    """Spot-check column names match v5 spec §5.1."""
    from kgw.db import build_pool, run_migrations

    pool = await build_pool(pg_dsn, min_size=1, max_size=2)
    try:
        await run_migrations(pool, SQL_DIR)
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'kgw_audit_log'
                """
            )
            cols = {row["column_name"] for row in await cur.fetchall()}
        # Spot check a representative subset
        for required in (
            "id",
            "source",
            "trace_id",
            "actor_user_id",
            "actor_kind",
            "operation_type",
            "kn_code",
            "file_path",
            "result_code",
            "latency_ms",
            "created_at",
        ):
            assert required in cols, f"missing column {required}"
    finally:
        async with pool.connection() as conn:
            for table in (
                "kgw_audit_log",
                "kgw_kb_write_history",
                "kgw_kb_source_lock",
                "kgw_kb_conflict_log",
                "kgw_migration",
            ):
                await conn.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
            await conn.commit()
        await pool.close()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest -xvs tests/test_sql_migrations.py
```

Expected: `FileNotFoundError: sql_dir not found` (the directory doesn't exist yet).

- [ ] **Step 3: Create `sql/000_extensions.sql`**

```sql
-- 000_extensions.sql
-- Placeholder for PostgreSQL extensions. OpenGauss may not support
-- the same extensions as PostgreSQL; later slices add per-extension
-- guards as needed. For S1 we only need core SQL features.
SELECT 1;
```

- [ ] **Step 4: Create `sql/001_kgw_audit_log.sql`** (from v5 spec §5.1)

```sql
-- 001_kgw_audit_log.sql
-- Unified audit log for serve + ingest paths.

CREATE TABLE kgw_audit_log (
    id                 BIGSERIAL PRIMARY KEY,
    source             VARCHAR(16)  NOT NULL,
    trace_id           VARCHAR(64),
    actor_user_id      VARCHAR(128),
    actor_ip           INET,
    actor_kind         VARCHAR(32),
    source_connector   VARCHAR(128),
    source_id          VARCHAR(128),
    source_item_id     VARCHAR(256),
    source_version     VARCHAR(64),
    operation_type     VARCHAR(64)  NOT NULL,
    kn_code            VARCHAR(64),
    file_path          VARCHAR(512),
    payload_size_bytes BIGINT,
    row_count          INTEGER,
    payload_redacted   JSONB,
    result_code        VARCHAR(8),
    result_msg         TEXT,
    latency_ms         INTEGER,
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_kb_time      ON kgw_audit_log (kn_code, created_at DESC);
CREATE INDEX idx_audit_op_time      ON kgw_audit_log (operation_type, created_at DESC);
CREATE INDEX idx_audit_source_time  ON kgw_audit_log (source, created_at DESC);
CREATE INDEX idx_audit_trace        ON kgw_audit_log (trace_id);
CREATE INDEX idx_audit_user         ON kgw_audit_log (actor_user_id, created_at DESC);
```

- [ ] **Step 5: Create `sql/002_kgw_kb_write_history.sql`**

```sql
-- 002_kgw_kb_write_history.sql
-- KB write history for version monotonicity checks.

CREATE TABLE kgw_kb_write_history (
    kn_code           VARCHAR(64)  NOT NULL,
    file_path         VARCHAR(512) NOT NULL,
    version           VARCHAR(64)  NOT NULL,
    source_id         VARCHAR(128),
    source_connector  VARCHAR(128),
    written_at        TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (kn_code, file_path, written_at)
);

CREATE INDEX idx_kb_write_history_latest
    ON kgw_kb_write_history (kn_code, file_path, written_at DESC);
```

- [ ] **Step 6: Create `sql/003_kgw_kb_source_lock.sql`**

```sql
-- 003_kgw_kb_source_lock.sql
-- Manual write lock; serve-path writes set 'manual' by default; ingest cannot override.

CREATE TABLE kgw_kb_source_lock (
    kn_code      VARCHAR(64)  NOT NULL,
    file_path    VARCHAR(512) NOT NULL,
    lock_owner   VARCHAR(64)  NOT NULL,
    locked_at    TIMESTAMPTZ DEFAULT NOW(),
    expires_at   TIMESTAMPTZ,
    PRIMARY KEY (kn_code, file_path)
);
```

- [ ] **Step 7: Create `sql/004_kgw_kb_conflict_log.sql`**

```sql
-- 004_kgw_kb_conflict_log.sql
-- Parallel-write conflict log: STALE_VERSION, SOURCE_LOCKED.

CREATE TABLE kgw_kb_conflict_log (
    id                 BIGSERIAL PRIMARY KEY,
    kn_code            VARCHAR(64)  NOT NULL,
    file_path          VARCHAR(512) NOT NULL,
    current_writer     VARCHAR(64),
    attempted_writer   VARCHAR(64)  NOT NULL,
    attempted_version  VARCHAR(64),
    reason             VARCHAR(64)  NOT NULL,
    attempted_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_conflict_kb_time
    ON kgw_kb_conflict_log (kn_code, attempted_at DESC);
```

- [ ] **Step 8: Run tests**

```bash
uv run pytest -xvs tests/test_sql_migrations.py
```

Expected: `2 passed` (or `2 skipped` without Docker).

- [ ] **Step 9: Commit**

```bash
git add sql/ tests/test_sql_migrations.py
git commit -m "feat(kgw): add S1 SQL migrations (audit, write_history, source_lock, conflict_log)"
```

### Task 8: KbConfigProvider (MinIO)

**Goal:** `KbConfigProvider.get_kb_config(kn_code)` reads `resource/doc/KG_DOC_{kn_code}.json` from MinIO and returns a typed `KbConfig`. Returns `None` (signaling `KBNotFound`) when the object is absent. No caching — every call is a fresh fetch (per v5 spec §3.3).

**Files:**
- Create: `src/kgw/config_provider.py`
- Create: `tests/test_config_provider.py`

- [ ] **Step 1: Write the failing test**

`tests/test_config_provider.py`:

```python
from __future__ import annotations

import json

import aioboto3
import pytest


def _kg_doc_payload() -> dict:
    """Mirror the MinIO config shape referenced by byclaw-qa."""
    return {
        "resourceCode": "hr_policy",
        "domainName": "HR 政策制度库",
        "domainURL": "http://kb-hr.internal:8080",
        "headers": {"Authorization": "${Authorization}"},
        "resourceService": [
            {"name": "knowledgeSearch", "path": "/api/v1/knowledgeItems/search"},
            {"name": "fileImport", "path": "/api/v1/knowledgeItems/import"},
        ],
    }


async def _put_kg_doc(minio_settings: dict, bucket: str, kn_code: str, payload: dict):
    session = aioboto3.Session()
    key = f"resource/doc/KG_DOC_{kn_code}.json"
    async with session.client(
        "s3",
        endpoint_url=minio_settings["endpoint_url"],
        aws_access_key_id=minio_settings["access_key"],
        aws_secret_access_key=minio_settings["secret_key"],
    ) as s3:
        await s3.put_object(
            Bucket=bucket,
            Key=key,
            Body=json.dumps(payload).encode("utf-8"),
            ContentType="application/json",
        )


@pytest.mark.integration
async def test_get_kb_config_returns_parsed_payload(
    minio_settings: dict, minio_bucket: str
):
    from kgw.config_provider import KbConfigProvider

    payload = _kg_doc_payload()
    await _put_kg_doc(minio_settings, minio_bucket, "hr_policy", payload)

    provider = KbConfigProvider(
        endpoint_url=minio_settings["endpoint_url"],
        access_key=minio_settings["access_key"],
        secret_key=minio_settings["secret_key"],
        bucket=minio_bucket,
        prefix="resource/doc/KG_DOC_",
    )

    config = await provider.get_kb_config("hr_policy")
    assert config is not None
    assert config.kn_code == "hr_policy"
    assert config.domain_url == "http://kb-hr.internal:8080"
    assert config.headers == {"Authorization": "${Authorization}"}
    assert config.operations == {"knowledgeSearch", "fileImport"}
    assert config.operation_path("knowledgeSearch") == "/api/v1/knowledgeItems/search"
    assert config.raw == payload


@pytest.mark.integration
async def test_get_kb_config_returns_none_for_missing(
    minio_settings: dict, minio_bucket: str
):
    from kgw.config_provider import KbConfigProvider

    provider = KbConfigProvider(
        endpoint_url=minio_settings["endpoint_url"],
        access_key=minio_settings["access_key"],
        secret_key=minio_settings["secret_key"],
        bucket=minio_bucket,
        prefix="resource/doc/KG_DOC_",
    )

    config = await provider.get_kb_config("does_not_exist")
    assert config is None


@pytest.mark.integration
async def test_get_kb_config_no_caching(
    minio_settings: dict, minio_bucket: str
):
    """Provider must read MinIO on every call (v5 spec §3.3)."""
    from kgw.config_provider import KbConfigProvider

    payload_v1 = _kg_doc_payload()
    payload_v2 = {**payload_v1, "domainURL": "http://kb-hr-v2.internal:8080"}

    provider = KbConfigProvider(
        endpoint_url=minio_settings["endpoint_url"],
        access_key=minio_settings["access_key"],
        secret_key=minio_settings["secret_key"],
        bucket=minio_bucket,
        prefix="resource/doc/KG_DOC_",
    )

    await _put_kg_doc(minio_settings, minio_bucket, "hr_v1", payload_v1)
    c1 = await provider.get_kb_config("hr_v1")
    assert c1 is not None
    assert c1.domain_url == "http://kb-hr.internal:8080"

    await _put_kg_doc(minio_settings, minio_bucket, "hr_v1", payload_v2)
    c2 = await provider.get_kb_config("hr_v1")
    assert c2 is not None
    assert c2.domain_url == "http://kb-hr-v2.internal:8080"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest -xvs tests/test_config_provider.py
```

Expected: `ModuleNotFoundError: No module named 'kgw.config_provider'`.

- [ ] **Step 3: Create `src/kgw/config_provider.py`**

```python
"""Knowledge-base configuration provider (MinIO).

Configuration for each KB is stored in MinIO as
``{prefix}{kn_code}.json`` (default prefix: ``resource/doc/KG_DOC_``).
Every ``get_kb_config`` call reads MinIO directly — no caching — so the
gateway always reflects the portal's current state. This matches v5
spec §3.3.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

import aioboto3
from botocore.exceptions import ClientError

from kgw.observability.logger import get_logger

_log = get_logger(__name__)


@dataclass(frozen=True)
class KbConfig:
    """Parsed KB configuration record."""

    kn_code: str
    domain_url: str
    headers: dict[str, str]
    operations: frozenset[str]
    operation_paths: dict[str, str]
    raw: dict[str, Any] = field(repr=False)

    def operation_path(self, operation: str) -> str | None:
        return self.operation_paths.get(operation)


class KbConfigProvider:
    """Async MinIO reader for KB configuration JSON.

    Modeled after byclaw-qa ``MinioResourceClient.get_kg_doc_config()``
    so the JSON shape stays compatible with existing portal-managed
    objects.
    """

    def __init__(
        self,
        *,
        endpoint_url: str,
        access_key: str,
        secret_key: str,
        bucket: str,
        prefix: str = "resource/doc/KG_DOC_",
        session: aioboto3.Session | None = None,
    ) -> None:
        self._endpoint_url = endpoint_url
        self._access_key = access_key
        self._secret_key = secret_key
        self._bucket = bucket
        self._prefix = prefix
        self._session = session or aioboto3.Session()

    def _client(self):
        return self._session.client(
            "s3",
            endpoint_url=self._endpoint_url,
            aws_access_key_id=self._access_key,
            aws_secret_access_key=self._secret_key,
        )

    async def get_kb_config(self, kn_code: str) -> KbConfig | None:
        """Return parsed KB config or None when the object is absent."""
        key = f"{self._prefix}{kn_code}.json"
        async with self._client() as s3:
            try:
                resp = await s3.get_object(Bucket=self._bucket, Key=key)
            except ClientError as exc:
                code = exc.response.get("Error", {}).get("Code")
                if code in {"NoSuchKey", "404", "NoSuchBucket"}:
                    _log.info("kb_config.not_found", kn_code=kn_code, key=key)
                    return None
                _log.error(
                    "kb_config.fetch_error",
                    kn_code=kn_code,
                    key=key,
                    error_code=code,
                )
                raise
            body = await resp["Body"].read()

        try:
            payload = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            _log.error("kb_config.parse_error", kn_code=kn_code, key=key, err=str(exc))
            raise

        return _parse_kb_config(kn_code, payload)


def _parse_kb_config(kn_code: str, payload: dict[str, Any]) -> KbConfig:
    """Translate the portal's KG_DOC JSON shape into a KbConfig record."""
    domain_url = str(payload.get("domainURL") or payload.get("endpointUrl") or "")
    raw_headers = payload.get("headers") or {}
    headers: dict[str, str] = {str(k): str(v) for k, v in raw_headers.items()}

    operation_paths: dict[str, str] = {}
    for entry in payload.get("resourceService") or ():
        if not isinstance(entry, dict):
            continue
        name = entry.get("name") or entry.get("operation")
        path = entry.get("path") or entry.get("url")
        if name and path:
            operation_paths[str(name)] = str(path)

    # The portal sometimes only lists operation names rather than full paths.
    if not operation_paths:
        for op in payload.get("operations") or ():
            if isinstance(op, str):
                operation_paths[op] = ""

    return KbConfig(
        kn_code=kn_code,
        domain_url=domain_url,
        headers=headers,
        operations=frozenset(operation_paths.keys()),
        operation_paths=operation_paths,
        raw=payload,
    )
```

- [ ] **Step 4: Run tests**

```bash
uv run pytest -xvs tests/test_config_provider.py
```

Expected: `3 passed` with Docker, `3 skipped` without.

- [ ] **Step 5: Commit**

```bash
git add src/kgw/config_provider.py tests/test_config_provider.py
git commit -m "feat(kgw): add KbConfigProvider reading KG_DOC_{knCode}.json from MinIO"
```

### Task 9: AuthProvider (Redis)

**Goal:** `AuthProvider.get_user_auth(user_code)` reads the Redis hash `user:{user_code}:login:auth`. `resolve_headers(headers, user_code)` substitutes `${KEY}` placeholders against that hash. Mirrors byclaw-qa `_resolve_header_placeholders()` semantics.

**Files:**
- Create: `src/kgw/auth_provider.py`
- Create: `tests/test_auth_provider.py`

- [ ] **Step 1: Write the failing test**

`tests/test_auth_provider.py`:

```python
from __future__ import annotations

import fakeredis.aioredis
import pytest


@pytest.fixture
async def fake_redis():
    client = fakeredis.aioredis.FakeRedis(decode_responses=False)
    try:
        yield client
    finally:
        await client.aclose()


async def test_get_user_auth_returns_decoded_hash(fake_redis):
    from kgw.auth_provider import AuthProvider

    await fake_redis.hset(
        "user:user_0001:login:auth",
        mapping={"Authorization": "Bearer abc", "X-Api-Key": "xyz"},
    )

    provider = AuthProvider(
        fake_redis, key_template="user:{user_code}:login:auth"
    )
    auth = await provider.get_user_auth("user_0001")
    assert auth == {"Authorization": "Bearer abc", "X-Api-Key": "xyz"}


async def test_get_user_auth_returns_none_when_missing(fake_redis):
    from kgw.auth_provider import AuthProvider

    provider = AuthProvider(
        fake_redis, key_template="user:{user_code}:login:auth"
    )
    auth = await provider.get_user_auth("nobody")
    assert auth is None


async def test_resolve_headers_substitutes_placeholders(fake_redis):
    from kgw.auth_provider import AuthProvider

    await fake_redis.hset(
        "user:user_0001:login:auth",
        mapping={"Authorization": "Bearer abc", "X-Api-Key": "xyz"},
    )

    provider = AuthProvider(
        fake_redis, key_template="user:{user_code}:login:auth"
    )
    resolved = await provider.resolve_headers(
        {
            "Authorization": "${Authorization}",
            "X-Api-Key": "${X-Api-Key}",
            "X-Static": "literal",
        },
        user_code="user_0001",
    )
    assert resolved == {
        "Authorization": "Bearer abc",
        "X-Api-Key": "xyz",
        "X-Static": "literal",
    }


async def test_resolve_headers_missing_placeholder_dropped(fake_redis):
    """Missing fields leave the placeholder in the value (warning logged).

    Mirrors byclaw-qa _resolve_header_placeholders() — partial substitution
    with a warning so the upstream call can still succeed for headers that
    don't depend on the missing field.
    """
    from kgw.auth_provider import AuthProvider

    await fake_redis.hset(
        "user:user_0001:login:auth",
        mapping={"Authorization": "Bearer abc"},
    )
    provider = AuthProvider(
        fake_redis, key_template="user:{user_code}:login:auth"
    )
    resolved = await provider.resolve_headers(
        {"Authorization": "${Authorization}", "X-Api-Key": "${X-Api-Key}"},
        user_code="user_0001",
    )
    assert resolved == {"Authorization": "Bearer abc", "X-Api-Key": "${X-Api-Key}"}


async def test_resolve_headers_raises_when_user_auth_missing(fake_redis):
    """If the user has no auth hash AND the headers contain placeholders, raise."""
    from kgw.auth_provider import AuthProvider
    from kgw.envelope import AuthInfoNotFound

    provider = AuthProvider(
        fake_redis, key_template="user:{user_code}:login:auth"
    )
    with pytest.raises(AuthInfoNotFound):
        await provider.resolve_headers(
            {"Authorization": "${Authorization}"},
            user_code="ghost",
        )


async def test_resolve_headers_no_placeholders_no_redis_call(fake_redis):
    """Static headers must not trigger a Redis lookup."""
    from kgw.auth_provider import AuthProvider

    provider = AuthProvider(
        fake_redis, key_template="user:{user_code}:login:auth"
    )
    # Even with no hash configured, this must succeed.
    resolved = await provider.resolve_headers(
        {"Content-Type": "application/json"},
        user_code="ghost",
    )
    assert resolved == {"Content-Type": "application/json"}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest -xvs tests/test_auth_provider.py
```

Expected: `ModuleNotFoundError: No module named 'kgw.auth_provider'`.

- [ ] **Step 3: Create `src/kgw/auth_provider.py`**

```python
"""Authentication provider (Redis read).

The portal writes per-user auth into Redis under
``user:{user_code}:login:auth`` (a hash). The gateway reads from that
hash to substitute ``${KEY}`` placeholders in the headers field
configured in the KB's MinIO config. Behavior matches byclaw-qa
``worker._resolve_header_placeholders``.
"""

from __future__ import annotations

import re
from typing import Any

import redis.asyncio as redis_async

from kgw.envelope import AuthInfoNotFound
from kgw.observability.logger import get_logger

_log = get_logger(__name__)
_PLACEHOLDER_RE = re.compile(r"\$\{([^}]+)\}")


class AuthProvider:
    """Read user auth from Redis and resolve header placeholders."""

    def __init__(
        self,
        client: redis_async.Redis,
        *,
        key_template: str = "user:{user_code}:login:auth",
    ) -> None:
        self._client = client
        self._key_template = key_template

    async def get_user_auth(self, user_code: str) -> dict[str, str] | None:
        """Return the user's auth hash decoded as ``{str: str}`` or None."""
        key = self._key_template.format(user_code=user_code)
        raw = await self._client.hgetall(key)
        if not raw:
            return None
        return {_decode(k): _decode(v) for k, v in raw.items()}

    async def resolve_headers(
        self,
        headers: dict[str, Any],
        *,
        user_code: str,
    ) -> dict[str, str]:
        """Substitute ``${KEY}`` placeholders in header values.

        Static headers (no placeholders) are passed through unchanged
        without touching Redis. If a header contains placeholders and
        the user has no auth hash, ``AuthInfoNotFound`` is raised.
        Individual missing fields leave their placeholder text intact
        and emit a warning, matching the byclaw-qa reference behavior.
        """
        resolved: dict[str, str] = {}
        cached_auth: dict[str, str] | None = None
        cached_auth_loaded = False

        for header_name, raw_value in headers.items():
            value = str(raw_value)
            matches = _PLACEHOLDER_RE.findall(value)
            if not matches:
                resolved[header_name] = value
                continue

            if not cached_auth_loaded:
                cached_auth = await self.get_user_auth(user_code)
                cached_auth_loaded = True

            if cached_auth is None:
                raise AuthInfoNotFound(
                    f"auth missing for user_code={user_code}",
                    user_code=user_code,
                )

            substituted = value
            for field in matches:
                if field not in cached_auth:
                    _log.warning(
                        "auth.placeholder_missing",
                        user_code=user_code,
                        field=field,
                        header=header_name,
                    )
                    continue
                substituted = substituted.replace(
                    f"${{{field}}}", cached_auth[field]
                )
            resolved[header_name] = substituted

        return resolved


def _decode(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8")
    return str(value)
```

- [ ] **Step 4: Run tests**

```bash
uv run pytest -xvs tests/test_auth_provider.py
```

Expected: `6 passed`. (These tests use `fakeredis`, so they don't need Docker.)

- [ ] **Step 5: Commit**

```bash
git add src/kgw/auth_provider.py tests/test_auth_provider.py
git commit -m "feat(kgw): add AuthProvider with \${KEY} placeholder resolution from Redis"
```

### Task 10: Shared HTTP Client

**Goal:** A single long-lived `httpx.AsyncClient` for all upstream calls. Injects `X-Trace-Id` from the current request context. Retries idempotent reads (GET/HEAD) once on transient connect/timeout. Streaming support is exposed as-is via `client.stream(...)` for later slices.

**Files:**
- Create: `src/kgw/http_client.py`
- Create: `tests/test_http_client.py`

- [ ] **Step 1: Write the failing test**

`tests/test_http_client.py`:

```python
from __future__ import annotations

import httpx
import pytest
import respx


def _make_client(**overrides):
    from kgw.http_client import build_http_client

    defaults = {
        "timeout_seconds": 5.0,
        "max_connections": 50,
        "max_keepalive": 10,
    }
    defaults.update(overrides)
    return build_http_client(**defaults)


@respx.mock
async def test_get_injects_trace_id_when_present():
    from kgw.observability.tracing import _trace_id_var

    route = respx.get("http://upstream/x").mock(
        return_value=httpx.Response(200, json={"ok": True})
    )

    token = _trace_id_var.set("trace-123")
    try:
        async with _make_client() as client:
            resp = await client.get("http://upstream/x")
    finally:
        _trace_id_var.reset(token)

    assert resp.status_code == 200
    assert route.calls.last.request.headers["X-Trace-Id"] == "trace-123"


@respx.mock
async def test_get_omits_trace_id_when_absent():
    route = respx.get("http://upstream/y").mock(
        return_value=httpx.Response(200, json={"ok": True})
    )

    async with _make_client() as client:
        resp = await client.get("http://upstream/y")

    assert resp.status_code == 200
    assert "X-Trace-Id" not in route.calls.last.request.headers


@respx.mock
async def test_get_retries_once_on_connect_error():
    """Idempotent reads retry once on transient errors."""
    route = respx.get("http://upstream/r").mock(
        side_effect=[
            httpx.ConnectError("boom"),
            httpx.Response(200, json={"ok": True}),
        ]
    )

    async with _make_client() as client:
        resp = await client.get("http://upstream/r")

    assert resp.status_code == 200
    assert route.call_count == 2


@respx.mock
async def test_post_does_not_retry():
    route = respx.post("http://upstream/p").mock(
        side_effect=[
            httpx.ConnectError("boom"),
            httpx.Response(200, json={"ok": True}),
        ]
    )

    async with _make_client() as client:
        with pytest.raises(httpx.ConnectError):
            await client.post("http://upstream/p", json={"a": 1})

    assert route.call_count == 1


@respx.mock
async def test_explicit_trace_id_header_is_preserved():
    """If caller passes X-Trace-Id explicitly, do not overwrite it."""
    from kgw.observability.tracing import _trace_id_var

    route = respx.get("http://upstream/z").mock(
        return_value=httpx.Response(200, json={"ok": True})
    )

    token = _trace_id_var.set("ctx-trace")
    try:
        async with _make_client() as client:
            await client.get(
                "http://upstream/z", headers={"X-Trace-Id": "explicit"}
            )
    finally:
        _trace_id_var.reset(token)

    assert route.calls.last.request.headers["X-Trace-Id"] == "explicit"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest -xvs tests/test_http_client.py
```

Expected: `ModuleNotFoundError: No module named 'kgw.http_client'`.

- [ ] **Step 3: Create `src/kgw/http_client.py`**

```python
"""Shared httpx AsyncClient for upstream KB / Connector calls.

The client is created once per process (in the FastAPI lifespan) and
shared by every dispatcher / proxy. It:

  * injects ``X-Trace-Id`` from the request context (unless the caller
    set it explicitly)
  * retries once on transient errors for idempotent reads (GET/HEAD)
  * passes ``stream(...)`` through unchanged for streaming uploads/
    downloads (used by S2/S3)
"""

from __future__ import annotations

import httpx

from kgw.observability.logger import get_logger
from kgw.observability.tracing import TRACE_HEADER, current_trace_id

_log = get_logger(__name__)

_RETRYABLE_EXC = (httpx.ConnectError, httpx.ReadError, httpx.WriteError)


class _KgwClient(httpx.AsyncClient):
    """httpx AsyncClient subclass that wires trace-id injection + retry."""

    async def send(  # type: ignore[override]
        self,
        request: httpx.Request,
        *,
        stream: bool = False,
        auth: httpx._types.AuthTypes | httpx._client.UseClientDefault = httpx.USE_CLIENT_DEFAULT,
        follow_redirects: bool | httpx._client.UseClientDefault = httpx.USE_CLIENT_DEFAULT,
    ) -> httpx.Response:
        if TRACE_HEADER not in request.headers:
            tid = current_trace_id()
            if tid:
                request.headers[TRACE_HEADER] = tid

        is_idempotent = request.method.upper() in {"GET", "HEAD"}
        attempts = 0
        max_attempts = 2 if is_idempotent else 1
        last_exc: Exception | None = None
        while attempts < max_attempts:
            attempts += 1
            try:
                return await super().send(
                    request,
                    stream=stream,
                    auth=auth,
                    follow_redirects=follow_redirects,
                )
            except _RETRYABLE_EXC as exc:
                last_exc = exc
                if attempts >= max_attempts:
                    break
                _log.warning(
                    "http.retry",
                    method=request.method,
                    url=str(request.url),
                    attempt=attempts,
                    error=str(exc),
                )
        assert last_exc is not None
        raise last_exc


def build_http_client(
    *,
    timeout_seconds: float,
    max_connections: int,
    max_keepalive: int,
) -> _KgwClient:
    """Construct the shared httpx client. Caller is responsible for closing."""
    limits = httpx.Limits(
        max_connections=max_connections,
        max_keepalive_connections=max_keepalive,
    )
    return _KgwClient(timeout=timeout_seconds, limits=limits)
```

- [ ] **Step 4: Run tests**

```bash
uv run pytest -xvs tests/test_http_client.py
```

Expected: `5 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/kgw/http_client.py tests/test_http_client.py
git commit -m "feat(kgw): add shared httpx async client with trace-id and GET retry"
```

### Task 11: AuditWriter

**Goal:** `AuditWriter.record(entry)` enqueues an `AuditEntry` and a single background drain task writes to `kgw_audit_log`. Drain failures are logged but never raised back to the request path (v5 spec §7.1: "audit write failures must not block business").

**Files:**
- Create: `src/kgw/audit/__init__.py`
- Create: `src/kgw/audit/writer.py`
- Create: `tests/test_audit_writer.py`

- [ ] **Step 1: Write the failing test**

`tests/test_audit_writer.py`:

```python
from __future__ import annotations

import asyncio
import json

import pytest


@pytest.mark.integration
async def test_audit_writer_persists_entries(pg_dsn: str):
    """End-to-end: enqueue -> drain -> row in kgw_audit_log."""
    from pathlib import Path

    from kgw.audit.writer import AuditEntry, AuditWriter
    from kgw.db import build_pool, run_migrations

    pool = await build_pool(pg_dsn, min_size=1, max_size=2)
    sql_dir = Path(__file__).resolve().parent.parent / "sql"
    await run_migrations(pool, sql_dir)

    writer = AuditWriter(pool, queue_max_size=10)
    await writer.start()
    try:
        await writer.record(
            AuditEntry(
                source="serve",
                trace_id="t-1",
                actor_user_id="user_0001",
                actor_kind="user",
                operation_type="echo",
                kn_code="hr_policy",
                file_path=None,
                payload_size_bytes=42,
                row_count=None,
                payload_redacted={"q": "hello"},
                result_code="0",
                result_msg="success",
                latency_ms=12,
            )
        )
        # Wait for drain
        await writer.flush(timeout=2.0)

        async with pool.connection() as conn:
            cur = await conn.execute(
                "SELECT source, trace_id, actor_user_id, operation_type, "
                "kn_code, payload_size_bytes, payload_redacted, result_code, "
                "latency_ms FROM kgw_audit_log ORDER BY id DESC LIMIT 1"
            )
            row = await cur.fetchone()
        assert row["source"] == "serve"
        assert row["trace_id"] == "t-1"
        assert row["actor_user_id"] == "user_0001"
        assert row["operation_type"] == "echo"
        assert row["kn_code"] == "hr_policy"
        assert row["payload_size_bytes"] == 42
        # payload is JSONB; psycopg returns it as a Python dict
        assert row["payload_redacted"] == {"q": "hello"} or json.loads(
            row["payload_redacted"]
        ) == {"q": "hello"}
        assert row["result_code"] == "0"
        assert row["latency_ms"] == 12
    finally:
        await writer.stop()
        async with pool.connection() as conn:
            await conn.execute("DROP TABLE IF EXISTS kgw_audit_log CASCADE")
            await conn.execute("DROP TABLE IF EXISTS kgw_kb_write_history CASCADE")
            await conn.execute("DROP TABLE IF EXISTS kgw_kb_source_lock CASCADE")
            await conn.execute("DROP TABLE IF EXISTS kgw_kb_conflict_log CASCADE")
            await conn.execute("DROP TABLE IF EXISTS kgw_migration CASCADE")
            await conn.commit()
        await pool.close()


async def test_audit_writer_swallows_db_errors():
    """A failing pool must not cause record() / flush() to raise."""
    from kgw.audit.writer import AuditEntry, AuditWriter

    class FailingConn:
        async def execute(self, *_a, **_kw):
            raise RuntimeError("db is down")

        async def commit(self):
            pass

        async def rollback(self):
            pass

    class FailingPool:
        def connection(self):
            outer = self

            class _Ctx:
                async def __aenter__(self):
                    return FailingConn()

                async def __aexit__(self, *exc):
                    return False

            return _Ctx()

    writer = AuditWriter(FailingPool(), queue_max_size=10)  # type: ignore[arg-type]
    await writer.start()
    try:
        await writer.record(
            AuditEntry(
                source="serve",
                trace_id="t-2",
                actor_user_id=None,
                actor_kind=None,
                operation_type="echo",
                kn_code=None,
                file_path=None,
                payload_size_bytes=None,
                row_count=None,
                payload_redacted=None,
                result_code="0",
                result_msg="ok",
                latency_ms=0,
            )
        )
        # flush waits for the drain to process the queue. With a failing
        # pool, the worker logs the error and continues; flush returns
        # without raising.
        await writer.flush(timeout=2.0)
    finally:
        await writer.stop()


async def test_audit_writer_full_queue_drops_entry_does_not_raise():
    from kgw.audit.writer import AuditEntry, AuditWriter

    class SlowPool:
        async def _slow_execute(self):
            await asyncio.sleep(10)

        def connection(self):
            outer = self

            class _Ctx:
                async def __aenter__(self_inner):
                    class _Conn:
                        async def execute(self_c, *_a, **_kw):
                            await outer._slow_execute()

                        async def commit(self_c):
                            pass

                        async def rollback(self_c):
                            pass

                    return _Conn()

                async def __aexit__(self_inner, *exc):
                    return False

            return _Ctx()

    writer = AuditWriter(SlowPool(), queue_max_size=1)  # type: ignore[arg-type]
    # Don't start the drain; queue will fill on the second record().
    entry = AuditEntry(
        source="serve",
        trace_id="t",
        actor_user_id=None,
        actor_kind=None,
        operation_type="echo",
        kn_code=None,
        file_path=None,
        payload_size_bytes=None,
        row_count=None,
        payload_redacted=None,
        result_code="0",
        result_msg="ok",
        latency_ms=0,
    )
    await writer.record(entry)
    # Second call should not raise even though queue is full.
    await writer.record(entry)
    assert writer.dropped_count == 1
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest -xvs tests/test_audit_writer.py
```

Expected: `ModuleNotFoundError: No module named 'kgw.audit'`.

- [ ] **Step 3: Create `src/kgw/audit/__init__.py`**

```python
"""Audit subsystem: AuditEntry + AuditWriter."""

from kgw.audit.writer import AuditEntry, AuditWriter

__all__ = ["AuditEntry", "AuditWriter"]
```

- [ ] **Step 4: Create `src/kgw/audit/writer.py`**

```python
"""Audit log writer.

A single ``AuditWriter`` instance lives for the app lifetime. Endpoints
call ``record(entry)`` synchronously; the entry is enqueued and a
background drain task writes it to ``kgw_audit_log``. Audit failures
are NEVER raised back to the request path (v5 spec §7.1).

Backpressure: the queue has a bounded size. When full, the entry is
dropped, a counter is incremented, and a warning is logged. This
matches the v5 spec stance that audit writes are best-effort.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import asdict, dataclass
from typing import Any

from psycopg.types.json import Json
from psycopg_pool import AsyncConnectionPool

from kgw.observability.logger import get_logger

_log = get_logger(__name__)


@dataclass
class AuditEntry:
    """A single audit row.

    Field names mirror v5 spec §5.1 ``kgw_audit_log`` columns. Optional
    fields default to None at the call site.
    """

    source: str  # 'serve' | 'ingest'
    trace_id: str | None
    actor_user_id: str | None
    actor_kind: str | None  # 'user' | 'connector'
    operation_type: str
    kn_code: str | None
    file_path: str | None
    payload_size_bytes: int | None
    row_count: int | None
    payload_redacted: dict[str, Any] | None
    result_code: str | None
    result_msg: str | None
    latency_ms: int | None
    actor_ip: str | None = None
    source_connector: str | None = None
    source_id: str | None = None
    source_item_id: str | None = None
    source_version: str | None = None


_INSERT_SQL = """
INSERT INTO kgw_audit_log (
    source, trace_id, actor_user_id, actor_ip, actor_kind,
    source_connector, source_id, source_item_id, source_version,
    operation_type, kn_code, file_path,
    payload_size_bytes, row_count, payload_redacted,
    result_code, result_msg, latency_ms
) VALUES (
    %(source)s, %(trace_id)s, %(actor_user_id)s, %(actor_ip)s, %(actor_kind)s,
    %(source_connector)s, %(source_id)s, %(source_item_id)s, %(source_version)s,
    %(operation_type)s, %(kn_code)s, %(file_path)s,
    %(payload_size_bytes)s, %(row_count)s, %(payload_redacted)s,
    %(result_code)s, %(result_msg)s, %(latency_ms)s
)
"""


class AuditWriter:
    """Async fire-and-forget audit writer."""

    def __init__(
        self,
        pool: AsyncConnectionPool,
        *,
        queue_max_size: int = 10_000,
    ) -> None:
        self._pool = pool
        self._queue: asyncio.Queue[AuditEntry] = asyncio.Queue(
            maxsize=queue_max_size
        )
        self._task: asyncio.Task[None] | None = None
        self._closed = False
        self.dropped_count = 0

    async def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._drain(), name="kgw-audit-drain")

    async def stop(self) -> None:
        self._closed = True
        # Sentinel to wake the drain task.
        try:
            self._queue.put_nowait(_SENTINEL)  # type: ignore[arg-type]
        except asyncio.QueueFull:
            pass
        if self._task is not None:
            try:
                await asyncio.wait_for(self._task, timeout=5.0)
            except asyncio.TimeoutError:
                self._task.cancel()
            self._task = None

    async def record(self, entry: AuditEntry) -> None:
        """Enqueue an entry. Never blocks; never raises."""
        if self._closed:
            return
        try:
            self._queue.put_nowait(entry)
        except asyncio.QueueFull:
            self.dropped_count += 1
            _log.warning(
                "audit.dropped_queue_full",
                operation_type=entry.operation_type,
                kn_code=entry.kn_code,
                dropped_count=self.dropped_count,
            )

    async def flush(self, *, timeout: float = 5.0) -> None:
        """Wait until all currently-queued entries are processed.

        Used by tests; production shutdown should call ``stop()``.
        """
        # Insert a flush barrier and wait for it to be consumed.
        loop = asyncio.get_running_loop()
        done = loop.create_future()
        await self._queue.put(_FlushBarrier(done))  # type: ignore[arg-type]
        try:
            await asyncio.wait_for(done, timeout=timeout)
        except asyncio.TimeoutError:
            _log.warning("audit.flush_timeout", timeout=timeout)

    async def _drain(self) -> None:
        while True:
            entry = await self._queue.get()
            if entry is _SENTINEL:
                break
            if isinstance(entry, _FlushBarrier):
                if not entry.done.done():
                    entry.done.set_result(None)
                continue
            try:
                await self._write_one(entry)
            except Exception as exc:  # noqa: BLE001 - logged, never raised
                _log.error(
                    "audit.write_failed",
                    operation_type=entry.operation_type,
                    kn_code=entry.kn_code,
                    error=str(exc),
                )

    async def _write_one(self, entry: AuditEntry) -> None:
        params = asdict(entry)
        payload = params.get("payload_redacted")
        params["payload_redacted"] = Json(payload) if payload is not None else None
        async with self._pool.connection() as conn:
            try:
                await conn.execute(_INSERT_SQL, params)
                await conn.commit()
            except Exception:
                await conn.rollback()
                raise


@dataclass
class _FlushBarrier:
    done: asyncio.Future[None]


_SENTINEL: Any = object()
```

- [ ] **Step 5: Run tests**

```bash
uv run pytest -xvs tests/test_audit_writer.py
```

Expected: `3 passed` with Docker, `1 passed + 2 skipped` without (the two non-integration tests still run).

- [ ] **Step 6: Commit**

```bash
git add src/kgw/audit tests/test_audit_writer.py
git commit -m "feat(kgw): add fire-and-forget AuditWriter with bounded queue"
```

### Task 12: FastAPI App & Lifespan

**Goal:** `main.py` builds the FastAPI app, manages all foundation resources via lifespan, registers `/healthz` + `/metrics`, and installs the trace-id middleware + a global `KgwError` handler. The app object is exported as `kgw.main:app` for `uvicorn`.

**Files:**
- Create: `src/kgw/main.py`
- Create: `src/kgw/api/__init__.py`
- Create: `tests/test_app_lifespan.py`

- [ ] **Step 1: Write the failing test**

`tests/test_app_lifespan.py`:

```python
from __future__ import annotations

from pathlib import Path

import pytest


def _set_env(monkeypatch, pg_dsn: str, redis_url: str, minio_settings: dict, bucket: str):
    monkeypatch.setenv("KGW_DB_DSN", pg_dsn)
    monkeypatch.setenv("KGW_REDIS_URL", redis_url)
    monkeypatch.setenv("KGW_MINIO_ENDPOINT", minio_settings["endpoint_url"])
    monkeypatch.setenv("KGW_MINIO_ACCESS_KEY", minio_settings["access_key"])
    monkeypatch.setenv("KGW_MINIO_SECRET_KEY", minio_settings["secret_key"])
    monkeypatch.setenv("KGW_MINIO_BUCKET", bucket)
    monkeypatch.setenv("KGW_MINIO_KG_DOC_PREFIX", "resource/doc/KG_DOC_")


@pytest.mark.integration
async def test_healthz_returns_ok(
    pg_dsn: str,
    redis_url: str,
    minio_settings: dict,
    minio_bucket: str,
    monkeypatch: pytest.MonkeyPatch,
):
    from httpx import ASGITransport, AsyncClient

    from kgw.settings import get_settings

    _set_env(monkeypatch, pg_dsn, redis_url, minio_settings, minio_bucket)
    get_settings.cache_clear()

    from kgw.main import build_app

    app = build_app()

    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            resp = await c.get("/healthz")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}


@pytest.mark.integration
async def test_metrics_endpoint_serves_prometheus_text(
    pg_dsn: str,
    redis_url: str,
    minio_settings: dict,
    minio_bucket: str,
    monkeypatch: pytest.MonkeyPatch,
):
    from httpx import ASGITransport, AsyncClient

    from kgw.settings import get_settings

    _set_env(monkeypatch, pg_dsn, redis_url, minio_settings, minio_bucket)
    get_settings.cache_clear()

    from kgw.main import build_app

    app = build_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            resp = await c.get("/metrics")
        assert resp.status_code == 200
        assert "text/plain" in resp.headers["content-type"]


@pytest.mark.integration
async def test_unhandled_kgw_error_returns_envelope(
    pg_dsn: str,
    redis_url: str,
    minio_settings: dict,
    minio_bucket: str,
    monkeypatch: pytest.MonkeyPatch,
):
    """The app-level exception handler must translate KgwError to envelope."""
    from fastapi import APIRouter
    from httpx import ASGITransport, AsyncClient

    from kgw.envelope import KBNotFound
    from kgw.settings import get_settings

    _set_env(monkeypatch, pg_dsn, redis_url, minio_settings, minio_bucket)
    get_settings.cache_clear()

    from kgw.main import build_app

    app = build_app()

    test_router = APIRouter()

    @test_router.get("/__test_kbnotfound")
    async def _():
        raise KBNotFound("no such kb", kn_code="ghost")

    app.include_router(test_router)

    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            resp = await c.get("/__test_kbnotfound")
    assert resp.status_code == 200
    body = resp.json()
    assert body["resultCode"] == "-1"
    assert body["resultMsg"] == "no such kb"
    assert body["resultObject"] == {"errorCode": "KBNotFound", "knCode": "ghost"}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest -xvs tests/test_app_lifespan.py
```

Expected: `ImportError: cannot import name 'build_app' from 'kgw.main'`.

- [ ] **Step 3: Create `src/kgw/api/__init__.py`**

```python
"""HTTP API routers."""
```

- [ ] **Step 4: Create `src/kgw/main.py`**

```python
"""FastAPI application factory + lifespan.

The app holds long-lived resources in ``app.state``:

  * pool (psycopg AsyncConnectionPool)
  * redis (redis.asyncio.Redis)
  * http  (shared httpx AsyncClient)
  * config_provider (KbConfigProvider)
  * auth_provider (AuthProvider)
  * audit (AuditWriter)

These are constructed in the lifespan context and torn down on exit.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

import redis.asyncio as redis_async
from fastapi import FastAPI
from fastapi.requests import Request
from fastapi.responses import JSONResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from kgw.audit import AuditWriter
from kgw.auth_provider import AuthProvider
from kgw.config_provider import KbConfigProvider
from kgw.db import build_pool, run_migrations
from kgw.envelope import KgwError
from kgw.http_client import build_http_client
from kgw.observability.logger import configure_logging, get_logger
from kgw.observability.metrics import get_registry
from kgw.observability.tracing import TraceIdMiddleware
from kgw.settings import Settings, get_settings

_log = get_logger(__name__)


def _sql_dir() -> Path:
    """Locate the bundled sql/ directory.

    Walks up from this file (``src/kgw/main.py``) to find the project
    root containing ``sql/``.
    """
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "sql"
        if candidate.is_dir():
            return candidate
    raise FileNotFoundError("sql/ directory not found")


@asynccontextmanager
async def _lifespan(app: FastAPI):
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
        endpoint_url=_normalize_endpoint(
            settings.minio_endpoint, secure=settings.minio_secure
        ),
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

    app.state.settings = settings
    app.state.pool = pool
    app.state.redis = redis_client
    app.state.http = http_client
    app.state.config_provider = config_provider
    app.state.auth_provider = auth_provider
    app.state.audit = audit_writer

    _log.info("kgw.startup_complete")
    try:
        yield
    finally:
        _log.info("kgw.shutdown_begin")
        await audit_writer.stop()
        await http_client.aclose()
        await redis_client.aclose()
        await pool.close()
        _log.info("kgw.shutdown_complete")


def _normalize_endpoint(raw: str, *, secure: bool) -> str:
    """Match byclaw-qa _build_endpoint_url() behavior."""
    host = raw.removeprefix("http://").removeprefix("https://")
    scheme = "https" if secure else "http"
    return f"{scheme}://{host}"


def build_app() -> FastAPI:
    """Construct the FastAPI app. Used by uvicorn entry point and tests."""
    app = FastAPI(title="byclaw-kgw", version="0.1.0", lifespan=_lifespan)
    app.add_middleware(TraceIdMiddleware)

    @app.exception_handler(KgwError)
    async def _kgw_error_handler(request: Request, exc: KgwError):
        return JSONResponse(status_code=200, content=exc.to_envelope())

    @app.get("/healthz")
    async def _healthz() -> dict:
        return {"status": "ok"}

    @app.get("/metrics")
    async def _metrics() -> Response:
        data = generate_latest(get_registry())
        return Response(content=data, media_type=CONTENT_TYPE_LATEST)

    return app


app = build_app()
```

- [ ] **Step 5: Run tests**

```bash
uv run pytest -xvs tests/test_app_lifespan.py
```

Expected: `3 passed` with Docker, `3 skipped` without.

- [ ] **Step 6: Try starting the server manually (optional sanity check)**

```bash
uv run uvicorn kgw.main:app --port 8000 &
sleep 2
curl -s http://localhost:8000/healthz
kill %1
```

Expected output: `{"status":"ok"}`. Skip this step if the env isn't configured (the server will fail to start without DB/Redis/MinIO available).

- [ ] **Step 7: Commit**

```bash
git add src/kgw/main.py src/kgw/api/__init__.py tests/test_app_lifespan.py
git commit -m "feat(kgw): add FastAPI app with lifespan, /healthz, /metrics, KgwError handler"
```

### Task 13: `/kgw/internal/v1/echo` Smoke Endpoint

**Goal:** A single internal endpoint that exercises every foundation in one request: parses `X-User-Id`, fetches KB config from MinIO, fetches auth from Redis, makes an httpx call to the KB's `domain_url` (echoes the response), writes an audit row. This is the v5 spec §13 "调 /echo 端点：成功路径写一条 audit_log" check.

**Files:**
- Create: `src/kgw/api/internal.py`
- Modify: `src/kgw/main.py` — register the router

- [ ] **Step 1: Update `src/kgw/main.py` to mount the internal router**

Inside `build_app()`, after the `_metrics` definition and before `return app`:

```python
    from kgw.api.internal import router as internal_router

    app.include_router(internal_router)
```

- [ ] **Step 2: Create `src/kgw/api/internal.py`**

```python
"""Internal smoke-test endpoints used by S1 to exercise the foundation chain.

These endpoints are not part of the public KGW API. They will be removed
in a later slice once real business endpoints take over the same plumbing.
"""

from __future__ import annotations

import time
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Header, Request

from kgw.audit import AuditEntry
from kgw.envelope import (
    KBNotFound,
    UpstreamConnectError,
    UpstreamTimeout,
    success,
)
from kgw.observability.logger import get_logger

_log = get_logger(__name__)
router = APIRouter(prefix="/kgw/internal/v1")


@router.post("/echo")
async def echo(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
):
    """Walk all S1 foundations end-to-end.

    Body shape: ``{"knCode": "<code>", "payload": {...}}``.

    Steps:
      1. Resolve KB config from MinIO (raises KBNotFound when missing).
      2. Resolve user auth from Redis and substitute header placeholders.
      3. Call the KB's ``/healthz`` (or ``/`` if missing) via the shared
         httpx client to prove connectivity + trace-id propagation.
      4. Audit the call.

    Returns the upstream status + body inside the unified envelope.
    """
    started = time.perf_counter()
    kn_code = str(body.get("knCode") or "")
    if not kn_code:
        raise KBNotFound("knCode is required", kn_code="")

    config_provider = request.app.state.config_provider
    auth_provider = request.app.state.auth_provider
    http_client: httpx.AsyncClient = request.app.state.http
    audit = request.app.state.audit

    config = await config_provider.get_kb_config(kn_code)
    if config is None:
        raise KBNotFound(f"unknown knCode: {kn_code}", kn_code=kn_code)

    headers = await auth_provider.resolve_headers(
        config.headers, user_code=x_user_id
    )

    target_url = f"{config.domain_url.rstrip('/')}/healthz"
    try:
        upstream = await http_client.get(target_url, headers=headers)
    except httpx.TimeoutException as exc:
        raise UpstreamTimeout(
            f"upstream timeout calling {target_url}", kn_code=kn_code
        ) from exc
    except httpx.ConnectError as exc:
        raise UpstreamConnectError(
            f"upstream connect error calling {target_url}", kn_code=kn_code
        ) from exc

    latency_ms = int((time.perf_counter() - started) * 1000)
    payload_bytes = upstream.content or b""

    await audit.record(
        AuditEntry(
            source="serve",
            trace_id=request.headers.get("X-Trace-Id"),
            actor_user_id=x_user_id,
            actor_kind="user",
            operation_type="echo",
            kn_code=kn_code,
            file_path=None,
            payload_size_bytes=len(payload_bytes),
            row_count=None,
            payload_redacted={"knCode": kn_code, "echo": True},
            result_code="0",
            result_msg="success",
            latency_ms=latency_ms,
        )
    )

    return success(
        {
            "knCode": kn_code,
            "upstreamStatus": upstream.status_code,
            "upstreamBytes": len(payload_bytes),
        }
    )
```

- [ ] **Step 3: Sanity import**

```bash
uv run python -c "from kgw.main import build_app; build_app()"
```

Expected: no output, no exception. (Settings won't be validated until lifespan runs, so this just checks imports compile.)

- [ ] **Step 4: Commit**

```bash
git add src/kgw/api/internal.py src/kgw/main.py
git commit -m "feat(kgw): add /kgw/internal/v1/echo end-to-end smoke endpoint"
```

### Task 14: End-to-End App Smoke Test

**Goal:** A single test exercises the whole chain: it seeds MinIO with a `KG_DOC_test_kb.json`, seeds Redis with a user auth hash, runs the app inside `lifespan_context`, posts to `/kgw/internal/v1/echo`, and verifies (a) the response is a success envelope, (b) trace-id is echoed, (c) an audit row was written, (d) `KBNotFound` and `AuthInfoNotFound` responses match v5 §6.6.

**Files:**
- Create: `tests/test_app_smoke.py`

- [ ] **Step 1: Write the failing test**

`tests/test_app_smoke.py`:

```python
from __future__ import annotations

import json

import aioboto3
import httpx
import pytest
import redis.asyncio as redis_async
import respx


def _set_env(monkeypatch, pg_dsn, redis_url, minio_settings, bucket):
    monkeypatch.setenv("KGW_DB_DSN", pg_dsn)
    monkeypatch.setenv("KGW_REDIS_URL", redis_url)
    monkeypatch.setenv("KGW_MINIO_ENDPOINT", minio_settings["endpoint_url"])
    monkeypatch.setenv("KGW_MINIO_ACCESS_KEY", minio_settings["access_key"])
    monkeypatch.setenv("KGW_MINIO_SECRET_KEY", minio_settings["secret_key"])
    monkeypatch.setenv("KGW_MINIO_BUCKET", bucket)
    monkeypatch.setenv("KGW_MINIO_KG_DOC_PREFIX", "resource/doc/KG_DOC_")


async def _seed_minio(minio_settings, bucket, kn_code, payload):
    session = aioboto3.Session()
    async with session.client(
        "s3",
        endpoint_url=minio_settings["endpoint_url"],
        aws_access_key_id=minio_settings["access_key"],
        aws_secret_access_key=minio_settings["secret_key"],
    ) as s3:
        await s3.put_object(
            Bucket=bucket,
            Key=f"resource/doc/KG_DOC_{kn_code}.json",
            Body=json.dumps(payload).encode("utf-8"),
            ContentType="application/json",
        )


async def _seed_redis(redis_url, user_code, mapping):
    client = redis_async.from_url(redis_url, decode_responses=False)
    try:
        await client.delete(f"user:{user_code}:login:auth")
        await client.hset(f"user:{user_code}:login:auth", mapping=mapping)
    finally:
        await client.aclose()


@pytest.mark.integration
async def test_echo_happy_path_writes_audit_and_propagates_trace(
    pg_dsn,
    redis_url,
    minio_settings,
    minio_bucket,
    monkeypatch: pytest.MonkeyPatch,
):
    _set_env(monkeypatch, pg_dsn, redis_url, minio_settings, minio_bucket)
    from kgw.settings import get_settings

    get_settings.cache_clear()

    await _seed_minio(
        minio_settings,
        minio_bucket,
        "test_kb",
        {
            "resourceCode": "test_kb",
            "domainName": "Test KB",
            "domainURL": "http://upstream.test",
            "headers": {"Authorization": "${Authorization}"},
            "resourceService": [
                {"name": "knowledgeSearch", "path": "/api/v1/knowledgeItems/search"}
            ],
        },
    )
    await _seed_redis(
        redis_url, "user_smoke", {"Authorization": b"Bearer token-xyz"}
    )

    from kgw.main import build_app

    app = build_app()
    from httpx import ASGITransport, AsyncClient

    with respx.mock(assert_all_called=False) as mock:
        upstream_route = mock.get("http://upstream.test/healthz").mock(
            return_value=httpx.Response(200, json={"upstream": "ok"})
        )

        async with app.router.lifespan_context(app):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as c:
                resp = await c.post(
                    "/kgw/internal/v1/echo",
                    headers={
                        "X-User-Id": "user_smoke",
                        "X-Trace-Id": "trace-smoke",
                    },
                    json={"knCode": "test_kb"},
                )

            # Wait for the audit drain to flush before tearing down lifespan.
            await app.state.audit.flush(timeout=3.0)

            assert resp.status_code == 200
            body = resp.json()
            assert body["resultCode"] == "0"
            assert body["resultObject"]["knCode"] == "test_kb"
            assert body["resultObject"]["upstreamStatus"] == 200
            assert resp.headers["X-Trace-Id"] == "trace-smoke"

            # Upstream got our auth header (substituted) and trace id.
            up_req = upstream_route.calls.last.request
            assert up_req.headers["Authorization"] == "Bearer token-xyz"
            assert up_req.headers["X-Trace-Id"] == "trace-smoke"

            # Audit row exists.
            pool = app.state.pool
            async with pool.connection() as conn:
                cur = await conn.execute(
                    "SELECT operation_type, kn_code, actor_user_id, "
                    "trace_id, result_code FROM kgw_audit_log "
                    "WHERE operation_type = 'echo' ORDER BY id DESC LIMIT 1"
                )
                row = await cur.fetchone()
            assert row["operation_type"] == "echo"
            assert row["kn_code"] == "test_kb"
            assert row["actor_user_id"] == "user_smoke"
            assert row["trace_id"] == "trace-smoke"
            assert row["result_code"] == "0"


@pytest.mark.integration
async def test_echo_returns_kb_not_found_for_unknown_kn_code(
    pg_dsn,
    redis_url,
    minio_settings,
    minio_bucket,
    monkeypatch: pytest.MonkeyPatch,
):
    _set_env(monkeypatch, pg_dsn, redis_url, minio_settings, minio_bucket)
    from kgw.settings import get_settings

    get_settings.cache_clear()
    from kgw.main import build_app

    app = build_app()
    from httpx import ASGITransport, AsyncClient

    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            resp = await c.post(
                "/kgw/internal/v1/echo",
                headers={"X-User-Id": "user_smoke"},
                json={"knCode": "ghost_kb"},
            )
    body = resp.json()
    assert body["resultCode"] == "-1"
    assert body["resultObject"]["errorCode"] == "KBNotFound"
    assert body["resultObject"]["knCode"] == "ghost_kb"


@pytest.mark.integration
async def test_echo_returns_auth_info_not_found_when_redis_empty(
    pg_dsn,
    redis_url,
    minio_settings,
    minio_bucket,
    monkeypatch: pytest.MonkeyPatch,
):
    _set_env(monkeypatch, pg_dsn, redis_url, minio_settings, minio_bucket)
    from kgw.settings import get_settings

    get_settings.cache_clear()

    await _seed_minio(
        minio_settings,
        minio_bucket,
        "auth_kb",
        {
            "domainURL": "http://upstream.test",
            "headers": {"Authorization": "${Authorization}"},
            "resourceService": [],
        },
    )

    from kgw.main import build_app

    app = build_app()
    from httpx import ASGITransport, AsyncClient

    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            resp = await c.post(
                "/kgw/internal/v1/echo",
                headers={"X-User-Id": "user_with_no_auth"},
                json={"knCode": "auth_kb"},
            )
    body = resp.json()
    assert body["resultCode"] == "-1"
    assert body["resultObject"]["errorCode"] == "AuthInfoNotFound"
    assert body["resultObject"]["userCode"] == "user_with_no_auth"
```

- [ ] **Step 2: Run the smoke test**

```bash
uv run pytest -xvs tests/test_app_smoke.py
```

Expected (Docker available): `3 passed`. Expected (no Docker): `3 skipped`.

- [ ] **Step 3: Run the full test suite**

```bash
uv run pytest -xvs
```

Expected: All previous tests still pass; total count grows accordingly. Document the pass count in the commit message body if helpful.

- [ ] **Step 4: Commit**

```bash
git add tests/test_app_smoke.py
git commit -m "test(kgw): add end-to-end /echo smoke test exercising all S1 foundations"
```

### Task 15: Final S1 Acceptance Review

**Goal:** Walk the slicing spec's S1 acceptance list and confirm each item, then invoke verification-before-completion.

This task is a checklist run, not new code. Open `docs/superpowers/specs/2026-06-03-knowledge-gateway-implementation-slicing.md` and read **§4 → S1 → 验收**.

- [ ] **Step 1: Confirm `/healthz` returns 200**

Already covered by `test_healthz_returns_ok` (Task 12). Re-run to confirm:

```bash
uv run pytest -xvs tests/test_app_lifespan.py::test_healthz_returns_ok
```

- [ ] **Step 2: Confirm migrations create the four S1 tables**

```bash
uv run pytest -xvs tests/test_sql_migrations.py
```

- [ ] **Step 3: Confirm /echo writes audit row, payload redacted**

```bash
uv run pytest -xvs tests/test_app_smoke.py::test_echo_happy_path_writes_audit_and_propagates_trace
```

The test asserts `payload_redacted = {"knCode": ..., "echo": True}` — i.e., no auth headers and no full upstream body, satisfying "payload 已脱敏".

- [ ] **Step 4: Confirm `KBNotFound` returned for missing knCode**

```bash
uv run pytest -xvs tests/test_app_smoke.py::test_echo_returns_kb_not_found_for_unknown_kn_code
```

- [ ] **Step 5: Confirm `AuthInfoNotFound` returned when Redis lacks the user**

```bash
uv run pytest -xvs tests/test_app_smoke.py::test_echo_returns_auth_info_not_found_when_redis_empty
```

- [ ] **Step 6: Confirm Redis hash field missing logs a warning, does not throw**

Already covered by `test_resolve_headers_missing_placeholder_dropped` (Task 9). Re-run:

```bash
uv run pytest -xvs tests/test_auth_provider.py::test_resolve_headers_missing_placeholder_dropped
```

- [ ] **Step 7: Confirm httpx client propagates trace-id**

Already covered by `test_get_injects_trace_id_when_present` (Task 10) and the smoke test's upstream assertion. Re-run:

```bash
uv run pytest -xvs tests/test_http_client.py::test_get_injects_trace_id_when_present
```

- [ ] **Step 8: Run the full suite one final time**

```bash
uv run pytest -xvs
```

Expected: all tests pass (or integration tests skipped if Docker is unavailable; in that case re-run on a host with Docker before declaring S1 complete).

- [ ] **Step 9: Lint check (mirrors pre-commit)**

```bash
uv run ruff check src tests
uv run pylint src/kgw
```

Expected: no errors. Fix any warnings in source rather than suppressing.

- [ ] **Step 10: Run the verification-before-completion skill**

Invoke the `superpowers:verification-before-completion` skill. Provide the test-suite command output and lint output as evidence. Only after that returns clean should this slice be considered done.

- [ ] **Step 11: Open the development-branch finishing flow**

Invoke `superpowers:finishing-a-development-branch` to choose between PR, direct merge, or cleanup based on team workflow.

---

## Self-Review Notes

The plan was self-reviewed for:

- **Spec coverage** — every bullet in slicing spec §4 → S1 → 范围 maps to a Task: project skeleton (Task 1, 12), `/healthz` + `/metrics` (Task 12), config from env (Task 3), `KbConfigProvider` (Task 8), `AuthProvider` (Task 9), shared httpx (Task 10), DB + numbered migrations (Task 6, 7), `AuditWriter` (Task 11), structured logs + Prometheus (Task 5), `/kgw/internal/v1/echo` (Task 13). Acceptance items map to Task 15.
- **Placeholders** — none. Every step shows the code or command to run; no "implement later" / "add validation" / "similar to Task N".
- **Type consistency** — `KbConfig` field names, `AuthProvider.resolve_headers` signature, `AuditEntry` dataclass fields, and `_KgwClient.send` retry behavior are referenced consistently across Tasks 8/9/10/11/13/14.
- **Out-of-scope guard** — no metadataProperty endpoints, no business endpoints, no circuit breaker, no streaming proxy. These are deferred to S2–S5.

If a later slice changes this plan's foundation (e.g., needs a new column on `kgw_audit_log`), add a new numbered SQL file rather than editing existing ones.

















