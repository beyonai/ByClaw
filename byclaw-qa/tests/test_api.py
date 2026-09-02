from __future__ import annotations

import json

import pytest

import api


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/knowledgeItems/import",
        "/api/v1/knowledgeItems/update",
    ],
)
def test_multipart_metadata_includes_header_user_code(path):
    result = api._customize_request_arguments(
        path,
        {"metadata": json.dumps({"category": "guide", "userCode": "spoofed"})},
        "user-1",
    )

    assert json.loads(result["metadata"]) == {
        "category": "guide",
        "userCode": "user-1",
    }


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/directories/create",
        "/api/v1/directories/update",
        "/api/v1/knowledgeItems/move",
    ],
)
def test_json_metadata_includes_header_user_code(path):
    original_body = {
        "metadata": {"category": "guide", "userCode": "spoofed"},
    }

    result = api._customize_request_arguments(path, {"body": original_body}, "user-1")

    assert result["body"]["metadata"] == {
        "category": "guide",
        "userCode": "user-1",
    }
    assert original_body["metadata"]["userCode"] == "spoofed"


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/knowledgeItems/import",
        "/api/v1/knowledgeItems/update",
        "/api/v1/directories/create",
        "/api/v1/directories/update",
        "/api/v1/knowledgeItems/move",
    ],
)
def test_metadata_is_unchanged_without_user_code_header(path):
    arguments = (
        {"metadata": '{"category":"guide"}'}
        if path in api._MULTIPART_METADATA_PATHS
        else {"body": {"metadata": {"category": "guide"}}}
    )

    result = api._customize_request_arguments(path, arguments, "")

    assert result == arguments


@pytest.mark.parametrize("path", ["/api/v1/listDir", "/api/v1/glob"])
def test_metadata_queries_append_user_code_field(path):
    result = api._customize_request_arguments(
        path,
        {"body": {"metadataFieldList": ["category"]}},
        "",
    )

    assert result["body"]["metadataFieldList"] == ["category", "userCode"]


@pytest.mark.parametrize("path", ["/api/v1/listDir", "/api/v1/glob"])
def test_metadata_queries_default_to_user_code_field_without_duplicates(path):
    defaulted = api._customize_request_arguments(path, {"body": {}}, "")
    existing = api._customize_request_arguments(
        path,
        {"body": {"metadataFieldList": ["userCode"]}},
        "",
    )

    assert defaulted["body"]["metadataFieldList"] == ["userCode"]
    assert existing["body"]["metadataFieldList"] == ["userCode"]


def test_invalid_multipart_metadata_is_left_for_upstream_validation():
    result = api._customize_request_arguments(
        "/api/v1/knowledgeItems/import",
        {"metadata": "not-json"},
        "user-1",
    )

    assert result["metadata"] == "not-json"
