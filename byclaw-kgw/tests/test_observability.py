from __future__ import annotations


def test_logger_returns_structlog_bound_logger():
    from kgw.observability.logger import configure_logging, get_logger

    configure_logging(json_logs=False)
    log = get_logger("kgw.test")
    log.info("hello", k="v")


def test_metrics_registry_singleton():
    from kgw.observability.metrics import REGISTRY, get_registry

    assert get_registry() is REGISTRY


def test_metrics_registry_emits_output_with_registered_metric():
    from prometheus_client import CollectorRegistry, Counter, generate_latest

    # Use a fresh registry per test to avoid cross-test pollution
    test_registry = CollectorRegistry()
    c = Counter("kgw_test_hits_total", "test counter", registry=test_registry)
    c.inc()
    output = generate_latest(test_registry).decode("utf-8")
    assert "kgw_test_hits_total" in output
    assert "1.0" in output


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
