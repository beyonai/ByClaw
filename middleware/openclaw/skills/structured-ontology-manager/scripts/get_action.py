#!/usr/local/bin/python3
"""查询单个 Action 详情（含脚本内容）。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON）:
    {
        "workspace_name": "travel_reimbursement",   # 必填
        "entity_code":    "travel_application",     # 必填
        "action_code":    "travel_application_submit"      # 必填
    }

出参（stdout JSON）:
    {
        "ok":          true,
        "action_code": "travel_application_submit",
        "action_name": "提交申请",
        "action_desc": "...",
        "script":      "def execute(params: dict) -> dict:\n    ...",
        "params": [
            {"paramCode": "app_id", "paramName": "申请ID", "type": "string", "isRequired": true, "direction": "input"},
            {"paramCode": "success", "paramName": "是否成功", "type": "boolean", "direction": "output"}
        ],
        "permission_roles": ["employee"]
    }
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).parent))

from _common import get_ontology_api, stdout_json


def main() -> None:
    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
    if not raw:
        stdout_json({"ok": False, "error": "缺少入参，需要 workspace_name、entity_code 和 action_code"})
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

    qs = urlencode({"workspace_name": workspace_name})
    result = get_ontology_api(f"/workspace/object/{entity_code}/action/{action_code}?{qs}")
    stdout_json(result)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        stdout_json({"ok": False, "error": str(exc)})
        sys.exit(1)
