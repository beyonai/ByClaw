from __future__ import annotations

import base64
from unittest.mock import AsyncMock, MagicMock

import pytest
from kgw.envelope import METADATA_PROPERTY_NOT_REGISTERED, KBNotFound
from kgw.event_processor import process_event
from kgw.schemas.standard_item import StandardItem


def _make_state(*, kb_ok=True):
    """Build a minimal mock state object."""
    state = MagicMock()
    state.pool = MagicMock()

    kb_config = MagicMock()
    kb_config.domain_url = "http://kb.test"
    kb_config.domain_name = ""
    kb_config.resource_code = "kb_res"
    kb_config.headers = {}
    kb_config.operation_path = MagicMock(return_value=None)

    state.config_provider.get_kb_config = AsyncMock(
        return_value=kb_config if kb_ok else None
    )
    state.auth_provider.resolve_headers = AsyncMock(return_value={})

    cb = MagicMock()
    cb.before_call.return_value = True
    cb.record_success = MagicMock()
    cb.record_failure = MagicMock()
    state.circuit_breakers.get.return_value = cb

    state.audit = MagicMock()
    state.audit.record = MagicMock()
    return state


@pytest.mark.asyncio
async def test_unknown_kn_code_raises():
    state = _make_state(kb_ok=False)
    item = StandardItem.model_validate(
        {
            "sourceId": "s",
            "itemId": "i",
            "version": "v1",
            "op": "upsert",
            "knCode": "bad_kb",
            "filePath": "/a.md",
            "content": "x",
        }
    )
    with pytest.raises(KBNotFound):
        await process_event(state, item, user_code="u1")


@pytest.mark.asyncio
async def test_unregistered_metadata_raises():
    from unittest.mock import patch as _patch

    state = _make_state()
    item = StandardItem.model_validate(
        {
            "sourceId": "s",
            "itemId": "i",
            "version": "v1",
            "op": "upsert",
            "knCode": "k",
            "filePath": "/a.md",
            "content": "hi",
            "metadata": {"unknown_field": "val"},
        }
    )
    with _patch(
        "kgw.event_processor.registry.list_active_properties",
        AsyncMock(return_value=[]),
    ):
        with pytest.raises(METADATA_PROPERTY_NOT_REGISTERED):
            await process_event(state, item, user_code="u1")


@pytest.mark.asyncio
async def test_base64_content_resolved():
    """_resolve_content correctly decodes base64."""
    from kgw.event_processor import _resolve_content

    data = base64.b64encode(b"hello world").decode()
    item = StandardItem.model_validate(
        {
            "sourceId": "s",
            "itemId": "i",
            "op": "upsert",
            "knCode": "k",
            "filePath": "/f.pdf",
            "content": {"encoding": "base64", "data": data},
            "contentType": "application/pdf",
        }
    )
    http_mock = MagicMock()
    content_bytes, ctype = await _resolve_content(http_mock, item)
    assert content_bytes == b"hello world"
    assert ctype == "application/pdf"


@pytest.mark.asyncio
async def test_inline_text_content_resolved():
    from kgw.event_processor import _resolve_content

    item = StandardItem.model_validate(
        {
            "sourceId": "s",
            "itemId": "i",
            "op": "upsert",
            "knCode": "k",
            "filePath": "/a.md",
            "content": "# Hello",
        }
    )
    http_mock = MagicMock()
    content_bytes, ctype = await _resolve_content(http_mock, item)
    assert content_bytes == b"# Hello"
    assert ctype == "text/plain"
