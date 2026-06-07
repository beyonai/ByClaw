"""Integration tests: file import, delete, read, build (GI1–GI11, GR1–GR11, GB1–GB6).

Covers the full file lifecycle: import (markdown + front-matter), delete,
soft-delete re-import, build trigger + status, readFile, downloadFile.
"""
# pylint: disable=redefined-outer-name,invalid-name,unused-argument

from typing import Any

import httpx
import pytest
import respx

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

# KB config constants — must match values in conftest.py
_KN_DIRECT = "200001"
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


_IMPORT_URL = f"{_KB_DIRECT_URL}/api/v1/knowledgeItems/import"
_DELETE_URL = f"{_KB_DIRECT_URL}/api/v1/knowledgeItems/delete"
_BUILD_URL = f"{_KB_DIRECT_URL}/api/v1/fileToMarkdownIndex"
_STATUS_URL = f"{_KB_DIRECT_URL}/api/v1/fileBuildStatus"
_READ_URL = f"{_KB_DIRECT_URL}/api/v1/readFile"
_DOWNLOAD_URL = f"{_KB_DIRECT_URL}/api/v1/downloadFile"


# ---- GI1: import markdown file (direct mode) ----
async def test_import_markdown_success(client):
    with respx.mock(assert_all_called=False) as mock:
        mock.post(_IMPORT_URL).mock(return_value=httpx.Response(200, json=_ok_resp()))
        resp = await client.post(
            "/kgw/api/v1/knowledgeItems/import",
            data={"knCode": _KN_DIRECT, "filePath": "/policies/leave.md"},
            files={"fileContent": ("leave.md", b"# Leave Policy", "text/markdown")},
            headers=_hdrs(),
        )
    assert resp.json()["resultCode"] == "0"


# ---- GI6: re-import same path (overwrite) ----
async def test_reimport_same_path(client):
    with respx.mock(assert_all_called=False) as mock:
        mock.post(_IMPORT_URL).mock(return_value=httpx.Response(200, json=_ok_resp()))
        resp = await client.post(
            "/kgw/api/v1/knowledgeItems/import",
            data={"knCode": _KN_DIRECT, "filePath": "/policies/leave.md"},
            files={"fileContent": ("leave.md", b"# Leave Policy v2", "text/markdown")},
            headers=_hdrs(),
        )
    assert resp.json()["resultCode"] == "0"


# ---- GI7: import non-markdown file (PDF bytes) ----
async def test_import_pdf_file(client):
    with respx.mock(assert_all_called=False) as mock:
        mock.post(_IMPORT_URL).mock(return_value=httpx.Response(200, json=_ok_resp()))
        resp = await client.post(
            "/kgw/api/v1/knowledgeItems/import",
            data={"knCode": _KN_DIRECT, "filePath": "/policies/rules.pdf"},
            files={"fileContent": ("rules.pdf", b"%PDF-1.4 fake", "application/pdf")},
            headers=_hdrs(),
        )
    assert resp.json()["resultCode"] == "0"


# ---- GI8: delete file (direct) ----
async def test_delete_file_success(client):
    with respx.mock(assert_all_called=False) as mock:
        mock.post(_DELETE_URL).mock(return_value=httpx.Response(200, json=_ok_resp()))
        resp = await client.post(
            "/kgw/api/v1/knowledgeItems/delete",
            json={"knCode": _KN_DIRECT, "filePath": "/policies/leave.md"},
            headers=_hdrs(),
        )
    assert resp.json()["resultCode"] == "0"


# ---- GI10: delete non-existent file ----
async def test_delete_nonexistent_file(client):
    with respx.mock(assert_all_called=False) as mock:
        mock.post(_DELETE_URL).mock(
            return_value=httpx.Response(200, json=_fail_resp("file not found"))
        )
        resp = await client.post(
            "/kgw/api/v1/knowledgeItems/delete",
            json={"knCode": _KN_DIRECT, "filePath": "/never.md"},
            headers=_hdrs(),
        )
    assert resp.json()["resultCode"] == "-1"


# ---- GI11: soft-delete then re-import ----
async def test_soft_delete_reimport(client):
    """Delete then re-import the same path should succeed."""
    with respx.mock(assert_all_called=False) as mock:
        mock.post(_DELETE_URL).mock(return_value=httpx.Response(200, json=_ok_resp()))
        await client.post(
            "/kgw/api/v1/knowledgeItems/delete",
            json={"knCode": _KN_DIRECT, "filePath": "/policies/reimport.md"},
            headers=_hdrs(),
        )
    with respx.mock(assert_all_called=False) as mock:
        mock.post(_IMPORT_URL).mock(return_value=httpx.Response(200, json=_ok_resp()))
        resp = await client.post(
            "/kgw/api/v1/knowledgeItems/import",
            data={"knCode": _KN_DIRECT, "filePath": "/policies/reimport.md"},
            files={"fileContent": ("reimport.md", b"# Fresh", "text/markdown")},
            headers=_hdrs(),
        )
    assert resp.json()["resultCode"] == "0"


# ---- GB1: trigger build ----
async def test_build_trigger_success(client):
    with respx.mock(assert_all_called=False) as mock:
        mock.post(_BUILD_URL).mock(return_value=httpx.Response(200, json=_ok_resp()))
        resp = await client.post(
            "/kgw/api/v1/fileToMarkdownIndex",
            json={"knCode": _KN_DIRECT, "filePath": "/policies/leave.md"},
            headers=_hdrs(),
        )
    assert resp.json()["resultCode"] == "0"


