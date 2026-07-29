#!/usr/local/bin/python3
"""查询术语类型的枚举值列表。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON）:
    {
        "term_type_code": "approval_status",   # 必填，术语类型编码
        "keyword":        "批"                  # 可选，按枚举值名称过滤
    }

出参（stdout JSON）:
    {
        "ok": true,
        "term_type_code": "approval_status",
        "data": [
            {"term_code": "PENDING",   "term_name": "待审批"},
            {"term_code": "APPROVED",  "term_name": "已批准"},
            {"term_code": "REJECTED",  "term_name": "已拒绝"}
        ]
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
        stdout_json({"ok": False, "error": "缺少入参，需要 term_type_code"})
        sys.exit(1)

    params: dict = json.loads(raw)
    term_type_code: str = params.get("term_type_code", "").strip()
    if not term_type_code:
        stdout_json({"ok": False, "error": "term_type_code 不能为空"})
        sys.exit(1)

    payload: dict = {"term_type_code": term_type_code}
    if params.get("keyword"):
        payload["keyword"] = params["keyword"]

    result = post_ontology_api("/term-types/values", payload)
    stdout_json(result)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        stdout_json({"ok": False, "error": str(exc)})
        sys.exit(1)
