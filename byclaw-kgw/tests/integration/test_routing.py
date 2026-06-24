"""Integration tests: direct vs discovery routing.

Makes REAL HTTP calls through the gateway to the byclaw-qa backend.
No respx mocks.
"""

# pylint: disable=redefined-outer-name,invalid-name

from __future__ import annotations

from typing import Any

import httpx
import pytest

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

# KB config constants -- must match values in conftest.py
_KN_DIRECT = "200001"
_KN_DISCOV = "300001"
_USER_ID = "test_user"
_QA_SVC_NAME = "byclaw-qa-manager"


def _hdrs(extra: dict | None = None) -> dict[str, str]:
    h = {"X-User-Id": _USER_ID}
    if extra:
        h.update(extra)
    return h


# ---------------------------------------------------------------------------
# E5: basic app health
# ---------------------------------------------------------------------------


async def test_app_health(client: httpx.AsyncClient) -> None:
    """GET /healthz returns 200."""
    resp = await client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


# ---------------------------------------------------------------------------
# KB config resolves correctly from MinIO
# ---------------------------------------------------------------------------


async def test_kb_config_direct_resolves(app: Any) -> None:
    """Direct KB (200001) config is loaded from MinIO with domain_url set."""
    cfg = await app.state.config_provider.get_kb_config(_KN_DIRECT)
    assert cfg is not None
    assert cfg.kn_code == _KN_DIRECT
    assert cfg.domain_url, "domain_url should be set to the QA backend URL"
    assert cfg.resource_code == "1"


async def test_kb_config_discovery_resolves(app: Any) -> None:
    """Discovery KB (300001) config is loaded with domain_name set."""
    cfg = await app.state.config_provider.get_kb_config(_KN_DISCOV)
    assert cfg is not None
    assert cfg.kn_code == _KN_DISCOV
    assert cfg.domain_name == _QA_SVC_NAME
    assert cfg.domain_url == ""
    assert cfg.resource_code == "2"


# ---------------------------------------------------------------------------
# Directory create in direct mode
# ---------------------------------------------------------------------------


