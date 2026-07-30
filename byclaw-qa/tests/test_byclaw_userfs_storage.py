"""Tests for ByClaw UserFS knowledge storage provider."""

from __future__ import annotations

import pytest

from by_qa.knowledge_base.infrastructure.storage import (
    StorageAuthenticationError,
    StorageConfigurationError,
    StorageConflictError,
    StorageNotFoundError,
    StorageOperationError,
)


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


# -- Task 3: storage operations ------------------------------------------------

from by_qa.knowledge_base.infrastructure.storage import StorageLocation


class FakeTransport:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    async def __call__(self, *, method, path, headers, json=None, data=None, files=None, params=None):
        self.calls.append(
            {
                "method": method,
                "path": path,
                "headers": headers,
                "json": json,
                "data": data,
                "files": files,
                "params": params,
            }
        )
        return self.responses.pop(0)


def _set_token():
    from byclaw_userfs_storage import set_byclaw_userfs_headers
    return set_byclaw_userfs_headers({"beyond-token": "token-123"})


async def test_write_uploads_multipart_and_returns_stored_object(monkeypatch):
    monkeypatch.setenv("BE_DOMAINNAME", "ByaiService")
    from byclaw_userfs_storage import (
        ByClawUserFsKnowledgeStorageProvider,
        reset_byclaw_userfs_headers,
    )

    transport = FakeTransport([
        {
            "status_code": 200,
            "data": {
                "fileSize": 5,
                "checksum": "abc",
                "contentType": "text/plain",
            },
        }
    ])
    provider = ByClawUserFsKnowledgeStorageProvider(transport=transport)
    token = _set_token()
    try:
        stored = await provider.write(
            StorageLocation("BYCLAW-USER", "/.bykc/KB001/raw/origin/a.txt"),
            b"hello",
            content_type="text/plain",
        )
    finally:
        reset_byclaw_userfs_headers(token)

    assert stored.size == 5
    assert stored.checksum == "abc"
    call = transport.calls[0]
    assert call["method"] == "POST"
    assert call["path"] == "/byaiService/fs/operation/v1/files/put"
    assert call["headers"] == {"system-code": "BYCLAW-QA", "beyond-token": "token-123"}
    assert call["data"] == {
        "spaceType": "USER",
        "path": "/.bykc/KB001/raw/origin/a.txt",
        "contentType": "text/plain",
    }
    assert call["files"]["file"][1] == b"hello"


async def test_read_returns_response_bytes(monkeypatch):
    monkeypatch.setenv("BE_DOMAINNAME", "ByaiService")
    from byclaw_userfs_storage import (
        ByClawUserFsKnowledgeStorageProvider,
        reset_byclaw_userfs_headers,
    )

    transport = FakeTransport([{"status_code": 200, "content": b"hello"}])
    provider = ByClawUserFsKnowledgeStorageProvider(transport=transport)
    token = _set_token()
    try:
        content = await provider.read(StorageLocation("BYCLAW-USER", "/.bykc/KB001/raw/origin/a.txt"))
    finally:
        reset_byclaw_userfs_headers(token)

    assert content == b"hello"
    assert transport.calls[0]["method"] == "GET"
    assert transport.calls[0]["params"] == {
        "spaceType": "USER",
        "path": "/.bykc/KB001/raw/origin/a.txt",
    }


async def test_delete_calls_delete_endpoint(monkeypatch):
    monkeypatch.setenv("BE_DOMAINNAME", "ByaiService")
    from byclaw_userfs_storage import (
        ByClawUserFsKnowledgeStorageProvider,
        reset_byclaw_userfs_headers,
    )

    transport = FakeTransport([{"status_code": 200, "data": {"code": "00000", "data": {"deleted": True}}}])
    provider = ByClawUserFsKnowledgeStorageProvider(transport=transport)
    token = _set_token()
    try:
        await provider.delete(StorageLocation("BYCLAW-USER", "/.bykc/KB001/raw/origin/a.txt"))
    finally:
        reset_byclaw_userfs_headers(token)

    assert transport.calls[0]["path"] == "/byaiService/fs/operation/v1/files/delete"
    assert transport.calls[0]["json"] == {
        "spaceType": "USER",
        "path": "/.bykc/KB001/raw/origin/a.txt",
    }


async def test_move_calls_rename_endpoint_with_overwrite(monkeypatch):
    monkeypatch.setenv("BE_DOMAINNAME", "ByaiService")
    from byclaw_userfs_storage import (
        ByClawUserFsKnowledgeStorageProvider,
        reset_byclaw_userfs_headers,
    )

    transport = FakeTransport([{"status_code": 200, "data": {"code": "00000"}}])
    provider = ByClawUserFsKnowledgeStorageProvider(transport=transport)
    token = _set_token()
    try:
        await provider.move(
            StorageLocation("BYCLAW-USER", "/.bykc/KB001/raw/origin/a.txt"),
            StorageLocation("BYCLAW-USER", "/.bykc/KB001/raw/origin/b.txt"),
            overwrite=True,
        )
    finally:
        reset_byclaw_userfs_headers(token)

    assert transport.calls[0]["json"] == {
        "spaceType": "USER",
        "oldPath": "/.bykc/KB001/raw/origin/a.txt",
        "newPath": "/.bykc/KB001/raw/origin/b.txt",
        "overwrite": True,
    }


