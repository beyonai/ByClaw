#!/usr/local/bin/python3
"""列出工作区已提交的对象列表。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON）:
    {
        "workspace_name": "travel_reimbursement",   # 必填
        "keyword":        "travel"                  # 可选，按编码或名称过滤
    }

出参（stdout JSON）:
    {
        "ok": true,
        "data": [
            {
                "entity_code": "travel_application",
                "entity_name": "出差申请",
                "resource_id": "res-abc123"
            }
        ]
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
        stdout_json({"ok": False, "error": "缺少入参，需要 workspace_name"})
        sys.exit(1)

    params: dict = json.loads(raw)
    workspace_name: str = params.get("workspace_name", "").strip()
    if not workspace_name:
        stdout_json({"ok": False, "error": "workspace_name 不能为空"})
        sys.exit(1)

    qs: dict = {"workspace_name": workspace_name}
    if params.get("keyword"):
        qs["keyword"] = params["keyword"]

    path = "/workspace/object/list?" + urlencode(qs)
    result = get_ontology_api(path)
    stdout_json(result)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        stdout_json({"ok": False, "error": str(exc)})
        sys.exit(1)
