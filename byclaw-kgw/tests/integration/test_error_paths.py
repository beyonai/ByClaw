"""Integration tests: common error paths for the byclaw-kgw gateway.

Covers: unknown knCode, missing auth header, invalid auth user.
All HTTP calls go through the gateway to the real byclaw-qa backend.
"""
# pylint: disable=redefined-outer-name,invalid-name,unused-argument

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

_KN_DIRECT = "200001"
_USER_ID = "test_user"


def _hdrs(extra: dict | None = None) -> dict[str, str]:
    h = {"X-User-Id": _USER_ID}
    if extra:
        h.update(extra)
    return h


# ---- Unknown knCode (all interfaces) ----


async def test_unknown_kn_code_listdir(client):
    """POST /listDir with nonexistent knCode returns error."""
    resp = await client.post(
        "/kgw/api/v1/listDir",
        json={"knCode": "99999999", "directoryPath": "/"},
        headers=_hdrs(),
    )
    assert resp.json()["resultCode"] == "-1"


async def test_unknown_kn_code_import(client):
    """POST /knowledgeItems/import with nonexistent knCode returns error."""
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/import",
        data={"knCode": "99999999", "filePath": "/x.md"},
        files={"fileContent": ("x.md", b"# hi", "text/markdown")},
        headers=_hdrs(),
    )
    assert resp.json()["resultCode"] == "-1"


async def test_unknown_kn_code_delete(client):
    """POST /knowledgeItems/delete with nonexistent knCode returns error."""
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/delete",
        json={"knCode": "99999999", "filePath": "/x.md"},
        headers=_hdrs(),
    )
    assert resp.json()["resultCode"] == "-1"


async def test_unknown_kn_code_build(client):
    """POST /fileToMarkdownIndex with nonexistent knCode returns error."""
    resp = await client.post(
        "/kgw/api/v1/fileToMarkdownIndex",
        json={"knCode": "99999999", "filePath": "/x.md"},
        headers=_hdrs(),
    )
    assert resp.json()["resultCode"] == "-1"


async def test_unknown_kn_code_search(client):
    """Search with unknown knCode returns -1 or 0 with degraded_kbs."""
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
    assert body["resultCode"] in ("-1", "0")
    if body["resultCode"] == "0":
        assert body["resultObject"]["degraded_kbs"] == [
            {"knCode": "99999999", "reason": "KBNotFound"}
        ]


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


async def test_invalid_auth_user(client):
    """POST with nonexistent user ID either works or returns auth error."""
    resp = await client.post(
        "/kgw/api/v1/listDir",
        json={"knCode": _KN_DIRECT, "directoryPath": "/"},
        headers={"X-User-Id": "no_such_user_99999"},
    )
    body = resp.json()
    assert body["resultCode"] in ("0", "-1")


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
