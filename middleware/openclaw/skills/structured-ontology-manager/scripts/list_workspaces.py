#!/usr/local/bin/python3
"""列出当前用户所有本体工作区及待提交摘要。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON）:
    {}   # 无需任何参数，用户身份从环境变量 USER_CODE 获取

出参（stdout JSON）:
    {
        "ok": true,
        "total": 2,
        "workspaces": [
            {
                "workspace_name": "travel_reimbursement",
                "workspace_desc": "差旅报销业务模块",
                "object_count": 4,
                "view_count": 1,
                "pending_count": 2,
                "has_pending": true,
                "pending_objects": ["travel_expense", "travel_invoice"],
                "pending_views": []
            },
            {
                "workspace_name": "hr_onboarding",
                "workspace_desc": "入职流程业务模块",
                "object_count": 3,
                "view_count": 0,
                "pending_count": 0,
                "has_pending": false,
                "pending_objects": [],
                "pending_views": []
            }
        ]
    }

has_pending 为 true 表示该工作区存在 draft 或 failed 状态的对象/视图，需要执行 batch-submit。
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from _common import get_ontology_api, stdout_json


def main() -> None:
    result = get_ontology_api("/workspace/list")
    stdout_json(result)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        stdout_json({"ok": False, "error": str(exc)})
        sys.exit(1)
