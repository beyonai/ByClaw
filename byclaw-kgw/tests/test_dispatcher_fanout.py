"""Unit tests for dispatcher.dispatch_fanout_json (multi-KB parallel reads)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
import respx
from kgw.config_provider import KbConfig
from kgw.dispatcher import dispatch_fanout_json
from kgw.resilience.circuit_breaker import CircuitBreakerRegistry


def _kb(kn_code: str, port: int) -> KbConfig:
    return KbConfig(
        kn_code=kn_code,
        resource_code=f"backend_{kn_code}",
        domain_url=f"http://kb-{port}.test",
        domain_name="",
        headers={},
        operations=frozenset({"knowledgeSearch"}),
        operation_paths={"knowledgeSearch": "/api/v1/knowledgeItems/search"},
        raw={},
    )


def _make_state(configs: dict[str, KbConfig]):
    state = MagicMock()
    state.config_provider = AsyncMock()

    async def _get(kn_code):
        return configs.get(kn_code)

    state.config_provider.get_kb_config.side_effect = _get
    state.auth_provider = AsyncMock()
    state.auth_provider.resolve_headers.return_value = {}
    state.circuit_breakers = CircuitBreakerRegistry()
    state.audit = AsyncMock()
    state.pool = MagicMock()
    return state


def _make_request(state):
    req = MagicMock()
    req.app.state = state
    req.headers = {}
    return req


@pytest.mark.asyncio
async def test_fanout_all_success_merges_data():
    """All KBs succeed → resultObject.data is concatenated, degraded_kbs is empty."""
    configs = {"kb_a": _kb("kb_a", 1), "kb_b": _kb("kb_b", 2)}
    state = _make_state(configs)
    state.http = httpx.AsyncClient()
    req = _make_request(state)
    with respx.mock:
        respx.post("http://kb-1.test/api/v1/knowledgeItems/search").mock(
            return_value=httpx.Response(
                200,
                json={
                    "resultCode": "0",
                    "resultMsg": "ok",
                    "resultObject": {
                        "data": [
                            {
                                "knCode": "backend_kb_a",
                                "filePath": "/a.pdf",
                                "score": 92,
                            }
                        ]
                    },
                },
            )
        )
        respx.post("http://kb-2.test/api/v1/knowledgeItems/search").mock(
            return_value=httpx.Response(
                200,
                json={
                    "resultCode": "0",
                    "resultMsg": "ok",
                    "resultObject": {
                        "data": [
                            {
                                "knCode": "backend_kb_b",
                                "filePath": "/b1.pdf",
                                "score": 88,
                            },
                            {
                                "knCode": "backend_kb_b",
                                "filePath": "/b2.pdf",
                                "score": 75,
                            },
                        ]
                    },
                },
            )
        )
        result = await dispatch_fanout_json(
            req,
            operation="knowledgeSearch",
            kn_code_list=["kb_a", "kb_b"],
            user_id="u1",
            body={"query": "请假流程", "topK": 5, "searchMode": "mixedRecall"},
        )
    assert result["resultCode"] == "0"
    data = result["resultObject"]["data"]
    assert len(data) == 3
    # resource_codes must be replaced with portal kn_codes
    kn_codes = {item["knCode"] for item in data}
    assert kn_codes == {"kb_a", "kb_b"}
    assert result["resultObject"]["degraded_kbs"] == []


@pytest.mark.asyncio
async def test_fanout_one_kb_timeout_others_succeed():
    """KB B times out → degraded_kbs contains B with reason=UpstreamTimeout."""
    configs = {"kb_a": _kb("kb_a", 1), "kb_b": _kb("kb_b", 2)}
    state = _make_state(configs)
    state.http = httpx.AsyncClient()
    req = _make_request(state)
    with respx.mock:
        respx.post("http://kb-1.test/api/v1/knowledgeItems/search").mock(
            return_value=httpx.Response(
                200,
                json={
                    "resultCode": "0",
                    "resultMsg": "ok",
                    "resultObject": {
                        "data": [{"knCode": "backend_kb_a", "filePath": "/a.pdf"}]
                    },
                },
            )
        )
        respx.post("http://kb-2.test/api/v1/knowledgeItems/search").mock(
            side_effect=httpx.TimeoutException("simulated timeout")
        )
        result = await dispatch_fanout_json(
            req,
            operation="knowledgeSearch",
            kn_code_list=["kb_a", "kb_b"],
            user_id="u1",
            body={"query": "请假流程", "topK": 5, "searchMode": "mixedRecall"},
        )
    assert result["resultCode"] == "0"
    data = result["resultObject"]["data"]
    assert len(data) == 1
    assert data[0]["knCode"] == "kb_a"
    degraded = result["resultObject"]["degraded_kbs"]
    assert len(degraded) == 1
    assert degraded[0]["knCode"] == "kb_b"
    assert degraded[0]["reason"] == "UpstreamTimeout"


@pytest.mark.asyncio
async def test_fanout_unknown_kb_marked_degraded():
    """Missing KB config → degraded with reason=KBNotFound, others ok."""
    configs = {"kb_a": _kb("kb_a", 1)}  # kb_b missing
    state = _make_state(configs)
    state.http = httpx.AsyncClient()
    req = _make_request(state)
    with respx.mock:
        respx.post("http://kb-1.test/api/v1/knowledgeItems/search").mock(
            return_value=httpx.Response(
                200,
                json={
                    "resultCode": "0",
                    "resultMsg": "ok",
                    "resultObject": {"data": []},
                },
            )
        )
        result = await dispatch_fanout_json(
            req,
            operation="knowledgeSearch",
            kn_code_list=["kb_a", "kb_b"],
            user_id="u1",
            body={"query": "x", "topK": 5, "searchMode": "embedding"},
        )
    assert any(
        d["knCode"] == "kb_b" and d["reason"] == "KBNotFound"
        for d in result["resultObject"]["degraded_kbs"]
    )


@pytest.mark.asyncio
async def test_fanout_circuit_open_kb_marked_degraded():
    """A KB whose circuit is OPEN → degraded with reason=CircuitOpen, no backend call."""
    configs = {"kb_a": _kb("kb_a", 1), "kb_b": _kb("kb_b", 2)}
    state = _make_state(configs)
    state.http = httpx.AsyncClient()
    # Force kb_b's breaker OPEN
    cb = state.circuit_breakers.get("http://kb-2.test")
    for _ in range(5):
        cb.before_call()
        cb.record_failure()
    req = _make_request(state)
    with respx.mock:
        respx.post("http://kb-1.test/api/v1/knowledgeItems/search").mock(
            return_value=httpx.Response(
                200,
                json={
                    "resultCode": "0",
                    "resultMsg": "ok",
                    "resultObject": {"data": []},
                },
            )
        )
        result = await dispatch_fanout_json(
            req,
            operation="knowledgeSearch",
            kn_code_list=["kb_a", "kb_b"],
            user_id="u1",
            body={"query": "x", "topK": 5, "searchMode": "fullTextRecall"},
        )
    deg = result["resultObject"]["degraded_kbs"]
    assert any(d["knCode"] == "kb_b" and d["reason"] == "CircuitOpen" for d in deg)


@pytest.mark.asyncio
async def test_fanout_url_grouping_sends_one_request():
    """Two KBs on the same URL are batched into a single backend request."""
    # Both kb_a and kb_b share the same domain_url but differ in resource_code
    configs = {
        "kb_a": KbConfig(
            kn_code="kb_a",
            resource_code="backend_kb_a",
            domain_url="http://shared.test",
            domain_name="",
            headers={},
            operations=frozenset({"knowledgeSearch"}),
            operation_paths={"knowledgeSearch": "/api/v1/knowledgeItems/search"},
            raw={},
        ),
        "kb_b": KbConfig(
            kn_code="kb_b",
            resource_code="backend_kb_b",
            domain_url="http://shared.test",
            domain_name="",
            headers={},
            operations=frozenset({"knowledgeSearch"}),
            operation_paths={"knowledgeSearch": "/api/v1/knowledgeItems/search"},
            raw={},
        ),
    }
    state = _make_state(configs)
    state.http = httpx.AsyncClient()
    req = _make_request(state)

    captured_bodies: list[dict] = []
    with respx.mock:

        def _capture(request):
            import json

            captured_bodies.append(json.loads(request.content))
            return httpx.Response(
                200,
                json={
                    "resultCode": "0",
                    "resultMsg": "ok",
                    "resultObject": {
                        "data": [
                            {"knCode": "backend_kb_a", "filePath": "/a.pdf"},
                            {"knCode": "backend_kb_b", "filePath": "/b.pdf"},
                        ]
                    },
                },
            )

        respx.post("http://shared.test/api/v1/knowledgeItems/search").mock(
            side_effect=_capture
        )
        result = await dispatch_fanout_json(
            req,
            operation="knowledgeSearch",
            kn_code_list=["kb_a", "kb_b"],
            user_id="u1",
            body={"query": "x", "topK": 3, "searchMode": "embedding"},
        )

    # Only ONE backend request was made (URL grouping)
    assert len(captured_bodies) == 1
    sent = captured_bodies[0]
    # Both resource_codes in the merged knCodeList
    assert set(sent["knCodeList"]) == {"backend_kb_a", "backend_kb_b"}
    assert "knCode" not in sent  # single knCode should be absent

    # Response knCodes back-mapped to portal codes
    data = result["resultObject"]["data"]
    assert len(data) == 2
    portal_codes = {item["knCode"] for item in data}
    assert portal_codes == {"kb_a", "kb_b"}


@pytest.mark.asyncio
async def test_fanout_cancelled_error_propagates():
    """A CancelledError from config fetch must not be swallowed as 'UnknownError'."""
    import asyncio

    configs = {"kb_a": _kb("kb_a", 1), "kb_b": _kb("kb_b", 2)}
    state = _make_state(configs)
    state.http = httpx.AsyncClient()
    req = _make_request(state)

    call_count = 0

    async def _fake_get(kn_code):
        nonlocal call_count
        call_count += 1
        if kn_code == "kb_b":
            raise asyncio.CancelledError("client gone")
        return configs.get(kn_code)

    state.config_provider.get_kb_config.side_effect = _fake_get

    with pytest.raises(asyncio.CancelledError):
        await dispatch_fanout_json(
            req,
            operation="knowledgeSearch",
            kn_code_list=["kb_a", "kb_b"],
            user_id="u1",
            body={"query": "x", "topK": 5, "searchMode": "embedding"},
        )


@pytest.mark.asyncio
async def test_fanout_non_list_data_kn_code_wins_over_backend():
    """Non-list resultObject: portal kn_code overrides backend-leaked resource_code."""
    configs = {
        "kb_a": KbConfig(
            kn_code="kb_a",
            resource_code="backend_kb_a",
            domain_url="http://kb-1.test",
            domain_name="",
            headers={},
            operations=frozenset({"metadataFieldsList"}),
            operation_paths={
                "metadataFieldsList": "/api/v1/knowledgeItems/metadataFields/list"
            },
            raw={},
        )
    }
    state = _make_state(configs)
    state.http = httpx.AsyncClient()
    req = _make_request(state)

    with respx.mock:
        respx.post("http://kb-1.test/api/v1/knowledgeItems/metadataFields/list").mock(
            return_value=httpx.Response(
                200,
                json={
                    "resultCode": "0",
                    "resultMsg": "ok",
                    "resultObject": {
                        "knCode": "backend_kb_a",
                        "fields": ["status", "tags"],
                    },
                },
            )
        )
        result = await dispatch_fanout_json(
            req,
            operation="metadataFieldsList",
            kn_code_list=["kb_a"],
            user_id="u1",
            body={"knCodeList": ["kb_a"]},
        )
    entries = result["resultObject"]["data"]
    assert len(entries) == 1
    # Portal kn_code must win, not the backend's resource_code.
    assert entries[0]["knCode"] == "kb_a"
    assert entries[0]["fields"] == ["status", "tags"]
