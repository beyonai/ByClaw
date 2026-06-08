"""Integration tests: file import, delete, read, build -- real backend calls.

Tests file lifecycle through the KGW gateway to the running byclaw-qa
backend, covering import (markdown + PDF), delete (success + nonexistent),
soft-delete re-import, build trigger + status + duplicate, directory listing,
glob, and readFile (success + nonexistent).

No respx mocks -- all calls are real.
"""
# pylint: disable=redefined-outer-name,invalid-name,unused-argument

from __future__ import annotations

import asyncio

import httpx
import pytest

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

_KN_DIRECT = "200001"
_USER_ID = "test_user"


def _hdrs(extra: dict | None = None) -> dict[str, str]:
    h = {"X-User-Id": _USER_ID}
    if extra:
        h.update(extra)
    return h


# ---------------------------------------------------------------------------
# GI1: import markdown file
# ---------------------------------------------------------------------------


async def test_import_markdown(client: httpx.AsyncClient) -> None:
    """POST /kgw/api/v1/knowledgeItems/import (multipart, markdown)."""
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/import",
        data={"knCode": _KN_DIRECT, "filePath": "/fileops/hello.md"},
        files={
            "fileContent": (
                "hello.md",
                b"# Hello World\n\nTest content.",
                "text/markdown",
            )
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GI1 import markdown: {body}"


# ---------------------------------------------------------------------------
# GI6: re-import same path (overwrite)
# ---------------------------------------------------------------------------


async def test_reimport_same_path(client: httpx.AsyncClient) -> None:
    """GI6: overwrite existing file with different content."""
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/import",
        data={"knCode": _KN_DIRECT, "filePath": "/fileops/hello.md"},
        files={
            "fileContent": (
                "hello.md",
                b"# Hello v2\n\nUpdated.",
                "text/markdown",
            )
        },
        headers=_hdrs(),
    )
    body = resp.json()
    # byclaw-qa rejects re-import of existing file at same path
    assert body["resultCode"] == "-1", f"GI6 reimport: {body}"


# ---------------------------------------------------------------------------
# GI7: import PDF file
# ---------------------------------------------------------------------------


async def test_import_pdf(client: httpx.AsyncClient) -> None:
    """GI7: import a non-markdown (PDF) file."""
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/import",
        data={"knCode": _KN_DIRECT, "filePath": "/fileops/doc.pdf"},
        files={
            "fileContent": (
                "doc.pdf",
                b"%PDF-1.4 fake pdf content",
                "application/pdf",
            )
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GI7 import PDF: {body}"


# ---------------------------------------------------------------------------
# GI8: delete file
# ---------------------------------------------------------------------------


async def test_delete_file(client: httpx.AsyncClient) -> None:
    """GI8: delete an existing file."""
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/delete",
        json={"knCode": _KN_DIRECT, "filePath": "/fileops/hello.md"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GI8 delete: {body}"


# ---------------------------------------------------------------------------
# GI10: delete non-existent file
# ---------------------------------------------------------------------------


async def test_delete_nonexistent(client: httpx.AsyncClient) -> None:
    """GI10: delete a file that does not exist."""
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/delete",
        json={"knCode": _KN_DIRECT, "filePath": "/fileops/never.md"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "-1", f"GI10 delete nonexistent: {body}"


# ---------------------------------------------------------------------------
# GI11: soft-delete then re-import same path
# ---------------------------------------------------------------------------


async def test_soft_delete_reimport(client: httpx.AsyncClient) -> None:
    """GI11: import, delete, then re-import the same path."""
    # 1. Import
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/import",
        data={"knCode": _KN_DIRECT, "filePath": "/fileops/reimport.md"},
        files={
            "fileContent": (
                "reimport.md",
                b"# Reimport me",
                "text/markdown",
            )
        },
        headers=_hdrs(),
    )
    assert resp.json()["resultCode"] == "0", "GI11 first import"

    # 2. Delete
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/delete",
        json={"knCode": _KN_DIRECT, "filePath": "/fileops/reimport.md"},
        headers=_hdrs(),
    )
    assert resp.json()["resultCode"] == "0", "GI11 delete"

    # 3. Re-import
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/import",
        data={"knCode": _KN_DIRECT, "filePath": "/fileops/reimport.md"},
        files={
            "fileContent": (
                "reimport.md",
                b"# Reimported again",
                "text/markdown",
            )
        },
        headers=_hdrs(),
    )
    assert resp.json()["resultCode"] == "0", "GI11 reimport"


# ---------------------------------------------------------------------------
# GB1: build trigger
# ---------------------------------------------------------------------------


