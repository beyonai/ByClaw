#!/usr/local/bin/python3
"""查询工作区状态（对象列表、提交状态、错误信息）。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON）:
    {
        "workspace_name": "travel_reimbursement"   # 必填
    }

出参（stdout JSON）:
    {
        "ok": true,
        "workspace_name": "travel_reimbursement",
        "description": "...",
        "created_at": "2026-06-25T10:00:00Z",
        "objects": {
            "travel_application": {
                "status": "submitted",
                "actual_code": "p_travel_application_u001_a3f2c1",
                "resource_id": "res-abc123",
                "submitted_at": "2026-06-25T11:30:00Z"
            },
            "travel_expense": {
                "status": "failed",
                "error": "字段 expense_type 缺少 term_type_code 绑定"
            }
        },
        "views": {
            "v_travel_full": {"status": "draft"}
        }
    }
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from _common import get_ontology_api, stdout_json


def main() -> None:
    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
    if not raw:
        stdout_json({"ok": False, "error": "缺少入参，需要 workspace_name"})
        sys.exit(1)

    params: dict = json.loads(raw) if raw.strip().startswith("{") else {"workspace_name": raw.strip()}
    workspace_name: str = params.get("workspace_name", "").strip()
    if not workspace_name:
        stdout_json({"ok": False, "error": "workspace_name 不能为空"})
        sys.exit(1)

    result = get_ontology_api(f"/workspace/{workspace_name}")
    stdout_json(result)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        stdout_json({"ok": False, "error": str(exc)})
        sys.exit(1)
