from __future__ import annotations

import pytest

from by_qa.knowledge_base.infrastructure.storage import (
    StorageConfigurationError,
    StorageLocation,
)

from byclaw_knowledge_storage import ByClawKnowledgeStorageProvider
from byclaw_userfs_storage import (
    bind_byclaw_resource_id,
    reset_byclaw_userfs_headers,
    set_byclaw_userfs_headers,
)


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


@pytest.mark.asyncio
async def test_write_uses_resource_space_and_resource_owned_path(monkeypatch):
    monkeypatch.setenv("BE_DOMAINNAME", "ByaiService")
    transport = FakeTransport([{"status_code": 200, "data": {"fileSize": 5}}])
    provider = ByClawKnowledgeStorageProvider(transport=transport)
    token = set_byclaw_userfs_headers({"beyond-token": "token-123"})
    try:
        with bind_byclaw_resource_id("10001"):
            await provider.write(
                StorageLocation("BYCLAW-USER", "/.bykc/KB001/raw/origin/a.txt"),
                b"hello",
                content_type="text/plain",
            )
    finally:
        reset_byclaw_userfs_headers(token)

    assert transport.calls[0]["data"] == {
        "spaceType": "RESOURCE",
        "resourceId": "10001",
        "path": "/resource/kg_doc/KG_DOC_10001/.bykc/KB001/raw/origin/a.txt",
        "contentType": "text/plain",
    }


@pytest.mark.asyncio
async def test_read_uses_resource_id_for_permission_and_path(monkeypatch):
    monkeypatch.setenv("BE_DOMAINNAME", "ByaiService")
    transport = FakeTransport([{"status_code": 200, "content": b"hello"}])
    provider = ByClawKnowledgeStorageProvider(transport=transport)
    token = set_byclaw_userfs_headers(
        {
            "beyond-token": "token-123",
            "X-Byclaw-Resource-Id": "10001",
        }
    )
    try:
        content = await provider.read(
            StorageLocation("BYCLAW-USER", "/.bykc/KB001/raw/origin/a.txt")
        )
    finally:
        reset_byclaw_userfs_headers(token)

    assert content == b"hello"
    assert transport.calls[0]["params"] == {
        "spaceType": "RESOURCE",
        "resourceId": "10001",
        "path": "/resource/kg_doc/KG_DOC_10001/.bykc/KB001/raw/origin/a.txt",
    }


@pytest.mark.asyncio
async def test_read_kg_doc_config_uses_resource_config_path(monkeypatch):
    monkeypatch.setenv("BE_DOMAINNAME", "ByaiService")
    transport = FakeTransport(
        [
            {
                "status_code": 200,
                "content": b'{"resourceId":10001,"resourceCode":"KB001"}',
            }
        ]
    )
    provider = ByClawKnowledgeStorageProvider(transport=transport)
    token = set_byclaw_userfs_headers({"beyond-token": "token-123"})
    try:
        config = await provider.read_kg_doc_config("10001")
    finally:
        reset_byclaw_userfs_headers(token)

    assert config["resourceCode"] == "KB001"
    assert transport.calls[0]["params"] == {
        "spaceType": "RESOURCE",
        "resourceId": "10001",
        "path": "/resource/doc/KG_DOC_10001.json",
    }


@pytest.mark.asyncio
async def test_read_kg_doc_config_rejects_resource_id_mismatch(monkeypatch):
    monkeypatch.setenv("BE_DOMAINNAME", "ByaiService")
    transport = FakeTransport(
        [
            {
                "status_code": 200,
                "content": b'{"resourceId":20002,"resourceCode":"KB001"}',
            }
        ]
    )
    provider = ByClawKnowledgeStorageProvider(transport=transport)
    token = set_byclaw_userfs_headers({"beyond-token": "token-123"})
    try:
        with pytest.raises(
            StorageConfigurationError,
            match="resourceId mismatch",
        ):
            await provider.read_kg_doc_config("10001")
    finally:
        reset_byclaw_userfs_headers(token)


@pytest.mark.asyncio
async def test_missing_resource_id_temporarily_falls_back_to_user_space(monkeypatch):
    monkeypatch.setenv("BE_DOMAINNAME", "ByaiService")
    transport = FakeTransport([{"status_code": 200, "content": b"legacy"}])
    provider = ByClawKnowledgeStorageProvider(transport=transport)
    token = set_byclaw_userfs_headers({"beyond-token": "token-123"})
    try:
        content = await provider.read(
            StorageLocation("BYCLAW-USER", "/.bykc/KB001/raw/origin/a.txt")
        )
    finally:
        reset_byclaw_userfs_headers(token)

    assert content == b"legacy"
    assert transport.calls[0]["params"] == {
        "spaceType": "USER",
        "path": "/.bykc/KB001/raw/origin/a.txt",
    }
