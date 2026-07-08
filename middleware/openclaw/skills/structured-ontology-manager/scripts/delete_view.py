#!/usr/local/bin/python3
"""删除结构化本体视图。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON）:
    {
        "view_code": "v_task_user"   # 必填
    }

出参（stdout JSON）:
    {"ok": true, "view_code": "v_task_user"}
    {"ok": false, "error": "..."}

所有业务逻辑由 datacloud_platform 的 ontology-manager API 提供服务。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from _common import post_ontology_api


def main() -> None:
    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
    if not raw:
        print(json.dumps({"ok": False, "error": "缺少入参"}), flush=True)
        sys.exit(1)

    params: dict = json.loads(raw)
    view_code: str = params.get("view_code", "").strip()

    if not view_code:
        print(json.dumps({"ok": False, "error": "view_code 不能为空"}), flush=True)
        sys.exit(1)

    result = post_ontology_api(
        "/view/delete",
        {"view_code": view_code},
    )
    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), flush=True)
        sys.exit(1)
