"""Integration tests: directory CRUD lifecycle (GD1-GD10).

Covers create, rename, delete of directories in direct-mode and
discovery-mode plus error paths: conflict, missing fields, unknown knCode.
Makes REAL HTTP calls through the gateway to the running byclaw-qa backend.
"""
# pylint: disable=redefined-outer-name,invalid-name,unused-argument

import httpx
import pytest

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

_KN_DIRECT = "200001"
_KN_DISCOV = "300001"
_USER_ID = "test_user"


def _hdrs(extra: dict | None = None) -> dict[str, str]:
    h = {"X-User-Id": _USER_ID}
    if extra:
        h.update(extra)
    return h


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_dir(client: httpx.AsyncClient, kn_code: str, path: str) -> dict:
    resp = await client.post(
        "/kgw/api/v1/directories/create",
        json={"knCode": kn_code, "directoryPath": path},
        headers=_hdrs(),
    )
    return resp.json()


async def _delete_dir(client: httpx.AsyncClient, kn_code: str, path: str) -> dict:
    resp = await client.post(
        "/kgw/api/v1/directories/delete",
        json={"knCode": kn_code, "directoryPath": path},
        headers=_hdrs(),
    )
    return resp.json()


async def _list_dir(client: httpx.AsyncClient, kn_code: str, path: str) -> dict:
    resp = await client.post(
        "/kgw/api/v1/listDir",
        json={"knCode": kn_code, "directoryPath": path},
        headers=_hdrs(),
    )
    return resp.json()


def _dir_names(list_body: dict) -> list[str]:
    """Extract directory names from a listDir response."""
    items = list_body.get("resultObject", {}).get("data", [])
    return [item.get("name", "") for item in items]


# ---------------------------------------------------------------------------
# Cleanup: delete all stale test directories from previous runs
# (runs first to leave a clean slate)
# ---------------------------------------------------------------------------


async def test_00_cleanup_stale_dirs(client: httpx.AsyncClient) -> None:
    """Delete every known test directory, ignoring failures."""
    for path in [
        "/gd1-test",
        "/gd2",
        "/gd6-old",
        "/gd6-new",
        "/gd7-a",
        "/gd7-b",
        "/gd8-empty",
        "/gd9-full",
        "/gd10-disc",
    ]:
        body = await _delete_dir(client, _KN_DIRECT, path)
        # Also try discovery-mode cleanup
        disc_body = await _delete_dir(client, _KN_DISCOV, path)
        _ = body, disc_body  # ignore failures


# ---------------------------------------------------------------------------
# GD1: create single-level directory
# ---------------------------------------------------------------------------


async def test_create_directory_success(client: httpx.AsyncClient) -> None:
    body = await _create_dir(client, _KN_DIRECT, "/gd1-test")
    assert body["resultCode"] == "0", f"create failed: {body}"

    # Verify it appears in the root listing
    list_body = await _list_dir(client, _KN_DIRECT, "/")
    names = _dir_names(list_body)
    assert "/gd1-test" in names, f"expected /gd1-test in listing, got {names}"


# ---------------------------------------------------------------------------
# GD2: create nested directory
# ---------------------------------------------------------------------------


async def test_create_nested_directory(client: httpx.AsyncClient) -> None:
    body = await _create_dir(client, _KN_DIRECT, "/gd2/parent/child")
    assert body["resultCode"] == "0", f"create nested failed: {body}"

    # List the parent to verify child exists (byclaw-qa returns full paths)
    list_body = await _list_dir(client, _KN_DIRECT, "/gd2/parent")
    names = _dir_names(list_body)
    assert "/gd2/parent/child" in names, (
        f"expected /gd2/parent/child in listing, got {names}"
    )


# ---------------------------------------------------------------------------
# GD3: create duplicate (conflict)
# ---------------------------------------------------------------------------


async def test_create_duplicate_conflict(client: httpx.AsyncClient) -> None:
    body = await _create_dir(client, _KN_DIRECT, "/gd1-test")
    assert body["resultCode"] == "-1", f"expected -1 for duplicate, got {body}"


# ---------------------------------------------------------------------------
# GD4: missing knCode
# ---------------------------------------------------------------------------


