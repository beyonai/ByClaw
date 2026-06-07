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

# S4 metadata property lifecycle counters
kgw_metadata_property_operations_total: Counter = Counter(
    "kgw_metadata_property_operations_total",
    "metadataProperty create/delete operations",
    ["operation", "result"],
    registry=REGISTRY,
)

kgw_metadata_sync_total: Counter = Counter(
    "kgw_metadata_sync_total",
    "Lazy sync attempts (ensure_synced T2 phase)",
    ["result"],  # success / failed / circuit_open
    registry=REGISTRY,
)

kgw_metadata_purge_total: Counter = Counter(
    "kgw_metadata_purge_total",
    "Cleanup worker purge attempts per sync row",
    ["result"],  # success / failed / circuit_open
    registry=REGISTRY,
)

kgw_metadata_reconcile_total: Counter = Counter(
    "kgw_metadata_reconcile_total",
    "Reconcile worker actions",
    ["action", "result"],  # action: outbox_drain / stale_pending / stale_syncing
    registry=REGISTRY,
)

kgw_ingest_events_total: Counter = Counter(
    "kgw_ingest_events_total",
    "Ingest events processed",
    ["op", "result"],
    registry=REGISTRY,
)

kgw_ingest_semaphore_rejected_total: Counter = Counter(
    "kgw_ingest_semaphore_rejected_total",
    "Ingest requests rejected due to concurrency limit (503)",
    registry=REGISTRY,
)