async def test_delete_quietly_succeeds(monkeypatch):
    monkeypatch.setenv("BE_DOMAINNAME", "ByaiService")
    from byclaw_userfs_storage import (
        ByClawUserFsKnowledgeStorageProvider,
        reset_byclaw_userfs_headers,
    )

    transport = FakeTransport([{"status_code": 200, "data": {"code": "00000"}}])
    provider = ByClawUserFsKnowledgeStorageProvider(transport=transport)
    token = _set_token()
    try:
        await provider.delete_quietly(StorageLocation("BYCLAW-USER", "/.bykc/KB001/raw/origin/a.txt"))
    finally:
        reset_byclaw_userfs_headers(token)


class ErrorTransport:
    def __init__(self, error):
        self._error = error

    async def __call__(self, **kwargs):
        raise self._error


async def test_delete_quietly_swallows_storage_error(monkeypatch):
    monkeypatch.setenv("BE_DOMAINNAME", "ByaiService")
    from by_qa.knowledge_base.infrastructure.storage import StorageError
    from byclaw_userfs_storage import (
        ByClawUserFsKnowledgeStorageProvider,
        reset_byclaw_userfs_headers,
    )

    transport = ErrorTransport(StorageError("simulated"))
    provider = ByClawUserFsKnowledgeStorageProvider(transport=transport)
    token = _set_token()
    try:
        await provider.delete_quietly(StorageLocation("BYCLAW-USER", "/.bykc/KB001/raw/origin/a.txt"))
    finally:
        reset_byclaw_userfs_headers(token)


def test_normalize_location_sets_namespace_to_byclaw_user():
    from byclaw_userfs_storage import _normalize_location

    result = _normalize_location(StorageLocation("OTHER-NS", "/.bykc/KB001/raw/origin/a.txt"))
    assert result.namespace == "BYCLAW-USER"
    assert result.key == "/.bykc/KB001/raw/origin/a.txt"


def test_normalize_location_preserves_already_correct_namespace():
    from byclaw_userfs_storage import _normalize_location

    original = StorageLocation("BYCLAW-USER", "/.bykc/KB001/raw/origin/a.txt")
    result = _normalize_location(original)
    assert result.namespace == "BYCLAW-USER"
    assert result.key == "/.bykc/KB001/raw/origin/a.txt"


def test_path_from_location_rejects_wrong_namespace():
    from byclaw_userfs_storage import _path_from_location

    with pytest.raises(StorageConfigurationError):
        _path_from_location(StorageLocation("OTHER-NS", "/.bykc/KB001/raw/origin/a.txt"))


async def test_path_from_location_rejects_wrong_prefix():
    from byclaw_userfs_storage import _path_from_location

    with pytest.raises(StorageConfigurationError):
        _path_from_location(StorageLocation("BYCLAW-USER", "/other/a.txt"))


async def test_ensure_ready_requires_be_domainname(monkeypatch):
    monkeypatch.delenv("BE_DOMAINNAME", raising=False)
    from byclaw_userfs_storage import ByClawUserFsKnowledgeStorageProvider

    provider = ByClawUserFsKnowledgeStorageProvider()
    with pytest.raises(StorageConfigurationError):
        await provider.ensure_ready()


async def test_ensure_ready_accepts_be_domainname(monkeypatch):
    monkeypatch.setenv("BE_DOMAINNAME", "ByaiService")
    from byclaw_userfs_storage import ByClawUserFsKnowledgeStorageProvider

    provider = ByClawUserFsKnowledgeStorageProvider()
    await provider.ensure_ready()


# -- Task 5: error translation ---------------------------------------------------


@pytest.mark.parametrize(
    ("status_code", "error_type"),
    [
        (401, StorageAuthenticationError),
        (403, StorageAuthenticationError),
        (404, StorageNotFoundError),
        (409, StorageConflictError),
        (400, StorageOperationError),
        (500, StorageOperationError),
    ],
)
async def test_http_errors_translate_to_storage_errors(monkeypatch, status_code, error_type):
    monkeypatch.setenv("BE_DOMAINNAME", "ByaiService")
    from byclaw_userfs_storage import (
        ByClawUserFsKnowledgeStorageProvider,
        reset_byclaw_userfs_headers,
    )

    transport = FakeTransport([
        {"status_code": status_code, "data": {"code": "ERROR", "msg": "failed"}}
    ])
    provider = ByClawUserFsKnowledgeStorageProvider(transport=transport)
    token = _set_token()
    try:
        with pytest.raises(error_type):
            await provider.read(StorageLocation("BYCLAW-USER", "/.bykc/KB001/raw/origin/a.txt"))
    finally:
        reset_byclaw_userfs_headers(token)


async def test_non_success_business_code_translates_to_operation_error(monkeypatch):
    monkeypatch.setenv("BE_DOMAINNAME", "ByaiService")
    from byclaw_userfs_storage import (
        ByClawUserFsKnowledgeStorageProvider,
        reset_byclaw_userfs_headers,
    )

    transport = FakeTransport([
        {"status_code": 200, "data": {"code": "E0001", "msg": "business failed"}}
    ])
    provider = ByClawUserFsKnowledgeStorageProvider(transport=transport)
    token = _set_token()
    try:
        with pytest.raises(StorageOperationError):
            await provider.delete(StorageLocation("BYCLAW-USER", "/.bykc/KB001/raw/origin/a.txt"))
    finally:
        reset_byclaw_userfs_headers(token)


def test_factory_returns_knowledge_storage_provider():
    from by_qa.knowledge_base.infrastructure.storage import KnowledgeStorageProvider
    from byclaw_knowledge_storage import ByClawKnowledgeStorageProvider
    from byclaw_userfs_storage import build_byclaw_userfs_storage_provider

    provider = build_byclaw_userfs_storage_provider()

    assert isinstance(provider, KnowledgeStorageProvider)
    assert isinstance(provider, ByClawKnowledgeStorageProvider)
    assert provider.provider_name == "byclaw-knowledge-resource"
