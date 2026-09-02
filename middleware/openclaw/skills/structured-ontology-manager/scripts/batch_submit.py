#!/usr/local/bin/python3
"""批量提交工作区所有对象和视图，在服务端生成 SDK 文件。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON）:
    {
        "workspace_name": "travel_reimbursement",   # 必填
        "owner_type": "personal",                    # 可选；缺失或空值时为 personal
        "tenant_id": "tenant-a",                     # 企业可选；通过 X-Tenant-Id 发送
        "only": ["travel_application", "v_travel_full"]  # 可选，指定只提交部分
    }

出参（stdout JSON）:
    {
        "ok": true,
        "submitted_objects": ["travel_application", "travel_itinerary"],
        "submitted_views":   ["v_travel_full"],
        "failed": [
            {"code": "travel_expense", "error": "字段 expense_type 缺少 term_type_code 绑定"}
        ],
        "sdk_files": {
            "travel_application": "# AUTO-GENERATED...",
            "travel_itinerary":   "# AUTO-GENERATED..."
        }
    }

提交成功后：
  - 服务端工作区 sdk/ 目录写入 <entity_code>_sdk.py
  - 状态从 draft/failed → submitted
  - 可通过 GET /workspace/{name}/sdk/{entity_code} 获取 SDK 内容
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
    owner_type = str(params.get("owner_type") or "personal").strip().lower()
    if owner_type not in {"personal", "enterprise"}:
        stdout_json({"ok": False, "error": "owner_type 必须为 personal 或 enterprise"})
        sys.exit(1)
    payload["owner_type"] = owner_type
    if params.get("base_id"):
        payload["base_id"] = params["base_id"]
    if params.get("only"):
        payload["only"] = params["only"]
    if params.get("confirm_drop_columns"):
        payload["confirm_drop_columns"] = True
    if params.get("confirm_scope_conversion"):
        payload["confirm_scope_conversion"] = True
    if params.get("confirm_drop_target_tables"):
        payload["confirm_drop_target_tables"] = True
    if params.get("publish_id"):
        payload["publish_id"] = params["publish_id"]

    tenant_id = str(params.get("tenant_id", "")).strip() or None
    result = post_ontology_api(
        "/workspace/batch-submit",
        payload,
        tenant_id=tenant_id if owner_type == "enterprise" else None,
    )
    stdout_json(result)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        stdout_json({"ok": False, "error": str(exc)})
        sys.exit(1)
