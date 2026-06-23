from __future__ import annotations

import base64
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock
from unittest.mock import patch as _patch

import httpx
import pytest
from kgw.envelope import METADATA_PROPERTY_NOT_REGISTERED, KBNotFound
from kgw.event_processor import _process_upsert, process_event
from kgw.metadata.registry import MetadataProperty
from kgw.schemas.standard_item import StandardItem


class _AsyncCtx:
    def __init__(self, value=None):
        self.value = value if value is not None else self

    async def __aenter__(self):
        return self.value

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _FakeConn:
    def transaction(self):
        return _AsyncCtx()


class _FakePool:
    def connection(self):
        return _AsyncCtx(_FakeConn())


def _make_state(*, kb_ok=True):
    """Build a minimal mock state object."""
    state = MagicMock()
    state.pool = _FakePool()

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


def _metadata_property(*, property_id: int = 101) -> MetadataProperty:
    return MetadataProperty(
        property_id=property_id,
        property_name="ingest_field",
        backend_name="__byclaw_kgw__ingest_field__v101",
        value_type="string",
        description=None,
        ext_params=None,
        status="ACTIVE",
    )


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


@pytest.mark.asyncio
async def test_upsert_metadata_failure_keeps_existing_bound_binding():
    """Failed repeat ingest metadata writes must not roll back existing BOUND rows."""
    state = _make_state()
    state.http.post = AsyncMock(
        return_value=httpx.Response(200, json={"resultCode": "0"})
    )
    item = StandardItem.model_validate(
        {
            "sourceId": "s",
            "itemId": "i",
            "op": "upsert",
            "knCode": "k",
            "filePath": "/a.pdf",
            "content": "file body",
            "metadata": {"ingest_field": "value"},
        }
    )
    prop = _metadata_property()
    delete_created = AsyncMock()

    with (
        _patch(
            "kgw.event_processor.resolve_base_url",
            AsyncMock(return_value="http://kb.test"),
        ),
        _patch(
            "kgw.event_processor.registry.list_active_properties",
            AsyncMock(return_value=[prop]),
        ),
        _patch("kgw.event_processor.sync_mod.ensure_synced", AsyncMock()),
        _patch(
            "kgw.event_processor.binding_mod.bind_usage", AsyncMock(return_value=False)
        ) as bind_usage,
        _patch(
            "kgw.event_processor.call_backend_json",
            AsyncMock(return_value={"resultCode": "-1", "resultMsg": "backend failed"}),
        ),
        _patch(
            "kgw.event_processor.idempotency.mark_failed", AsyncMock()
        ) as mark_failed,
        _patch("kgw.event_processor._audit", AsyncMock()),
        _patch(
            "kgw.event_processor._delete_created_bindings", delete_created, create=True
        ),
    ):
        await _process_upsert(
            state,
            item,
            event_id=42,
            config=state.config_provider.get_kb_config.return_value,
            user_code="u1",
            trace_id=None,
        )

    bind_usage.assert_awaited_once()
    delete_created.assert_awaited_once_with(state.pool, [])
    mark_failed.assert_awaited_once()


@pytest.mark.asyncio
async def test_upsert_metadata_failure_rolls_back_created_binding_marker():
    """Failed ingest metadata writes roll back only rows created by this request."""
    state = _make_state()
    state.http.post = AsyncMock(
        return_value=httpx.Response(200, json={"resultCode": "0"})
    )
    item = StandardItem.model_validate(
        {
            "sourceId": "s",
            "itemId": "i",
            "op": "upsert",
            "knCode": "k",
            "filePath": "/b.pdf",
            "content": "file body",
            "metadata": {"ingest_field": "value"},
        }
    )
    prop = _metadata_property()
    marker = datetime(2026, 6, 23, tzinfo=timezone.utc)
    delete_created = AsyncMock()

    with (
        _patch(
            "kgw.event_processor.resolve_base_url",
            AsyncMock(return_value="http://kb.test"),
        ),
        _patch(
            "kgw.event_processor.registry.list_active_properties",
            AsyncMock(return_value=[prop]),
        ),
        _patch("kgw.event_processor.sync_mod.ensure_synced", AsyncMock()),
        _patch(
            "kgw.event_processor.binding_mod.bind_usage", AsyncMock(return_value=True)
        ),
        _patch(
            "kgw.event_processor._binding_updated_at",
            AsyncMock(return_value=marker),
            create=True,
        ),
        _patch(
            "kgw.event_processor.call_backend_json",
            AsyncMock(return_value={"resultCode": "-1", "resultMsg": "backend failed"}),
        ),
        _patch("kgw.event_processor.idempotency.mark_failed", AsyncMock()),
        _patch("kgw.event_processor._audit", AsyncMock()),
        _patch(
            "kgw.event_processor._delete_created_bindings", delete_created, create=True
        ),
    ):
        await _process_upsert(
            state,
            item,
            event_id=43,
            config=state.config_provider.get_kb_config.return_value,
            user_code="u1",
            trace_id=None,
        )

    delete_created.assert_awaited_once()
    _, records = delete_created.await_args.args
    assert len(records) == 1
    record = records[0]
    assert record.property_id == prop.property_id
    assert record.kn_code == "k"
    assert record.file_path == "/b.pdf"
    assert record.updated_at == marker
