#!/usr/local/bin/python3
"""删除工作区（⚠️ 删除整个工作区目录，不可逆，需二次确认后调用）。

只删除本地工作区文件，不删除已提交到本体库的 OWL 数据。
如需同时清理已提交数据，请先分别调用 delete_object.py 和 delete_view.py。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON）:
    {
        "workspace_name": "travel_reimbursement"   # 必填
    }

出参（stdout JSON）:
    {"ok": true, "workspace_name": "travel_reimbursement", "existed": true}
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

    params: dict = json.loads(raw) if raw.strip().startswith("{") else {"workspace_name": raw.strip()}
    workspace_name: str = params.get("workspace_name", "").strip()

    if not workspace_name:
        stdout_json({"ok": False, "error": "workspace_name 不能为空"})
        sys.exit(1)

    result = post_ontology_api("/workspace/delete", {
        "workspace_name": workspace_name,
    })
    stdout_json(result)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        stdout_json({"ok": False, "error": str(exc)})
        sys.exit(1)
