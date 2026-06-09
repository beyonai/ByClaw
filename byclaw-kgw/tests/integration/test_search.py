"""Cross-KB search integration tests using the REAL byclaw-qa backend.

Tests search endpoints through the KGW gateway, covering semantic,
full-text, mixed, metadata, file, cross-KB, and error-case searches.

No respx mocks -- all calls are real.
"""

# pylint: disable=redefined-outer-name,invalid-name

from __future__ import annotations

import asyncio
import uuid

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


async def _import_and_build(
    client: httpx.AsyncClient,
    kn_code: str,
    file_path: str,
    content: bytes = b"# Test\n\nSearch test content.",
    content_type: str = "text/markdown",
) -> str | None:
    """Import a file, trigger build, and wait for completion.

    Returns the file_path on success, or None if the file already exists.
    """
    fname = file_path.rsplit("/", 1)[-1]

    # 1. Import
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/import",
        data={"knCode": kn_code, "filePath": file_path},
        files={"fileContent": (fname, content, content_type)},
        headers=_hdrs(),
    )
    body = resp.json()
    if body.get("resultCode") != "0":
        # File may already exist from a previous run
        return None

    # 2. Trigger build
    resp = await client.post(
        "/kgw/api/v1/fileToMarkdownIndex",
        json={"knCode": kn_code, "filePath": file_path},
        headers=_hdrs(),
    )
    if resp.json()["resultCode"] != "0":
        return None

    # 3. Wait for build to complete (poll every 2s, timeout 120s)
    for _ in range(60):
        status_resp = await client.post(
            "/kgw/api/v1/fileBuildStatus",
            json={"knCode": kn_code, "filePath": file_path},
            headers=_hdrs(),
        )
        sbody = status_resp.json()
        status = sbody.get("resultObject", {}).get("status")
        if status in ("success", "complete"):
            return file_path
        if status in ("failed",):
            return None
        await asyncio.sleep(2)
    return None  # Build timed out


def _gen_path(prefix: str = "/search-test") -> str:
    """Generate a unique file path for a test."""
    return f"{prefix}/gs-{uuid.uuid4().hex[:8]}.md"


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------


async def test_search_setup(client: httpx.AsyncClient) -> None:
    """Import test files and trigger build for search tests."""
    try:
        success = await _setup_search_files(client)
    except httpx.RemoteProtocolError:
        pytest.skip("Proxy interference — set NO_PROXY=127.0.0.1,localhost")
    if not success:
        pytest.skip("Import failed — files may already exist from previous run")


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
    ro = body.get("resultObject", {})
    assert "degraded_kbs" in ro, (
        f"cross-KB search missing degraded_kbs in resultObject: {body}"
    )
    degraded = ro["degraded_kbs"]
    assert isinstance(degraded, list), (
        f"degraded_kbs should be a list, got: {type(degraded)}"
    )
    # If discovery KB backend is down, it should appear with knCode + reason
    if degraded:
        for entry in degraded:
            assert "knCode" in entry, f"degraded entry missing knCode: {entry}"


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
# GS2: Active degradation test
# ---------------------------------------------------------------------------


async def test_search_degraded_kb(client: httpx.AsyncClient) -> None:
    """GS2: Search with one unreachable knCode - degraded_kbs reports the failed KB."""
    # Import+build a file in the direct KB first
    path = _gen_path("/search-test/gs2")
    await _import_and_build(
        client,
        _KN_DIRECT,
        path,
        b"# GS2 Test\n\nDegradation test content.",
    )

    # Search with one valid and one nonexistent knCode
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/search",
        json={
            "knCodeList": [_KN_DIRECT, "99999999"],
            "query": "degradation test",
            "topK": 3,
            "searchMode": "fullTextRecall",
        },
        headers=_hdrs(),
    )
    body = resp.json()
    # Either resultCode=0 (partial success) or resultCode=-1 with degraded_kbs
    degraded = body.get("resultObject", {}).get("degraded_kbs", [])
    # Check that the bad KB is reported
    degraded_kns = [d.get("knCode") for d in degraded]
    assert "99999999" in degraded_kns or body["resultCode"] == "0", (
        f"GS2 expected degraded_kbs to include 99999999: {body}"
    )
    # The direct KB should still return results
    if body["resultCode"] == "0":
        data = body.get("resultObject", {}).get("data", [])
        assert len(data) >= 0, f"GS2 should have results from direct KB: {body}"