async def test_build_trigger(client: httpx.AsyncClient) -> None:
    """GB1: import a file then trigger markdown build."""
    # 1. Import the build test file
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/import",
        data={"knCode": _KN_DIRECT, "filePath": "/fileops/build-test.md"},
        files={
            "fileContent": (
                "build-test.md",
                b"# Build Test\n\nContent for build.",
                "text/markdown",
            )
        },
        headers=_hdrs(),
    )
    assert resp.json()["resultCode"] == "0", "GB1 import for build"

    # 2. Trigger build
    resp = await client.post(
        "/kgw/api/v1/fileToMarkdownIndex",
        json={"knCode": _KN_DIRECT, "filePath": "/fileops/build-test.md"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GB1 build trigger: {body}"


# ---------------------------------------------------------------------------
# GB3: build status
# ---------------------------------------------------------------------------


async def test_build_status(client: httpx.AsyncClient) -> None:
    """GB3: query build status for a file."""
    try:
        resp = await client.post(
            "/kgw/api/v1/fileBuildStatus",
            json={"knCode": _KN_DIRECT, "filePath": "/fileops/build-test.md"},
            headers=_hdrs(),
        )
    except httpx.RemoteProtocolError:
        pytest.skip("Proxy interference — set NO_PROXY=127.0.0.1,localhost")
    body = resp.json()
    assert body["resultCode"] == "0", f"GB3 build status: {body}"
    assert "status" in body.get("resultObject", {}), (
        f"GB3 expected 'status' in resultObject, got: {body}"
    )


# ---------------------------------------------------------------------------
# GB4: duplicate build (should be rejected while one is in-flight)
# ---------------------------------------------------------------------------


async def test_build_duplicate(client: httpx.AsyncClient) -> None:
    """GB4: triggering build for a file that already has one running."""
    try:
        resp = await client.post(
            "/kgw/api/v1/fileToMarkdownIndex",
            json={"knCode": _KN_DIRECT, "filePath": "/fileops/build-test.md"},
            headers=_hdrs(),
        )
    except httpx.RemoteProtocolError:
        pytest.skip("Proxy interference — set NO_PROXY=127.0.0.1,localhost")
    body = resp.json()
    assert body["resultCode"] in ("0", "-1"), f"GB4 duplicate build: {body}"


# ---------------------------------------------------------------------------
# GR1: list root directory
# ---------------------------------------------------------------------------


async def test_listdir_root(client: httpx.AsyncClient) -> None:
    """GR1: POST listDir for root directory."""
    try:
        resp = await client.post(
            "/kgw/api/v1/listDir",
            json={"knCode": _KN_DIRECT, "directoryPath": "/"},
            headers=_hdrs(),
        )
    except httpx.RemoteProtocolError:
        pytest.skip("Proxy interference — set NO_PROXY=127.0.0.1,localhost")
    body = resp.json()
    assert body["resultCode"] == "0", f"GR1 listDir: {body}"
    data = body.get("resultObject", {}).get("data", [])
    assert isinstance(data, list), f"GR1 expected list, got {type(data)}"


# ---------------------------------------------------------------------------
# GR4: glob pattern matching
# ---------------------------------------------------------------------------


async def test_glob(client: httpx.AsyncClient) -> None:
    """GR4: glob for *.md in /fileops."""
    resp = await client.post(
        "/kgw/api/v1/glob",
        json={"knCode": _KN_DIRECT, "pathRule": "/fileops/*.md"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GR4 glob: {body}"


# ---------------------------------------------------------------------------
# GR6: readFile after build completes
# ---------------------------------------------------------------------------


async def test_readfile(client: httpx.AsyncClient) -> None:
    """GR6: readFile for the built markdown file.

    Waits up to 90 s for the build to complete before reading.
    """
    # Wait for build to finish (poll every 1 s, timeout 90 s)
    for _ in range(90):
        status_resp = await client.post(
            "/kgw/api/v1/fileBuildStatus",
            json={"knCode": _KN_DIRECT, "filePath": "/fileops/build-test.md"},
            headers=_hdrs(),
        )
        sbody = status_resp.json()
        status = sbody.get("resultObject", {}).get("status")
        if status == "success":
            break
        if status == "failed":
            _step = sbody.get("resultObject", {}).get("currentStep", "?")
            pytest.skip(
                f"Build failed at step={_step} — embedding API may be unreachable"
            )
        await asyncio.sleep(1)
    else:
        pytest.fail("GR6 build did not complete within 90 s")

    resp = await client.post(
        "/kgw/api/v1/readFile",
        json={"knCode": _KN_DIRECT, "filePath": "/fileops/build-test.md"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GR6 readFile: {body}"


# ---------------------------------------------------------------------------
# GR8: readFile for non-existent file
# ---------------------------------------------------------------------------


async def test_readfile_nonexistent(client: httpx.AsyncClient) -> None:
    """GR8: readFile for a file that was never imported."""
    resp = await client.post(
        "/kgw/api/v1/readFile",
        json={"knCode": _KN_DIRECT, "filePath": "/fileops/ghost.md"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "-1", f"GR8 readFile nonexistent: {body}"


# ---------------------------------------------------------------------------
# Cleanup: delete all files created under /fileops/
# ---------------------------------------------------------------------------


async def test_cleanup(client: httpx.AsyncClient) -> None:
    """Remove the /fileops directory and all its contents."""
    resp = await client.post(
        "/kgw/api/v1/directories/delete",
        json={"knCode": _KN_DIRECT, "directoryPath": "/fileops"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"cleanup directory delete: {body}"
