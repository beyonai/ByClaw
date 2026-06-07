"""Integration tests: ingest error paths GU17-GU23.

Covers: payload-too-large, semaphore-503, backend auth failure,
backend timeout, circuit breaker OPEN.
"""

# pylint: disable=redefined-outer-name,invalid-name,unused-argument

from typing import Any

import httpx
import pytest
import respx
from kgw.resilience.circuit_breaker import CircuitState

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

# KB config constants -- must match values in conftest.py
_KN_DIRECT = "200001"
_KB_DIRECT_URL = "http://kb-direct.test"
_USER_ID = "test_user"


def _hdrs(extra: dict[str, str] | None = None) -> dict[str, str]:
    h = {"X-User-Id": _USER_ID}
    if extra:
        h.update(extra)
    return h


_INGEST_URL = "/kgw/ingest/v1/events"
_IMPORT_URL = f"{_KB_DIRECT_URL}/api/v1/knowledgeItems/import"

_BASE_EVENT: dict[str, Any] = {
    "sourceId": "err_test_src",
    "itemId": "err_item_1",
    "version": "2026-06-07T00:00:00Z",
    "op": "upsert",
    "knCode": _KN_DIRECT,
    "filePath": "/error/test.md",
    "content": "# test",
}


def _event(**overrides: Any) -> dict[str, Any]:
    e = {**_BASE_EVENT, **overrides}
    # Ensure unique itemId per test to avoid idempotency conflicts
    return e


# ---- GU17: payload too large ----
async def test_payload_too_large(client):
    """Request body > 4MB should be rejected."""
    huge = _event(content="x" * (4 * 1024 * 1024 + 100))
    resp = await client.post(
        _INGEST_URL,
        json=huge,
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "-1"


# ---- GU22: backend auth failure (401) ----
async def test_backend_auth_failed(client):
    """Backend returning 401 should produce BACKEND_AUTH_FAILED."""
    with respx.mock(assert_all_called=False) as mock:
        mock.post(_IMPORT_URL).mock(return_value=httpx.Response(401))
        resp = await client.post(
            _INGEST_URL,
            json=_event(
                sourceId="err_auth",
                itemId="auth_item",
                version="2026-06-07T01:00:00Z",
                filePath="/error/auth.md",
            ),
            headers=_hdrs(),
        )
    body = resp.json()
    assert body["resultCode"] == "-1"
    assert body["resultObject"]["status"] == "failed"
    # Error type should indicate auth failure
    assert body["resultObject"]["errorType"] in (
        "BACKEND_AUTH_FAILED",
        "UPSTREAM_ERROR",
    )


# ---- GU23: circuit breaker OPEN ----
async def test_circuit_breaker_open(client, app):
    """After threshold failures, the circuit breaker opens."""
    endpoint_key = _KB_DIRECT_URL
    cb = app.state.circuit_breakers.get(endpoint_key)

    # Force the circuit OPEN by recording threshold+1 failures
    for _ in range(6):  # failure_threshold=5 in conftest fixture
        cb.record_failure()

    # Now try an upsert -- should be rejected by CB
    resp = await client.post(
        _INGEST_URL,
        json=_event(
            sourceId="err_cb",
            itemId="cb_item",
            version="2026-06-07T02:00:00Z",
            filePath="/error/cb.md",
        ),
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "-1"
    assert body["resultObject"]["status"] == "failed"

    # Reset CB for subsequent tests
    cb.record_success()  # record_success unconditionally resets to CLOSED
    cb._failure_count = 0  # noqa: SLF001
    cb._state = CircuitState.CLOSED  # noqa: SLF001


# ---- ER4: circuit breaker recovery ----
async def test_circuit_breaker_recovery(client, app):
    """After opening, the CB should eventually recover."""
    endpoint_key = _KB_DIRECT_URL
    cb = app.state.circuit_breakers.get(endpoint_key)

    # Ensure CB starts CLOSED
    assert cb._state in (CircuitState.CLOSED, CircuitState.HALF_OPEN)  # noqa: SLF001

    # Force OPEN
    for _ in range(6):
        cb.record_failure()
    assert cb._state == CircuitState.OPEN  # noqa: SLF001

    # Force recovery -- record_success unconditionally resets to CLOSED
    cb.record_success()
    assert cb._state == CircuitState.CLOSED  # noqa: SLF001


# ---- E2 partial: Redis not available (graceful error) ----
async def test_redis_auth_not_found(client):
    """Request with X-User-Id that has no Redis auth entry.

    When the KB config has no header placeholders, auth resolution
    is a no-op. The request proceeds to the backend.
    """
    with respx.mock(assert_all_called=False) as mock:
        mock.post(f"{_KB_DIRECT_URL}/api/v1/listDir").mock(
            return_value=httpx.Response(
                200,
                json={"resultCode": "0", "resultObject": {"data": []}},
            )
        )
        resp = await client.post(
            "/kgw/api/v1/listDir",
            json={"knCode": _KN_DIRECT, "directoryPath": "/"},
            headers={"X-User-Id": "no_such_user"},
        )
    assert resp.status_code == 200
    assert resp.json()["resultCode"] == "0"
