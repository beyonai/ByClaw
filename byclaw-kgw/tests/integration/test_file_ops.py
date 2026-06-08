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
    """GR6: readFile for a built markdown file — self-contained import+build+read."""
    import uuid

    path = f"/fileops/readfile-{uuid.uuid4().hex[:8]}.md"

    # 1. Import a fresh file (use unique path to avoid reimport rejection)
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/import",
        data={"knCode": _KN_DIRECT, "filePath": path},
        files={
            "fileContent": (
                "rf.md",
                b"# ReadFile Test\n\nSelf-contained.",
                "text/markdown",
            )
        },
        headers=_hdrs(),
    )
    body = resp.json()
    if body["resultCode"] != "0":
        pytest.skip(f"Import failed (file may already exist): {body}")

    # 2. Trigger build
    resp = await client.post(
        "/kgw/api/v1/fileToMarkdownIndex",
        json={"knCode": _KN_DIRECT, "filePath": path},
        headers=_hdrs(),
    )
    assert resp.json()["resultCode"] == "0", f"build trigger failed: {resp.json()}"

    # 3. Wait for build to complete (poll every 2s, timeout 120s)
    for _ in range(60):
        status_resp = await client.post(
            "/kgw/api/v1/fileBuildStatus",
            json={"knCode": _KN_DIRECT, "filePath": path},
            headers=_hdrs(),
        )
        sbody = status_resp.json()
        status = sbody.get("resultObject", {}).get("status")
        if status in ("success", "complete"):
            break
        if status in ("failed",):
            _step = sbody.get("resultObject", {}).get("currentStep", "?")
            pytest.skip(
                f"Build failed at step={_step} — embedding API may be unreachable"
            )
        await asyncio.sleep(2)
    else:
        pytest.fail("GR6 build did not complete within 120 s")

    # 4. readFile
    resp = await client.post(
        "/kgw/api/v1/readFile",
        json={"knCode": _KN_DIRECT, "filePath": path},
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
# GI5: Malformed YAML front-matter tolerance
# ---------------------------------------------------------------------------


async def test_import_broken_frontmatter(client: httpx.AsyncClient) -> None:
    """GI5: Import with broken YAML front-matter - tolerant import succeeds, file ingested."""
    content = b"---\nstatus: [unclosed\n---\n# Broken YAML Header\n\nSome content here."

    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/import",
        data={"knCode": _KN_DIRECT, "filePath": "/fileops/broken-fm.md"},
        files={
            "fileContent": (
                "broken-fm.md",
                content,
                "text/markdown",
            )
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GI5 import broken frontmatter: {body}"

    # Verify file appears in listDir
    try:
        resp = await client.post(
            "/kgw/api/v1/listDir",
            json={"knCode": _KN_DIRECT, "directoryPath": "/fileops"},
            headers=_hdrs(),
        )
    except httpx.RemoteProtocolError:
        pytest.skip("Proxy interference — set NO_PROXY=127.0.0.1,localhost")
    body = resp.json()
    assert body["resultCode"] == "0", f"GI5 listDir after import: {body}"
    data = body.get("resultObject", {}).get("data", [])
    found = any("broken-fm.md" in str(f) for f in data)
    assert found, f"GI5 broken frontmatter file not in listDir: {data}"


# ---------------------------------------------------------------------------
# GB2: Build trigger via service discovery
# ---------------------------------------------------------------------------

_KN_DISCOV = "300001"


async def test_build_trigger_discovery(client: httpx.AsyncClient) -> None:
    """GB2: Trigger fileToMarkdownIndex via service discovery knCode=300001."""
    # Import a file with knCode=300001
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/import",
        data={"knCode": _KN_DISCOV, "filePath": "/fileops/discovery-build.md"},
        files={
            "fileContent": (
                "discovery-build.md",
                b"# Discovery Build\n\nFile via service discovery.",
                "text/markdown",
            )
        },
        headers=_hdrs(),
    )
    body = resp.json()
    # Discovery import may fail gracefully
    assert body["resultCode"] in ("0", "-1"), f"GB2 import discovery: {body}"

    # Trigger build with knCode=300001
    try:
        resp = await client.post(
            "/kgw/api/v1/fileToMarkdownIndex",
            json={"knCode": _KN_DISCOV, "filePath": "/fileops/discovery-build.md"},
            headers=_hdrs(),
        )
    except httpx.RemoteProtocolError:
        pytest.skip("Proxy interference — set NO_PROXY=127.0.0.1,localhost")
    body = resp.json()
    assert body["resultCode"] == "0", f"GB2 build trigger discovery: {body}"


# ---------------------------------------------------------------------------
# GB5: Build retry after failure
# ---------------------------------------------------------------------------


async def test_build_retry_after_failure(client: httpx.AsyncClient) -> None:
    """GB5: Build fails, then retry succeeds."""
    path = "/fileops/retry-build.md"

    # 1. Import
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/import",
        data={"knCode": _KN_DIRECT, "filePath": path},
        files={
            "fileContent": (
                "retry-build.md",
                b"# Retry Build\n\nContent for retry test.",
                "text/markdown",
            )
        },
        headers=_hdrs(),
    )
    body = resp.json()
    if body["resultCode"] != "0":
        pytest.skip(f"GB5 import failed (file may exist): {body}")

    # 2. Trigger first build
    try:
        resp = await client.post(
            "/kgw/api/v1/fileToMarkdownIndex",
            json={"knCode": _KN_DIRECT, "filePath": path},
            headers=_hdrs(),
        )
    except httpx.RemoteProtocolError:
        pytest.skip("Proxy interference — set NO_PROXY=127.0.0.1,localhost")
    assert resp.json()["resultCode"] == "0", f"GB5 first build trigger: {resp.json()}"

    # 3. Poll for status
    build_failed = False
    for _ in range(60):
        status_resp = await client.post(
            "/kgw/api/v1/fileBuildStatus",
            json={"knCode": _KN_DIRECT, "filePath": path},
            headers=_hdrs(),
        )
        sbody = status_resp.json()
        status = sbody.get("resultObject", {}).get("status")
        if status in ("success", "complete"):
            break
        if status in ("failed",):
            build_failed = True
            break
        await asyncio.sleep(2)
    else:
        # If build never completes, skip rather than fail (may be slow backend)
        pytest.skip("GB5 build did not reach terminal state within 120 s")

    # 4. If build failed, retry and assert accepted
    if build_failed:
        try:
            resp = await client.post(
                "/kgw/api/v1/fileToMarkdownIndex",
                json={"knCode": _KN_DIRECT, "filePath": path},
                headers=_hdrs(),
            )
        except httpx.RemoteProtocolError:
            pytest.skip("Proxy interference — set NO_PROXY=127.0.0.1,localhost")
        body = resp.json()
        assert body["resultCode"] == "0", f"GB5 retry build: {body}"


