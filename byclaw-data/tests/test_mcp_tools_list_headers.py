"""MCP `tools/list` 集成测试：通过请求头限定 object / view。

依赖 `datacloud_data_service` 已启动（见 `by-datacloud` 的 launch 配置），
MCP 挂载在 ``/api/v1/mcp``。请求头与实现一致：

- ``X-Object-Id``：单对象（见 ``mcp_sdk_handler.py``）
- ``X-View-Id``：单视图

默认用亦庄 demo 场景中常见的 object / view id，可通过环境变量覆盖。
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx
import pytest

# 与 datacloud-data 测试/场景 JSON 中常见取值一致；可按你当前本体改环境变量
_DEFAULT_OBJECT_ID = "sales_bo"
_DEFAULT_VIEW_ID = "scene_01_data_analysis"

_TOOLS_LIST_BODY = {
    "jsonrpc": "2.0",
    "id": "1",
    "method": "tools/list",
    "params": {},
}


def _iter_jsonrpc_payloads(raw: str) -> list[dict[str, Any]]:
    """解析 MCP Streamable HTTP（SSE）或纯 JSON 响应中的 JSON-RPC 对象。"""

    raw = raw.strip()
    if not raw:
        return []
    if raw.lstrip().startswith("{"):
        try:
            return [json.loads(raw)]
        except json.JSONDecodeError:
            pass

    payloads: list[dict[str, Any]] = []
    for line in raw.splitlines():
        line = line.strip()
        if not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if payload in ("[DONE]",):
            continue
        try:
            payloads.append(json.loads(payload))
        except json.JSONDecodeError:
            # 部分实现会带 event id 等，尝试提取首个 JSON 对象
            match = re.search(r"\{.*\}", payload, re.DOTALL)
            if match:
                payloads.append(json.loads(match.group()))
    return payloads


def _tool_names_from_list_result(payloads: list[dict[str, Any]]) -> list[str]:
    names: list[str] = []
    for p in payloads:
        result = p.get("result")
        if not isinstance(result, dict):
            continue
        tools = result.get("tools")
        if not isinstance(tools, list):
            continue
        for t in tools:
            if isinstance(t, dict) and "name" in t:
                names.append(str(t["name"]))
    return names


@pytest.mark.integration
def test_mcp_tools_list_with_object_id_header(
    data_service_base_url: str,
    require_data_service: None,
) -> None:
    """在请求头中传 ``X-Object-Id``，应返回 tools/list 且包含统一查询工具。"""

    object_id = os.environ.get("MCP_TEST_OBJECT_ID", _DEFAULT_OBJECT_ID)
    url = f"{data_service_base_url}/api/v1/mcp"
    headers = {
        "Content-Type": "application/json",
        "X-Tenant-Id": "test-tenant",
        "X-User-Id": "test-user",
        "X-Object-Id": object_id,
    }
    with httpx.Client(timeout=60.0) as client:
        response = client.post(url, headers=headers, json=_TOOLS_LIST_BODY)
    assert response.status_code == 200, response.text[:2000]

    payloads = _iter_jsonrpc_payloads(response.text)
    assert payloads, "未解析到 JSON-RPC 响应体"
    names = _tool_names_from_list_result(payloads)
    assert "unified_data_query" in names, f"期望含 unified_data_query，实际: {names[:20]}"


@pytest.mark.integration
def test_mcp_tools_list_with_view_id_header(
    data_service_base_url: str,
    require_data_service: None,
) -> None:
    """在请求头中传 ``X-View-Id``，应返回 tools/list 且包含统一查询工具。"""

    view_id = os.environ.get("MCP_TEST_VIEW_ID", _DEFAULT_VIEW_ID)
    url = f"{data_service_base_url}/api/v1/mcp"
    headers = {
        "Content-Type": "application/json",
        "X-Tenant-Id": "test-tenant",
        "X-User-Id": "test-user",
        "X-View-Id": view_id,
    }
    with httpx.Client(timeout=60.0) as client:
        response = client.post(url, headers=headers, json=_TOOLS_LIST_BODY)
    assert response.status_code == 200, response.text[:2000]

    payloads = _iter_jsonrpc_payloads(response.text)
    assert payloads, "未解析到 JSON-RPC 响应体"
    names = _tool_names_from_list_result(payloads)
    assert "unified_data_query" in names, f"期望含 unified_data_query，实际: {names[:20]}"
