#!/usr/local/bin/python3
"""调试 Action 脚本（在 debug.db 沙箱中执行，返回结果或完整 traceback）。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON）:
    {
        "workspace_name": "travel_reimbursement",   # 必填
        "entity_code":    "travel_application",     # 必填
        "action_code":    "travel_application_submit",     # 必填
        "params": {"app_id": 1, "submit_time": "2026-06-25"},  # 必填，Action 入参
        "script": "def execute(params: dict) -> dict:\n    ..."  # 可选，临时覆盖（不传则读服务端工作区文件）
    }

出参（stdout JSON）— 成功：
    {
        "ok":         true,
        "result":     {"records": [...], "total": 1, "meta": {...}},
        "elapsed_ms": 42
    }

出参（stdout JSON）— 脚本报错：
    {
        "ok":         false,
        "error":      "AttributeError: ...",
        "traceback":  "Traceback (most recent call last):\n  ...",
        "elapsed_ms": 15
    }

调试数据存储在服务端工作区 debug.db，跨调用持久保留，batch-submit 后自动清除。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from _common import post_ontology_api, stdout_json


def main() -> None:
    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
    if not raw:
        stdout_json({"ok": False, "error": "缺少入参"})
        sys.exit(1)

    params: dict = json.loads(raw)
    workspace_name: str = params.get("workspace_name", "").strip()
    entity_code: str = params.get("entity_code", "").strip()
    action_code: str = params.get("action_code", "").strip()

    if not workspace_name:
        stdout_json({"ok": False, "error": "workspace_name 不能为空"})
        sys.exit(1)
    if not entity_code:
        stdout_json({"ok": False, "error": "entity_code 不能为空"})
        sys.exit(1)
    if not action_code:
        stdout_json({"ok": False, "error": "action_code 不能为空"})
        sys.exit(1)
    if params.get("params") is None:
        stdout_json({"ok": False, "error": "params（Action 入参）不能为 null"})
        sys.exit(1)

    payload: dict = {
        "workspace_name": workspace_name,
        "entity_code": entity_code,
        "action_code": action_code,
        "params": params.get("params", {}),
    }
    # 可选：临时覆盖脚本（不传则服务端读工作区文件）
    if params.get("script", "").strip():
        payload["script"] = params["script"].strip()

    result = post_ontology_api("/workspace/object/run-action", payload)
    stdout_json(result)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        stdout_json({"ok": False, "error": str(exc)})
        sys.exit(1)
