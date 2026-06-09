"""Integration tests: common error paths for the byclaw-kgw gateway.

Covers: unknown knCode (KBNotFound), missing auth header, invalid auth user,
upstream connection error, upstream timeout, backend 401/403,
missing required fields, plus control tests for real-backend health.

Backend-failure simulations (connect error, timeout, 401, 403) use respx
mocks because the real byclaw-qa backend cannot natively inject those
conditions.
"""
# pylint: disable=redefined-outer-name,invalid-name,unused-argument

import httpx
import pytest
import respx
from kgw.resilience.circuit_breaker import CircuitState

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

_KN_DIRECT = "200001"
_USER_ID = "test_user"
_QA_URL = "http://127.0.0.1:8000"


def _hdrs(extra: dict | None = None) -> dict[str, str]:
    h = {"X-User-Id": _USER_ID}
    if extra:
        h.update(extra)
    return h


def _reset_circuit_breaker(app) -> None:
    """Force the direct-KB circuit breaker back to CLOSED."""
    cb = app.state.circuit_breakers.get(_QA_URL)
    cb._failure_count = 0  # noqa: SLF001
    cb._state = CircuitState.CLOSED  # noqa: SLF001
    cb._opened_at = None  # noqa: SLF001
    cb._half_open_in_flight = 0  # noqa: SLF001


# ---- Unknown knCode (all interfaces) ----


