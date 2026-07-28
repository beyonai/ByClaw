#!/usr/local/bin/python3
"""初始化本体开发工作区。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON）:
    {
        "workspace_name": "travel_reimbursement",   # 必填，snake_case
        "description":    "差旅报销业务模块",          # 可选（映射到 workspace_desc）
        "objects": ["travel_application", "travel_itinerary"]  # 可选，预声明对象列表
    }

出参（stdout JSON）:
    {
        "ok": true,
        "workspace_name": "travel_reimbursement",
        "objects": {"travel_application": {"status": "draft"}, ...},
        "views": {}
    }
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
        stdout_json({"ok": False, "error": "缺少入参，需要 workspace_name"})
        sys.exit(1)

    params: dict = json.loads(raw)
    workspace_name: str = params.get("workspace_name", "").strip()
    if not workspace_name:
        stdout_json({"ok": False, "error": "workspace_name 不能为空"})
        sys.exit(1)

    payload: dict = {"workspace_name": workspace_name}
    if params.get("description"):
        payload["workspace_desc"] = params["description"]
    if params.get("objects"):
        payload["object_codes"] = params["objects"]

    result = post_ontology_api("/workspace/init", payload)
    stdout_json(result)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        stdout_json({"ok": False, "error": str(exc)})
        sys.exit(1)