async def test_create_missing_kncode(client: httpx.AsyncClient) -> None:
    resp = await client.post(
        "/kgw/api/v1/directories/create",
        json={"directoryPath": "/x"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "-1", f"expected -1 for missing knCode, got {body}"


# ---------------------------------------------------------------------------
# GD5: unknown knCode
# ---------------------------------------------------------------------------


async def test_create_unknown_kncode(client: httpx.AsyncClient) -> None:
    body = await _create_dir(client, "99999999", "/x")
    assert body["resultCode"] == "-1", f"expected -1 for unknown knCode, got {body}"


# ---------------------------------------------------------------------------
# GD6: rename directory
# ---------------------------------------------------------------------------


async def test_rename_directory(client: httpx.AsyncClient) -> None:
    # Create old directory
    body = await _create_dir(client, _KN_DIRECT, "/gd6-old")
    assert body["resultCode"] == "0", f"create /gd6-old failed: {body}"

    # Rename
    resp = await client.post(
        "/kgw/api/v1/directories/update",
        json={
            "knCode": _KN_DIRECT,
            "directoryPath": "/gd6-old",
            "directoryName": "gd6-new",
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"rename failed: {body}"

    # Verify old name is gone and new name appears
    list_body = await _list_dir(client, _KN_DIRECT, "/")
    names = _dir_names(list_body)
    assert "/gd6-old" not in names, f"expected /gd6-old to be gone, got {names}"
    assert "/gd6-new" in names, f"expected /gd6-new to appear, got {names}"


# ---------------------------------------------------------------------------
# GD7: rename conflict
# ---------------------------------------------------------------------------


async def test_rename_conflict(client: httpx.AsyncClient) -> None:
    # Create both directories
    body = await _create_dir(client, _KN_DIRECT, "/gd7-a")
    assert body["resultCode"] == "0", f"create /gd7-a failed: {body}"

    body = await _create_dir(client, _KN_DIRECT, "/gd7-b")
    assert body["resultCode"] == "0", f"create /gd7-b failed: {body}"

    # Try to rename gd7-b to gd7-a (conflict)
    resp = await client.post(
        "/kgw/api/v1/directories/update",
        json={
            "knCode": _KN_DIRECT,
            "directoryPath": "/gd7-b",
            "directoryName": "gd7-a",
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "-1", f"expected -1 for rename conflict, got {body}"


# ---------------------------------------------------------------------------
# GD8: delete empty directory
# ---------------------------------------------------------------------------


async def test_delete_empty_directory(client: httpx.AsyncClient) -> None:
    body = await _create_dir(client, _KN_DIRECT, "/gd8-empty")
    assert body["resultCode"] == "0", f"create /gd8-empty failed: {body}"

    body = await _delete_dir(client, _KN_DIRECT, "/gd8-empty")
    assert body["resultCode"] == "0", f"delete /gd8-empty failed: {body}"

    # Verify it is gone from listing
    list_body = await _list_dir(client, _KN_DIRECT, "/")
    names = _dir_names(list_body)
    assert "/gd8-empty" not in names, f"expected /gd8-empty to be gone, got {names}"


# ---------------------------------------------------------------------------
# GD9: delete non-empty directory (recursive)
# ---------------------------------------------------------------------------


async def test_delete_nonempty_directory_recursive(
    client: httpx.AsyncClient,
) -> None:
    # Create directory and import a file inside it
    body = await _create_dir(client, _KN_DIRECT, "/gd9-full")
    assert body["resultCode"] == "0", f"create /gd9-full failed: {body}"

    import_resp = await client.post(
        "/kgw/api/v1/knowledgeItems/import",
        data={
            "knCode": _KN_DIRECT,
            "filePath": "/gd9-full/file.md",
        },
        files={
            "fileContent": ("file.md", b"# hi", "text/markdown"),
        },
        headers=_hdrs(),
    )
    import_body = import_resp.json()
    assert import_body["resultCode"] == "0", f"import file failed: {import_body}"

    # Delete the directory (should be recursive)
    body = await _delete_dir(client, _KN_DIRECT, "/gd9-full")
    assert body["resultCode"] == "0", f"delete /gd9-full failed: {body}"

    # Verify the directory is gone
    list_body = await _list_dir(client, _KN_DIRECT, "/")
    names = _dir_names(list_body)
    assert "/gd9-full" not in names, f"expected /gd9-full to be gone, got {names}"


# ---------------------------------------------------------------------------
# GD10: discovery mode directory operations
# ---------------------------------------------------------------------------


async def test_discovery_mode_directory(client: httpx.AsyncClient) -> None:
    body = await _create_dir(client, _KN_DISCOV, "/gd10-disc")
    assert body["resultCode"] == "0", f"create discovery-mode dir failed: {body}"

    # Cleanup
    body = await _delete_dir(client, _KN_DISCOV, "/gd10-disc")
    assert body["resultCode"] == "0", f"delete discovery-mode dir failed: {body}"


# ---------------------------------------------------------------------------
# Cleanup: delete all test directories
# ---------------------------------------------------------------------------


async def test_cleanup_all_test_dirs(client: httpx.AsyncClient) -> None:
    """Delete every test directory created above to leave clean state."""
    for path in [
        "/gd1-test",
        "/gd2",
        "/gd6-old",
        "/gd6-new",
        "/gd7-a",
        "/gd7-b",
        "/gd9-full",
    ]:
        body = await _delete_dir(client, _KN_DIRECT, path)
        # Ignore failures — some may already have been deleted
        if body["resultCode"] != "0":
            # The path may not exist; that's fine
            pass

    # Also clean up any orphan from a failed GD6 rename
    for path in ["/gd6-old", "/gd6-new"]:
        await _delete_dir(client, _KN_DIRECT, path)
