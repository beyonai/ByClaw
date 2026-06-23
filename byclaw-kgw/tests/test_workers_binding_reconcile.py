"""Integration tests for stale DELETING binding reconciliation."""

# pylint: disable=redefined-outer-name

from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx
import pytest
import pytest_asyncio
from kgw.db import build_pool, run_migrations
from kgw.metadata.registry import create_property
from kgw.workers.binding_reconcile import reconcile_iteration

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

REPO_ROOT = Path(__file__).resolve().parent.parent
SQL_DIR = REPO_ROOT / "sql"

_TABLES_TO_DROP = (
    "kgw_metadata_property_sync",
    "kgw_metadata_property_binding",
    "kgw_metadata_property",
    "kgw_audit_log",
    "kgw_kb_source_lock",
    "kgw_kb_conflict_log",
    "kgw_migration",
)

_KN_CODE = "rc_kb"


class _FakeResponse:
    def __init__(self, body: dict[str, Any]):
        self._body = body
        self.status_code = 200

    def json(self) -> dict[str, Any]:
        return self._body

    def raise_for_status(self) -> None:
        return None


class _FakeHttp:
    def __init__(self):
        self._items: list[dict[str, Any] | Exception | Any] = []

    def queue_json(self, body: dict[str, Any]) -> None:
        self._items.append(body)

    def queue_exception(self, exc: Exception) -> None:
        self._items.append(exc)

    async def post(self, *args, **kwargs):  # pylint: disable=unused-argument
        item = self._items.pop(0)
        if callable(item):
            item = await item()
        if isinstance(item, Exception):
            raise item
        return _FakeResponse(item)


class _FakeConfig:
    resource_code = "backend_rc"
    domain_url = "http://kb-rc.test"
    domain_name = ""
    headers: dict[str, str] = {}

    def operation_path(self, op_id):  # pylint: disable=unused-argument
        return "/api/v1/knowledgeItems/metadata/get"


class _FakeConfigProvider:
    async def get_kb_config(self, kn_code: str):  # pylint: disable=unused-argument
        return _FakeConfig()


class _FakeAuthProvider:
    async def resolve_headers(self, headers, user_code=None):  # pylint: disable=unused-argument
        return {}


class _FakeState:
    def __init__(self):
        self.http = _FakeHttp()
        self.config_provider = _FakeConfigProvider()
        self.auth_provider = _FakeAuthProvider()


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def rc_pool(pg_dsn: str):
    """Module-scoped pool shared across reconcile worker tests."""
    pool = await build_pool(pg_dsn, min_size=1, max_size=3)
    await run_migrations(pool, SQL_DIR)
    yield pool
    async with pool.connection() as conn:
        for table in _TABLES_TO_DROP:
            await conn.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
        await conn.commit()
    await pool.close()


@pytest.fixture
def fake_state():
    return _FakeState()


async def _clean_rows(pool) -> None:
    """Delete binding + property rows between tests."""
    async with pool.connection() as conn:
        await conn.execute("DELETE FROM kgw_metadata_property_binding")
        await conn.execute("DELETE FROM kgw_metadata_property")
        await conn.commit()


async def _fetch_binding(pool, *, property_id: int, file_path: str) -> dict | None:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT property_id, kn_code, file_path, status, updated_at "
                "FROM kgw_metadata_property_binding "
                "WHERE property_id=%s AND kn_code=%s AND file_path=%s",
                (property_id, _KN_CODE, file_path),
            )
            return await cur.fetchone()


async def test_stale_deleting_removed_when_backend_has_no_field(rc_pool, fake_state):
    await _clean_rows(rc_pool)
    prop = await create_property(
        rc_pool, property_name="rc_deleting_absent", value_type="string"
    )
    async with rc_pool.connection() as conn:
        await conn.execute(
            "INSERT INTO kgw_metadata_property_binding "
            "(property_id, kn_code, file_path, status, bound_at, updated_at) "
            "VALUES (%s, %s, %s, 'DELETING', NOW(), "
            "NOW() - INTERVAL '10 minutes')",
            (prop.property_id, _KN_CODE, "/docs/rc_absent.md"),
        )
        await conn.commit()

    fake_state.http.queue_json({"resultCode": "0", "resultObject": {"metadata": {}}})

    deleted_n, restored_n, _ = await reconcile_iteration(
        rc_pool,
        state=fake_state,
        deleting_threshold_minutes=5,
    )

    assert deleted_n == 1
    assert restored_n == 0
    row = await _fetch_binding(
        rc_pool, property_id=prop.property_id, file_path="/docs/rc_absent.md"
    )
    assert row is None


