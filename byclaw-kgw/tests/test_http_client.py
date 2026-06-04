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
            await client.get("http://upstream/z", headers={"X-Trace-Id": "explicit"})
    finally:
        _trace_id_var.reset(token)

    assert route.calls.last.request.headers["X-Trace-Id"] == "explicit"
