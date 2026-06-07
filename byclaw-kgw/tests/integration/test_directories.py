"""Integration tests: directory CRUD lifecycle (GD1–GD10).

Covers create, update (rename), delete of directories in direct mode
plus error paths: conflict, missing fields, unknown knCode.
"""
# pylint: disable=redefined-outer-name,invalid-name,unused-argument

from typing import Any

import httpx
import pytest
import respx

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

# KB config constants — must match values in conftest.py
_KN_DIRECT = "200001"
_KN_DISCOV = "300001"
_KB_DIRECT_URL = "http://kb-direct.test"
_USER_ID = "test_user"


def _hdrs(extra: dict | None = None) -> dict[str, str]:
    h = {"X-User-Id": _USER_ID}
    if extra:
        h.update(extra)
    return h


def _ok_resp(obj: dict | None = None) -> dict[str, Any]:
    return {"resultCode": "0", "resultMsg": "success", "resultObject": obj or {}}


def _fail_resp(msg: str = "error") -> dict[str, Any]:
    return {"resultCode": "-1", "resultMsg": msg, "resultObject": {}}


_DIR_URL = f"{_KB_DIRECT_URL}/api/v1/directories"


# ---- helpers ----


def _mock_create_dir(mock: respx.MockRouter, *, ok: bool = True):
    resp = _ok_resp() if ok else _fail_resp("already exists")
    return mock.post(f"{_DIR_URL}/create").mock(
        return_value=httpx.Response(200, json=resp)
    )


def _mock_update_dir(mock: respx.MockRouter, *, ok: bool = True):
    resp = _ok_resp() if ok else _fail_resp("name conflict")
    return mock.post(f"{_DIR_URL}/update").mock(
        return_value=httpx.Response(200, json=resp)
    )


def _mock_delete_dir(mock: respx.MockRouter, *, ok: bool = True):
    resp = _ok_resp() if ok else _fail_resp("not found")
    return mock.post(f"{_DIR_URL}/delete").mock(
        return_value=httpx.Response(200, json=resp)
    )


def _mock_listdir(mock: respx.MockRouter, data: list | None = None):
    return mock.post(f"{_KB_DIRECT_URL}/api/v1/listDir").mock(
        return_value=httpx.Response(200, json=_ok_resp({"data": data or []}))
    )


# ---- GD1: create single-level directory ----
async def test_create_directory_success(client):
    with respx.mock(assert_all_called=False) as mock:
        _mock_create_dir(mock, ok=True)
        resp = await client.post(
            "/kgw/api/v1/directories/create",
            json={"knCode": _KN_DIRECT, "directoryPath": "/policies"},
            headers=_hdrs(),
        )
    assert resp.json()["resultCode"] == "0"


# ---- GD3: create path conflict ----
async def test_create_directory_conflict(client):
    with respx.mock(assert_all_called=False) as mock:
        _mock_create_dir(mock, ok=False)
        resp = await client.post(
            "/kgw/api/v1/directories/create",
            json={"knCode": _KN_DIRECT, "directoryPath": "/policies"},
            headers=_hdrs(),
        )
    assert resp.json()["resultCode"] == "-1"


# ---- GD4: missing required field ----
async def test_create_missing_path(client):
    """Missing directoryPath — the gateway passes the body through
    without Pydantic-level validation (body is dict[str, Any]).
    """
    with respx.mock(assert_all_called=False) as mock:
        _mock_create_dir(mock, ok=True)
        resp = await client.post(
            "/kgw/api/v1/directories/create",
            json={"knCode": _KN_DIRECT},
            headers=_hdrs(),
        )
    assert resp.status_code == 200


# ---- GD5: unknown knCode ----
async def test_create_unknown_kn_code(client):
    resp = await client.post(
        "/kgw/api/v1/directories/create",
        json={"knCode": "99999999", "directoryPath": "/x"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "-1"


# ---- GD6: rename directory ----
async def test_rename_directory(client):
    with respx.mock(assert_all_called=False) as mock:
        _mock_update_dir(mock, ok=True)
        resp = await client.post(
            "/kgw/api/v1/directories/update",
            json={
                "knCode": _KN_DIRECT,
                "directoryPath": "/dept",
                "directoryName": "department",
            },
            headers=_hdrs(),
        )
    assert resp.json()["resultCode"] == "0"


# ---- GD7: rename conflict ----
async def test_rename_directory_conflict(client):
    with respx.mock(assert_all_called=False) as mock:
        _mock_update_dir(mock, ok=False)
        resp = await client.post(
            "/kgw/api/v1/directories/update",
            json={
                "knCode": _KN_DIRECT,
                "directoryPath": "/B",
                "directoryName": "A",
            },
            headers=_hdrs(),
        )
    assert resp.json()["resultCode"] == "-1"


# ---- GD8: delete empty directory ----
async def test_delete_empty_directory(client):
    with respx.mock(assert_all_called=False) as mock:
        _mock_delete_dir(mock, ok=True)
        resp = await client.post(
            "/kgw/api/v1/directories/delete",
            json={"knCode": _KN_DIRECT, "directoryPath": "/tmp"},
            headers=_hdrs(),
        )
    assert resp.json()["resultCode"] == "0"


# ---- GD9: delete non-empty directory (recursive) ----
async def test_delete_nonempty_directory(client, pool, app):
    """Recursive delete: directory containing files.

    After delete, verify the binding cleanup by checking the DB directly.
    """
    # First, set up metadata to verify binding cleanup
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO kgw_metadata_property "
                "(property_name, value_type, status, backend_name, property_id) "
                "SELECT 'status', 'string', 'ACTIVE', '__byclaw_kgw__status__v1', 1 "
                "WHERE NOT EXISTS ("
                "  SELECT 1 FROM kgw_metadata_property WHERE property_id = 1"
                ")"
            )
            await cur.execute(
                "INSERT INTO kgw_metadata_property_binding "
                "(property_id, kn_code, file_path, status, attempt_id) "
                "SELECT 1, %s, '/policies/salary.md', 'SYNCED', 1 "
                "WHERE NOT EXISTS ("
                "  SELECT 1 FROM kgw_metadata_property_binding "
                "  WHERE property_id = 1 AND kn_code = %s"
                "  AND file_path = '/policies/salary.md'"
                ")",
                (_KN_DIRECT, _KN_DIRECT),
            )
        await conn.commit()

    with respx.mock(assert_all_called=False) as mock:
        _mock_delete_dir(mock, ok=True)
        resp = await client.post(
            "/kgw/api/v1/directories/delete",
            json={"knCode": _KN_DIRECT, "directoryPath": "/policies"},
            headers=_hdrs(),
        )
    assert resp.json()["resultCode"] == "0"

    # Verify bindings under /policies/ were cleaned up
    await app.state.audit.flush()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT COUNT(*) as c FROM kgw_metadata_property_binding "
                "WHERE kn_code=%s AND file_path LIKE %s",
                (_KN_DIRECT, "/policies/%"),
            )
            row = await cur.fetchone()
    assert row is not None and not row["c"], f"Expected 0 bindings, got {row}"


# ---- GD10: discovery mode directory delete (via endpoint, verified by config) ----
async def test_delete_directory_discovery_kn_code(client):
    """Directory delete using discovery-mode KB (300001).

    This tests that the gateway correctly resolves the KB config for discovery mode.
    """
    resp = await client.post(
        "/kgw/api/v1/directories/delete",
        json={"knCode": _KN_DISCOV, "directoryPath": "/ghost"},
        headers=_hdrs(),
    )
    assert resp.status_code == 200