async def test_stale_deleting_restored_when_backend_has_field(rc_pool, fake_state):
    await _clean_rows(rc_pool)
    prop = await create_property(
        rc_pool, property_name="rc_deleting_present", value_type="string"
    )
    async with rc_pool.connection() as conn:
        await conn.execute(
            "INSERT INTO kgw_metadata_property_binding "
            "(property_id, kn_code, file_path, status, bound_at, updated_at) "
            "VALUES (%s, %s, %s, 'DELETING', NOW(), "
            "NOW() - INTERVAL '10 minutes')",
            (prop.property_id, _KN_CODE, "/docs/rc_present.md"),
        )
        await conn.commit()

    fake_state.http.queue_json(
        {
            "resultCode": "0",
            "resultObject": {"metadata": {prop.backend_name: "still-present"}},
        }
    )

    deleted_n, restored_n, _ = await reconcile_iteration(
        rc_pool,
        state=fake_state,
        deleting_threshold_minutes=5,
    )

    assert deleted_n == 0
    assert restored_n == 1
    row = await _fetch_binding(
        rc_pool, property_id=prop.property_id, file_path="/docs/rc_present.md"
    )
    assert row is not None
    assert row["status"] == "BOUND"


async def test_stale_deleting_kept_when_backend_unavailable(rc_pool, fake_state):
    await _clean_rows(rc_pool)
    prop = await create_property(
        rc_pool, property_name="rc_deleting_unknown", value_type="string"
    )
    async with rc_pool.connection() as conn:
        await conn.execute(
            "INSERT INTO kgw_metadata_property_binding "
            "(property_id, kn_code, file_path, status, bound_at, updated_at) "
            "VALUES (%s, %s, %s, 'DELETING', NOW(), "
            "NOW() - INTERVAL '10 minutes')",
            (prop.property_id, _KN_CODE, "/docs/rc_unknown.md"),
        )
        await conn.commit()

    fake_state.http.queue_exception(httpx.ConnectError("offline"))

    deleted_n, restored_n, _ = await reconcile_iteration(
        rc_pool,
        state=fake_state,
        deleting_threshold_minutes=5,
    )

    assert deleted_n == 0
    assert restored_n == 0
    row = await _fetch_binding(
        rc_pool, property_id=prop.property_id, file_path="/docs/rc_unknown.md"
    )
    assert row is not None
    assert row["status"] == "DELETING"


async def test_stale_deleting_race_does_not_delete_refreshed_row(rc_pool, fake_state):
    await _clean_rows(rc_pool)
    prop = await create_property(
        rc_pool, property_name="rc_deleting_race", value_type="string"
    )
    async with rc_pool.connection() as conn:
        await conn.execute(
            "INSERT INTO kgw_metadata_property_binding "
            "(property_id, kn_code, file_path, status, bound_at, updated_at) "
            "VALUES (%s, %s, %s, 'DELETING', NOW(), "
            "NOW() - INTERVAL '10 minutes')",
            (prop.property_id, _KN_CODE, "/docs/rc_race.md"),
        )
        await conn.commit()

    async def refresh_row_before_backend_response():
        async with rc_pool.connection() as conn:
            await conn.execute(
                "UPDATE kgw_metadata_property_binding "
                "SET updated_at=NOW() "
                "WHERE property_id=%s AND kn_code=%s AND file_path=%s",
                (prop.property_id, _KN_CODE, "/docs/rc_race.md"),
            )
            await conn.commit()
        return {"resultCode": "0", "resultObject": {"metadata": {}}}

    fake_state.http.queue_json(refresh_row_before_backend_response)

    deleted_n, restored_n, _ = await reconcile_iteration(
        rc_pool,
        state=fake_state,
        deleting_threshold_minutes=5,
    )

    assert deleted_n == 0
    assert restored_n == 0
    row = await _fetch_binding(
        rc_pool, property_id=prop.property_id, file_path="/docs/rc_race.md"
    )
    assert row is not None
    assert row["status"] == "DELETING"
