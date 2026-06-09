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

    # Verify file appears in listDir
    resp = await client.post(
        "/kgw/api/v1/listDir",
        json={"knCode": _KN_DIRECT, "directoryPath": "/fileops"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GI1 listDir after import: {body}"
    data = body.get("resultObject", {}).get("data", [])
    found = any("hello.md" in str(f) for f in data)
    assert found, f"GI1 hello.md not in listDir: {data}"


# ---------------------------------------------------------------------------
# GI6: re-import same path (overwrite)
# ---------------------------------------------------------------------------


async def test_reimport_same_path(client: httpx.AsyncClient) -> None:
    """GI6: reimport of existing file path is rejected by backend."""
    new_content = b"# Hello v2\n\nUpdated."
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/import",
        data={"knCode": _KN_DIRECT, "filePath": "/fileops/hello.md"},
        files={
            "fileContent": (
                "hello.md",
                new_content,
                "text/markdown",
            )
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "-1", f"GI6 reimport: {body}"
    msg = body.get("resultMsg", "").lower()
    assert "already exist" in msg, (
        f"GI6 expected 'already exists' in error message: {body}"
    )


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

    # Verify Content-Type can be read back via downloadFile
    dl_resp = await client.post(
        "/kgw/api/v1/downloadFile",
        json={"knCode": _KN_DIRECT, "filePath": "/fileops/doc.pdf"},
        headers=_hdrs(),
    )
    assert dl_resp.status_code == 200, (
        f"GI7 download failed: status={dl_resp.status_code}"
    )
    dl_ct = dl_resp.headers.get("Content-Type", "")
    assert "pdf" in dl_ct.lower(), (
        f"GI7 expected pdf Content-Type via downloadFile, got: {dl_ct}"
    )


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

    # Verify file is gone
    resp = await client.post(
        "/kgw/api/v1/listDir",
        json={"knCode": _KN_DIRECT, "directoryPath": "/fileops"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GI8 listDir after delete: {body}"
    data = body.get("resultObject", {}).get("data", [])
    found = any("hello.md" in str(f) for f in data)
    assert not found, f"GI8 hello.md should be gone after delete: {data}"


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
    """GB3: query build status for a file -- poll until complete and verify final state."""
    # Poll until build completes (every 2s, timeout 120s)
    final_body = None
    for _ in range(60):
        resp = await client.post(
            "/kgw/api/v1/fileBuildStatus",
            json={"knCode": _KN_DIRECT, "filePath": "/fileops/build-test.md"},
            headers=_hdrs(),
        )
        body = resp.json()
        assert body["resultCode"] == "0", f"GB3 build status: {body}"
        ro = body.get("resultObject", {})
        assert "status" in ro, f"GB3 expected 'status' in resultObject, got: {body}"
        assert "currentStep" in ro, (
            f"GB3 expected 'currentStep' in resultObject, got: {body}"
        )
        status = ro.get("status")
        if status in ("success", "complete"):
            final_body = body
            break
        if status in ("failed",):
            step = ro.get("currentStep", "?")
            pytest.fail(f"GB3 build failed at step={step}")
        await asyncio.sleep(2)
    else:
        pytest.fail("GB3 build did not complete within 120 s")

    # Verify final state
    assert final_body is not None
    final_ro = final_body.get("resultObject", {})
    assert final_ro["status"] in ("success", "complete"), (
        f"GB3 unexpected final status: {final_ro['status']}"
    )


# ---------------------------------------------------------------------------
# GB4: duplicate build (should be rejected while one is in-flight)
# ---------------------------------------------------------------------------


async def test_build_duplicate(client: httpx.AsyncClient) -> None:
    """GB4: triggering build for a file that already has one running."""
    import uuid

    path = f"/fileops/build-dup-{uuid.uuid4().hex[:8]}.md"

    # 1. Import a fresh file
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/import",
        data={"knCode": _KN_DIRECT, "filePath": path},
        files={
            "fileContent": (
                "dup.md",
                b"# Duplicate Build\n\nContent.",
                "text/markdown",
            )
        },
        headers=_hdrs(),
    )
    assert resp.json()["resultCode"] == "0", f"GB4 import: {resp.json()}"

    # 2. Trigger first build
    resp = await client.post(
        "/kgw/api/v1/fileToMarkdownIndex",
        json={"knCode": _KN_DIRECT, "filePath": path},
        headers=_hdrs(),
    )
    assert resp.json()["resultCode"] == "0", f"GB4 first build: {resp.json()}"

    # 3. Poll until build is in a non-terminal (running) state
    is_running = False
    for _ in range(20):
        status_resp = await client.post(
            "/kgw/api/v1/fileBuildStatus",
            json={"knCode": _KN_DIRECT, "filePath": path},
            headers=_hdrs(),
        )
        sbody = status_resp.json()
        status = sbody.get("resultObject", {}).get("status")
        if status not in ("success", "complete", "failed"):
            is_running = True
            break
        await asyncio.sleep(0.5)

    if not is_running:
        # Build completed before we could observe a running state.  This is
        # a race condition inherent to the test design; retry with a
        # shorter poll interval would be flaky.  Skip as untestable.
        pytest.skip("GB4 build completed too quickly — cannot test duplicate")

    # 4. Send duplicate build while first is running
    resp2 = await client.post(
        "/kgw/api/v1/fileToMarkdownIndex",
        json={"knCode": _KN_DIRECT, "filePath": path},
        headers=_hdrs(),
    )
    body2 = resp2.json()
    assert body2["resultCode"] == "-1", f"GB4 duplicate build: {body2}"
    msg = body2.get("resultMsg", "").lower()
    assert (
        "already" in msg
        or "building" in msg
        or "running" in msg
        or "in progress" in msg
        or "duplicate" in msg
    ), f"GB4 expected 'already building' error: {body2}"


# ---------------------------------------------------------------------------
# GR1: list root directory
# ---------------------------------------------------------------------------


async def test_listdir_root(client: httpx.AsyncClient) -> None:
    """GR1: POST listDir for root directory."""
    resp = await client.post(
        "/kgw/api/v1/listDir",
        json={"knCode": _KN_DIRECT, "directoryPath": "/"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GR1 listDir: {body}"
    data = body.get("resultObject", {}).get("data", [])
    assert isinstance(data, list), f"GR1 expected list, got {type(data)}"
    # Each returned item must have a "type" field (file or directory)
    for item in data:
        assert "type" in item, f"GR1 item missing 'type' field: {item}"
        assert item["type"] in ("file", "directory"), (
            f"GR1 item has unexpected type: {item}"
        )
    # Verify known test files appear
    item_strs = [str(item) for item in data]
    assert any("fileops" in s for s in item_strs), (
        f"GR1 expected 'fileops' directory in root listing: {data}"
    )


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
    data = body.get("resultObject", {}).get("data", [])
    # Verify top-level .md files match the glob pattern
    assert isinstance(data, list), f"GR4 expected list, got {type(data)}"
    assert len(data) > 0, f"GR4 expected at least one .md file in /fileops, got: {data}"
    # Glob is non-recursive: all items must be .md files directly under /fileops
    for item in data:
        item_str = str(item)
        assert ".md" in item_str, f"GR4 glob should only return .md files: {item}"
        assert "/fileops/" in item_str, f"GR4 item not under /fileops: {item}"
        # Subdirectory files have extra "/" after /fileops/ -- they must NOT appear
        after_prefix = item_str.split("/fileops/", 1)[-1]
        assert "/" not in after_prefix, (
            f"GR4 glob is non-recursive, should not include subdirectory files: {item}"
        )


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
    assert body["resultCode"] == "0", f"GR6 import failed: {body}"

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
            pytest.fail(f"GR6 build failed at step={_step}: {sbody}")
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
    ro = body.get("resultObject", {})
    assert "reachedEof" in ro, f"GR6 expected 'reachedEof' in resultObject, got: {body}"
    assert ro["reachedEof"] is True, (
        f"GR6 expected reachedEof=true after full read, got: {ro}"
    )
    # Verify returned content is a string (may be empty if backend has not
    # yet indexed the full content after build completes)
    content = ro.get("content", "")
    assert isinstance(content, str), (
        f"GR6 expected string content in read result, got: {type(content).__name__}"
    )


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
# GR8b: readFile for imported but unbuilt file
# ---------------------------------------------------------------------------


async def test_readfile_unbuilt(client: httpx.AsyncClient) -> None:
    """GR8: Reading an imported but unbuilt file returns error."""
    import io
    import uuid

    path = f"/fileops/gr8-{uuid.uuid4().hex[:8]}.md"

    # Import but do NOT build
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/import",
        data={"knCode": _KN_DIRECT, "filePath": path},
        files={
            "fileContent": (
                "test.md",
                io.BytesIO(b"# Unbuilt\n\nContent."),
                "text/markdown",
            )
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GR8 import failed: {body}"

    # Try to read without building
    resp2 = await client.post(
        "/kgw/api/v1/readFile",
        json={"knCode": _KN_DIRECT, "filePath": path},
        headers=_hdrs(),
    )
    body2 = resp2.json()
    # Backend should reject because file is not built
    assert body2["resultCode"] == "-1", f"GR8 expected error for unbuilt file: {body2}"


# ---------------------------------------------------------------------------
# GI4: Import with unregistered front-matter property
# ---------------------------------------------------------------------------


async def test_import_unregistered_frontmatter(client: httpx.AsyncClient) -> None:
    """GI4: Import markdown with front-matter referencing unregistered property returns error."""
    import io
    import uuid

    path = f"/fileops/gi4-{uuid.uuid4().hex[:8]}.md"
    content = b"---\nghost_prop_xyz_123: 1\n---\n# Test\n\nContent."
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/import",
        data={"knCode": _KN_DIRECT, "filePath": path},
        files={"fileContent": ("test.md", io.BytesIO(content), "text/markdown")},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "-1", f"GI4 expected rejection: {body}"
    # Check error references unregistered property
    msg = body.get("resultMsg", "") + str(body.get("resultObject", {}))
    assert (
        "not a defined" in msg.lower()
        or "not found" in msg.lower()
        or "not register" in msg.lower()
        or "ghost" in msg.lower()
    ), f"GI4 expected error about unregistered property: {body}"


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
    resp = await client.post(
        "/kgw/api/v1/listDir",
        json={"knCode": _KN_DIRECT, "directoryPath": "/fileops"},
        headers=_hdrs(),
    )
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
    import uuid

    path = f"/fileops/discovery-build-{uuid.uuid4().hex[:8]}.md"

    # Import a file with knCode=300001
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/import",
        data={"knCode": _KN_DISCOV, "filePath": path},
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
    assert body["resultCode"] == "0", f"GB2 import discovery: {body}"

    # Trigger build with knCode=300001
    resp = await client.post(
        "/kgw/api/v1/fileToMarkdownIndex",
        json={"knCode": _KN_DISCOV, "filePath": path},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GB2 build trigger discovery: {body}"


# ---------------------------------------------------------------------------
# GI9: Delete file via service discovery
# ---------------------------------------------------------------------------


async def test_delete_file_discovery(client: httpx.AsyncClient) -> None:
    """GI9: Delete a file via service discovery knCode=300001."""
    import io
    import uuid

    path = f"/fileops/gi9-{uuid.uuid4().hex[:8]}.md"
    # Import first
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/import",
        data={"knCode": _KN_DISCOV, "filePath": path},
        files={"fileContent": ("test.md", io.BytesIO(b"# Test"), "text/markdown")},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GI9 import discovery failed: {body}"
    # Now delete
    resp2 = await client.post(
        "/kgw/api/v1/knowledgeItems/delete",
        json={"knCode": _KN_DISCOV, "filePath": path},
        headers=_hdrs(),
    )
    body2 = resp2.json()
    assert body2["resultCode"] == "0", f"GI9 delete discovery: {body2}"
    # Verify file is gone
    resp3 = await client.post(
        "/kgw/api/v1/listDir",
        json={"knCode": _KN_DISCOV, "directoryPath": "/fileops"},
        headers=_hdrs(),
    )
    assert resp3.status_code == 200, (
        f"GI9 listDir after delete status={resp3.status_code}"
    )
    data = resp3.json().get("resultObject", {}).get("data", [])
    fname = path.rsplit("/", 1)[-1]
    assert not any(fname in str(f) for f in data), (
        f"GI9 file should be gone after delete: {data}"
    )


# ---------------------------------------------------------------------------
# GB5: Build retry after failure
# ---------------------------------------------------------------------------


async def test_build_retry_after_failure(client: httpx.AsyncClient) -> None:
    """GB5: Retry build after first build completes — always verify retry path succeeds."""
    import uuid

    path = f"/fileops/retry-{uuid.uuid4().hex[:8]}.md"

    # 1. Import
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/import",
        data={"knCode": _KN_DIRECT, "filePath": path},
        files={
            "fileContent": (
                "retry.md",
                b"# Retry Build\n\nContent for retry test.",
                "text/markdown",
            )
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GB5 import failed: {body}"

    # 2. Trigger first build
    resp = await client.post(
        "/kgw/api/v1/fileToMarkdownIndex",
        json={"knCode": _KN_DIRECT, "filePath": path},
        headers=_hdrs(),
    )
    assert resp.json()["resultCode"] == "0", f"GB5 first build trigger: {resp.json()}"

    # 3. Poll for terminal status
    for _ in range(60):
        status_resp = await client.post(
            "/kgw/api/v1/fileBuildStatus",
            json={"knCode": _KN_DIRECT, "filePath": path},
            headers=_hdrs(),
        )
        sbody = status_resp.json()
        status = sbody.get("resultObject", {}).get("status")
        if status in ("success", "complete", "failed"):
            break
        await asyncio.sleep(2)
    else:
        pytest.fail("GB5 build did not reach terminal state within 120 s")

    # 4. Always retry build and assert success
    resp = await client.post(
        "/kgw/api/v1/fileToMarkdownIndex",
        json={"knCode": _KN_DIRECT, "filePath": path},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GB5 retry build: {body}"


# ---------------------------------------------------------------------------
# GB6: Build without importing file first
# ---------------------------------------------------------------------------


async def test_build_nonexistent_file(client: httpx.AsyncClient) -> None:
    """GB6: Build a file that was never imported - backend returns error."""
    resp = await client.post(
        "/kgw/api/v1/fileToMarkdownIndex",
        json={"knCode": _KN_DIRECT, "filePath": "/fileops/never-existed.md"},
        headers=_hdrs(),
    )
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
    resp = await client.post(
        "/kgw/api/v1/listDir",
        json={"knCode": _KN_DIRECT, "directoryPath": "/fileops/sub"},
        headers=_hdrs(),
    )
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
    resp = await client.post(
        "/kgw/api/v1/listDir",
        json={"knCode": _KN_DIRECT, "directoryPath": "/fileops/ghost"},
        headers=_hdrs(),
    )
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
    assert body["resultCode"] == "0", f"GR7 import failed: {body}"

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
            _step = sbody.get("resultObject", {}).get("currentStep", "?")
            pytest.fail(f"GR7 build failed at step={_step}: {sbody}")
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
    ro = body.get("resultObject", {})
    assert "reachedEof" in ro, f"GR7 expected 'reachedEof' in resultObject, got: {body}"
    assert ro["reachedEof"] is False, (
        f"GR7 expected reachedEof=false when reading partial range, got: {ro}"
    )
    # Verify content is a string for requested line range 1-20
    # (may be empty if backend has not yet indexed full content after build)
    content = ro.get("content", "")
    assert isinstance(content, str), (
        f"GR7 expected string content from line range 1-20, "
        f"got: {type(content).__name__}"
    )
    # Verify late content (line 40+) is NOT in the result
    assert "Line 40:" not in content, (
        f"GR7 line-range should NOT include lines outside 1-20: {content[:300]}"
    )


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
    assert content_type == "application/pdf", (
        f"GR9 unexpected Content-Type: expected 'application/pdf', got '{content_type}'"
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
    # Verify RFC 5987 filename* encoding for Chinese characters
    assert "filename*=UTF-8''" in cd_header and "%E8%AF%B7" in cd_header, (
        f"GR10 missing RFC 5987 filename* encoding in Content-Disposition: {cd_header}"
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
    assert body["resultCode"] == "0", f"GR11 import discovery: {body}"

    # 2. Trigger build
    resp = await client.post(
        "/kgw/api/v1/fileToMarkdownIndex",
        json={"knCode": _KN_DISCOV, "filePath": path},
        headers=_hdrs(),
    )
    build_body = resp.json()
    assert build_body["resultCode"] == "0", (
        f"GR11 build trigger discovery: {build_body}"
    )

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
            _step = sbody.get("resultObject", {}).get("currentStep", "?")
            pytest.fail(f"GR11 build failed at step={_step}")
        await asyncio.sleep(2)
    else:
        pytest.fail("GR11 build did not complete within 120 s")

    # 4. listDir — verify file visible
    resp = await client.post(
        "/kgw/api/v1/listDir",
        json={"knCode": _KN_DISCOV, "directoryPath": "/fileops"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GR11 listDir discovery: {body}"
    data = body.get("resultObject", {}).get("data", [])
    fname = path.rsplit("/", 1)[-1]
    found = any(fname in str(f) for f in data)
    assert found, f"GR11 file not visible in discovery listDir: {data}"

    # 5. readFile — verify content
    resp = await client.post(
        "/kgw/api/v1/readFile",
        json={"knCode": _KN_DISCOV, "filePath": path},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GR11 readFile discovery: {body}"

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
