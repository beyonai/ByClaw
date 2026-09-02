from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import Any

import datacloud_knowledge.sync
import datacloud_platform

import byclaw_data.platform.routes as platform_routes
from byclaw_data.platform.routes import _configure_platform_logging


def test_configure_platform_logging_includes_datacloud_namespaces(
    monkeypatch,
) -> None:
    calls: list[dict[str, Any]] = []

    def fake_setup_logging(**kwargs: Any) -> None:
        calls.append(kwargs)

    monkeypatch.setenv("DATACLOUD_DATA_SERVICE_LOG_LEVEL", "debug")

    _configure_platform_logging(setup_logging_func=fake_setup_logging)

    assert calls == [
        {
            "level": "DEBUG",
            "extra_namespaces": ("byclaw_data", "datacloud_knowledge"),
        }
    ]


async def test_platform_lifespan_manages_term_sync_worker(monkeypatch) -> None:
    started = asyncio.Event()
    cancelled = asyncio.Event()
    platform = object()

    async def fake_term_sync_worker(*, handler) -> None:
        assert handler is platform
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    async def fake_register_service(application) -> None:
        return None

    async def fake_unregister_service(application) -> None:
        return None

    @asynccontextmanager
    async def original_lifespan(application):
        yield

    monkeypatch.setattr(
        datacloud_knowledge.sync,
        "term_sync_worker",
        fake_term_sync_worker,
    )
    monkeypatch.setattr(datacloud_platform, "get_platform", lambda: platform)
    monkeypatch.setattr(platform_routes, "register_service", fake_register_service)
    monkeypatch.setattr(platform_routes, "unregister_service", fake_unregister_service)

    app = SimpleNamespace(
        router=SimpleNamespace(lifespan_context=original_lifespan),
        state=SimpleNamespace(),
    )
    platform_routes._wrap_lifespan_with_discovery(app)

    async with app.router.lifespan_context(app):
        await asyncio.wait_for(started.wait(), timeout=1)
        task = app.state.term_sync_worker_task
        assert task.get_name() == "term_sync_worker"
        assert not task.done()

    assert cancelled.is_set()
    assert not hasattr(app.state, "term_sync_worker_task")
