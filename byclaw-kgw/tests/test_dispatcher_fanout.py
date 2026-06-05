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
                    "resultObject": {"data": [{"id": "a1"}]},
                },
            )
        )
        respx.post("http://kb-2.test/api/v1/knowledgeItems/search").mock(
            return_value=httpx.Response(
                200,
                json={
                    "resultCode": "0",
                    "resultMsg": "ok",
                    "resultObject": {"data": [{"id": "b1"}, {"id": "b2"}]},
                },
            )
        )
        result = await dispatch_fanout_json(
            req,
            operation="knowledgeSearch",
            kn_code_list=["kb_a", "kb_b"],
            user_id="u1",
            body={"query": "x"},
        )
    assert result["resultCode"] == "0"
    ids = sorted(item["id"] for item in result["resultObject"]["data"])
    assert ids == ["a1", "b1", "b2"]
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
                    "resultObject": {"data": [{"id": "a1"}]},
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
            body={"query": "x"},
        )
    assert result["resultCode"] == "0"
    assert [item["id"] for item in result["resultObject"]["data"]] == ["a1"]
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
            body={},
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
            body={},
        )
    deg = result["resultObject"]["degraded_kbs"]
    assert any(d["knCode"] == "kb_b" and d["reason"] == "CircuitOpen" for d in deg)
