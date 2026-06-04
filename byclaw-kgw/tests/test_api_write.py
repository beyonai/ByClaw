"""Unit tests for S2 write API routers.

Each router's dispatch_json call is mocked so tests only verify:
- correct endpoint path
- correct operation name forwarded
- correct knCode / file_path extraction from body
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

# ---- Directories ----


def _build_dir_app():
    from fastapi import FastAPI
    from kgw.api.directories import router

    app = FastAPI()
    app.include_router(router)
    return app


def test_directory_create():
    with patch("kgw.api.directories.dispatch_json", new_callable=AsyncMock) as m:
        m.return_value = {"resultCode": "0", "resultMsg": "ok", "resultObject": {}}
        client = TestClient(_build_dir_app())
        resp = client.post(
            "/kgw/api/v1/directories/create",
            json={"knCode": "kb1", "directoryPath": "/docs"},
            headers={"X-User-Id": "u1"},
        )
    assert resp.status_code == 200
    assert resp.json()["resultCode"] == "0"
    assert m.call_args.kwargs["operation"] == "directoryCreate"
    assert m.call_args.kwargs["kn_code"] == "kb1"


def test_directory_update():
    with patch("kgw.api.directories.dispatch_json", new_callable=AsyncMock) as m:
        m.return_value = {"resultCode": "0", "resultMsg": "ok", "resultObject": {}}
        client = TestClient(_build_dir_app())
        client.post(
            "/kgw/api/v1/directories/update",
            json={"knCode": "kb1"},
            headers={"X-User-Id": "u1"},
        )
    assert m.call_args.kwargs["operation"] == "directoryUpdate"


def test_directory_delete():
    with patch("kgw.api.directories.dispatch_json", new_callable=AsyncMock) as m:
        m.return_value = {"resultCode": "0", "resultMsg": "ok", "resultObject": {}}
        client = TestClient(_build_dir_app())
        client.post(
            "/kgw/api/v1/directories/delete",
            json={"knCode": "kb1"},
            headers={"X-User-Id": "u1"},
        )
    assert m.call_args.kwargs["operation"] == "directoryDelete"


# ---- KnowledgeItems ----


def _build_ki_app():
    from fastapi import FastAPI
    from kgw.api.knowledge_items import router

    app = FastAPI()
    app.include_router(router)
    return app


def test_knowledge_item_delete():
    with patch("kgw.api.knowledge_items.dispatch_json", new_callable=AsyncMock) as m:
        m.return_value = {"resultCode": "0", "resultMsg": "ok", "resultObject": {}}
        client = TestClient(_build_ki_app())
        client.post(
            "/kgw/api/v1/knowledgeItems/delete",
            json={"knCode": "kb1", "filePath": "/docs/file.pdf"},
            headers={"X-User-Id": "u1"},
        )
    assert m.call_args.kwargs["operation"] == "fileDelete"
    assert m.call_args.kwargs["file_path"] == "/docs/file.pdf"


def test_knowledge_item_import_endpoint_exists():
    """Smoke test: import endpoint is registered and accepts multipart form."""
    # raise_server_exceptions=False so the missing app.state returns 500 instead of
    # propagating the AttributeError — we only care that the route is registered.
    client = TestClient(_build_ki_app(), raise_server_exceptions=False)
    resp = client.post(
        "/kgw/api/v1/knowledgeItems/import",
        data={"knCode": "kb1", "filePath": "/docs/test.pdf"},
        files={"fileContent": ("test.pdf", b"hello", "application/pdf")},
        headers={"X-User-Id": "u1"},
    )
    # 200 requires real app.state — TestClient without lifespan returns 500;
    # we only verify the endpoint is registered (not 404 or 405)
    assert resp.status_code != 404
    assert resp.status_code != 405


# ---- Files ----


def _build_files_app():
    from fastapi import FastAPI
    from kgw.api.files import router

    app = FastAPI()
    app.include_router(router)
    return app


def test_file_to_markdown_index():
    with patch("kgw.api.files.dispatch_json", new_callable=AsyncMock) as m:
        m.return_value = {"resultCode": "0", "resultMsg": "ok", "resultObject": {}}
        client = TestClient(_build_files_app())
        client.post(
            "/kgw/api/v1/fileToMarkdownIndex",
            json={"knCode": "kb1", "filePath": "/docs/x.pdf"},
            headers={"X-User-Id": "u1"},
        )
    assert m.call_args.kwargs["operation"] == "fileToMarkdownIndex"


def test_file_build_status():
    with patch("kgw.api.files.dispatch_json", new_callable=AsyncMock) as m:
        m.return_value = {
            "resultCode": "0",
            "resultMsg": "ok",
            "resultObject": {"status": "done"},
        }
        client = TestClient(_build_files_app())
        client.post(
            "/kgw/api/v1/fileBuildStatus",
            json={"knCode": "kb1"},
            headers={"X-User-Id": "u1"},
        )
    assert m.call_args.kwargs["operation"] == "fileBuildStatus"