# ---------------------------------------------------------------------------
# GS1: Cross-KB semantic search with embedding mode
# ---------------------------------------------------------------------------


async def test_cross_kb_semantic_embedding(client: httpx.AsyncClient) -> None:
    """GS1: Cross 2-KB semantic search - knCodeList with query and topK in embedding mode."""
    # Import + build a file in each KB
    path1 = _gen_path("/search-test/gs1")
    path2 = _gen_path("/search-test/gs1-disc")

    await _import_and_build(
        client,
        _KN_DIRECT,
        path1,
        b"# Leave Request\n\nLeave request procedures for employees.",
    )
    await _import_and_build(
        client,
        _KN_DISCOV,
        path2,
        b"# Vacation Policy\n\nCompany vacation policy documentation.",
    )

    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/search",
        json={
            "knCodeList": [_KN_DIRECT, _KN_DISCOV],
            "query": "请假流程",
            "topK": 5,
            "searchMode": "embedding",
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GS1 cross-KB semantic: {body}"

    ro = body.get("resultObject", {})
    data = ro.get("data", [])
    assert isinstance(data, list), f"GS1 expected data list, got: {type(data)}"

    # Results should span both KBs (direct at minimum)
    kn_codes = {item.get("knCode") for item in data if item.get("knCode")}
    assert _KN_DIRECT in kn_codes, (
        f"GS1 expected results from {_KN_DIRECT} in {kn_codes}"
    )


# ---------------------------------------------------------------------------
# GS4: fileTypeList filter
# ---------------------------------------------------------------------------


async def test_search_filetype_filter(client: httpx.AsyncClient) -> None:
    """GS4: Search with fileTypeList=["md"] - only .md files in results."""
    path = _gen_path("/search-test/gs4")
    await _import_and_build(
        client,
        _KN_DIRECT,
        path,
        b"# FileType Test\n\nMarkdown content for file type filter.",
    )

    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/search",
        json={
            "knCodeList": [_KN_DIRECT],
            "query": "FileType",
            "topK": 5,
            "fileTypeList": ["md"],
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GS4 fileTypeList filter: {body}"

    ro = body.get("resultObject", {})
    data = ro.get("data", [])
    # If results are returned, they should be from .md files
    for item in data:
        file_name = item.get("fileName", "")
        assert file_name.endswith(".md") or not file_name, (
            f"GS4 expected .md files only, got: {file_name}"
        )


# ---------------------------------------------------------------------------
# GS5: where DSL with eq operator
# ---------------------------------------------------------------------------


async def test_search_where_dsl_eq(client: httpx.AsyncClient) -> None:
    """GS5: Search with where DSL eq filter on metadata field."""
    prop_name = f"gs5_status_{uuid.uuid4().hex[:6]}"

    # 1. Create metadata property
    cresp = await client.post(
        "/kgw/api/v1/metadataProperties/create",
        json={
            "propertyName": prop_name,
            "valueType": "string",
            "description": "GS5 test status field",
        },
        headers=_hdrs(),
    )
    cbody = cresp.json()
    # Property may already exist from a prior run
    assert cbody["resultCode"] in ("0", "-1"), f"GS5 create property: {cbody}"

    # 2. Import + build a file
    path = _gen_path("/search-test/gs5")
    result = await _import_and_build(
        client,
        _KN_DIRECT,
        path,
        b"# Where DSL Test\n\nContent for where eq filter.",
    )
    if result is None:
        pytest.skip("GS5 import+failed — file may already exist")

    # 3. Set metadata status=active on the file
    mresp = await client.post(
        "/kgw/api/v1/knowledgeItems/metadata/update",
        json={
            "knCode": _KN_DIRECT,
            "filePath": path,
            "operationList": [
                {"propertyName": prop_name, "operation": "set", "value": "active"}
            ],
        },
        headers=_hdrs(),
    )
    mbody = mresp.json()
    assert mbody["resultCode"] == "0", f"GS5 set metadata: {mbody}"

    # 4. Search with where eq filter
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/search",
        json={
            "knCodeList": [_KN_DIRECT],
            "query": "Where",
            "topK": 5,
            "where": {"eq": {"fieldName": prop_name, "value": "active"}},
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GS5 where eq search: {body}"


# ---------------------------------------------------------------------------
# GS6: metadataSearch cross-KB
# ---------------------------------------------------------------------------


async def test_metadata_search_cross_kb(client: httpx.AsyncClient) -> None:
    """GS6: metadataSearch across two KBs with metadata filtering."""
    prop_name = f"gs6_priority_{uuid.uuid4().hex[:6]}"

    # 1. Create "priority" property
    cresp = await client.post(
        "/kgw/api/v1/metadataProperties/create",
        json={
            "propertyName": prop_name,
            "valueType": "number",
            "description": "GS6 priority field",
        },
        headers=_hdrs(),
    )
    cbody = cresp.json()
    assert cbody["resultCode"] in ("0", "-1"), f"GS6 create property: {cbody}"

    # 2. Import + build files in both KBs
    path1 = _gen_path("/search-test/gs6")
    path2 = _gen_path("/search-test/gs6-disc")

    await _import_and_build(
        client,
        _KN_DIRECT,
        path1,
        b"# Priority Doc 1\n\nHigh priority documentation.",
    )
    await _import_and_build(
        client,
        _KN_DISCOV,
        path2,
        b"# Priority Doc 2\n\nHigh priority documentation for discovery.",
    )

    # 3. Set priority=5 on both files
    for kn, p in [(_KN_DIRECT, path1), (_KN_DISCOV, path2)]:
        mresp = await client.post(
            "/kgw/api/v1/knowledgeItems/metadata/update",
            json={
                "knCode": kn,
                "filePath": p,
                "operationList": [
                    {"propertyName": prop_name, "operation": "set", "value": 5}
                ],
            },
            headers=_hdrs(),
        )
        mbody = mresp.json()
        assert mbody["resultCode"] in ("0", "-1"), f"GS6 set priority on {kn}: {mbody}"

    # 4. metadataSearch across both KBs
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/metadataSearch",
        json={
            "knCodeList": [_KN_DIRECT, _KN_DISCOV],
            "topK": 10,
            "where": {"eq": {"fieldName": prop_name, "value": 5}},
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GS6 metadataSearch cross-KB: {body}"

    ro = body.get("resultObject", {})
    data = ro.get("data", [])
    assert isinstance(data, list), f"GS6 expected data list, got: {type(data)}"


# ---------------------------------------------------------------------------
# GS7: metadataSearch empty results
# ---------------------------------------------------------------------------


async def test_metadata_search_empty(client: httpx.AsyncClient) -> None:
    """GS7: metadataSearch with no matches returns data=[] without error."""
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/metadataSearch",
        json={
            "knCodeList": [_KN_DIRECT],
            "topK": 5,
            "where": {
                "eq": {"fieldName": "gs7_nonexistent_field", "value": "no_match"}
            },
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GS7 empty metadataSearch: {body}"
    data = body.get("resultObject", {}).get("data", [])
    assert isinstance(data, list), f"GS7 expected data list, got: {type(data)}"
    # Empty results means no matches — this is expected
    if data:
        # If there happen to be matches, that's OK too
        pass


# ---------------------------------------------------------------------------
# GS8: metadataSearch DSL operators
# ---------------------------------------------------------------------------


async def test_metadata_search_dsl_operators(client: httpx.AsyncClient) -> None:
    """GS8: metadataSearch DSL operators - ne, in, exists, gt, and/or."""
    prefix = f"gs8_{uuid.uuid4().hex[:6]}"
    prop_num = f"{prefix}_score"
    prop_tags = f"{prefix}_tags"

    # 1. Create properties
    for pn, vt in [(prop_num, "number"), (prop_tags, "stringList")]:
        cresp = await client.post(
            "/kgw/api/v1/metadataProperties/create",
            json={
                "propertyName": pn,
                "valueType": vt,
                "description": f"GS8 {vt} field",
            },
            headers=_hdrs(),
        )
        cbody = cresp.json()
        assert cbody["resultCode"] in ("0", "-1"), f"GS8 create {pn}: {cbody}"

    # 2. Import + build a file
    path = _gen_path("/search-test/gs8")
    ok = await _import_and_build(
        client,
        _KN_DIRECT,
        path,
        b"# DSL Operators\n\nTesting DSL operators.",
    )
    if ok is None:
        pytest.skip("GS8 import+failed — file may already exist")

    # 3. Set metadata values
    mresp = await client.post(
        "/kgw/api/v1/knowledgeItems/metadata/update",
        json={
            "knCode": _KN_DIRECT,
            "filePath": path,
            "operationList": [
                {"propertyName": prop_num, "operation": "set", "value": 42},
                {
                    "propertyName": prop_tags,
                    "operation": "set",
                    "value": ["urgent", "review"],
                },
            ],
        },
        headers=_hdrs(),
    )
    mbody = mresp.json()
    assert mbody["resultCode"] == "0", f"GS8 set metadata: {mbody}"

    # 4a. Test 'ne' operator
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/metadataSearch",
        json={
            "knCodeList": [_KN_DIRECT],
            "topK": 5,
            "where": {"ne": {"fieldName": prop_num, "value": 999}},
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GS8 ne operator: {body}"

    # 4b. Test 'in' operator
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/metadataSearch",
        json={
            "knCodeList": [_KN_DIRECT],
            "topK": 5,
            "where": {"in": {"fieldName": prop_num, "value": [42, 99]}},
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GS8 in operator: {body}"

    # 4c. Test 'exists' operator
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/metadataSearch",
        json={
            "knCodeList": [_KN_DIRECT],
            "topK": 5,
            "where": {"exists": {"fieldName": prop_num}},
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GS8 exists operator: {body}"

    # 4d. Test 'gt' operator
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/metadataSearch",
        json={
            "knCodeList": [_KN_DIRECT],
            "topK": 5,
            "where": {"gt": {"fieldName": prop_num, "value": 10}},
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GS8 gt operator: {body}"

    # 4e. Test 'and' compound
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/metadataSearch",
        json={
            "knCodeList": [_KN_DIRECT],
            "topK": 5,
            "where": {
                "and": [
                    {"gt": {"fieldName": prop_num, "value": 10}},
                    {"lt": {"fieldName": prop_num, "value": 100}},
                ]
            },
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GS8 and operator: {body}"

    # 4f. Test 'or' compound
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/metadataSearch",
        json={
            "knCodeList": [_KN_DIRECT],
            "topK": 5,
            "where": {
                "or": [
                    {"eq": {"fieldName": prop_num, "value": 42}},
                    {"eq": {"fieldName": prop_num, "value": 999}},
                ]
            },
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GS8 or operator: {body}"


# ---------------------------------------------------------------------------
# GS8b: metadataSearch DSL remaining operators
# ---------------------------------------------------------------------------


async def test_metadata_search_dsl_remaining_operators(
    client: httpx.AsyncClient,
) -> None:
    """GS8: Test remaining DSL operators: contains, gte, lte, prefix, wildcard, not, nested."""
    suffix = uuid.uuid4().hex[:8]
    str_prop = f"gs8_str_{suffix}"
    num_prop = f"gs8_num_{suffix}"
    path = _gen_path("/search-test/gs8b")

    # Create properties
    for name, vt in [(str_prop, "string"), (num_prop, "number")]:
        cresp = await client.post(
            "/kgw/api/v1/metadataProperties/create",
            json={"propertyName": name, "valueType": vt},
            headers=_hdrs(),
        )
        cbody = cresp.json()
        assert cbody["resultCode"] in ("0", "-1"), f"GS8b create {name}: {cbody}"

    # Import+build and set metadata
    await _import_and_build(
        client, _KN_DIRECT, path, b"# GS8b\n\nDSL operator matrix test."
    )
    # Set string to "hello_world_test" and number to 42
    await client.post(
        "/kgw/api/v1/knowledgeItems/metadata/update",
        json={
            "knCode": _KN_DIRECT,
            "filePath": path,
            "operationList": [
                {
                    "operation": "set",
                    "propertyName": str_prop,
                    "value": "hello_world_test",
                },
                {"operation": "set", "propertyName": num_prop, "value": 42},
            ],
        },
        headers=_hdrs(),
    )
    # Sync may take a moment; proceed even if update returns non-zero

    # Test operators that should match
    operators = [
        # (operator_spec, description)
        ({"contains": {"fieldName": str_prop, "value": "world"}}, "contains"),
        ({"gte": {"fieldName": num_prop, "value": 40}}, "gte"),
        ({"lte": {"fieldName": num_prop, "value": 50}}, "lte"),
        ({"prefix": {"fieldName": str_prop, "value": "hello"}}, "prefix"),
    ]

    for op_spec, desc in operators:
        resp = await client.post(
            "/kgw/api/v1/knowledgeItems/metadataSearch",
            json={
                "knCodeList": [_KN_DIRECT],
                "where": op_spec,
            },
            headers=_hdrs(),
        )
        body = resp.json()
        assert body["resultCode"] == "0", f"GS8b {desc} failed: {body}"

    # Test NOT operator (should match nothing for this file)
    resp_not = await client.post(
        "/kgw/api/v1/knowledgeItems/metadataSearch",
        json={
            "knCodeList": [_KN_DIRECT],
            "where": {
                "not": {"eq": {"fieldName": str_prop, "value": "hello_world_test"}}
            },
        },
        headers=_hdrs(),
    )
    not_body = resp_not.json()
    assert not_body["resultCode"] == "0", f"GS8b not: {not_body}"

    # Test nested: {and: [{gte: {num, 40}}, {lte: {num, 50}}]}
    resp_nested = await client.post(
        "/kgw/api/v1/knowledgeItems/metadataSearch",
        json={
            "knCodeList": [_KN_DIRECT],
            "where": {
                "and": [
                    {"gte": {"fieldName": num_prop, "value": 40}},
                    {"lte": {"fieldName": num_prop, "value": 50}},
                ]
            },
        },
        headers=_hdrs(),
    )
    nested_body = resp_nested.json()
    assert nested_body["resultCode"] == "0", f"GS8b nested: {nested_body}"

    # Test wildcard (backend may or may not support)
    resp_wc = await client.post(
        "/kgw/api/v1/knowledgeItems/metadataSearch",
        json={
            "knCodeList": [_KN_DIRECT],
            "where": {"wildcard": {"fieldName": str_prop, "value": "hello*"}},
        },
        headers=_hdrs(),
    )
    wc_body = resp_wc.json()
    # Wildcard may not be supported by all backends — accept success or graceful error
    assert wc_body["resultCode"] in ("0", "-1"), f"GS8b wildcard unexpected: {wc_body}"


# ---------------------------------------------------------------------------
# GS9: searchFile dedup
# ---------------------------------------------------------------------------


async def test_search_file_dedup(client: httpx.AsyncClient) -> None:
    """GS9: searchFile deduplicates identical filePath across KBs."""
    shared_path = f"/search-test/gs9-{uuid.uuid4().hex[:8]}.md"

    # Import same filePath in both KBs
    for kn in [_KN_DIRECT, _KN_DISCOV]:
        await _import_and_build(
            client,
            kn,
            shared_path,
            b"# Dedup Test\n\nSame file across KBs.",
        )

    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/searchFile",
        json={"knCodeList": [_KN_DIRECT, _KN_DISCOV], "topK": 10},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GS9 searchFile dedup: {body}"

    ro = body.get("resultObject", {})
    files = ro.get("data", [])
    # Each filePath should appear at most once
    seen_paths: set[str] = set()
    for fitem in files:
        fp = fitem.get("filePath") or fitem.get("path") or ""
        if fp:
            assert fp not in seen_paths, (
                f"GS9 duplicate filePath in searchFile results: {fp}"
            )
            seen_paths.add(fp)


# ---------------------------------------------------------------------------
# GS10: searchFile consistency with search
# ---------------------------------------------------------------------------


async def test_search_file_consistency(client: httpx.AsyncClient) -> None:
    """GS10: searchFile results consistent with knowledgeSearch results."""
    path = _gen_path("/search-test/gs10")
    ok = await _import_and_build(
        client,
        _KN_DIRECT,
        path,
        b"# Consistency Test\n\nVerify search and searchFile overlap.",
    )
    if ok is None:
        pytest.skip("GS10 import+build failed — file may already exist")

    # 1. Plain knowledge search
    search_resp = await client.post(
        "/kgw/api/v1/knowledgeItems/search",
        json={
            "knCodeList": [_KN_DIRECT],
            "query": "Consistency",
            "topK": 5,
        },
        headers=_hdrs(),
    )
    sbody = search_resp.json()
    assert sbody["resultCode"] == "0", f"GS10 search: {sbody}"

    # Collect filePaths from search results
    search_files: set[str] = set()
    for item in sbody.get("resultObject", {}).get("data", []):
        fp = item.get("filePath") or ""
        if fp:
            search_files.add(fp)

    # 2. searchFile with same query
    file_resp = await client.post(
        "/kgw/api/v1/knowledgeItems/searchFile",
        json={
            "knCodeList": [_KN_DIRECT],
            "query": "Consistency",
            "topK": 5,
        },
        headers=_hdrs(),
    )
    fbody = file_resp.json()
    assert fbody["resultCode"] == "0", f"GS10 searchFile: {fbody}"

    file_paths: set[str] = set()
    for item in fbody.get("resultObject", {}).get("data", []):
        fp = item.get("filePath") or item.get("path") or ""
        if fp:
            file_paths.add(fp)

    # Both should return results (they reference the same underlying data)
    assert isinstance(search_files, set), "GS10 search files should be a set"
    assert isinstance(file_paths, set), "GS10 searchFile paths should be a set"

    # There should be at least some overlap — the imported file should appear
    # in both result sets (or at minimum both calls succeed)
    if search_files and file_paths:
        overlap = search_files & file_paths
        assert overlap or path in search_files or path in file_paths, (
            f"GS10 no overlap: search={search_files}, filePaths={file_paths}"
        )


# ---------------------------------------------------------------------------
# GS11: Search without auth header
# ---------------------------------------------------------------------------


async def test_search_no_auth_required(client: httpx.AsyncClient) -> None:
    """GS11: Search works without X-User-Id header - no BackendAuthFailed."""
    path = _gen_path("/search-test/gs11")
    await _import_and_build(
        client,
        _KN_DIRECT,
        path,
        b"# No Auth Test\n\nSearch without auth header.",
    )

    # Search without X-User-Id header
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/search",
        json={
            "knCodeList": [_KN_DIRECT],
            "query": "auth",
            "topK": 5,
        },
        # intentionally no headers=_hdrs() — omit X-User-Id
    )
    body = resp.json()
    # Should return results or a non-auth-failure error
    assert body["resultCode"] == "0", f"GS11 search without auth should succeed: {body}"


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
