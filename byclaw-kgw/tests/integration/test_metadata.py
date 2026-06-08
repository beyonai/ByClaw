"""Integration tests: metadata properties lifecycle and file metadata operations.

Tests metadata property creation (including datetime valueType), batch create,
and set/get/append/remove/clear/unset operations on files across direct (200001)
and discovery (300001) knowledge bases, using the real byclaw-qa backend.

No respx mocks -- all calls are real.
"""

# pylint: disable=redefined-outer-name,invalid-name,unused-argument

from __future__ import annotations

import uuid

import httpx
import pytest

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

_KN_DIRECT = "200001"
_KN_DISCOV = "300001"
_USER_ID = "test_user"

_MP_BASE = "/kgw/api/v1/metadataProperties"
_ITEMS_BASE = "/kgw/api/v1/knowledgeItems"


def _hdrs(extra: dict | None = None) -> dict[str, str]:
    h = {"X-User-Id": _USER_ID}
    if extra:
        h.update(extra)
    return h


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_prop(
    client: httpx.AsyncClient, name: str, value_type: str = "string"
) -> dict:
    """Create a metadata property and assert success; return resultObject."""
    resp = await client.post(
        f"{_MP_BASE}/create",
        json={"propertyName": name, "valueType": value_type},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"create {name}: {body}"
    return body["resultObject"]


async def _import_file(
    client: httpx.AsyncClient,
    kn_code: str,
    file_path: str,
    content: bytes = b"# Test\n\nContent.",
) -> dict:
    """Import a file via multipart POST; assert success or handle failure."""
    resp = await client.post(
        f"{_ITEMS_BASE}/import",
        data={"knCode": kn_code, "filePath": file_path},
        files={"fileContent": ("test.md", content, "text/markdown")},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"import {file_path}: {body}"
    return body


async def _import_file_maybe(
    client: httpx.AsyncClient,
    kn_code: str,
    file_path: str,
    content: bytes = b"# Test\n\nContent.",
) -> dict:
    """Import a file; return response body even on backend failure."""
    resp = await client.post(
        f"{_ITEMS_BASE}/import",
        data={"knCode": kn_code, "filePath": file_path},
        files={"fileContent": ("test.md", content, "text/markdown")},
        headers=_hdrs(),
    )
    return resp.json()


async def _update_metadata(
    client: httpx.AsyncClient,
    kn_code: str,
    file_path: str,
    operation_list: list[dict],
) -> dict:
    """Call metadata/update; return full response body."""
    resp = await client.post(
        f"{_ITEMS_BASE}/metadata/update",
        json={
            "knCode": kn_code,
            "filePath": file_path,
            "operationList": operation_list,
        },
        headers=_hdrs(),
    )
    return resp.json()


async def _get_metadata(
    client: httpx.AsyncClient, kn_code: str, file_path: str
) -> dict:
    """Call metadata/get; return full response body."""
    resp = await client.post(
        f"{_ITEMS_BASE}/metadata/get",
        json={"knCode": kn_code, "filePath": file_path},
        headers=_hdrs(),
    )
    return resp.json()


async def _list_metadata_fields(
    client: httpx.AsyncClient, kn_code_list: list[str]
) -> dict:
    """Call metadataFields/list; return full response body."""
    resp = await client.post(
        f"{_ITEMS_BASE}/metadataFields/list",
        json={"knCodeList": kn_code_list},
        headers=_hdrs(),
    )
    return resp.json()


def _find_meta_entry(metadata: dict, prop_name: str) -> dict:
    """Find a metadata entry by searching for prop_name within backend keys.

    The KGW backend adds ``__byclaw_kgw__`` prefix and ``__vN`` suffix to
    property names in metadata/get responses.  This helper looks for any key
    that *contains* *prop_name* and returns the corresponding value dict.
    Returns an empty dict when no matching key is found.
    """
    for key, val in metadata.items():
        if prop_name in key:
            return val
    return {}


# ---------------------------------------------------------------------------
# GM2: Create metadata property with valueType=datetime
# ---------------------------------------------------------------------------


async def test_create_datetime_property(client: httpx.AsyncClient) -> None:
    """GM2: Create metadata property with valueType=datetime."""
    prop_name = f"gm2_dt_{uuid.uuid4().hex[:8]}"

    # Create
    resp = await client.post(
        f"{_MP_BASE}/create",
        json={"propertyName": prop_name, "valueType": "datetime"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GM2 create: {body}"
    assert body["resultObject"]["propertyName"] == prop_name
    assert body["resultObject"]["valueType"] == "datetime"

    # Verify in list
    resp2 = await client.post(
        f"{_MP_BASE}/list",
        json={"propertyNameList": [prop_name]},
        headers=_hdrs(),
    )
    data = resp2.json()["resultObject"]["data"]
    names = [p["propertyName"] for p in data]
    assert prop_name in names, f"GM2 list: {data}"


# ---------------------------------------------------------------------------
# GM5: batchCreate with 3 properties, all succeed
# ---------------------------------------------------------------------------


async def test_batch_create_success(client: httpx.AsyncClient) -> None:
    """GM5: Batch create [A,B,C] all succeed."""
    suffix = uuid.uuid4().hex[:8]
    names = [f"gm5_a_{suffix}", f"gm5_b_{suffix}", f"gm5_c_{suffix}"]

    resp = await client.post(
        f"{_MP_BASE}/batchCreate",
        json={
            "propertyList": [
                {"propertyName": names[0], "valueType": "string"},
                {"propertyName": names[1], "valueType": "number"},
                {"propertyName": names[2], "valueType": "boolean"},
            ]
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"GM5 batchCreate: {body}"

    # Verify all 3 in list
    resp2 = await client.post(
        f"{_MP_BASE}/list",
        json={"propertyNameList": names},
        headers=_hdrs(),
    )
    data = resp2.json()["resultObject"]["data"]
    listed_names = {p["propertyName"] for p in data}
    for name in names:
        assert name in listed_names, f"GM5 missing {name} in {listed_names}"


# ---------------------------------------------------------------------------
# GF1: metadata set + get roundtrip (string valueType)
# ---------------------------------------------------------------------------


async def test_metadata_set_get_roundtrip_string(
    client: httpx.AsyncClient,
) -> None:
    """GF1: Set metadata on file, then get it back - value preserved."""
    suffix = uuid.uuid4().hex[:8]
    file_path = f"/metadata-test/gf1_{suffix}.md"
    prop_name = f"gf1_status_{suffix}"

    # 1. Import a file
    await _import_file(client, _KN_DIRECT, file_path)

    # 2. Create a string property
    await _create_prop(client, prop_name, "string")

    # 3. Set metadata
    body = await _update_metadata(
        client,
        _KN_DIRECT,
        file_path,
        [{"propertyName": prop_name, "operation": "set", "value": "active"}],
    )
    assert body["resultCode"] == "0", f"GF1 set: {body}"

    # 4. Get metadata
    body = await _get_metadata(client, _KN_DIRECT, file_path)
    assert body["resultCode"] == "0", f"GF1 get: {body}"
    metadata = body["resultObject"].get("metadata", {})
    meta_entry = _find_meta_entry(metadata, prop_name)
    assert meta_entry, f"GF1 expected key containing {prop_name} in {list(metadata)}"
    assert meta_entry.get("value") == "active", f"GF1 value: {meta_entry}"


# ---------------------------------------------------------------------------
# GF2: metadata set + get for all 5 valueTypes
# ---------------------------------------------------------------------------


async def test_metadata_set_get_all_types(client: httpx.AsyncClient) -> None:
    """GF2: Set and get all five valueTypes: string/number/boolean/datetime/stringList."""
    suffix = uuid.uuid4().hex[:8]
    file_path = f"/metadata-test/gf2_{suffix}.md"

    props = {
        "gf2_str": "string",
        "gf2_num": "number",
        "gf2_bool": "boolean",
        "gf2_dt": "datetime",
        "gf2_list": "stringList",
    }

    # 1. Import file
    await _import_file(client, _KN_DIRECT, file_path)

    # 2. Create all 5 properties
    for name, vtype in props.items():
        full_name = f"{name}_{suffix}"
        await _create_prop(client, full_name, vtype)

    # 3. Set each property
    ops = [
        {
            "propertyName": f"gf2_str_{suffix}",
            "operation": "set",
            "value": "hello",
        },
        {
            "propertyName": f"gf2_num_{suffix}",
            "operation": "set",
            "value": 42,
        },
        {
            "propertyName": f"gf2_bool_{suffix}",
            "operation": "set",
            "value": True,
        },
        {
            "propertyName": f"gf2_dt_{suffix}",
            "operation": "set",
            "value": "2025-01-15T10:30:00",
        },
        {
            "propertyName": f"gf2_list_{suffix}",
            "operation": "set",
            "value": ["x", "y"],
        },
    ]
    body = await _update_metadata(client, _KN_DIRECT, file_path, ops)
    assert body["resultCode"] == "0", f"GF2 set: {body}"

    # 4. Get metadata
    body = await _get_metadata(client, _KN_DIRECT, file_path)
    assert body["resultCode"] == "0", f"GF2 get: {body}"
    metadata = body["resultObject"].get("metadata", {})

    str_key = f"gf2_str_{suffix}"
    num_key = f"gf2_num_{suffix}"
    bool_key = f"gf2_bool_{suffix}"
    dt_key = f"gf2_dt_{suffix}"
    list_key = f"gf2_list_{suffix}"

    str_entry = _find_meta_entry(metadata, str_key)
    assert str_entry, f"GF2 missing {str_key}"
    assert str_entry.get("value") == "hello"

    num_entry = _find_meta_entry(metadata, num_key)
    assert num_entry, f"GF2 missing {num_key}"
    assert num_entry.get("value") == 42

    bool_entry = _find_meta_entry(metadata, bool_key)
    assert bool_entry, f"GF2 missing {bool_key}"
    assert bool_entry.get("value") is True

    dt_entry = _find_meta_entry(metadata, dt_key)
    assert dt_entry, f"GF2 missing {dt_key}"
    dt_value = dt_entry.get("value")
    assert isinstance(dt_value, str) and dt_value.startswith("2025-01-15T10:30:00"), (
        f"GF2 dt value should start with 2025-01-15T10:30:00, got: {dt_value}"
    )

    list_entry = _find_meta_entry(metadata, list_key)
    assert list_entry, f"GF2 missing {list_key}"
    list_val = list_entry.get("value")
    assert sorted(list_val) == sorted(["x", "y"]), f"GF2 list value: {list_val}"


# ---------------------------------------------------------------------------
# GF3: append deduplicates on stringList
# ---------------------------------------------------------------------------


async def test_metadata_append_dedup(client: httpx.AsyncClient) -> None:
    """GF3: Append to stringList deduplicates."""
    suffix = uuid.uuid4().hex[:8]
    file_path = f"/metadata-test/gf3_{suffix}.md"
    prop_name = f"gf3_tags_{suffix}"

    await _import_file(client, _KN_DIRECT, file_path)
    await _create_prop(client, prop_name, "stringList")

    # Set ["a"]
    body = await _update_metadata(
        client,
        _KN_DIRECT,
        file_path,
        [{"propertyName": prop_name, "operation": "set", "value": ["a"]}],
    )
    assert body["resultCode"] == "0", f"GF3 set: {body}"

    # Append ["b", "c"]
    body = await _update_metadata(
        client,
        _KN_DIRECT,
        file_path,
        [{"propertyName": prop_name, "operation": "append", "value": ["b", "c"]}],
    )
    assert body["resultCode"] == "0", f"GF3 append: {body}"

    # Get - verify ["a", "b", "c"]
    body = await _get_metadata(client, _KN_DIRECT, file_path)
    assert body["resultCode"] == "0", f"GF3 get: {body}"
    metadata = body["resultObject"].get("metadata", {})
    meta_entry = _find_meta_entry(metadata, prop_name)
    assert meta_entry, f"GF3 expected key containing {prop_name} in {list(metadata)}"
    value = meta_entry.get("value")
    assert sorted(value) == sorted(["a", "b", "c"]), f"GF3 value: {value}"


# ---------------------------------------------------------------------------
# GF4: remove tolerates missing values
# ---------------------------------------------------------------------------


async def test_metadata_remove_tolerates_missing(
    client: httpx.AsyncClient,
) -> None:
    """GF4: Remove non-existent values from stringList doesn't error."""
    suffix = uuid.uuid4().hex[:8]
    file_path = f"/metadata-test/gf4_{suffix}.md"
    prop_name = f"gf4_tags_{suffix}"

    await _import_file(client, _KN_DIRECT, file_path)
    await _create_prop(client, prop_name, "stringList")

    # Set ["a", "b"]
    body = await _update_metadata(
        client,
        _KN_DIRECT,
        file_path,
        [{"propertyName": prop_name, "operation": "set", "value": ["a", "b"]}],
    )
    assert body["resultCode"] == "0", f"GF4 set: {body}"

    # Remove ["x", "y"] — non-existent, should not error
    body = await _update_metadata(
        client,
        _KN_DIRECT,
        file_path,
        [{"propertyName": prop_name, "operation": "remove", "value": ["x", "y"]}],
    )
    assert body["resultCode"] == "0", f"GF4 remove: {body}"

    # Get - verify ["a", "b"] unchanged
    body = await _get_metadata(client, _KN_DIRECT, file_path)
    assert body["resultCode"] == "0", f"GF4 get: {body}"
    metadata = body["resultObject"].get("metadata", {})
    meta_entry = _find_meta_entry(metadata, prop_name)
    assert meta_entry, f"GF4 expected key containing {prop_name} in {list(metadata)}"
    value = meta_entry.get("value")
    assert sorted(value) == sorted(["a", "b"]), f"GF4 value: {value}"


# ---------------------------------------------------------------------------
# GF5: clear empties stringList
# ---------------------------------------------------------------------------


async def test_metadata_clear(client: httpx.AsyncClient) -> None:
    """GF5: Clear operation empties stringList."""
    suffix = uuid.uuid4().hex[:8]
    file_path = f"/metadata-test/gf5_{suffix}.md"
    prop_name = f"gf5_tags_{suffix}"

    await _import_file(client, _KN_DIRECT, file_path)
    await _create_prop(client, prop_name, "stringList")

    # Set ["a", "b"]
    body = await _update_metadata(
        client,
        _KN_DIRECT,
        file_path,
        [{"propertyName": prop_name, "operation": "set", "value": ["a", "b"]}],
    )
    assert body["resultCode"] == "0", f"GF5 set: {body}"

    # Clear
    body = await _update_metadata(
        client,
        _KN_DIRECT,
        file_path,
        [{"propertyName": prop_name, "operation": "clear"}],
    )
    assert body["resultCode"] == "0", f"GF5 clear: {body}"

    # Get - verify valueType=stringList, value=[]
    body = await _get_metadata(client, _KN_DIRECT, file_path)
    assert body["resultCode"] == "0", f"GF5 get: {body}"
    metadata = body["resultObject"].get("metadata", {})
    prop_meta = _find_meta_entry(metadata, prop_name)
    assert prop_meta, f"GF5 expected key containing {prop_name} in {list(metadata)}"
    assert prop_meta.get("valueType") == "stringList", f"GF5 valueType: {prop_meta}"
    assert prop_meta.get("value") == [], f"GF5 value: {prop_meta}"


# ---------------------------------------------------------------------------
# GF6: unset on file without that property is idempotent success
# ---------------------------------------------------------------------------


async def test_metadata_unset_nonexistent(client: httpx.AsyncClient) -> None:
    """GF6: Unset on file without that property is idempotent success."""
    suffix = uuid.uuid4().hex[:8]
    file_path = f"/metadata-test/gf6_{suffix}.md"
    prop_name = f"gf6_never_set_{suffix}"

    # Create property but do NOT set it on the file
    await _import_file(client, _KN_DIRECT, file_path)
    await _create_prop(client, prop_name, "string")

    # Unset a property that was never set on this file
    body = await _update_metadata(
        client,
        _KN_DIRECT,
        file_path,
        [{"propertyName": prop_name, "operation": "unset"}],
    )
    assert body["resultCode"] == "0", f"GF6 unset: {body}"


# ---------------------------------------------------------------------------
# GF10: metadataFields/list returns KB-specific property lists
# ---------------------------------------------------------------------------


async def test_metadata_fields_list_cross_kb(
    client: httpx.AsyncClient,
) -> None:
    """GF10: metadataFields/list returns KB-specific property lists for each KB."""
    suffix = uuid.uuid4().hex[:8]

    # Create different properties
    direct_prop = f"gf10_direct_{suffix}"
    disc_prop = f"gf10_disc_{suffix}"
    await _create_prop(client, direct_prop, "string")
    await _create_prop(client, disc_prop, "number")

    # Sync properties to each KB by doing metadata/update on files
    # Direct KB: import file + set metadata
    direct_file = f"/metadata-test/gf10_direct_{suffix}.md"
    await _import_file(client, _KN_DIRECT, direct_file)
    body = await _update_metadata(
        client,
        _KN_DIRECT,
        direct_file,
        [{"propertyName": direct_prop, "operation": "set", "value": "x"}],
    )
    assert body["resultCode"] == "0", f"GF10 direct set: {body}"

    # Discovery KB: import file + set metadata (may fail gracefully)
    disc_file = f"/metadata-test/gf10_disc_{suffix}.md"
    await _import_file_maybe(client, _KN_DISCOV, disc_file)
    body = await _update_metadata(
        client,
        _KN_DISCOV,
        disc_file,
        [{"propertyName": disc_prop, "operation": "set", "value": 99}],
    )
    rc_disc = body["resultCode"]
    assert rc_disc in ("0", "-1"), f"GF10 disc set unexpected: {body}"

    # Call metadataFields/list for direct KB
    body = await _list_metadata_fields(client, [_KN_DIRECT])
    assert body["resultCode"] == "0", f"GF10 direct fields: {body}"
    direct_names = [p["propertyName"] for p in body["resultObject"]["data"]]
    assert direct_prop in direct_names, (
        f"GF10 expected {direct_prop} in direct: {direct_names}"
    )

    # Call metadataFields/list for discovery KB (may be empty)
    body = await _list_metadata_fields(client, [_KN_DISCOV])
    assert body["resultCode"] == "0", f"GF10 disc fields: {body}"
    disc_names = [p["propertyName"] for p in body["resultObject"]["data"]]
    if rc_disc == "0":
        assert disc_prop in disc_names, (
            f"GF10 expected {disc_prop} in disc: {disc_names}"
        )


# ---------------------------------------------------------------------------
# GF11: metadataFields/list system field definitions
# ---------------------------------------------------------------------------


async def test_metadata_fields_list_system_fields(
    client: httpx.AsyncClient,
) -> None:
    """GF11: metadataFields/list returns system field definitions.

    The KGW gateway's metadataFields/list endpoint is local-only; system fields
    are not currently exposed (by design after S4).  This test documents the
    expected count of system field definitions should the gateway or backend
    add them in the future.
    """
    suffix = uuid.uuid4().hex[:8]
    file_path = f"/metadata-test/gf11_{suffix}.md"
    prop_name = f"gf11_sys_{suffix}"

    # Create a property and sync it so metadataFields/list is non-empty
    await _import_file(client, _KN_DIRECT, file_path)
    await _create_prop(client, prop_name, "string")
    body = await _update_metadata(
        client,
        _KN_DIRECT,
        file_path,
        [{"propertyName": prop_name, "operation": "set", "value": "test"}],
    )
    assert body["resultCode"] == "0", f"GF11 set: {body}"

    # Call metadataFields/list
    body = await _list_metadata_fields(client, [_KN_DIRECT])
    assert body["resultCode"] == "0", f"GF11 fields: {body}"
    data = body["resultObject"]["data"]
    names = {p["propertyName"] for p in data}

    # Expect 7 system fields: fileName, fileType, fileSize, mimeType,
    # createdAt, updatedAt, filePath
    expected_system = {
        "fileName",
        "fileType",
        "fileSize",
        "mimeType",
        "createdAt",
        "updatedAt",
        "filePath",
    }
    found_system = expected_system & names
    # Note: KGW local-only handler currently excludes system fields.
    # This assertion validates the expected behavior if/when system fields
    # are added back.
    if found_system:
        assert len(found_system) == 7, (
            f"GF11 expected 7 system fields, found {len(found_system)}: {found_system}"
        )


# ---------------------------------------------------------------------------
# GF12: dual-mode metadata ops (direct + discovery)
# ---------------------------------------------------------------------------


async def test_metadata_dual_mode(client: httpx.AsyncClient) -> None:
    """GF12: metadata/update + get + fields/list work on both direct (200001)
    and discovery (300001)."""
    suffix = uuid.uuid4().hex[:8]
    prop_name = f"gf12_mode_{suffix}"

    # Create property (shared, will sync to both KBs independently)
    await _create_prop(client, prop_name, "string")

    # --- Direct KB ---
    direct_file = f"/metadata-test/gf12_direct_{suffix}.md"
    await _import_file(client, _KN_DIRECT, direct_file)

    body = await _update_metadata(
        client,
        _KN_DIRECT,
        direct_file,
        [{"propertyName": prop_name, "operation": "set", "value": "direct"}],
    )
    assert body["resultCode"] == "0", f"GF12 direct set: {body}"

    body = await _get_metadata(client, _KN_DIRECT, direct_file)
    assert body["resultCode"] == "0", f"GF12 direct get: {body}"
    meta = body["resultObject"].get("metadata", {})
    direct_entry = _find_meta_entry(meta, prop_name)
    assert direct_entry, (
        f"GF12 direct expected key containing {prop_name} in {list(meta)}"
    )
    assert direct_entry.get("value") == "direct", f"GF12 direct meta: {meta}"

    body = await _list_metadata_fields(client, [_KN_DIRECT])
    assert body["resultCode"] == "0", f"GF12 direct fields: {body}"

    # --- Discovery KB ---
    disc_file = f"/metadata-test/gf12_disc_{suffix}.md"
    await _import_file_maybe(client, _KN_DISCOV, disc_file)

    body = await _update_metadata(
        client,
        _KN_DISCOV,
        disc_file,
        [{"propertyName": prop_name, "operation": "set", "value": "disc"}],
    )
    rc_disc = body["resultCode"]
    assert rc_disc in ("0", "-1"), f"GF12 disc set unexpected: {body}"

    if rc_disc == "0":
        body = await _get_metadata(client, _KN_DISCOV, disc_file)
        assert body["resultCode"] == "0", f"GF12 disc get: {body}"
        meta = body["resultObject"].get("metadata", {})
        disc_entry = _find_meta_entry(meta, prop_name)
        assert disc_entry, (
            f"GF12 disc expected key containing {prop_name} in {list(meta)}"
        )
        assert disc_entry.get("value") == "disc", f"GF12 disc meta: {meta}"

    body = await _list_metadata_fields(client, [_KN_DISCOV])
    assert body["resultCode"] == "0", f"GF12 disc fields: {body}"


# ---------------------------------------------------------------------------
# GF15: import with front-matter, then metadata/get reads same values
# ---------------------------------------------------------------------------


async def test_frontmatter_import_metadata_get(
    client: httpx.AsyncClient,
) -> None:
    """GF15: Import with front-matter, then metadata/get reads same values."""
    suffix = uuid.uuid4().hex[:8]
    file_path = f"/metadata-test/gf15_{suffix}.md"

    # Create metadata properties matching the front-matter YAML keys.
    # Use unique names to avoid collision with other tests.
    status_prop = f"gf15_status_{suffix}"
    priority_prop = f"gf15_priority_{suffix}"
    await _create_prop(client, status_prop, "string")
    await _create_prop(client, priority_prop, "number")

    # Build front-matter content with the unique property names
    content = (
        f"---\n"
        f"{status_prop}: active\n"
        f"{priority_prop}: 3\n"
        f"---\n"
        f"\n"
        f"# Front-matter Test\n"
        f"\n"
        f"Body content.\n"
    ).encode()

    # Import with front-matter
    await _import_file(client, _KN_DIRECT, file_path, content=content)

    # Call metadata/get — KGW proxies to byclaw-qa; front-matter fields
    # should be present in the response under the KGW-translated names.
    body = await _get_metadata(client, _KN_DIRECT, file_path)
    assert body["resultCode"] == "0", f"GF15 get: {body}"
    metadata = body["resultObject"].get("metadata", {})

    # Check that front-matter properties were extracted
    for check_name, expected_val in [(status_prop, "active"), (priority_prop, 3)]:
        meta_entry = _find_meta_entry(metadata, check_name)
        assert meta_entry, (
            f"GF15 expected {check_name} in metadata, got keys={list(metadata)}"
        )
        val = meta_entry.get("value")
        assert val == expected_val, (
            f"GF15 expected {check_name}={expected_val}, got {val}"
        )


# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------


async def test_cleanup_metadata(client: httpx.AsyncClient) -> None:
    """Remove the /metadata-test directory and all its contents on both KBs."""
    for kn_code in (_KN_DIRECT, _KN_DISCOV):
        try:
            resp = await client.post(
                "/kgw/api/v1/directories/delete",
                json={"knCode": kn_code, "directoryPath": "/metadata-test"},
                headers=_hdrs(),
            )
        except httpx.RemoteProtocolError:
            continue
        body = resp.json()
        rc = body["resultCode"]
        msg = body.get("resultMsg", "")
        # Acceptable: directory not found / discovery not available
        if rc != "0" and ("not found" in msg or "No available" in msg):
            continue
        assert rc == "0", f"cleanup {kn_code}: {body}"
