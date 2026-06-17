#!/usr/local/bin/python3
"""创建结构化本体视图（信息收集 + 提交两阶段）。

I/O 协议：stdin JSON → stdout JSON

## 阶段一：信息收集（action="collect"）

入参（stdin JSON）:
    {
        "action": "collect",
        "session_id": "uuid-xxx",
        "view_code": "v_task_user",
        "view_name": "任务用户视图",
        "view_desc": "任务与用户的关联视图",
        "object_codes": ["by_task", "by_user"],
        "object_relations": [
            {
                "source_object_code": "by_task",
                "source_object_field_code": "user_id",
                "target_object_code": "by_user",
                "target_object_field_code": "id",
                "relation_type": "MANY_TO_ONE"
            }
        ],
        "fields": [...]
    }

出参（stdout JSON）:
    {
        "ok": true,
        "state": { ...当前暂存状态... },
        "missing": ["view_name"]
    }

## 阶段二：信息提交（action="submit"）

入参（stdin JSON）:
    {
        "action": "submit",
        "session_id": "uuid-xxx",
        "view_code": "v_task_user"
    }

出参（stdout JSON）:
    {"ok": true, "resource_id": "..."}

所有业务逻辑由 datacloud_data_service 的 ontology-manager API 提供服务。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from _common import load_embedding_model_from_redis, post_ontology_api


def main() -> None:
    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
    if not raw:
        print(json.dumps({"ok": False, "error": "缺少入参"}), flush=True)
        sys.exit(1)

    load_embedding_model_from_redis()

    params: dict = json.loads(raw)
    action: str = params.get("action", "collect").lower().strip()
    session_id: str = params.get("session_id", "")
    view_code: str = params.get("view_code", "").strip()

    if not view_code:
        print(json.dumps({"ok": False, "error": "view_code 不能为空"}), flush=True)
        sys.exit(1)

    if action == "collect":
        result = post_ontology_api(
            "/view/collect",
            {
                "view_code": view_code,
                "session_id": session_id,
                "view_name": params.get("view_name", ""),
                "view_desc": params.get("view_desc", ""),
                "object_codes": params.get("object_codes"),
                "object_relations": params.get("object_relations"),
                "fields": params.get("fields"),
            },
        )
        print(json.dumps(result, ensure_ascii=False), flush=True)

    elif action == "submit":
        result = post_ontology_api(
            "/view/submit",
            {"view_code": view_code, "session_id": session_id},
        )
        print(json.dumps(result, ensure_ascii=False), flush=True)

    else:
        print(
            json.dumps(
                {"ok": False, "error": f"未知 action: {action}，合法值: collect/submit"},
                ensure_ascii=False,
            ),
            flush=True,
        )
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), flush=True)
        sys.exit(1)
