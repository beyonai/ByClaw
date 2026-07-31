#!/usr/local/bin/python3
"""删除已提交的视图（⚠️ 不可逆，需二次确认后调用）。

同时删除工作区本地文件、OWL 数据和 Discovery 注册。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON）:
    {
        "workspace_name": "travel_reimbursement",   # 必填
        "view_code":      "v_travel_full"           # 必填
    }

出参（stdout JSON）:
    {"ok": true}
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
        stdout_json({"ok": False, "error": "缺少入参，需要 workspace_name 和 view_code"})
        sys.exit(1)

    params: dict = json.loads(raw)
    workspace_name: str = params.get("workspace_name", "").strip()
    view_code: str = params.get("view_code", "").strip()

    if not workspace_name:
        stdout_json({"ok": False, "error": "workspace_name 不能为空"})
        sys.exit(1)
    if not view_code:
        stdout_json({"ok": False, "error": "view_code 不能为空"})
        sys.exit(1)

    result = post_ontology_api("/workspace/view/delete", {
        "workspace_name": workspace_name,
        "view_code": view_code,
    })
    stdout_json(result)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        stdout_json({"ok": False, "error": str(exc)})
        sys.exit(1)
