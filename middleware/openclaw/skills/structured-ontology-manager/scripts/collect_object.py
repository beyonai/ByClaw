#!/usr/local/bin/python3
"""收集对象字段定义（多轮合并，字段写入服务端工作区）。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON）:
    {
        "workspace_name": "travel_reimbursement",   # 必填
        "entity_code":    "travel_application",     # 必填，snake_case
        "entity_name":    "出差申请",                 # 可选
        "entity_desc":    "记录员工一次完整出差报销的主单据",  # 可选
        "fields": [                                  # 可选，多次调用按 property_code 合并
            {
                "property_code": "applicant_code",
                "property_name": "申请人",
                "data_type":     "STRING",
                "ext_property":  {
                    "property_role_rule": {"property_role": "DIMENSION", "rule_type": "owner"}
                },
                "required": true
            }
        ],
        "term_sync": {                               # 可选，DYNAMIC_TABLE 对象自动同步记录到术语库
            "enabled": true,
            "term_name_field": "employee_name",      # 记录中作为术语名称的字段
            "term_code_field": "id",                 # 记录中作为术语编码的字段，默认 id
            "term_desc_field": "description",        # 记录中作为术语描述的字段（可选）
            "sync_on": ["insert", "update", "delete"]
        }
    }

出参（stdout JSON）:
    {
        "ok":      true,
        "state":   { ...当前工作区文件中的完整字段定义... },
        "missing": []           # 仍缺失的必填信息，非空时需继续追问
    }

字段写入服务端 workspace/<name>/objects/<entity_code>/fields.json。
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

    payload: dict = {
        "workspace_name": workspace_name,
        "entity_code": entity_code,
    }
    if params.get("entity_name"):
        payload["entity_name"] = params["entity_name"]
    if params.get("entity_desc"):
        payload["entity_desc"] = params["entity_desc"]
    if params.get("fields") is not None:
        payload["fields"] = params["fields"]
    if params.get("term_sync") is not None:
        payload["term_sync"] = params["term_sync"]

    result = post_ontology_api("/workspace/object/collect", payload)
    stdout_json(result)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        stdout_json({"ok": False, "error": str(exc)})
        sys.exit(1)