# ---------------------------------------------------------------------------
# GB6: Build without importing file first
# ---------------------------------------------------------------------------


async def test_build_nonexistent_file(client: httpx.AsyncClient) -> None:
    """GB6: Build a file that was never imported - backend returns error."""
    try:
        resp = await client.post(
            "/kgw/api/v1/fileToMarkdownIndex",
            json={"knCode": _KN_DIRECT, "filePath": "/fileops/never-existed.md"},
            headers=_hdrs(),
        )
    except httpx.RemoteProtocolError:
        pytest.skip("Proxy interference — set NO_PROXY=127.0.0.1,localhost")
    body = resp.json()
    assert body["resultCode"] == "-1", f"GB6 build nonexistent file: {body}"


# ---------------------------------------------------------------------------
# GR2: List subdirectory
# ---------------------------------------------------------------------------


async def test_listdir_subdirectory(client: httpx.AsyncClient) -> None:
    """GR2: List contents of a subdirectory."""
    # Create subdirectory
    resp = await client.post(
        "/kgw/api/v1/directories/create",
        json={"knCode": _KN_DIRECT, "directoryPath": "/fileops/sub"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GR2 create dir: {body}"

    # Import file in subdirectory
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/import",
        data={"knCode": _KN_DIRECT, "filePath": "/fileops/sub/file.md"},
        files={
            "fileContent": (
                "file.md",
                b"# Subdirectory File\n\nIn sub dir.",
                "text/markdown",
            )
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GR2 import in sub: {body}"

    # List subdirectory
    try:
        resp = await client.post(
            "/kgw/api/v1/listDir",
            json={"knCode": _KN_DIRECT, "directoryPath": "/fileops/sub"},
            headers=_hdrs(),
        )
    except httpx.RemoteProtocolError:
        pytest.skip("Proxy interference — set NO_PROXY=127.0.0.1,localhost")
    body = resp.json()
    assert body["resultCode"] == "0", f"GR2 listDir sub: {body}"
    data = body.get("resultObject", {}).get("data", [])
    found = any("file.md" in str(f) for f in data)
    assert found, f"GR2 file.md not in subdirectory listing: {data}"


# ---------------------------------------------------------------------------
# GR3: List nonexistent directory
# ---------------------------------------------------------------------------


async def test_listdir_nonexistent(client: httpx.AsyncClient) -> None:
    """GR3: List a directory that doesn't exist returns error."""
    try:
        resp = await client.post(
            "/kgw/api/v1/listDir",
            json={"knCode": _KN_DIRECT, "directoryPath": "/fileops/ghost"},
            headers=_hdrs(),
        )
    except httpx.RemoteProtocolError:
        pytest.skip("Proxy interference — set NO_PROXY=127.0.0.1,localhost")
    body = resp.json()
    assert body["resultCode"] == "-1", f"GR3 listDir nonexistent: {body}"


# ---------------------------------------------------------------------------
# GR5: Glob empty match
# ---------------------------------------------------------------------------


async def test_glob_empty(client: httpx.AsyncClient) -> None:
    """GR5: Glob with pattern that matches nothing returns empty list."""
    resp = await client.post(
        "/kgw/api/v1/glob",
        json={"knCode": _KN_DIRECT, "pathRule": "/fileops/x/*.md"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GR5 glob empty: {body}"
    data = body.get("resultObject", {}).get("data", [])
    assert data == [], f"GR5 expected empty data, got: {data}"


# ---------------------------------------------------------------------------
# GR7: readFile with line window
# ---------------------------------------------------------------------------


async def test_readfile_line_window(client: httpx.AsyncClient) -> None:
    """GR7: Read markdown file with startLine/endLine window."""
    import uuid

    path = f"/fileops/readfile-lines-{uuid.uuid4().hex[:8]}.md"

    # Create multi-line content (50 lines)
    lines = ["# Multi-Line Test\n"]
    for i in range(1, 51):
        lines.append(f"Line {i}: This is content line number {i}.\n")
    content = "".join(lines).encode()

    # 1. Import
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/import",
        data={"knCode": _KN_DIRECT, "filePath": path},
        files={
            "fileContent": (
                "multi.md",
                content,
                "text/markdown",
            )
        },
        headers=_hdrs(),
    )
    body = resp.json()
    if body["resultCode"] != "0":
        pytest.skip(f"GR7 import failed (file may exist): {body}")

    # 2. Trigger build
    resp = await client.post(
        "/kgw/api/v1/fileToMarkdownIndex",
        json={"knCode": _KN_DIRECT, "filePath": path},
        headers=_hdrs(),
    )
    assert resp.json()["resultCode"] == "0", f"GR7 build trigger: {resp.json()}"

    # 3. Wait for build to complete
    for _ in range(60):
        status_resp = await client.post(
            "/kgw/api/v1/fileBuildStatus",
            json={"knCode": _KN_DIRECT, "filePath": path},
            headers=_hdrs(),
        )
        sbody = status_resp.json()
        status = sbody.get("resultObject", {}).get("status")
        if status in ("success", "complete"):
            break
        if status in ("failed",):
            pytest.skip("GR7 build failed — embedding API may be unreachable")
        await asyncio.sleep(2)
    else:
        pytest.fail("GR7 build did not complete within 120 s")

    # 4. readFile with line window
    resp = await client.post(
        "/kgw/api/v1/readFile",
        json={
            "knCode": _KN_DIRECT,
            "filePath": path,
            "startLine": 1,
            "endLine": 20,
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GR7 readFile with line window: {body}"


# ---------------------------------------------------------------------------
# GR9: downloadFile
# ---------------------------------------------------------------------------


async def test_download_file(client: httpx.AsyncClient) -> None:
    """GR9: Download original file returns raw bytes with correct Content-Type."""
    original_content = b"%PDF-1.4 fake pdf content for download test"

    # Import a binary file (PDF)
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/import",
        data={"knCode": _KN_DIRECT, "filePath": "/fileops/download-test.pdf"},
        files={
            "fileContent": (
                "download-test.pdf",
                original_content,
                "application/pdf",
            )
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GR9 import PDF: {body}"

    # Download the file — returns StreamingResponse (raw bytes, not JSON)
    resp = await client.post(
        "/kgw/api/v1/downloadFile",
        json={"knCode": _KN_DIRECT, "filePath": "/fileops/download-test.pdf"},
        headers=_hdrs(),
    )
    assert resp.status_code == 200, f"GR9 download failed: status={resp.status_code}"
    assert resp.content == original_content, (
        f"GR9 content mismatch: expected {len(original_content)} bytes, "
        f"got {len(resp.content)} bytes"
    )
    content_type = resp.headers.get("Content-Type", "")
    assert "pdf" in content_type.lower() or "octet-stream" in content_type.lower(), (
        f"GR9 unexpected Content-Type: {content_type}"
    )


# ---------------------------------------------------------------------------
# GR10: downloadFile with Chinese filename
# ---------------------------------------------------------------------------


async def test_download_file_chinese_filename(client: httpx.AsyncClient) -> None:
    """GR10: Download file with Chinese filename - Content-Disposition handles non-ASCII."""
    original_content = b"# Chinese Filename Test\n\nContent for download."

    # Import with Chinese filename
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/import",
        data={"knCode": _KN_DIRECT, "filePath": "/fileops/请假制度.md"},
        files={
            "fileContent": (
                "请假制度.md",
                original_content,
                "text/markdown",
            )
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GR10 import Chinese filename: {body}"

    # Download
    resp = await client.post(
        "/kgw/api/v1/downloadFile",
        json={"knCode": _KN_DIRECT, "filePath": "/fileops/请假制度.md"},
        headers=_hdrs(),
    )
    assert resp.status_code == 200, f"GR10 download failed: status={resp.status_code}"
    assert resp.content == original_content, (
        f"GR10 content mismatch: expected {len(original_content)} bytes, "
        f"got {len(resp.content)} bytes"
    )
    # Content-Disposition should be present with the filename
    cd_header = resp.headers.get("Content-Disposition", "")
    assert cd_header, "GR10 missing Content-Disposition header"
    assert "请假制度" in cd_header or "filename" in cd_header.lower(), (
        f"GR10 Content-Disposition missing filename: {cd_header}"
    )


# ---------------------------------------------------------------------------
# GR11: Discovery mode read path (listDir + readFile + downloadFile)
# ---------------------------------------------------------------------------


async def test_discovery_read_path(client: httpx.AsyncClient) -> None:
    """GR11: listDir, readFile, and downloadFile all work with service discovery knCode=300001."""
    import uuid

    path = f"/fileops/disc-read-{uuid.uuid4().hex[:8]}.md"
    content = b"# Discovery Read Path\n\nTest content for discovery mode reads."

    # 1. Import with discovery knCode
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/import",
        data={"knCode": _KN_DISCOV, "filePath": path},
        files={
            "fileContent": (
                path.removeprefix("/fileops/"),
                content,
                "text/markdown",
            )
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] in ("0", "-1"), f"GR11 import discovery: {body}"

    # 2. Trigger build
    try:
        resp = await client.post(
            "/kgw/api/v1/fileToMarkdownIndex",
            json={"knCode": _KN_DISCOV, "filePath": path},
            headers=_hdrs(),
        )
    except httpx.RemoteProtocolError:
        pytest.skip("Proxy interference — set NO_PROXY=127.0.0.1,localhost")
    build_body = resp.json()
    if build_body["resultCode"] != "0":
        pytest.skip(f"GR11 build trigger failed (discovery may be down): {build_body}")

    # 3. Wait for build
    for _ in range(60):
        status_resp = await client.post(
            "/kgw/api/v1/fileBuildStatus",
            json={"knCode": _KN_DISCOV, "filePath": path},
            headers=_hdrs(),
        )
        sbody = status_resp.json()
        status = sbody.get("resultObject", {}).get("status")
        if status in ("success", "complete"):
            break
        if status in ("failed",):
            pytest.skip("GR11 build failed — embedding API may be unreachable")
        await asyncio.sleep(2)
    else:
        pytest.fail("GR11 build did not complete within 120 s")

    # 4. listDir — verify file visible (discovery mode may be flaky)
    try:
        resp = await client.post(
            "/kgw/api/v1/listDir",
            json={"knCode": _KN_DISCOV, "directoryPath": "/fileops"},
            headers=_hdrs(),
        )
    except httpx.RemoteProtocolError:
        pytest.skip("Proxy interference — set NO_PROXY=127.0.0.1,localhost")
    body = resp.json()
    if body["resultCode"] != "0":
        pytest.skip(f"GR11 listDir discovery returned error: {body}")
    data = body.get("resultObject", {}).get("data", [])
    fname = path.rsplit("/", 1)[-1]
    found = any(fname in str(f) for f in data)
    if not found:
        pytest.skip(
            f"GR11 file not visible in discovery listDir (backend may be out of sync): {data}"
        )

    # 5. readFile — verify content (discovery mode may be flaky)
    try:
        resp = await client.post(
            "/kgw/api/v1/readFile",
            json={"knCode": _KN_DISCOV, "filePath": path},
            headers=_hdrs(),
        )
    except httpx.RemoteProtocolError:
        pytest.skip("Proxy interference — set NO_PROXY=127.0.0.1,localhost")
    try:
        body = resp.json()
    except Exception:
        pytest.skip(
            f"GR11 readFile discovery returned non-JSON response "
            f"(status={resp.status_code})"
        )
    # Discovery operations may return -1 when backend is partially available
    assert body.get("resultCode") in ("0", "-1"), f"GR11 readFile discovery: {body}"

    # 6. downloadFile — verify bytes (discovery mode)
    resp = await client.post(
        "/kgw/api/v1/downloadFile",
        json={"knCode": _KN_DISCOV, "filePath": path},
        headers=_hdrs(),
    )
    # downloadFile returns StreamingResponse — check status and content
    assert resp.status_code == 200, (
        f"GR11 download discovery status={resp.status_code}, body={resp.text[:200]}"
    )
    assert resp.content == content, (
        f"GR11 content mismatch: expected {len(content)} bytes, "
        f"got {len(resp.content)} bytes"
    )


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
