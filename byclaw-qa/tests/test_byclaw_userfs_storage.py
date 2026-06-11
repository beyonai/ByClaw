"""Tests for ByClaw UserFS knowledge storage provider."""

from __future__ import annotations

import pytest

from by_qa.knowledge_base.infrastructure.storage import StorageConfigurationError


def test_build_original_location_uses_byclaw_user_namespace_and_origin_path():
    from byclaw_userfs_storage import ByClawUserFsKnowledgeStorageProvider

    provider = ByClawUserFsKnowledgeStorageProvider()

    location = provider.build_original_location(
        kb_code="KB001",
        knowledge_base_id=12,
        fs_entry_id=34,
        file_path="/产品文档/用户手册.pdf",
        mime_type="application/pdf",
    )

    assert location.namespace == "BYCLAW-USER"
    assert location.key == "/.bykc/KB001/raw/origin/产品文档/用户手册.pdf"


def test_build_markdown_location_uses_markdown_path_with_md_suffix():
    from byclaw_userfs_storage import ByClawUserFsKnowledgeStorageProvider

    provider = ByClawUserFsKnowledgeStorageProvider()

    location = provider.build_markdown_location(
        kb_code="KB001",
        knowledge_base_id=12,
        fs_entry_id=34,
        file_path="/产品文档/用户手册.pdf",
    )

    assert location.namespace == "BYCLAW-USER"
    assert location.key == "/.bykc/KB001/raw/markdown/产品文档/用户手册.pdf.md"


@pytest.mark.parametrize("file_path", ["", "/", "/../secret.txt", "/a/../b.txt"])
def test_location_rejects_invalid_db_paths(file_path):
    from byclaw_userfs_storage import ByClawUserFsKnowledgeStorageProvider

    provider = ByClawUserFsKnowledgeStorageProvider()

    with pytest.raises(StorageConfigurationError):
        provider.build_original_location(
            kb_code="KB001",
            knowledge_base_id=12,
            fs_entry_id=34,
            file_path=file_path,
            mime_type="text/plain",
        )


def test_location_rejects_empty_kb_code():
    from byclaw_userfs_storage import ByClawUserFsKnowledgeStorageProvider

    provider = ByClawUserFsKnowledgeStorageProvider()

    with pytest.raises(StorageConfigurationError):
        provider.build_markdown_location(
            kb_code="",
            knowledge_base_id=12,
            fs_entry_id=34,
            file_path="/a.txt",
        )


# -- Task 2: request header context -------------------------------------------

def test_build_headers_forwards_beyond_token_and_system_code():
    from byclaw_userfs_storage import (
        build_byclaw_userfs_headers,
        reset_byclaw_userfs_headers,
        set_byclaw_userfs_headers,
    )

    token = set_byclaw_userfs_headers({"beyond-token": "token-123"})
    try:
        assert build_byclaw_userfs_headers() == {
            "system-code": "BYCLAW-QA",
            "beyond-token": "token-123",
        }
    finally:
        reset_byclaw_userfs_headers(token)


def test_build_headers_accepts_case_insensitive_request_header():
    from byclaw_userfs_storage import (
        build_byclaw_userfs_headers,
        reset_byclaw_userfs_headers,
        set_byclaw_userfs_headers,
    )

    token = set_byclaw_userfs_headers({"Beyond-Token": "token-123"})
    try:
        assert build_byclaw_userfs_headers()["beyond-token"] == "token-123"
    finally:
        reset_byclaw_userfs_headers(token)


def test_build_headers_requires_beyond_token():
    from byclaw_userfs_storage import (
        build_byclaw_userfs_headers,
        reset_byclaw_userfs_headers,
        set_byclaw_userfs_headers,
    )

    from by_qa.knowledge_base.infrastructure.storage import StorageAuthenticationError

    token = set_byclaw_userfs_headers({})
    try:
        with pytest.raises(StorageAuthenticationError):
            build_byclaw_userfs_headers()
    finally:
        reset_byclaw_userfs_headers(token)
