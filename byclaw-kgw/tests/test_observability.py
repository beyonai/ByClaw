from __future__ import annotations


def test_logger_returns_structlog_bound_logger():
    from kgw.observability.logger import configure_logging, get_logger

    configure_logging(json_logs=False)
    log = get_logger("kgw.test")
    log.info("hello", k="v")


def test_metrics_registry_singleton():
    from kgw.observability.metrics import get_registry

    r1 = get_registry()
    r2 = get_registry()
    assert r1 is r2


def test_metrics_registry_emits_default_metrics():
    from kgw.observability.metrics import get_registry
    from prometheus_client import generate_latest

    output = generate_latest(get_registry()).decode("utf-8")
    assert isinstance(output, str)


async def test_trace_id_middleware_generates_when_missing():
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from kgw.observability.tracing import (
        TRACE_HEADER,
        TraceIdMiddleware,
        current_trace_id,
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
    from kgw.observability.tracing import TRACE_HEADER, TraceIdMiddleware

    app = FastAPI()
    app.add_middleware(TraceIdMiddleware)

    @app.get("/x")
    async def x():
        return {"ok": True}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        resp = await c.get("/x", headers={TRACE_HEADER: "trace-abc"})
    assert resp.headers[TRACE_HEADER] == "trace-abc"
