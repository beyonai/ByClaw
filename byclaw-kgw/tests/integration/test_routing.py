"""Integration tests: direct vs discovery routing.

Verifies the gateway correctly handles both domainURL (direct HTTP)
and domainName (by-framework DiscoveryClient) routing modes.
"""
# pylint: disable=redefined-outer-name,invalid-name

from typing import Any

import httpx
import pytest
import respx

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

# KB config constants — must match values in conftest.py
_KN_DIRECT = "200001"
_KN_DISCOV = "300001"
_KB_DIRECT_URL = "http://kb-direct.test"
_USER_ID = "test_user"
_RESOURCE_CODE_DIRECT = "2"


def _hdrs(extra: dict | None = None) -> dict[str, str]:
    h = {"X-User-Id": _USER_ID}
    if extra:
        h.update(extra)
    return h


def _ok_resp(obj: dict | None = None) -> dict[str, Any]:
    return {"resultCode": "0", "resultMsg": "success", "resultObject": obj or {}}


def _fail_resp(msg: str = "error") -> dict[str, Any]:
    return {"resultCode": "-1", "resultMsg": msg, "resultObject": {}}


# --- E5: basic app health ---
async def test_app_health(client):
    resp = await client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


# --- E3: KB config resolves correctly ---
async def test_kb_config_direct_resolves(app):
    """Direct KB (200001) config is loaded from MinIO and domain_url is populated."""
    cfg = await app.state.config_provider.get_kb_config(_KN_DIRECT)
    assert cfg is not None
    assert cfg.kn_code == _KN_DIRECT
    assert cfg.domain_url == _KB_DIRECT_URL
    assert cfg.resource_code == "2"  # backend knCode


async def test_kb_config_discovery_resolves(app):
    """Discovery KB (300001) config is loaded with domain_name set."""
    cfg = await app.state.config_provider.get_kb_config(_KN_DISCOV)
    assert cfg is not None
    assert cfg.kn_code == _KN_DISCOV
    assert cfg.domain_name == "kgw-int-kb-svc"
    assert cfg.domain_url == ""


# --- GD1/GD2: directory create in both modes ---
async def test_create_directory_direct(client):
    with respx.mock(assert_all_called=False) as mock:
        mock.post(f"{_KB_DIRECT_URL}/api/v1/directories/create").mock(
            return_value=httpx.Response(200, json=_ok_resp())
        )
        mock.post(f"{_KB_DIRECT_URL}/api/v1/listDir").mock(
            return_value=httpx.Response(200, json=_ok_resp())
        )
        resp = await client.post(
            "/kgw/api/v1/directories/create",
            json={"knCode": _KN_DIRECT, "directoryPath": "/policies"},
            headers=_hdrs(),
        )
    assert resp.json()["resultCode"] == "0"


# --- GI2: discovery mode config verified at import layer ---
async def test_import_file_discovery_config(app):
    """Discovery KB config has domain_name set (no domainURL).

    We verify the config layer — the actual HTTP call to a discovery-mode
    backend requires Redis service registration which is set up by the
    docker-compose environment at deploy time, not during unit tests.
    """
    cfg = await app.state.config_provider.get_kb_config(_KN_DISCOV)
    assert cfg is not None
    assert cfg.domain_name == "kgw-int-kb-svc"
    assert cfg.domain_url == ""
    assert cfg.resource_code == "3"


# --- GI9: discovery mode config verified at delete layer ---
async def test_delete_file_discovery_config(app):
    """Discovery KB config loaded correctly for delete operations."""
    cfg = await app.state.config_provider.get_kb_config(_KN_DISCOV)
    assert cfg is not None
    assert "fileDelete" in cfg.operation_paths


# --- GR1: listDir direct ---
async def test_listdir_direct(client):
    with respx.mock(assert_all_called=False) as mock:
        mock.post(f"{_KB_DIRECT_URL}/api/v1/listDir").mock(
            return_value=httpx.Response(200, json=_ok_resp({"data": []}))
        )
        resp = await client.post(
            "/kgw/api/v1/listDir",
            json={"knCode": _KN_DIRECT, "directoryPath": "/"},
            headers=_hdrs(),
        )
    assert resp.json()["resultCode"] == "0"


# --- CX1: cross-KB config verification ---
async def test_cross_kb_both_configs_independent(app):
    """Both KB configs (200001+300001) loaded independently from MinIO."""
    cfg_direct = await app.state.config_provider.get_kb_config(_KN_DIRECT)
    cfg_disc = await app.state.config_provider.get_kb_config(_KN_DISCOV)
    assert cfg_direct is not None
    assert cfg_disc is not None
    assert cfg_direct.domain_url == _KB_DIRECT_URL
    assert cfg_disc.domain_name == "kgw-int-kb-svc"
    # Two KBs should not share config state
    assert cfg_direct.resource_code != cfg_disc.resource_code


# --- KBNotFound for unknown knCode ---
async def test_unknown_kn_code(client):
    resp = await client.post(
        "/kgw/api/v1/listDir",
        json={"knCode": "99999999", "directoryPath": "/"},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "-1"
    assert (
        "not found" in body["resultMsg"].lower()
        or "unknown" in body["resultMsg"].lower()
    )
