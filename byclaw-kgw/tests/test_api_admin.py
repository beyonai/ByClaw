# pylint: disable=redefined-outer-name
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from kgw.api.admin import router


def _build_app() -> FastAPI:
    app = FastAPI()
    app.include_router(router)
    return app


def _mock_pool(rows: list, count: int = 0) -> MagicMock:
    """Build a minimal async context-manager mock pool."""
    cur = MagicMock()
    cur.execute = AsyncMock()
    cur.fetchone = AsyncMock(return_value={"count": count})
    cur.fetchall = AsyncMock(return_value=rows)
    cur.rowcount = 0
    cur.__aenter__ = AsyncMock(return_value=cur)
    cur.__aexit__ = AsyncMock(return_value=False)

    conn = MagicMock()
    conn.cursor = MagicMock(return_value=cur)
    conn.commit = AsyncMock()
    conn.rollback = AsyncMock()
    conn.__aenter__ = AsyncMock(return_value=conn)
    conn.__aexit__ = AsyncMock(return_value=False)

    pool = MagicMock()
    pool.connection = MagicMock(return_value=conn)
    return pool


@pytest.mark.asyncio
async def test_audit_returns_empty_list() -> None:
    app = _build_app()
    app.state.pool = _mock_pool(rows=[], count=0)

    async with AsyncClient(
        transport=ASGITransport(app), base_url="http://test"
    ) as client:
        resp = await client.get("/kgw/admin/v1/audit")

    assert resp.status_code == 200
    body = resp.json()
    assert body["resultCode"] == "0"
    assert body["resultObject"]["data"] == []
    assert body["resultObject"]["total"] == 0


@pytest.mark.asyncio
async def test_conflicts_returns_empty_list() -> None:
    app = _build_app()
    app.state.pool = _mock_pool(rows=[], count=0)

    async with AsyncClient(
        transport=ASGITransport(app), base_url="http://test"
    ) as client:
        resp = await client.get("/kgw/admin/v1/conflicts")

    assert resp.status_code == 200
    assert resp.json()["resultCode"] == "0"


@pytest.mark.asyncio
async def test_unlock_nonexistent_returns_minus1() -> None:
    app = _build_app()
    # rowcount=0 means no row deleted
    pool = _mock_pool(rows=[], count=0)
    pool.connection().__aenter__.return_value.cursor().__aenter__.return_value.rowcount = 0
    app.state.pool = pool

    async with AsyncClient(
        transport=ASGITransport(app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/kgw/admin/v1/kbs/test_kb/files/%2Fpolicy%2Fsalary.md/unlock"
        )

    assert resp.json()["resultCode"] == "-1"
