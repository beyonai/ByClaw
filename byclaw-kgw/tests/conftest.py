"""Shared test fixtures for byclaw-kgw.

Two layers:

* Unit tests (default) — use mock backends: ``fake_redis`` (fakeredis)
  and ``respx`` for httpx-based clients (KB upstream + aioboto3/MinIO
  S3 transport).

* Integration tests (marked ``@pytest.mark.integration``) — use real
  OpenGauss / Redis / MinIO via the byclaw middleware compose stack at
  ``deploy/middleware/``. Default ``pytest`` invocation skips these
  via ``-m "not integration"`` (see ``pytest.ini``); run with
  ``uv run pytest -m integration`` after starting the stack.

Integration fixtures read connection settings directly from the byclaw
repo-level ``.env`` (loaded from ``<repo-root>/.env`` if present), using
the same variable names as ``byclaw-be`` / ``byclaw-qa``: ``DB_HOST``,
``DB_PORT``, ``DB_USER``, ``DB_PASS``, ``DB_DATABASE``, ``DB_SCHEMA``,
``REDIS_HOST``, ``REDIS_PORT``, ``REDIS_PASSWORD``, ``REDIS_USERNAME``,
``REDIS_DATABASE``, ``FILE_STORAGE_MINIO_HOST``,
``FILE_STORAGE_MINIO_API_PORT``, ``FILE_STORAGE_MINIO_ACCESS_KEY``,
``FILE_STORAGE_MINIO_SECRET_KEY``, ``FILE_STORAGE_MINIO_SECURE``,
``FILE_STORAGE_MINIO_BUCKET_NAME``.

These fixtures do NOT decide what schema / redis db / bucket to use —
they consume whatever ``.env`` provides. Switch environments by swapping
``.env`` files (production / staging / test ``.env`` are managed at the
deployment layer, not in code).

A fixture skips its test when a required variable is missing, so a
half-configured environment never causes a hard failure.
"""

# pylint: disable=redefined-outer-name  # pytest fixture pattern

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from pathlib import Path
from urllib.parse import quote

import pytest

_ENV_LOADED = False
_HERE = Path(__file__).resolve()


def _find_repo_env() -> Path | None:
    """Return the path of the repo-level .env if it exists."""
    for parent in [_HERE.parent.parent, *_HERE.parents]:
        candidate = parent / ".env"
        if candidate.is_file():
            return candidate
    return None


def _load_dotenv_once() -> None:
    """Load the byclaw repo-level ``.env`` into ``os.environ`` once."""
    global _ENV_LOADED
    if _ENV_LOADED:
        return
    _ENV_LOADED = True
    env_path = _find_repo_env()
    if env_path is None:
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def _require_env(name: str) -> str:
    """Return env var, or ``pytest.skip`` with a clear reason."""
    _load_dotenv_once()
    value = os.environ.get(name)
    if not value:
        pytest.skip(
            f"integration test requires env var {name} "
            f"(set in <repo>/.env or export it before running)"
        )
    return value


def _env(name: str, default: str = "") -> str:
    _load_dotenv_once()
    return os.environ.get(name, default)


# ---------------------------------------------------------------------------
# Integration fixtures (real backends — only resolve when used)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def pg_dsn() -> str:
    """OpenGauss DSN built from the repo .env values.

    Includes ``DB_SCHEMA`` as the connection-level search_path so callers
    do not need to qualify table names. The schema itself must already
    exist in the target database.
    """
    host = _require_env("DB_HOST")
    port = _require_env("DB_PORT")
    user = _require_env("DB_USER")
    password = _require_env("DB_PASS")
    database = _require_env("DB_DATABASE")
    schema = _env("DB_SCHEMA")
    base = f"postgresql://{quote(user)}:{quote(password)}@{host}:{port}/{database}"
    if schema:
        return f"{base}?options=-csearch_path%3D{schema}"
    return base


@pytest.fixture(scope="session")
def db_schema() -> str:
    """Schema name from the repo .env (empty string when unset)."""
    return _env("DB_SCHEMA")


@pytest.fixture(scope="session")
def redis_url() -> str:
    """Redis URL built from the repo .env values."""
    host = _require_env("REDIS_HOST")
    port = _require_env("REDIS_PORT")
    db = _env("REDIS_DATABASE", "0")
    password = _env("REDIS_PASSWORD")
    username = _env("REDIS_USERNAME")
    auth = ""
    if password:
        if username:
            auth = f"{quote(username)}:{quote(password)}@"
        else:
            auth = f":{quote(password)}@"
    return f"redis://{auth}{host}:{port}/{db}"


@pytest.fixture(scope="session")
def minio_settings() -> dict[str, str]:
    """MinIO connection settings from the repo .env values."""
    host = _require_env("FILE_STORAGE_MINIO_HOST")
    port = _require_env("FILE_STORAGE_MINIO_API_PORT")
    secure = _env("FILE_STORAGE_MINIO_SECURE", "false").lower() in {
        "true",
        "1",
        "yes",
    }
    scheme = "https" if secure else "http"
    return {
        "endpoint_url": f"{scheme}://{host}:{port}",
        "access_key": _require_env("FILE_STORAGE_MINIO_ACCESS_KEY"),
        "secret_key": _require_env("FILE_STORAGE_MINIO_SECRET_KEY"),
        "bucket": _require_env("FILE_STORAGE_MINIO_BUCKET_NAME"),
    }


@pytest.fixture
async def minio_bucket(minio_settings: dict[str, str]) -> AsyncIterator[str]:
    """Return the configured bucket name.

    Assumes the bucket already exists (created by the MinIO deployment).
    Object-level operations (GetObject/PutObject) work correctly with
    aiobotocore; bucket-level operations (HeadBucket/CreateBucket) trigger
    botocore endpoint ruleset issues and are intentionally avoided here.
    """
    yield minio_settings["bucket"]


# ---------------------------------------------------------------------------
# Unit-test fixtures (mock backends)
# ---------------------------------------------------------------------------


@pytest.fixture
async def fake_redis() -> AsyncIterator:
    """In-memory Redis for unit tests; supports the same async API."""
    import fakeredis.aioredis

    client = fakeredis.aioredis.FakeRedis(decode_responses=False)
    try:
        yield client
    finally:
        await client.aclose()
