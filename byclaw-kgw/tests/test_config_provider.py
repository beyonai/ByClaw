"""Tests for KbConfigProvider.

Unit tests mock the S3 HTTP layer via unittest.mock patching _client().
aioboto3 uses botocore/aiohttp under the hood, not httpx, so respx cannot
intercept its calls. Integration tests (marked ``@pytest.mark.integration``)
hit a real MinIO instance via fixtures in conftest.py.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def _kg_doc_payload() -> dict:
    return {
        "resourceCode": "hr_policy",
        "domainName": "HR 政策制度库",
        "domainURL": "http://kb-hr.internal:8080",
        "headers": {"Authorization": "${Authorization}"},
        "resourceService": [
            {"name": "knowledgeSearch", "path": "/api/v1/knowledgeItems/search"},
            {"name": "fileImport", "path": "/api/v1/knowledgeItems/import"},
        ],
    }


def _make_provider(**overrides):
    from kgw.config_provider import KbConfigProvider

    defaults = {
        "endpoint_url": "http://minio.test:9000",
        "access_key": "ak",
        "secret_key": "sk",
        "bucket": "byclaw",
        "prefix": "resource/doc/KG_DOC_",
    }
    defaults.update(overrides)
    return KbConfigProvider(**defaults)


def _make_mock_s3(body: bytes):
    """Return a mock async context manager yielding an s3 client stub."""
    mock_response = {"Body": AsyncMock(read=AsyncMock(return_value=body))}
    mock_s3 = AsyncMock()
    mock_s3.get_object = AsyncMock(return_value=mock_response)
    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_s3)
    mock_cm.__aexit__ = AsyncMock(return_value=None)
    return mock_cm, mock_s3


def _make_nosuchkey_error():
    """Return a ClientError that looks like S3 NoSuchKey."""
    from botocore.exceptions import ClientError

    return ClientError(
        {
            "Error": {
                "Code": "NoSuchKey",
                "Message": "The specified key does not exist.",
            }
        },
        "GetObject",
    )


async def test_get_kb_config_returns_parsed_payload():
    body = json.dumps(_kg_doc_payload()).encode()
    mock_cm, _ = _make_mock_s3(body)

    provider = _make_provider()
    with patch.object(provider, "_client", return_value=mock_cm):
        config = await provider.get_kb_config("hr_policy")

    assert config is not None
    assert config.kn_code == "hr_policy"
    assert config.resource_code == "hr_policy"  # matches resourceCode in payload
    assert config.domain_url == "http://kb-hr.internal:8080"
    assert config.domain_name == "HR 政策制度库"
    assert config.headers == {"Authorization": "${Authorization}"}
    assert config.operations == {"knowledgeSearch", "fileImport"}
    assert config.operation_path("knowledgeSearch") == "/api/v1/knowledgeItems/search"
    assert config.raw == _kg_doc_payload()


async def test_get_kb_config_returns_none_for_missing():
    error = _make_nosuchkey_error()
    mock_s3 = AsyncMock()
    mock_s3.get_object = AsyncMock(side_effect=error)
    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_s3)
    mock_cm.__aexit__ = AsyncMock(return_value=None)

    provider = _make_provider()
    with patch.object(provider, "_client", return_value=mock_cm):
        config = await provider.get_kb_config("ghost")

    assert config is None


async def test_get_kb_config_no_caching():
    """Each call reads MinIO independently (no caching per v5 spec §3.3)."""
    payload_v1 = {**_kg_doc_payload(), "domainURL": "http://v1.internal"}
    payload_v2 = {**_kg_doc_payload(), "domainURL": "http://v2.internal"}

    call_count = 0

    def make_response(*_args, **_kwargs):
        nonlocal call_count
        call_count += 1
        payload = payload_v1 if call_count == 1 else payload_v2
        body = json.dumps(payload).encode()
        return {"Body": AsyncMock(read=AsyncMock(return_value=body))}

    mock_s3 = AsyncMock()
    mock_s3.get_object = AsyncMock(side_effect=make_response)
    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_s3)
    mock_cm.__aexit__ = AsyncMock(return_value=None)

    provider = _make_provider()
    with patch.object(provider, "_client", return_value=mock_cm):
        c1 = await provider.get_kb_config("dynamic")
        c2 = await provider.get_kb_config("dynamic")

    assert c1 is not None
    assert c2 is not None
    assert c1.domain_url == "http://v1.internal"
    assert c2.domain_url == "http://v2.internal"
    assert call_count == 2


def test_parse_kb_config_operations_only_payload():
    """Portal sometimes sends operations list instead of resourceService."""
    from kgw.config_provider import _parse_kb_config

    payload = {
        "domainURL": "http://kb.internal",
        "headers": {},
        "operations": ["knowledgeSearch", "fileImport"],
    }
    config = _parse_kb_config("test_kb", payload)
    assert config.operations == {"knowledgeSearch", "fileImport"}
    assert config.operation_path("knowledgeSearch") == ""


@pytest.mark.integration
async def test_get_kb_config_integration(minio_settings: dict, minio_bucket: str):
    """Integration test: seed MinIO and verify round-trip."""
    import aioboto3

    payload = _kg_doc_payload()
    session = aioboto3.Session()
    async with session.client(
        "s3",
        endpoint_url=minio_settings["endpoint_url"],
        aws_access_key_id=minio_settings["access_key"],
        aws_secret_access_key=minio_settings["secret_key"],
    ) as s3:
        await s3.put_object(
            Bucket=minio_bucket,
            Key="resource/doc/KG_DOC_hr_policy.json",
            Body=json.dumps(payload).encode(),
            ContentType="application/json",
        )

    from kgw.config_provider import KbConfigProvider

    provider = KbConfigProvider(
        endpoint_url=minio_settings["endpoint_url"],
        access_key=minio_settings["access_key"],
        secret_key=minio_settings["secret_key"],
        bucket=minio_bucket,
        prefix="resource/doc/KG_DOC_",
    )
    config = await provider.get_kb_config("hr_policy")
    assert config is not None
    assert config.domain_url == "http://kb-hr.internal:8080"
