"""Prometheus metrics registry.

A single ``REGISTRY`` is the process-wide Prometheus collector. Import it
directly: ``from kgw.observability.metrics import REGISTRY``.

Tests that need metric isolation should create their own
``CollectorRegistry()`` and pass it into the code under test instead of
using the module-level one.
"""

from __future__ import annotations

from prometheus_client import CollectorRegistry

REGISTRY: CollectorRegistry = CollectorRegistry(auto_describe=True)


def get_registry() -> CollectorRegistry:
    """Return the process-wide Prometheus registry.

    Kept for backwards compatibility; prefer importing ``REGISTRY`` directly.
    """
    return REGISTRY
