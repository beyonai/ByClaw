from __future__ import annotations

import pytest
from kgw.schemas.standard_item import (
    InlineBase64Content,
    RemoteUrlContent,
    StandardItem,
)
from pydantic import ValidationError


def test_upsert_valid():
    item = StandardItem.model_validate(
        {
            "sourceId": "src1",
            "itemId": "doc1",
            "op": "upsert",
            "knCode": "kb1",
            "filePath": "/a.md",
            "content": "# Hello",
        }
    )
    assert item.op == "upsert"
    assert item.file_path == "/a.md"
    assert item.source_id == "src1"


def test_upsert_requires_content():
    with pytest.raises(ValidationError, match="content is required"):
        StandardItem.model_validate(
            {
                "sourceId": "s",
                "itemId": "i",
                "op": "upsert",
                "knCode": "k",
                "filePath": "/a.md",
            }
        )


def test_delete_no_content_ok():
    item = StandardItem.model_validate(
        {
            "sourceId": "s",
            "itemId": "i",
            "op": "delete",
            "knCode": "k",
            "filePath": "/a.md",
        }
    )
    assert item.content is None


def test_base64_content():
    item = StandardItem.model_validate(
        {
            "sourceId": "s",
            "itemId": "i",
            "op": "upsert",
            "knCode": "k",
            "filePath": "/f.pdf",
            "content": {"encoding": "base64", "data": "SGVsbG8="},
            "contentType": "application/pdf",
        }
    )
    assert isinstance(item.content, InlineBase64Content)
    assert item.content.data == "SGVsbG8="


def test_remote_url_content():
    item = StandardItem.model_validate(
        {
            "sourceId": "s",
            "itemId": "i",
            "op": "upsert",
            "knCode": "k",
            "filePath": "/f.pdf",
            "content": {"url": "https://example.com/doc.pdf"},
        }
    )
    assert isinstance(item.content, RemoteUrlContent)
    assert item.content.url == "https://example.com/doc.pdf"


def test_version_optional():
    item = StandardItem.model_validate(
        {
            "sourceId": "s",
            "itemId": "i",
            "op": "delete",
            "knCode": "k",
            "filePath": "/a.md",
        }
    )
    assert item.version is None


def test_metadata_allowed():
    item = StandardItem.model_validate(
        {
            "sourceId": "s",
            "itemId": "i",
            "op": "upsert",
            "knCode": "k",
            "filePath": "/a.md",
            "content": "hi",
            "metadata": {"status": "active", "tags": ["a", "b"]},
        }
    )
    assert item.metadata == {"status": "active", "tags": ["a", "b"]}
