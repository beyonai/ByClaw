"""Cross-KB search integration tests using the REAL byclaw-qa backend.

Tests search endpoints through the KGW gateway, covering semantic,
full-text, mixed, metadata, file, cross-KB, and error-case searches.

No respx mocks -- all calls are real.
"""

# pylint: disable=redefined-outer-name,invalid-name

from __future__ import annotations

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


async def _setup_search_files(client: httpx.AsyncClient) -> bool:
    """Import test files for search tests. Returns True if setup succeeded."""
    for i, path in enumerate(["/search-test/doc1.md", "/search-test/doc2.md"]):
        resp = await client.post(
            "/kgw/api/v1/knowledgeItems/import",
            data={"knCode": _KN_DIRECT, "filePath": path},
            files={
                "fileContent": (
                    f"doc{i}.md",
                    f"# Document {i}\n\nTest content for search.",
                    "text/markdown",
                )
            },
            headers=_hdrs(),
        )
        if resp.json().get("resultCode") != "0":
            return False
    # Trigger build
    for path in ["/search-test/doc1.md", "/search-test/doc2.md"]:
        await client.post(
            "/kgw/api/v1/fileToMarkdownIndex",
            json={"knCode": _KN_DIRECT, "filePath": path},
            headers=_hdrs(),
        )
    return True


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------


async def test_search_setup(client: httpx.AsyncClient) -> None:
    """Import test files and trigger build for search tests."""
    try:
        success = await _setup_search_files(client)
    except httpx.RemoteProtocolError:
        pytest.skip("Proxy interference -- run with NO_PROXY=*")
    if not success:
        pytest.skip("Build requires embedding API")


# ---------------------------------------------------------------------------
# Search mode tests
# ---------------------------------------------------------------------------


async def test_semantic_search(client: httpx.AsyncClient) -> None:
    """Semantic (embedding) search returns resultCode 0."""
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/search",
        json={
            "knCodeList": [_KN_DIRECT],
            "query": "Document",
            "topK": 5,
            "searchMode": "embedding",
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"semantic search: {body}"


async def test_search_mode_fulltext(client: httpx.AsyncClient) -> None:
    """Full-text search returns resultCode 0."""
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/search",
        json={
            "knCodeList": [_KN_DIRECT],
            "query": "Document",
            "topK": 5,
            "searchMode": "fullTextRecall",
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"fulltext search: {body}"


async def test_search_mode_mixed(client: httpx.AsyncClient) -> None:
    """Mixed recall search returns resultCode 0."""
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/search",
        json={
            "knCodeList": [_KN_DIRECT],
            "query": "Document",
            "topK": 5,
            "searchMode": "mixedRecall",
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"mixed search: {body}"


# ---------------------------------------------------------------------------
# Metadata and file search
# ---------------------------------------------------------------------------


async def test_metadata_search(client: httpx.AsyncClient) -> None:
    """Metadata search using exists filter on fileName."""
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/metadataSearch",
        json={
            "knCodeList": [_KN_DIRECT],
            "topK": 5,
            "where": {"exists": {"fieldName": "fileName"}},
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"metadata search: {body}"


async def test_search_file(client: httpx.AsyncClient) -> None:
    """File-level search returns resultCode 0."""
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/searchFile",
        json={"knCodeList": [_KN_DIRECT], "topK": 5},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"search file: {body}"


# ---------------------------------------------------------------------------
# Cross-KB and error-case tests
# ---------------------------------------------------------------------------


async def test_search_cross_kb(client: httpx.AsyncClient) -> None:
    """Cross-KB search across direct and discovery KBs."""
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/search",
        json={
            "knCodeList": [_KN_DIRECT, _KN_DISCOV],
            "query": "Document",
            "topK": 5,
        },
        headers=_hdrs(),
    )
    body = resp.json()
    # 300001 may appear in degraded_kbs, but overall result should be 0
    assert body["resultCode"] == "0", f"cross-KB search: {body}"


async def test_search_unknown_kncode(client: httpx.AsyncClient) -> None:
    """Unknown knCode returns error or degraded_kbs."""
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/search",
        json={"knCodeList": ["99999999"], "query": "Document", "topK": 5},
        headers=_hdrs(),
    )
    body = resp.json()
    rc = body["resultCode"]
    if rc == "-1":
        return
    assert rc == "0", f"unexpected resultCode for unknown knCode: {body}"
    ro = body.get("resultObject", {})
    assert "degraded_kbs" in ro, (
        f"expected degraded_kbs in resultObject for unknown knCode: {body}"
    )


# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------


async def test_cleanup_search_files(client: httpx.AsyncClient) -> None:
    """Clean up the /search-test/ directory."""
    try:
        resp = await client.post(
            "/kgw/api/v1/directories/delete",
            json={"knCode": _KN_DIRECT, "directoryPath": "/search-test"},
            headers=_hdrs(),
        )
    except httpx.RemoteProtocolError:
        pytest.skip("Proxy interference -- run with NO_PROXY=*")
    body = resp.json()
    # OK if directory was never created (setup was skipped)
    if body["resultCode"] != "0" and "not found" in body.get("resultMsg", ""):
        return
    assert body["resultCode"] == "0", f"cleanup failed: {body}"
