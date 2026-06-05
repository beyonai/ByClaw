"""Smoke tests: verify S2 metric instruments exist and have correct labels."""

from __future__ import annotations

import pytest


def test_dispatch_total_exists():
    from kgw.observability.metrics import DISPATCH_TOTAL

    # prometheus_client Counter strips the _total suffix from _name
    assert DISPATCH_TOTAL._name == "kgw_dispatch"
    # verify label names
    assert set(DISPATCH_TOTAL._labelnames) == {"operation", "kn_code", "result"}


def test_dispatch_latency_exists():
    from kgw.observability.metrics import DISPATCH_LATENCY

    assert DISPATCH_LATENCY._name == "kgw_dispatch_latency_seconds"
    assert set(DISPATCH_LATENCY._labelnames) == {"operation", "kn_code"}


def test_stream_bytes_total_exists():
    from kgw.observability.metrics import STREAM_BYTES_TOTAL

    # prometheus_client Counter strips the _total suffix from _name
    assert STREAM_BYTES_TOTAL._name == "kgw_stream_bytes"
    assert set(STREAM_BYTES_TOTAL._labelnames) == {"direction", "operation", "kn_code"}


def test_circuit_state_exists():
    from kgw.observability.metrics import CIRCUIT_STATE

    assert CIRCUIT_STATE._name == "kgw_circuit_state"
    assert set(CIRCUIT_STATE._labelnames) == {"kn_code"}


def test_all_metrics_use_shared_registry():
    from kgw.observability.metrics import REGISTRY

    # REGISTRY.collect() returns Metric objects with a .name attribute.
    # prometheus_client stores Counter base names without the _total suffix.
    names = {m.name for m in REGISTRY.collect()}
    assert "kgw_dispatch" in names
    assert "kgw_dispatch_latency_seconds" in names
    assert "kgw_stream_bytes" in names
    assert "kgw_circuit_state" in names


@pytest.mark.asyncio
async def test_read_op_counts_in_dispatch_total():
    """A successful listDir dispatch increments kgw_dispatch_total."""
    from unittest.mock import AsyncMock, MagicMock

    import httpx
    import respx
    from kgw.config_provider import KbConfig
    from kgw.dispatcher import dispatch_json
    from kgw.observability.metrics import DISPATCH_TOTAL
    from kgw.resilience.circuit_breaker import CircuitBreakerRegistry

    cfg = KbConfig(
        kn_code="metrics_kb",
        resource_code="metrics_backend",
        domain_url="http://kb-metrics.test",
        domain_name="",
        headers={},
        operations=frozenset({"listDir"}),
        operation_paths={"listDir": "/api/v1/listDir"},
        raw={},
    )
    state = MagicMock()
    state.config_provider = AsyncMock()
    state.config_provider.get_kb_config.return_value = cfg
    state.auth_provider = AsyncMock()
    state.auth_provider.resolve_headers.return_value = {}
    state.circuit_breakers = CircuitBreakerRegistry()
    state.audit = AsyncMock()
    state.pool = MagicMock()
    state.http = httpx.AsyncClient()

    req = MagicMock()
    req.app.state = state
    req.headers = {}

    before = DISPATCH_TOTAL.labels(
        operation="listDir", kn_code="metrics_kb", result="0"
    )._value.get()
    with respx.mock:
        respx.post("http://kb-metrics.test/api/v1/listDir").mock(
            return_value=httpx.Response(
                200,
                json={"resultCode": "0", "resultMsg": "ok", "resultObject": {}},
            )
        )
        await dispatch_json(
            req,
            operation="listDir",
            kn_code="metrics_kb",
            user_id="u1",
            body={"knCode": "metrics_kb"},
        )
    after = DISPATCH_TOTAL.labels(
        operation="listDir", kn_code="metrics_kb", result="0"
    )._value.get()
    assert after - before == 1
