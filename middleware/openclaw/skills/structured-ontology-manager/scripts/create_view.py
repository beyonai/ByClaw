#!/usr/bin/env python3
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
        "object_relations": [
            {
                "source_object_code": "by_task",
                "source_object_field_code": "user_id",
                "target_object_code": "by_user",
                "target_object_field_code": "id",
                "relation_type": "MANY_TO_ONE"
            }
        ]
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
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))


def main() -> None:
    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
    if not raw:
        print(json.dumps({"ok": False, "error": "缺少入参"}), flush=True)
        sys.exit(1)

    # 预加载 Embedding 模型配置（从 Redis），使 build_terms 内的向量回填可用
    from _common import load_embedding_model_from_redis

    load_embedding_model_from_redis()

    params: dict = json.loads(raw)
    action: str = params.get("action", "collect").lower().strip()
    session_id: str = params.get("session_id", "")
    view_code: str = params.get("view_code", "").strip()

    if not view_code:
        print(json.dumps({"ok": False, "error": "view_code 不能为空"}), flush=True)
        sys.exit(1)

    from datacloud_knowledge.ingestion.ontology_build import OntologyBuildSession

    session = OntologyBuildSession()

    if action == "collect":
        state = session.collect_view_info(
            view_code=view_code,
            session_id=session_id,
            view_name=params.get("view_name", ""),
            view_desc=params.get("view_desc", ""),
            object_codes=params.get("object_codes"),
            object_relations=params.get("object_relations"),
        )
        missing = state.pop("missing", [])
        print(
            json.dumps({"ok": True, "state": state, "missing": missing}, ensure_ascii=False),
            flush=True,
        )

    elif action == "submit":
        result = session.submit_view(view_code=view_code, session_id=session_id)
        print(json.dumps(result, ensure_ascii=False), flush=True)

    else:
        print(
            json.dumps({"ok": False, "error": f"未知 action: {action}，合法值: collect/submit"}),
            flush=True,
        )
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), flush=True)
        sys.exit(1)
