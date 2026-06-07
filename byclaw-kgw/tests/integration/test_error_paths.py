"""Integration tests: common error paths ER1–ER5, AU1–AU3.

Covers: upstream connect error, timeout, unknown knCode, validation errors,
backend auth 401/403, missing Redis auth info.
"""
# pylint: disable=redefined-outer-name,invalid-name,unused-argument

import httpx
import pytest
import respx

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

# KB config constants -- must match values in conftest.py
_KN_DIRECT = "200001"
_KB_DIRECT_URL = "http://kb-direct.test"
_USER_ID = "test_user"


def _hdrs(extra: dict | None = None) -> dict[str, str]:
    h = {"X-User-Id": _USER_ID}
    if extra:
        h.update(extra)
    return h


# ---- ER1: upstream connect error ----
async def test_upstream_connect_error(client):
    """When KB backend is unreachable, the gateway returns UpstreamConnectError."""
    with respx.mock(assert_all_called=False) as mock:
        mock.post(f"{_KB_DIRECT_URL}/api/v1/listDir").mock(
            side_effect=httpx.ConnectError("connection refused")
        )
        resp = await client.post(
            "/kgw/api/v1/listDir",
            json={"knCode": _KN_DIRECT, "directoryPath": "/"},
            headers=_hdrs(),
        )
    body = resp.json()
    assert body["resultCode"] == "-1"


# ---- ER2: upstream timeout ----
async def test_upstream_timeout(client):
    """When KB backend times out, the gateway returns UpstreamTimeout."""
    with respx.mock(assert_all_called=False) as mock:
        mock.post(f"{_KB_DIRECT_URL}/api/v1/listDir").mock(
            side_effect=httpx.TimeoutException("read timeout")
        )
        resp = await client.post(
            "/kgw/api/v1/listDir",
            json={"knCode": _KN_DIRECT, "directoryPath": "/"},
            headers=_hdrs(),
        )
    body = resp.json()
    assert body["resultCode"] == "-1"


# ---- ER3: unknown knCode (all interfaces) ----
async def test_unknown_kn_code_listdir(client):
    resp = await client.post(
        "/kgw/api/v1/listDir",
        json={"knCode": "99999999", "directoryPath": "/"},
        headers=_hdrs(),
    )
    assert resp.json()["resultCode"] == "-1"


async def test_unknown_kn_code_import(client):
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/import",
        data={"knCode": "99999999", "filePath": "/x.md"},
        files={"fileContent": ("x.md", b"# hi", "text/markdown")},
        headers=_hdrs(),
    )
    assert resp.json()["resultCode"] == "-1"


async def test_unknown_kn_code_delete(client):
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/delete",
        json={"knCode": "99999999", "filePath": "/x.md"},
        headers=_hdrs(),
    )
    assert resp.json()["resultCode"] == "-1"


async def test_unknown_kn_code_build(client):
    resp = await client.post(
        "/kgw/api/v1/fileToMarkdownIndex",
        json={"knCode": "99999999", "filePath": "/x.md"},
        headers=_hdrs(),
    )
    assert resp.json()["resultCode"] == "-1"


async def test_unknown_kn_code_search(client):
    """dispatch_fanout_json degrades gracefully -- unknown knCodes are
    reported in the degraded_kbs array with resultCode "0".
    """
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
    assert body["resultCode"] == "0"
    assert body["resultObject"]["degraded_kbs"] == [
        {"knCode": "99999999", "reason": "KBNotFound"}
    ]


# ---- Backend auth failures AU2/AU3 (401/403) ----
async def test_backend_401(client):
    with respx.mock(assert_all_called=False) as mock:
        mock.post(f"{_KB_DIRECT_URL}/api/v1/directories/create").mock(
            return_value=httpx.Response(401)
        )
        resp = await client.post(
            "/kgw/api/v1/directories/create",
            json={"knCode": _KN_DIRECT, "directoryPath": "/test401"},
            headers=_hdrs(),
        )
    assert resp.json()["resultCode"] == "-1"


async def test_backend_403(client):
    with respx.mock(assert_all_called=False) as mock:
        mock.post(f"{_KB_DIRECT_URL}/api/v1/listDir").mock(
            return_value=httpx.Response(403)
        )
        resp = await client.post(
            "/kgw/api/v1/listDir",
            json={"knCode": _KN_DIRECT, "directoryPath": "/"},
            headers=_hdrs(),
        )
    assert resp.json()["resultCode"] == "-1"


# ---- ER5: missing required field ----
async def test_validation_missing_kn_code(client):
    """When knCode is missing, str(body.get('knCode', '')) yields ''
    which does not match any KB config -> KBNotFound -> error envelope.
    """
    resp = await client.post(
        "/kgw/api/v1/listDir",
        json={"directoryPath": "/"},  # missing knCode
        headers=_hdrs(),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["resultCode"] == "-1"


# ---- Cross-interface: audit log records errors ----
async def test_error_operations_appear_in_audit(client, pool, app):
    """After an error operation, the audit log should contain a failure record.

    The audit path in dispatch_json only runs when the backend returns a JSON
    response (even a failure one).  Exceptions that are raised (401/403,
    connect errors, timeouts) bypass audit, so we mock a 200 with a failure
    envelope here.
    """
    await app.state.audit.flush()

    # Count audit entries before
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT COUNT(*) as c FROM kgw_audit_log "
                "WHERE source='serve' AND result_code='-1'"
            )
            before = (await cur.fetchone())["c"]

    # Trigger an error by returning a backend failure envelope (HTTP 200
    # with resultCode "-1") rather than raising an HTTP exception, so the
    # audit section of dispatch_json is reached.
    with respx.mock(assert_all_called=False) as mock:
        mock.post(f"{_KB_DIRECT_URL}/api/v1/directories/create").mock(
            return_value=httpx.Response(
                200, json={"resultCode": "-1", "resultMsg": "backend failure"}
            )
        )
        await client.post(
            "/kgw/api/v1/directories/create",
            json={"knCode": _KN_DIRECT, "directoryPath": "/audit-test"},
            headers=_hdrs(),
        )

    await app.state.audit.flush()

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT COUNT(*) as c FROM kgw_audit_log "
                "WHERE source='serve' AND result_code='-1'"
            )
            after = (await cur.fetchone())["c"]

    assert after > before, (
        f"Expected audit count to increase, was {before} before and {after} after"
    )
