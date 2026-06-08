"""Integration tests: ingest error paths.

Covers: payload-too-large, circuit breaker OPEN / recovery,
basic success (control), missing knCode.

No respx mocking -- all tests use the real byclaw-qa backend on port 8000
(via ``app.state`` resources seeded by conftest).
"""

# pylint: disable=redefined-outer-name,invalid-name,unused-argument

from typing import Any

import pytest
from kgw.resilience.circuit_breaker import CircuitState

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_KN_DIRECT = "200001"
_USER_ID = "test_user"


def _hdrs(extra: dict[str, str] | None = None) -> dict[str, str]:
    h = {"X-User-Id": _USER_ID}
    if extra:
        h.update(extra)
    return h


_INGEST_URL = "/kgw/ingest/v1/events"

_BASE_EVENT: dict[str, Any] = {
    "sourceId": "ingest_err_test",
    "itemId": "ingest_err_item",
    "version": "2026-06-08T00:00:00Z",
    "op": "upsert",
    "knCode": _KN_DIRECT,
    "filePath": "/ingest-err-test/test.md",
    "content": "# test",
}


def _event(**overrides: Any) -> dict[str, Any]:
    e = {**_BASE_EVENT, **overrides}
    return e


# ---------------------------------------------------------------------------
# GU17: payload too large (gateway rejects before calling backend)
# ---------------------------------------------------------------------------


async def test_payload_too_large(client):
    """Request body > 4 MB should be rejected with resultCode=-1."""
    huge = _event(content="x" * (4 * 1024 * 1024 + 100))
    resp = await client.post(
        _INGEST_URL,
        json=huge,
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "-1"


# ---------------------------------------------------------------------------
# GU23: circuit breaker OPEN
# ---------------------------------------------------------------------------


async def test_circuit_breaker_open(client, app):
    """After threshold failures, the circuit breaker opens and rejects requests."""
    cb = app.state.circuit_breakers.get("http://127.0.0.1:8000")

    # Force the circuit OPEN by recording threshold+1 failures
    for _ in range(6):  # failure_threshold=5 in conftest fixture
        cb.record_failure()

    # Now try an upsert -- should be rejected by CB before calling backend
    resp = await client.post(
        _INGEST_URL,
        json=_event(
            sourceId="ingest_err_cb",
            itemId="cb_open_item",
            version="2026-06-08T00:00:01Z",
            filePath="/ingest-err-test/cb-open.md",
        ),
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "-1"

    # Reset CB for subsequent tests
    cb._failure_count = 0  # noqa: SLF001
    cb._state = CircuitState.CLOSED  # noqa: SLF001


# ---------------------------------------------------------------------------
# ER4: circuit breaker recovery
# ---------------------------------------------------------------------------


async def test_circuit_breaker_recovery(client, app):
    """After opening, record_success resets the breaker to CLOSED."""
    cb = app.state.circuit_breakers.get("http://127.0.0.1:8000")

    # Ensure CB starts CLOSED
    assert cb._state in (CircuitState.CLOSED, CircuitState.HALF_OPEN)  # noqa: SLF001

    # Force OPEN
    for _ in range(6):
        cb.record_failure()
    assert cb._state == CircuitState.OPEN  # noqa: SLF001

    # record_success unconditionally transitions to CLOSED
    cb.record_success()
    assert cb._state == CircuitState.CLOSED  # noqa: SLF001


# ---------------------------------------------------------------------------
# E2R4: basic success (control test -- real backend round-trip)
# ---------------------------------------------------------------------------


async def test_ingest_event_basic_success(client):
    """A valid upsert event to a known KB should succeed against the real backend."""
    import uuid

    item_id = f"ingest_err_basic_success_{uuid.uuid4().hex[:8]}"
    resp = await client.post(
        _INGEST_URL,
        json=_event(
            sourceId="ingest_err_test",
            itemId=item_id,
            version="2026-06-08T00:00:02Z",
            filePath=f"/ingest-err-test/{item_id}.md",
        ),
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0"
    assert body["resultObject"]["status"] == "done"


# ---------------------------------------------------------------------------
# E2R5: missing knCode
# ---------------------------------------------------------------------------


async def test_ingest_missing_kncode(client):
    """An unknown knCode should be rejected before any backend call."""
    resp = await client.post(
        _INGEST_URL,
        json={
            "sourceId": "ingest_err_test",
            "itemId": "missing_kn_item",
            "version": "2026-06-08T00:00:03Z",
            "op": "upsert",
            "knCode": "99999999",
            "filePath": "/ingest-err-test/missing.md",
            "content": "# test",
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "-1"
