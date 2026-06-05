"""Unit tests for S3 read API routers (knowledge_items + files)."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient


def _build_ki_app():
    from kgw.api.knowledge_items import router

    app = FastAPI()
    app.include_router(router)
    return app


def test_knowledge_search_calls_fanout():
    """POST /knowledgeItems/search → dispatch_fanout_json with knCodeList."""
    with patch(
        "kgw.api.knowledge_items.dispatch_fanout_json", new_callable=AsyncMock
    ) as m:
        m.return_value = {
            "resultCode": "0",
            "resultMsg": "ok",
            "resultObject": {"data": [], "degraded_kbs": []},
        }
        client = TestClient(_build_ki_app())
        resp = client.post(
            "/kgw/api/v1/knowledgeItems/search",
            json={"knCodeList": ["kb_a", "kb_b"], "query": "x"},
            headers={"X-User-Id": "u1"},
        )
    assert resp.status_code == 200
    assert m.call_args.kwargs["operation"] == "knowledgeSearch"
    assert m.call_args.kwargs["kn_code_list"] == ["kb_a", "kb_b"]
    assert m.call_args.kwargs["user_id"] == "u1"
