#!/usr/local/bin/python3
"""收集视图定义（跨对象关联查询）。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON）:
    {
        "workspace_name":   "travel_reimbursement",    # 必填
        "view_code":        "v_travel_full",           # 必填，snake_case，建议 v_ 前缀
        "view_name":        "差旅全视图",               # 必填
        "view_desc":        "申请关联行程和费用的聚合视图",  # 可选
        "object_codes":     ["travel_application", "travel_itinerary", "travel_expense"],  # 必填
        "object_relations": [                           # 必填，对象间关联关系
            {
                "source_object_code":       "travel_itinerary",
                "source_object_field_code": "app_id",
                "target_object_code":       "travel_application",
                "target_object_field_code": "id",
                "relation_type":            "MANY_TO_ONE"
            }
        ],
        "fields": [...]   # 可选，不填时自动从各对象字段推导
    }

出参（stdout JSON）:
    {
        "ok":           true,
        "view_code":    "v_travel_full",
        "fields_count": 14,
        "missing":      []
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
        stdout_json({"ok": False, "error": "缺少入参"})
        sys.exit(1)

    params: dict = json.loads(raw)
    workspace_name: str = params.get("workspace_name", "").strip()
    view_code: str = params.get("view_code", "").strip()
    view_name: str = params.get("view_name", "").strip()

    if not workspace_name:
        stdout_json({"ok": False, "error": "workspace_name 不能为空"})
        sys.exit(1)
    if not view_code:
        stdout_json({"ok": False, "error": "view_code 不能为空"})
        sys.exit(1)
    if not view_name:
        stdout_json({"ok": False, "error": "view_name 不能为空"})
        sys.exit(1)

    payload: dict = {
        "workspace_name": workspace_name,
        "view_code": view_code,
        "view_name": view_name,
        "object_codes": params.get("object_codes") or [],
        "object_relations": params.get("object_relations") or [],
    }
    if params.get("view_desc"):
        payload["view_desc"] = params["view_desc"]
    if params.get("fields"):
        payload["fields"] = params["fields"]

    result = post_ontology_api("/workspace/view/collect", payload)
    stdout_json(result)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        stdout_json({"ok": False, "error": str(exc)})
        sys.exit(1)