async def test_unknown_kn_code_listdir(client):
    """POST /listDir with nonexistent knCode returns KBNotFound error."""
    resp = await client.post(
        "/kgw/api/v1/listDir",
        json={"knCode": "99999999", "directoryPath": "/"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "-1"
    assert body["resultObject"]["errorCode"] == "KBNotFound"


async def test_unknown_kn_code_import(client):
    """POST /knowledgeItems/import with nonexistent knCode returns KBNotFound."""
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/import",
        data={"knCode": "99999999", "filePath": "/x.md"},
        files={"fileContent": ("x.md", b"# hi", "text/markdown")},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "-1"
    assert body["resultObject"]["errorCode"] == "KBNotFound"


async def test_unknown_kn_code_delete(client):
    """POST /knowledgeItems/delete with nonexistent knCode returns KBNotFound."""
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/delete",
        json={"knCode": "99999999", "filePath": "/x.md"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "-1"
    assert body["resultObject"]["errorCode"] == "KBNotFound"


async def test_unknown_kn_code_build(client):
    """POST /fileToMarkdownIndex with nonexistent knCode returns KBNotFound."""
    resp = await client.post(
        "/kgw/api/v1/fileToMarkdownIndex",
        json={"knCode": "99999999", "filePath": "/x.md"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "-1"
    assert body["resultObject"]["errorCode"] == "KBNotFound"


async def test_unknown_kn_code_search(client):
    """ER3: fanout search with only unknown KBs degrades deterministically."""
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/search",
        json={
            "knCodeList": ["99999999"],
            "query": "test",
            "topK": 5,
            "searchMode": "embedding",
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", body
    assert body["resultMsg"] == "success", body
    assert body["resultObject"]["data"] == [], body
    assert body["resultObject"]["degraded_kbs"] == [
        {"knCode": "99999999", "reason": "KBNotFound"}
    ], body


# ---- ER1: upstream connection error ----


async def test_upstream_connect_error(client, app):
    """ER1: Backend connection refused returns UpstreamConnectError."""
    _reset_circuit_breaker(app)

    with respx.mock(assert_all_called=False) as mock:
        mock.post(f"{_QA_URL}/api/v1/listDir").mock(
            side_effect=httpx.ConnectError("connection refused")
        )

        resp = await client.post(
            "/kgw/api/v1/listDir",
            json={"knCode": _KN_DIRECT, "directoryPath": "/"},
            headers=_hdrs(),
        )
        body = resp.json()
        assert body["resultCode"] == "-1"
        assert body["resultObject"]["errorCode"] == "UpstreamConnectError"

    _reset_circuit_breaker(app)


# ---- ER2: upstream timeout ----


async def test_upstream_timeout(client, app):
    """ER2: Backend timeout returns UpstreamTimeout."""
    _reset_circuit_breaker(app)

    with respx.mock(assert_all_called=False) as mock:
        mock.post(f"{_QA_URL}/api/v1/listDir").mock(
            side_effect=httpx.TimeoutException("timeout")
        )

        resp = await client.post(
            "/kgw/api/v1/listDir",
            json={"knCode": _KN_DIRECT, "directoryPath": "/"},
            headers=_hdrs(),
        )
        body = resp.json()
        assert body["resultCode"] == "-1"
        assert body["resultObject"]["errorCode"] == "UpstreamTimeout"

    _reset_circuit_breaker(app)


# ---- ER5: parameter validation failures ----


async def test_validation_missing_required_fields(client):
    """ER5: request validation returns KGW error envelopes (200 with resultCode=-1)."""
    # directories/create without directoryPath -- forwarded to backend,
    # which returns its own validation error envelope
    resp = await client.post(
        "/kgw/api/v1/directories/create",
        json={"knCode": _KN_DIRECT},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "-1", (
        f"expected -1 for missing directoryPath, got {body}"
    )
    errors = body.get("resultObject", {}).get("errors", [])
    assert any(err.get("loc") == ["directoryPath"] for err in errors), body


# ---- Auth header errors ----


async def test_missing_auth_header(client):
    """POST without X-User-Id header returns 422 validation error."""
    resp = await client.post(
        "/kgw/api/v1/listDir",
        json={"knCode": _KN_DIRECT, "directoryPath": "/"},
        # No auth header
    )
    assert resp.status_code == 422
    body = resp.json()
    detail = body.get("detail", [])
    assert any("X-User-Id" in str(err.get("loc", [])) for err in detail)


# ---- AU1: invalid auth user ----


async def test_invalid_auth_user(client):
    """POST with nonexistent user ID returns AuthInfoNotFound error."""
    resp = await client.post(
        "/kgw/api/v1/listDir",
        json={"knCode": _KN_DIRECT, "directoryPath": "/"},
        headers={"X-User-Id": "no_such_user_99999"},
    )
    body = resp.json()
    assert body["resultCode"] == "-1"
    assert body["resultObject"]["errorCode"] == "AuthInfoNotFound"


# ---- AU2: backend returns 401 ----


async def test_backend_401(client, app):
    """AU2: Backend returns 401 -- gateway returns BackendAuthFailed."""
    _reset_circuit_breaker(app)

    with respx.mock(assert_all_called=False) as mock:
        mock.post(f"{_QA_URL}/api/v1/directories/create").mock(
            return_value=httpx.Response(401, json={"error": "unauthorized"})
        )

        resp = await client.post(
            "/kgw/api/v1/directories/create",
            json={"knCode": _KN_DIRECT, "directoryPath": "/test-auth-401"},
            headers=_hdrs(),
        )
        body = resp.json()
        assert body["resultCode"] == "-1"
        assert body["resultObject"]["errorCode"] == "BackendAuthFailed"

    _reset_circuit_breaker(app)


# ---- AU3: backend returns 403 ----


async def test_backend_403(client, app):
    """AU3: Backend returns 403 -- gateway returns BackendAuthFailed."""
    _reset_circuit_breaker(app)

    with respx.mock(assert_all_called=False) as mock:
        mock.post(f"{_QA_URL}/api/v1/listDir").mock(
            return_value=httpx.Response(403, json={"error": "forbidden"})
        )

        resp = await client.post(
            "/kgw/api/v1/listDir",
            json={"knCode": _KN_DIRECT, "directoryPath": "/"},
            headers=_hdrs(),
        )
        body = resp.json()
        assert body["resultCode"] == "-1"
        assert body["resultObject"]["errorCode"] == "BackendAuthFailed"

    _reset_circuit_breaker(app)


# ---- Control tests (verify the real backend is healthy) ----


async def test_directory_create_success_and_delete(client):
    """Create then delete a directory as a control test.

    This verifies the backend is reachable and functional.
    """
    # Create
    resp = await client.post(
        "/kgw/api/v1/directories/create",
        json={"knCode": _KN_DIRECT, "directoryPath": "/errpath-test"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"create failed: {body}"

    # Delete (cleanup)
    resp = await client.post(
        "/kgw/api/v1/directories/delete",
        json={"knCode": _KN_DIRECT, "directoryPath": "/errpath-test"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"delete failed: {body}"


async def test_real_directory_listing(client):
    """POST /listDir with known knCode returns result and data."""
    resp = await client.post(
        "/kgw/api/v1/listDir",
        json={"knCode": _KN_DIRECT, "directoryPath": "/"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"listing failed: {body}"
    assert "data" in body.get("resultObject", {}), f"no data key: {body}"
