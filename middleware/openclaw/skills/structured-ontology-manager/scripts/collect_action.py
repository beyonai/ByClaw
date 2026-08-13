#!/usr/local/bin/python3
"""收集 Action 定义（脚本 + 参数 + 权限），写入服务端工作区文件。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON）:
    {
        "workspace_name":   "travel_reimbursement",   # 必填
        "entity_code":      "travel_application",     # 必填
        "action_code":      "travel_application_submit",     # 必填，snake_case，对象编码作前缀
        "action_name":      "提交申请",                 # 必填
        "action_type":      "OPERATION",                # 必填，QUERY（查询类）或 OPERATION（操作类）
        "action_desc":      "汇总费用、校验审批人、更新状态为已提交",  # 可选
        "object_references": ["travel_expense", "travel_itinerary"],  # 可选，脚本依赖的其他对象编码
        "script":           "def execute(params: dict) -> dict:\n    ...",  # 必填
        "params": [                                    # 必填，入参 + 出参
            {
                "paramCode":      "status",
                "paramName":      "申请状态",
                "type":           "string",
                "isRequired":     true,
                "direction":      "input",
                "term_type_code": "travel_application_status",   # 字段有 term_values 时填 {entity_code}_{property_code}
                "term_data_type": "DICT_TERM"                    # term_values 内联枚举 → DICT_TERM
            },
            {
                "paramCode":      "app_id",
                "paramName":      "关联申请单",
                "type":           "integer",
                "isRequired":     true,
                "direction":      "input",
                "term_type_code": "travel_application_app_title", # 外键字段填父表的 term_type_code
                "term_data_type": "LIST_TERM"                    # 绑定动态列表（用户、申请单等）→ LIST_TERM
            },
            {"paramCode": "success", "paramName": "是否成功", "type": "boolean", "isRequired": false, "direction": "output"}
        ],
        "permission_roles": ["employee"]               # 可选，允许调用的角色
    }

出参（stdout JSON）:
    {
        "ok":          true,
        "action_code": "travel_application_submit",
        "file":        "objects/travel_application/actions/travel_application_submit.py"
    }

同一 action_code 多次调用直接覆盖，用于调试后修正脚本。
脚本存储在服务端工作区：objects/{entity_code}/actions/{action_code}.py
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
    entity_code: str = params.get("entity_code", "").strip()
    action_code: str = params.get("action_code", "").strip()
    action_name: str = params.get("action_name", "").strip()
    action_type: str = params.get("action_type", "OPERATION").strip().upper()
    script: str = params.get("script", "").strip()

    if not workspace_name:
        stdout_json({"ok": False, "error": "workspace_name 不能为空"})
        sys.exit(1)
    if not entity_code:
        stdout_json({"ok": False, "error": "entity_code 不能为空"})
        sys.exit(1)
    if not action_code:
        stdout_json({"ok": False, "error": "action_code 不能为空"})
        sys.exit(1)
    if not action_name:
        stdout_json({"ok": False, "error": "action_name 不能为空"})
        sys.exit(1)
    if action_type not in ("QUERY", "OPERATION"):
        stdout_json({"ok": False, "error": "action_type 必须为 QUERY 或 OPERATION"})
        sys.exit(1)
    if not script:
        stdout_json({"ok": False, "error": "script 不能为空"})
        sys.exit(1)

    action_params = params.get("params")
    if not action_params:
        stdout_json({"ok": False, "error": "params（入参/出参定义）不能为空"})
        sys.exit(1)

    payload: dict = {
        "workspace_name": workspace_name,
        "entity_code": entity_code,
        "action_code": action_code,
        "action_name": action_name,
        "action_type": action_type,
        "script": script,
        "params": action_params,
    }
    if params.get("action_desc"):
        payload["action_desc"] = params["action_desc"]
    if params.get("object_references"):
        payload["object_references"] = params["object_references"]
    if params.get("permission_roles"):
        payload["permission_roles"] = params["permission_roles"]

    result = post_ontology_api("/workspace/object/collect-action", payload)
    stdout_json(result)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        stdout_json({"ok": False, "error": str(exc)})
        sys.exit(1)
