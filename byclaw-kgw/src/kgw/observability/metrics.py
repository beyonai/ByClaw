"""Prometheus metrics registry.

A single ``REGISTRY`` is the process-wide Prometheus collector. Import it
directly: ``from kgw.observability.metrics import REGISTRY``.

Tests that need metric isolation should create their own
``CollectorRegistry()`` and pass it into the code under test instead of
using the module-level one.
"""

from __future__ import annotations

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram

REGISTRY: CollectorRegistry = CollectorRegistry(auto_describe=True)


def get_registry() -> CollectorRegistry:
    """Return the process-wide Prometheus registry.

    Kept for backwards compatibility; prefer importing ``REGISTRY`` directly.
    """
    return REGISTRY


DISPATCH_TOTAL: Counter = Counter(
    "kgw_dispatch_total",
    "Total dispatched KB requests",
    ["operation", "kn_code", "result"],
    registry=REGISTRY,
)
DISPATCH_LATENCY: Histogram = Histogram(
    "kgw_dispatch_latency_seconds",
    "KB request dispatch latency in seconds",
    ["operation", "kn_code"],
    registry=REGISTRY,
)
STREAM_BYTES_TOTAL: Counter = Counter(
    "kgw_stream_bytes_total",
    "Total bytes transferred via streaming proxy",
    ["direction", "operation", "kn_code"],
    registry=REGISTRY,
)
CIRCUIT_STATE: Gauge = Gauge(
    "kgw_circuit_state",
    "Circuit breaker state per endpoint (0=CLOSED 1=OPEN 2=HALF_OPEN)",
    ["kn_code"],
    registry=REGISTRY,
)
