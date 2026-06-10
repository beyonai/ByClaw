"""Tests for KbConfigProvider.

Unit tests use the ``fake_redis`` fixture (in-memory FakeRedis) so no
external services are needed.  Integration tests (marked
``@pytest.mark.integration``) hit a real Redis instance via the
``redis_url`` fixture from conftest.py.
"""

from __future__ import annotations

import json

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


def _make_provider(redis_client):
    from kgw.config_provider import KbConfigProvider

    return KbConfigProvider(redis_client=redis_client)


async def test_get_kb_config_returns_parsed_payload(fake_redis):
    payload = _kg_doc_payload()
    await fake_redis.set("KG_DOC_hr_policy", json.dumps(payload))

    provider = _make_provider(fake_redis)
    config = await provider.get_kb_config("hr_policy")

    assert config is not None
    assert config.kn_code == "hr_policy"
    assert config.resource_code == "hr_policy"  # matches resourceCode in payload
    assert config.domain_url == "http://kb-hr.internal:8080"
    assert config.domain_name == "HR 政策制度库"
    assert config.headers == {"Authorization": "${Authorization}"}
    assert config.operations == {"knowledgeSearch", "fileImport"}
    assert config.operation_path("knowledgeSearch") == "/api/v1/knowledgeItems/search"
    assert config.raw == payload


async def test_get_kb_config_returns_none_for_missing(fake_redis):
    provider = _make_provider(fake_redis)
    config = await provider.get_kb_config("ghost")
    assert config is None


async def test_get_kb_config_no_caching(fake_redis):
    """Each call reads Redis independently (no caching per v5 spec §3.3)."""
    await fake_redis.set(
        "KG_DOC_dynamic",
        json.dumps({**_kg_doc_payload(), "domainURL": "http://v1.internal"}),
    )

    provider = _make_provider(fake_redis)
    c1 = await provider.get_kb_config("dynamic")
    assert c1 is not None
    assert c1.domain_url == "http://v1.internal"

    # Update the key — next read must see the new value.
    await fake_redis.set(
        "KG_DOC_dynamic",
        json.dumps({**_kg_doc_payload(), "domainURL": "http://v2.internal"}),
    )
    c2 = await provider.get_kb_config("dynamic")
    assert c2 is not None
    assert c2.domain_url == "http://v2.internal"


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
async def test_get_kb_config_integration(redis_url: str):
    """Integration test: seed Redis and verify round-trip."""
    import redis.asyncio as redis_async

    payload = _kg_doc_payload()
    r = redis_async.from_url(redis_url, decode_responses=False)
    try:
        await r.set("KG_DOC_hr_policy", json.dumps(payload))

        from kgw.config_provider import KbConfigProvider

        provider = KbConfigProvider(redis_client=r)
        config = await provider.get_kb_config("hr_policy")
        assert config is not None
        assert config.domain_url == "http://kb-hr.internal:8080"
    finally:
        await r.delete("KG_DOC_hr_policy")
        await r.aclose()
