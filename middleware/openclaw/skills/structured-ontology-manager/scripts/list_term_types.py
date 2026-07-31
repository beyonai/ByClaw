#!/usr/local/bin/python3
"""查询可绑定的术语类型列表。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON）:
    {
        "keyword": "状态"   # 可选，按名称或编码过滤
    }

出参（stdout JSON）:
    {
        "ok": true,
        "data": [
            {
                "term_type_code": "approval_status",
                "term_type_name": "审批状态",
                "samples": ["待审批", "已批准", "已拒绝"]
            }
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
    params: dict = json.loads(raw) if raw else {}

    payload: dict = {}
    if params.get("keyword"):
        payload["keyword"] = params["keyword"]

    result = post_ontology_api("/term-types/list", payload)
    stdout_json(result)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        stdout_json({"ok": False, "error": str(exc)})
        sys.exit(1)
