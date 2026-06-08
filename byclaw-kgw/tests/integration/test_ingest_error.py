"""Integration tests: ingest error paths.

Covers: payload-too-large, circuit breaker OPEN / HALF_OPEN / recovery,
backend timeout, backend auth failure, basic success (control), missing knCode.

Most tests use the real byclaw-qa backend.  Backend-failure simulations
(timeout, 401/403) use respx mocks because the real backend cannot
natively inject those conditions.
"""

# pylint: disable=redefined-outer-name,invalid-name,unused-argument

import asyncio
import time
from typing import Any
from unittest.mock import patch

import httpx
import pytest
import respx
from kgw.resilience.circuit_breaker import CircuitState

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_KN_DIRECT = "200001"
_USER_ID = "test_user"
_QA_URL = "http://127.0.0.1:8000"
_IMPORT_PATH = "/api/v1/knowledgeItems/import"


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


def _reset_circuit_breaker(app) -> None:
    """Force the direct-KB circuit breaker back to CLOSED."""
    cb = app.state.circuit_breakers.get(_QA_URL)
    cb._failure_count = 0  # noqa: SLF001
    cb._state = CircuitState.CLOSED  # noqa: SLF001
    cb._opened_at = None  # noqa: SLF001
    cb._half_open_in_flight = 0  # noqa: SLF001


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
    """After threshold failures, the circuit breaker opens and rejects requests.

    The response envelope carries errorType=CIRCUIT_OPEN in resultObject.
    """
    _reset_circuit_breaker(app)
    cb = app.state.circuit_breakers.get(_QA_URL)

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
    assert body["resultObject"]["errorType"] == "CIRCUIT_OPEN"

    # Reset CB for subsequent tests
    _reset_circuit_breaker(app)


# ---------------------------------------------------------------------------
# ER4: circuit breaker recovery (OPEN -> HALF_OPEN -> CLOSED)
# ---------------------------------------------------------------------------


async def test_circuit_breaker_recovery(client, app):
    """After the open-duration elapses, CB transitions to HALF_OPEN,
    and a successful request moves it to CLOSED."""
    _reset_circuit_breaker(app)
    cb = app.state.circuit_breakers.get(_QA_URL)

    # Force OPEN
    for _ in range(6):
        cb.record_failure()
    assert cb._state == CircuitState.OPEN  # noqa: SLF001

    # Simulate open_duration elapsed (30 s) → transition to HALF_OPEN
    cb._opened_at = time.monotonic() - 31.0  # noqa: SLF001
    cb._materialize_half_open()
    assert cb._state == CircuitState.HALF_OPEN  # noqa: SLF001

    # Send a successful request with mocked backend response
    with respx.mock(assert_all_called=False) as mock:
        mock.post(f"{_QA_URL}{_IMPORT_PATH}").mock(
            return_value=httpx.Response(
                200, json={"resultCode": "0", "resultMsg": "ok"}
            )
        )
        resp = await client.post(
            _INGEST_URL,
            json=_event(
                sourceId="cb_recovery",
                itemId="cb_recovery_item",
                version="2026-06-08T00:00:03Z",
                filePath="/ingest-err-test/cb-recovery.md",
            ),
            headers=_hdrs(),
        )
        body = resp.json()
        assert body["resultCode"] == "0"

    assert cb._state == CircuitState.CLOSED  # noqa: SLF001
    assert cb._failure_count == 0  # noqa: SLF001


# ---------------------------------------------------------------------------
# GU21: backend timeout (PROCESSING_TIMEOUT)
# ---------------------------------------------------------------------------


async def test_backend_timeout(client, app):
    """GU21: Backend times out after 30s -- event status=failed with PROCESSING_TIMEOUT.

    The 30s asyncio.timeout is patched down to 1s and the backend mock
    sleeps longer, so the timeout fires quickly.
    """
    _reset_circuit_breaker(app)

    with respx.mock(assert_all_called=False) as mock:

        async def _slow(_request):
            await asyncio.sleep(5)
            return httpx.Response(200, json={"resultCode": "0"})

        mock.post(f"{_QA_URL}{_IMPORT_PATH}").mock(side_effect=_slow)

        # Capture the real timeout before patching --- patch
        # modifies ``asyncio.timeout`` globally (event_processor
        # and this module share the same ``asyncio`` module object).
        _real_timeout = asyncio.timeout

        with patch("kgw.event_processor.asyncio.timeout") as mock_to:

            def _short_timeout(delay):  # pylint: disable=unused-argument
                return _real_timeout(1.0)

            mock_to.side_effect = _short_timeout

            resp = await client.post(
                _INGEST_URL,
                json=_event(
                    sourceId="timeout_test",
                    itemId="timeout_item",
                    version="2026-06-08T00:05:00Z",
                    filePath="/ingest-err-test/timeout.md",
                ),
                headers=_hdrs(),
            )
            body = resp.json()
            assert body["resultCode"] == "-1"
            assert body["resultObject"]["status"] == "failed"
            assert body["resultObject"]["errorType"] == "PROCESSING_TIMEOUT"


# ---------------------------------------------------------------------------
# GU22: backend auth failure (BACKEND_AUTH_FAILED)
# ---------------------------------------------------------------------------


async def test_backend_auth_failed(client, app):
    """GU22: Backend returns 401 -- status=failed with BACKEND_AUTH_FAILED."""
    _reset_circuit_breaker(app)

    with respx.mock(assert_all_called=False) as mock:
        mock.post(f"{_QA_URL}{_IMPORT_PATH}").mock(
            return_value=httpx.Response(401, json={"error": "unauthorized"})
        )

        resp = await client.post(
            _INGEST_URL,
            json=_event(
                sourceId="backend_auth_test",
                itemId="auth_fail_item",
                version="2026-06-08T00:06:00Z",
                filePath="/ingest-err-test/auth-fail.md",
            ),
            headers=_hdrs(),
        )
        body = resp.json()
        assert body["resultCode"] == "-1"
        assert body["resultObject"]["status"] == "failed"
        assert body["resultObject"]["errorType"] == "BACKEND_AUTH_FAILED"


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
