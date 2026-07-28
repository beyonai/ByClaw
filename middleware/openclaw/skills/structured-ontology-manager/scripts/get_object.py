#!/usr/local/bin/python3
"""查询对象完整定义（含字段、Actions）。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON）:
    {
        "workspace_name": "travel_reimbursement",   # 必填
        "entity_code":    "travel_application"      # 必填
    }

出参（stdout JSON）:
    {
        "ok": true,
        "entity_code":  "travel_application",
        "entity_name":  "出差申请",
        "entity_desc":  "...",
        "status":       "submitted",
        "actual_code":  "p_travel_application_u001_a3f2c1",
        "resource_id":  "res-abc123",
        "fields": [...],
        "actions": [...]
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
        stdout_json({"ok": False, "error": "缺少入参，需要 workspace_name 和 entity_code"})
        sys.exit(1)

    params: dict = json.loads(raw)
    workspace_name: str = params.get("workspace_name", "").strip()
    entity_code: str = params.get("entity_code", "").strip()

    if not workspace_name:
        stdout_json({"ok": False, "error": "workspace_name 不能为空"})
        sys.exit(1)
    if not entity_code:
        stdout_json({"ok": False, "error": "entity_code 不能为空"})
        sys.exit(1)

    qs = urlencode({"workspace_name": workspace_name})
    result = get_ontology_api(f"/workspace/object/{entity_code}?{qs}")
    stdout_json(result)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        stdout_json({"ok": False, "error": str(exc)})
        sys.exit(1)