# ---- GB3: query build status ----
async def test_build_status_success(client):
    with respx.mock(assert_all_called=False) as mock:
        mock.post(_STATUS_URL).mock(
            return_value=httpx.Response(
                200,
                json=_ok_resp({"status": "success", "currentStep": "complete"}),
            )
        )
        resp = await client.post(
            "/kgw/api/v1/fileBuildStatus",
            json={"knCode": _KN_DIRECT, "filePath": "/policies/leave.md"},
            headers=_hdrs(),
        )
    body = resp.json()
    assert body["resultCode"] == "0"
    assert body["resultObject"]["status"] == "success"


# ---- GB4: duplicate build (already running) ----
async def test_build_duplicate_rejected(client):
    with respx.mock(assert_all_called=False) as mock:
        mock.post(_BUILD_URL).mock(
            return_value=httpx.Response(
                200, json=_fail_resp("build task already exists")
            )
        )
        resp = await client.post(
            "/kgw/api/v1/fileToMarkdownIndex",
            json={"knCode": _KN_DIRECT, "filePath": "/policies/leave.md"},
            headers=_hdrs(),
        )
    assert resp.json()["resultCode"] == "-1"


# ---- GB5: build after failure retry ----
async def test_build_retry_after_failure(client):
    """After build fails, retrying should be accepted."""
    with respx.mock(assert_all_called=False) as mock:
        # First: status shows failed
        mock.post(_STATUS_URL).respond(
            json=_ok_resp({"status": "failed", "currentStep": "chunking"})
        )
        # Second: retry build accepted
        mock.post(_BUILD_URL).respond(json=_ok_resp())
        # Check status
        status_resp = await client.post(
            "/kgw/api/v1/fileBuildStatus",
            json={"knCode": _KN_DIRECT, "filePath": "/policies/leave.md"},
            headers=_hdrs(),
        )
        assert status_resp.json()["resultCode"] == "0"
        # Retry build
        build_resp = await client.post(
            "/kgw/api/v1/fileToMarkdownIndex",
            json={"knCode": _KN_DIRECT, "filePath": "/policies/leave.md"},
            headers=_hdrs(),
        )
    assert build_resp.json()["resultCode"] == "0"


# ---- GR6: readFile full markdown ----
async def test_readfile_full(client):
    with respx.mock(assert_all_called=False) as mock:
        mock.post(_READ_URL).mock(
            return_value=httpx.Response(
                200,
                json=_ok_resp(
                    {
                        "knCode": _KN_DIRECT,
                        "filePath": "/policies/leave.md",
                        "data": "# Leave Policy\n\nContent here",
                        "reachedEof": True,
                    }
                ),
            )
        )
        resp = await client.post(
            "/kgw/api/v1/readFile",
            json={"knCode": _KN_DIRECT, "filePath": "/policies/leave.md"},
            headers=_hdrs(),
        )
    body = resp.json()
    assert body["resultCode"] == "0"
    assert body["resultObject"]["reachedEof"] is True


# ---- GR7: readFile with line window ----
async def test_readfile_line_window(client):
    with respx.mock(assert_all_called=False) as mock:
        mock.post(_READ_URL).mock(
            return_value=httpx.Response(
                200,
                json=_ok_resp(
                    {
                        "knCode": _KN_DIRECT,
                        "filePath": "/policies/leave.md",
                        "data": "line 1\nline 2\nline 3",
                        "startLine": 1,
                        "endLine": 3,
                        "reachedEof": False,
                    }
                ),
            )
        )
        resp = await client.post(
            "/kgw/api/v1/readFile",
            json={
                "knCode": _KN_DIRECT,
                "filePath": "/policies/leave.md",
                "startLine": 1,
                "endLine": 3,
            },
            headers=_hdrs(),
        )
    body = resp.json()
    assert body["resultCode"] == "0"
    assert body["resultObject"]["startLine"] == 1


# ---- GR8: readFile not built ----
async def test_readfile_not_built(client):
    with respx.mock(assert_all_called=False) as mock:
        mock.post(_READ_URL).mock(
            return_value=httpx.Response(200, json=_fail_resp("file not built"))
        )
        resp = await client.post(
            "/kgw/api/v1/readFile",
            json={"knCode": _KN_DIRECT, "filePath": "/policies/never_built.md"},
            headers=_hdrs(),
        )
    assert resp.json()["resultCode"] == "-1"


# ---- GR9: downloadFile ----
async def test_download_file(client):
    with respx.mock(assert_all_called=False) as mock:
        mock.post(_DOWNLOAD_URL).mock(
            return_value=httpx.Response(
                200,
                content=b"binary content here",
                headers={"Content-Type": "application/octet-stream"},
            )
        )
        resp = await client.post(
            "/kgw/api/v1/downloadFile",
            json={"knCode": _KN_DIRECT, "filePath": "/policies/rules.pdf"},
            headers=_hdrs(),
        )
    assert resp.status_code == 200
    assert resp.content == b"binary content here"


# ---- GR4: glob pattern matching ----
async def test_glob_matching(client):
    with respx.mock(assert_all_called=False) as mock:
        mock.post(f"{_KB_DIRECT_URL}/api/v1/glob").mock(
            return_value=httpx.Response(
                200,
                json=_ok_resp(
                    {
                        "data": [
                            {"name": "/policies/a.md", "type": "file", "size": 100},
                            {"name": "/policies/b.md", "type": "file", "size": 200},
                        ]
                    }
                ),
            )
        )
        resp = await client.post(
            "/kgw/api/v1/glob",
            json={"knCode": _KN_DIRECT, "pathRule": "/policies/*.md"},
            headers=_hdrs(),
        )
    body = resp.json()
    assert body["resultCode"] == "0"
    assert len(body["resultObject"]["data"]) == 2
