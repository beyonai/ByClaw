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


def test_metadata_search_calls_fanout():
    with patch(
        "kgw.api.knowledge_items.dispatch_fanout_json", new_callable=AsyncMock
    ) as m:
        m.return_value = {
            "resultCode": "0",
            "resultMsg": "ok",
            "resultObject": {"data": [], "degraded_kbs": []},
        }
        client = TestClient(_build_ki_app())
        client.post(
            "/kgw/api/v1/knowledgeItems/metadataSearch",
            json={"knCodeList": ["kb_a"], "where": {}},
            headers={"X-User-Id": "u1"},
        )
    assert m.call_args.kwargs["operation"] == "metadataSearch"
    assert m.call_args.kwargs["kn_code_list"] == ["kb_a"]


def test_search_file_calls_fanout():
    with patch(
        "kgw.api.knowledge_items.dispatch_fanout_json", new_callable=AsyncMock
    ) as m:
        m.return_value = {
            "resultCode": "0",
            "resultMsg": "ok",
            "resultObject": {"data": [], "degraded_kbs": []},
        }
        client = TestClient(_build_ki_app())
        client.post(
            "/kgw/api/v1/knowledgeItems/searchFile",
            json={"knCodeList": ["kb_a"], "fileName": "x.pdf"},
            headers={"X-User-Id": "u1"},
        )
    assert m.call_args.kwargs["operation"] == "searchFile"


def test_metadata_fields_list_calls_fanout():
    with patch(
        "kgw.api.knowledge_items.dispatch_fanout_json", new_callable=AsyncMock
    ) as m:
        m.return_value = {
            "resultCode": "0",
            "resultMsg": "ok",
            "resultObject": {"data": [], "degraded_kbs": []},
        }
        client = TestClient(_build_ki_app())
        client.post(
            "/kgw/api/v1/knowledgeItems/metadataFields/list",
            json={"knCodeList": ["kb_a"]},
            headers={"X-User-Id": "u1"},
        )
    assert m.call_args.kwargs["operation"] == "metadataFieldsList"


def _build_files_app():
    from kgw.api.files import router

    app = FastAPI()
    app.include_router(router)
    return app


def test_list_dir_calls_dispatch():
    with patch("kgw.api.files.dispatch_json", new_callable=AsyncMock) as m:
        m.return_value = {"resultCode": "0", "resultMsg": "ok", "resultObject": {}}
        client = TestClient(_build_files_app())
        resp = client.post(
            "/kgw/api/v1/listDir",
            json={"knCode": "kb1", "directoryPath": "/docs"},
            headers={"X-User-Id": "u1"},
        )
    assert resp.status_code == 200
    assert m.call_args.kwargs["operation"] == "listDir"
    assert m.call_args.kwargs["kn_code"] == "kb1"


def test_glob_calls_dispatch():
    with patch("kgw.api.files.dispatch_json", new_callable=AsyncMock) as m:
        m.return_value = {"resultCode": "0", "resultMsg": "ok", "resultObject": {}}
        client = TestClient(_build_files_app())
        client.post(
            "/kgw/api/v1/glob",
            json={"knCode": "kb1", "pattern": "*.pdf"},
            headers={"X-User-Id": "u1"},
        )
    assert m.call_args.kwargs["operation"] == "glob"


def test_read_file_calls_dispatch():
    with patch("kgw.api.files.dispatch_json", new_callable=AsyncMock) as m:
        m.return_value = {"resultCode": "0", "resultMsg": "ok", "resultObject": {}}
        client = TestClient(_build_files_app())
        client.post(
            "/kgw/api/v1/readFile",
            json={"knCode": "kb1", "filePath": "/a.md"},
            headers={"X-User-Id": "u1"},
        )
    assert m.call_args.kwargs["operation"] == "readFile"
    assert m.call_args.kwargs["file_path"] == "/a.md"


def test_dsl_guide_calls_dispatch():
    with patch("kgw.api.files.dispatch_json", new_callable=AsyncMock) as m:
        m.return_value = {"resultCode": "0", "resultMsg": "ok", "resultObject": {}}
        client = TestClient(_build_files_app())
        client.post(
            "/kgw/api/v1/dslGuide",
            json={"knCode": "kb1"},
            headers={"X-User-Id": "u1"},
        )
    assert m.call_args.kwargs["operation"] == "dslGuide"
