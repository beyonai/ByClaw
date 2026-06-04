"""Prometheus metrics registry.

A single ``CollectorRegistry`` is shared across the process.
"""

from __future__ import annotations

from prometheus_client import CollectorRegistry

_REGISTRY: CollectorRegistry | None = None


def get_registry() -> CollectorRegistry:
    """Return the process-wide Prometheus registry."""
    global _REGISTRY
    if _REGISTRY is None:
        _REGISTRY = CollectorRegistry(auto_describe=True)
    return _REGISTRY
