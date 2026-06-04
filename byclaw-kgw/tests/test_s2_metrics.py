"""Smoke tests: verify S2 metric instruments exist and have correct labels."""

from __future__ import annotations


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
