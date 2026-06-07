# pylint: disable=redefined-outer-name
from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from kgw.api.events import router
from kgw.event_processor import EventResult


def _build_app() -> FastAPI:
    app = FastAPI()
    app.include_router(router)
    app.state.ingest_semaphore = asyncio.Semaphore(100)
    return app


@pytest.mark.asyncio
async def test_single_event_done() -> None:
    app = _build_app()

    async def mock_process(state, item, *, user_code, trace_id=None):  # pylint: disable=unused-argument
        return EventResult(event_id=42, status="done")

    with patch("kgw.api.events.process_event", mock_process):
        async with AsyncClient(
            transport=ASGITransport(app), base_url="http://test"
        ) as client:
            resp = await client.post(
                "/kgw/ingest/v1/events",
                json={
                    "sourceId": "s",
                    "itemId": "i",
                    "version": "v1",
                    "op": "upsert",
                    "knCode": "k",
                    "filePath": "/a.md",
                    "content": "hi",
                },
                headers={"X-User-Id": "user1"},
            )
    assert resp.status_code == 200
    body = resp.json()
    assert body["resultCode"] == "0"
    assert body["resultObject"]["eventId"] == 42
    assert body["resultObject"]["status"] == "done"


@pytest.mark.asyncio
async def test_already_processed() -> None:
    app = _build_app()

    async def mock_process(state, item, *, user_code, trace_id=None):  # pylint: disable=unused-argument
        return EventResult(event_id=99, status="already_processed")

    with patch("kgw.api.events.process_event", mock_process):
        async with AsyncClient(
            transport=ASGITransport(app), base_url="http://test"
        ) as client:
            resp = await client.post(
                "/kgw/ingest/v1/events",
                json={
                    "sourceId": "s",
                    "itemId": "i",
                    "version": "v1",
                    "op": "upsert",
                    "knCode": "k",
                    "filePath": "/a.md",
                    "content": "hi",
                },
                headers={"X-User-Id": "user1"},
            )
    assert resp.json()["resultCode"] == "0"
    assert resp.json()["resultMsg"] == "already-processed"


@pytest.mark.asyncio
async def test_in_progress_returns_409() -> None:
    app = _build_app()

    async def mock_process(state, item, *, user_code, trace_id=None):  # pylint: disable=unused-argument
        return EventResult(event_id=10, status="in_progress")

    with patch("kgw.api.events.process_event", mock_process):
        async with AsyncClient(
            transport=ASGITransport(app), base_url="http://test"
        ) as client:
            resp = await client.post(
                "/kgw/ingest/v1/events",
                json={
                    "sourceId": "s",
                    "itemId": "i",
                    "version": "v1",
                    "op": "upsert",
                    "knCode": "k",
                    "filePath": "/a.md",
                    "content": "hi",
                },
                headers={"X-User-Id": "user1"},
            )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_batch_partial_success() -> None:
    app = _build_app()
    call_count = 0

    async def mock_process(state, item, *, user_code, trace_id=None):  # pylint: disable=unused-argument
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return EventResult(event_id=1, status="done")
        return EventResult(
            event_id=2,
            status="failed",
            error_type="UPSTREAM_ERROR",
            error_message="oops",
        )

    with patch("kgw.api.events.process_event", mock_process):
        async with AsyncClient(
            transport=ASGITransport(app), base_url="http://test"
        ) as client:
            resp = await client.post(
                "/kgw/ingest/v1/events/batch",
                json={
                    "events": [
                        {
                            "sourceId": "s",
                            "itemId": "i1",
                            "op": "upsert",
                            "knCode": "k",
                            "filePath": "/a.md",
                            "content": "x",
                        },
                        {
                            "sourceId": "s",
                            "itemId": "i2",
                            "op": "upsert",
                            "knCode": "k",
                            "filePath": "/b.md",
                            "content": "y",
                        },
                    ]
                },
                headers={"X-User-Id": "u"},
            )
    body = resp.json()
    assert body["resultCode"] == "-1"
    assert body["resultObject"]["succeeded"] == 1
    assert body["resultObject"]["failed"] == 1


@pytest.mark.asyncio
async def test_batch_all_success() -> None:
    app = _build_app()

    async def mock_process(state, item, *, user_code, trace_id=None):  # pylint: disable=unused-argument
        return EventResult(event_id=1, status="done")

    with patch("kgw.api.events.process_event", mock_process):
        async with AsyncClient(
            transport=ASGITransport(app), base_url="http://test"
        ) as client:
            resp = await client.post(
                "/kgw/ingest/v1/events/batch",
                json={
                    "events": [
                        {
                            "sourceId": "s",
                            "itemId": "i1",
                            "op": "upsert",
                            "knCode": "k",
                            "filePath": "/a.md",
                            "content": "x",
                        },
                    ]
                },
                headers={"X-User-Id": "u"},
            )
    assert resp.json()["resultCode"] == "0"


@pytest.mark.asyncio
async def test_semaphore_full_returns_503() -> None:
    app = FastAPI()
    app.include_router(router)
    # Set semaphore to 0 available slots
    app.state.ingest_semaphore = asyncio.Semaphore(0)

    async with AsyncClient(
        transport=ASGITransport(app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/kgw/ingest/v1/events",
            json={
                "sourceId": "s",
                "itemId": "i",
                "op": "upsert",
                "knCode": "k",
                "filePath": "/a.md",
                "content": "x",
            },
            headers={"X-User-Id": "u"},
        )
    assert resp.status_code == 503
    assert resp.headers.get("retry-after") == "5"