async def test_create_directory_direct(client: httpx.AsyncClient) -> None:
    """Create a directory on the direct KB and verify it appears in listDir."""
    # Create
    resp = await client.post(
        "/kgw/api/v1/directories/create",
        json={"knCode": _KN_DIRECT, "directoryPath": "/routing-test"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"create failed: {body}"

    # Verify via listDir
    resp = await client.post(
        "/kgw/api/v1/listDir",
        json={"knCode": _KN_DIRECT, "directoryPath": "/"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"listDir failed: {body}"
    data = body.get("resultObject", {}).get("data", [])
    names = [item.get("name", "") for item in data]
    assert "/routing-test" in names, f"/routing-test not found in listing: {data}"


# ---------------------------------------------------------------------------
# Directory create in discovery mode
# ---------------------------------------------------------------------------


async def test_create_directory_discovery(client: httpx.AsyncClient) -> None:
    """GD2: Create a multi-level directory on the discovery KB and verify path structure."""
    resp = await client.post(
        "/kgw/api/v1/directories/create",
        json={"knCode": _KN_DISCOV, "directoryPath": "/routing-disc-test/subdir"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"create failed: {body}"

    # Verify parent listing contains the intermediate path
    resp = await client.post(
        "/kgw/api/v1/listDir",
        json={"knCode": _KN_DISCOV, "directoryPath": "/"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"listDir / failed: {body}"
    parent_data = body.get("resultObject", {}).get("data", [])
    parent_names = [item.get("name", "") for item in parent_data]
    assert "/routing-disc-test" in parent_names, (
        f"/routing-disc-test not found in root listing: {parent_data}"
    )

    # Verify target listing contains the leaf subdirectory
    resp = await client.post(
        "/kgw/api/v1/listDir",
        json={"knCode": _KN_DISCOV, "directoryPath": "/routing-disc-test"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"listDir /routing-disc-test failed: {body}"
    target_data = body.get("resultObject", {}).get("data", [])
    target_names = [item.get("name", "") for item in target_data]
    assert "/routing-disc-test/subdir" in target_names, (
        f"/routing-disc-test/subdir not found in listing: {target_data}"
    )


# ---------------------------------------------------------------------------
# Cleanup test directories
# ---------------------------------------------------------------------------


async def test_delete_directory_cleanup(client: httpx.AsyncClient) -> None:
    """Clean up the test directories created above."""
    for kn_code, path in [
        (_KN_DIRECT, "/routing-test"),
        (_KN_DISCOV, "/routing-disc-test/subdir"),
        (_KN_DISCOV, "/routing-disc-test"),
    ]:
        resp = await client.post(
            "/kgw/api/v1/directories/delete",
            json={"knCode": kn_code, "directoryPath": path},
            headers=_hdrs(),
        )
        body = resp.json()
        msg = body.get("resultMsg", "")
        # Best-effort cleanup: directories may already be gone
        if body.get("resultCode") == "0":
            continue
        if "not found" in msg.lower() or "no available" in msg.lower():
            continue
        pytest.fail(f"cleanup delete {path} for knCode={kn_code}: {body}")


# ---------------------------------------------------------------------------
# listDir in direct mode
# ---------------------------------------------------------------------------


async def test_listdir_direct(client: httpx.AsyncClient) -> None:
    """POST /kgw/api/v1/listDir returns a valid result."""
    resp = await client.post(
        "/kgw/api/v1/listDir",
        json={"knCode": _KN_DIRECT, "directoryPath": "/"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"listDir failed: {body}"
    data = body.get("resultObject", {}).get("data", [])
    assert isinstance(data, list), f"data should be a list, got {type(data)}"


# ---------------------------------------------------------------------------
# Unknown knCode returns error
# ---------------------------------------------------------------------------


async def test_unknown_kn_code(client: httpx.AsyncClient) -> None:
    """GD5: Unknown knCode returns resultCode -1 with KBNotFound error."""
    resp = await client.post(
        "/kgw/api/v1/listDir",
        json={"knCode": "99999999", "directoryPath": "/"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "-1", f"expected -1, got: {body}"
    assert body["resultObject"]["errorCode"] == "KBNotFound", (
        f"expected KBNotFound, got: {body}"
    )


# ---------------------------------------------------------------------------
# Import a file via multipart, then delete it
# ---------------------------------------------------------------------------


async def test_import_and_read(client: httpx.AsyncClient) -> None:
    """GI1/GI8: Multipart file import, verify via listDir, then delete and verify removal."""
    # Import
    files = {
        "fileContent": ("hello.md", b"# Hello", "text/markdown"),
    }
    data = {
        "knCode": _KN_DIRECT,
        "filePath": "/routing/hello.md",
    }
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/import",
        data=data,
        files=files,
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"import failed: {body}"

    # Verify file appears in directory listing
    resp = await client.post(
        "/kgw/api/v1/listDir",
        json={"knCode": _KN_DIRECT, "directoryPath": "/routing"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"listDir after import failed: {body}"
    import_files = [
        item.get("name", "") for item in body.get("resultObject", {}).get("data", [])
    ]
    assert "/routing/hello.md" in import_files, (
        f"/routing/hello.md not found after import: {body}"
    )

    # Delete the imported file
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/delete",
        json={"knCode": _KN_DIRECT, "filePath": "/routing/hello.md"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"delete failed: {body}"

    # Verify file is gone from directory listing
    resp = await client.post(
        "/kgw/api/v1/listDir",
        json={"knCode": _KN_DIRECT, "directoryPath": "/routing"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"listDir after delete failed: {body}"
    after_delete_files = [
        item.get("name", "") for item in body.get("resultObject", {}).get("data", [])
    ]
    assert "/routing/hello.md" not in after_delete_files, (
        f"/routing/hello.md still present after delete: {body}"
    )
