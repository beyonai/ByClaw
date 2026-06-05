"""Unit tests for dispatcher.dispatch_json."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
import respx
from kgw.config_provider import KbConfig
from kgw.dispatcher import dispatch_json
from kgw.envelope import (
    BackendAuthFailed,
    CircuitOpen,
    KBNotFound,
    OperationNotSupported,
    UpstreamConnectError,
    UpstreamTimeout,
)
from kgw.resilience.circuit_breaker import CircuitBreakerRegistry

_KB_CONFIG = KbConfig(
    kn_code="test_kb",
    resource_code="backend_kb_1",
    domain_url="http://kb.test",
    domain_name="",
    headers={"Authorization": "${token}"},
    operations=frozenset(
        {
            "directoryCreate",
            "directoryDelete",
            "fileImport",
            "buildTrigger",
            "buildStatus",
        }
    ),
    operation_paths={
        "directoryCreate": "/api/v1/directories/create",
        "directoryDelete": "/api/v1/directories/delete",
        "fileImport": "/api/v1/knowledgeItems/import",
        "buildTrigger": "/api/v1/fileToMarkdownIndex",
        "buildStatus": "/api/v1/fileBuildStatus",
    },
    raw={},
)


def _make_state(kb_config=_KB_CONFIG, auth_headers=None):
    state = MagicMock()
    state.config_provider = AsyncMock()
    state.config_provider.get_kb_config.return_value = kb_config
    state.auth_provider = AsyncMock()
    state.auth_provider.resolve_headers.return_value = auth_headers or {
        "Authorization": "Bearer tok"
    }
    state.circuit_breakers = CircuitBreakerRegistry()
    state.audit = AsyncMock()
    state.pool = MagicMock()
    state.pool.connection = MagicMock()
    # Make pool.connection() a context manager that yields a mock conn
    mock_conn = AsyncMock()
    state.pool.connection.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
    state.pool.connection.return_value.__aexit__ = AsyncMock(return_value=False)
    return state


def _make_request(state):
    req = MagicMock()
    req.app.state = state
    req.headers = {}
    return req


@pytest.mark.asyncio
async def test_dispatch_json_success():
    state = _make_state()
    req = _make_request(state)
    with respx.mock:
        respx.post("http://kb.test/api/v1/directories/create").mock(
            return_value=httpx.Response(
                200,
                json={"resultCode": "0", "resultMsg": "ok", "resultObject": {}},
            )
        )
        state.http = httpx.AsyncClient()
        result = await dispatch_json(
            req,
            operation="directoryCreate",
            kn_code="test_kb",
            user_id="u1",
            body={"knCode": "test_kb"},
        )
    assert result["resultCode"] == "0"
    state.audit.record.assert_called_once()


@pytest.mark.asyncio
async def test_dispatch_json_kb_not_found():
    state = _make_state()
    state.config_provider.get_kb_config.return_value = None
    req = _make_request(state)
    state.http = httpx.AsyncClient()
    with pytest.raises(KBNotFound):
        await dispatch_json(
            req, operation="directoryCreate", kn_code="missing", user_id="u1", body={}
        )


@pytest.mark.asyncio
async def test_dispatch_json_operation_not_supported():
    state = _make_state()
    req = _make_request(state)
    state.http = httpx.AsyncClient()
    with pytest.raises(OperationNotSupported):
        await dispatch_json(
            req, operation="directoryUpdate", kn_code="test_kb", user_id="u1", body={}
        )
    # directoryUpdate is NOT in _KB_CONFIG.operations (only directoryCreate/Delete present)


@pytest.mark.asyncio
async def test_dispatch_json_circuit_open():
    state = _make_state()
    cb = state.circuit_breakers.get("http://kb.test")
    for _ in range(5):
        cb.before_call()
        cb.record_failure()
    req = _make_request(state)
    state.http = httpx.AsyncClient()
    with pytest.raises(CircuitOpen):
        await dispatch_json(
            req, operation="directoryCreate", kn_code="test_kb", user_id="u1", body={}
        )


@pytest.mark.asyncio
async def test_dispatch_json_backend_auth_failed():
    state = _make_state()
    req = _make_request(state)
    with respx.mock:
        respx.post("http://kb.test/api/v1/directories/create").mock(
            return_value=httpx.Response(401)
        )
        state.http = httpx.AsyncClient()
        with pytest.raises(BackendAuthFailed):
            await dispatch_json(
                req,
                operation="directoryCreate",
                kn_code="test_kb",
                user_id="u1",
                body={},
            )


@pytest.mark.asyncio
async def test_dispatch_json_upstream_timeout():
    state = _make_state()
    req = _make_request(state)
    with respx.mock:
        respx.post("http://kb.test/api/v1/directories/create").mock(
            side_effect=httpx.TimeoutException("timeout")
        )
        state.http = httpx.AsyncClient()
        with pytest.raises(UpstreamTimeout):
            await dispatch_json(
                req,
                operation="directoryCreate",
                kn_code="test_kb",
                user_id="u1",
                body={},
            )


@pytest.mark.asyncio
async def test_dispatch_json_upstream_connect_error():
    state = _make_state()
    req = _make_request(state)
    with respx.mock:
        respx.post("http://kb.test/api/v1/directories/create").mock(
            side_effect=httpx.ConnectError("conn refused")
        )
        state.http = httpx.AsyncClient()
        with pytest.raises(UpstreamConnectError):
            await dispatch_json(
                req,
                operation="directoryCreate",
                kn_code="test_kb",
                user_id="u1",
                body={},
            )


@pytest.mark.asyncio
async def test_dispatch_file_to_markdown_index_maps_to_build_trigger():
    """fileToMarkdownIndex gateway name should map to buildTrigger KB op."""
    state = _make_state()
    req = _make_request(state)
    with respx.mock:
        route = respx.post("http://kb.test/api/v1/fileToMarkdownIndex").mock(
            return_value=httpx.Response(
                200, json={"resultCode": "0", "resultMsg": "ok", "resultObject": {}}
            )
        )
        state.http = httpx.AsyncClient()
        result = await dispatch_json(
            req,
            operation="fileToMarkdownIndex",
            kn_code="test_kb",
            user_id="u1",
            body={"knCode": "test_kb"},
        )
    assert result["resultCode"] == "0"
    assert route.called


@pytest.mark.asyncio
async def test_dispatch_write_history_called_for_write_ops():
    """directoryCreate should trigger write_history insert."""
    state = _make_state()
    req = _make_request(state)
    with respx.mock:
        respx.post("http://kb.test/api/v1/directories/create").mock(
            return_value=httpx.Response(
                200, json={"resultCode": "0", "resultMsg": "ok", "resultObject": {}}
            )
        )
        state.http = httpx.AsyncClient()
        await dispatch_json(
            req,
            operation="directoryCreate",
            kn_code="test_kb",
            user_id="u1",
            body={"knCode": "test_kb"},
            file_path="/docs",
        )
    # Yield control so the background create_task can run
    await asyncio.sleep(0)
    # pool.connection was called for write_history
    state.pool.connection.assert_called()


@pytest.mark.asyncio
async def test_dispatch_build_status_no_write_history():
    """fileBuildStatus is read-shaped: no audit, no kgw_kb_write_history."""
    state = _make_state()
    req = _make_request(state)
    with respx.mock:
        respx.post("http://kb.test/api/v1/fileBuildStatus").mock(
            return_value=httpx.Response(
                200,
                json={
                    "resultCode": "0",
                    "resultMsg": "ok",
                    "resultObject": {"status": "done"},
                },
            )
        )
        state.http = httpx.AsyncClient()
        await dispatch_json(
            req,
            operation="fileBuildStatus",
            kn_code="test_kb",
            user_id="u1",
            body={"knCode": "test_kb"},
        )
    await asyncio.sleep(0)
    # pool.connection should NOT be called for buildStatus (not a write-history op)
    state.pool.connection.assert_not_called()
    state.audit.record.assert_not_called()


@pytest.mark.asyncio
async def test_dispatch_translates_kn_code_to_resource_code():
    """Portal kn_code must be replaced with backend resource_code in the request body."""
    state = _make_state()
    req = _make_request(state)
    captured_body = {}
    with respx.mock:

        def _capture(request):
            import json

            captured_body.update(json.loads(request.content))
            return httpx.Response(
                200, json={"resultCode": "0", "resultMsg": "ok", "resultObject": {}}
            )

        respx.post("http://kb.test/api/v1/directories/create").mock(
            side_effect=_capture
        )
        state.http = httpx.AsyncClient()
        await dispatch_json(
            req,
            operation="directoryCreate",
            kn_code="test_kb",  # portal ID
            user_id="u1",
            body={"knCode": "test_kb", "directoryPath": "/docs"},
        )
    # The backend should receive resource_code ("backend_kb_1"), not portal kn_code
    assert captured_body.get("knCode") == "backend_kb_1"


# ---- by-framework service-discovery mode ----

_KB_CONFIG_DISCOVERY = KbConfig(
    kn_code="svc_kb",
    resource_code="svc_backend_1",
    domain_url="",  # no direct URL → discovery mode
    domain_name="kb-service-a",
    headers={},
    operations=frozenset({"directoryCreate"}),
    operation_paths={"directoryCreate": "/api/v1/directories/create"},
    raw={},
)


@pytest.mark.asyncio
async def test_dispatch_discovery_mode_success():
    """When domain_url is empty and domain_name is set, use DiscoveryHttpClient."""
    from unittest.mock import patch

    state = _make_state(kb_config=_KB_CONFIG_DISCOVERY)
    req = _make_request(state)
    state.http = httpx.AsyncClient()

    captured: dict = {}

    async def _fake_discovery(*, domain_name, op_path, body, headers):  # pylint: disable=unused-argument
        captured["domain_name"] = domain_name
        captured["op_path"] = op_path
        captured["body"] = body
        return {"resultCode": "0", "resultMsg": "ok", "resultObject": {}}

    with patch("kgw.dispatcher._call_via_discovery", side_effect=_fake_discovery):
        result = await dispatch_json(
            req,
            operation="directoryCreate",
            kn_code="svc_kb",
            user_id="u1",
            body={"knCode": "svc_kb"},
        )

    assert result["resultCode"] == "0"
    assert captured["domain_name"] == "kb-service-a"
    assert captured["op_path"] == "/api/v1/directories/create"
    # Verify resource_code was substituted in the body (not portal kn_code)
    assert captured["body"]["knCode"] == "svc_backend_1"


@pytest.mark.asyncio
async def test_dispatch_discovery_mode_no_domain_raises():
    """If both domain_url and domain_name are empty, raise UpstreamConnectError."""
    empty_cfg = KbConfig(
        kn_code="empty_kb",
        resource_code="empty_1",
        domain_url="",
        domain_name="",
        headers={},
        operations=frozenset({"directoryCreate"}),
        operation_paths={"directoryCreate": "/api/v1/directories/create"},
        raw={},
    )
    state = _make_state(kb_config=empty_cfg)
    req = _make_request(state)
    state.http = httpx.AsyncClient()

    with pytest.raises(UpstreamConnectError):
        await dispatch_json(
            req,
            operation="directoryCreate",
            kn_code="empty_kb",
            user_id="u1",
            body={},
        )


@pytest.mark.asyncio
async def test_dispatch_read_op_does_not_audit():
    """Read ops (knowledgeSearch/listDir/...) MUST NOT write audit log."""
    state = _make_state()
    # extend operations to include knowledgeSearch
    state.config_provider.get_kb_config.return_value = KbConfig(
        kn_code="test_kb",
        resource_code="backend_kb_1",
        domain_url="http://kb.test",
        domain_name="",
        headers={},
        operations=frozenset({"knowledgeSearch"}),
        operation_paths={"knowledgeSearch": "/api/v1/knowledgeItems/search"},
        raw={},
    )
    req = _make_request(state)
    with respx.mock:
        respx.post("http://kb.test/api/v1/knowledgeItems/search").mock(
            return_value=httpx.Response(
                200, json={"resultCode": "0", "resultMsg": "ok", "resultObject": {}}
            )
        )
        state.http = httpx.AsyncClient()
        await dispatch_json(
            req,
            operation="knowledgeSearch",
            kn_code="test_kb",
            user_id="u1",
            body={"knCodeList": ["test_kb"]},
        )
    state.audit.record.assert_not_called()


@pytest.mark.asyncio
async def test_dispatch_read_op_no_write_history():
    """Read ops must not insert kgw_kb_write_history."""
    state = _make_state()
    state.config_provider.get_kb_config.return_value = KbConfig(
        kn_code="test_kb",
        resource_code="backend_kb_1",
        domain_url="http://kb.test",
        domain_name="",
        headers={},
        operations=frozenset({"listDir"}),
        operation_paths={"listDir": "/api/v1/listDir"},
        raw={},
    )
    req = _make_request(state)
    with respx.mock:
        respx.post("http://kb.test/api/v1/listDir").mock(
            return_value=httpx.Response(
                200, json={"resultCode": "0", "resultMsg": "ok", "resultObject": {}}
            )
        )
        state.http = httpx.AsyncClient()
        await dispatch_json(
            req,
            operation="listDir",
            kn_code="test_kb",
            user_id="u1",
            body={"knCode": "test_kb"},
        )
    await asyncio.sleep(0)
    state.pool.connection.assert_not_called()
