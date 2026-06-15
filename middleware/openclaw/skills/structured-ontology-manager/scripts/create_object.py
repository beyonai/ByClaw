#!/usr/bin/env python3
"""创建结构化本体对象（信息收集 + 提交两阶段）。

I/O 协议：stdin JSON → stdout JSON

## 阶段一：信息收集（action="collect"）

入参（stdin JSON）:
    {
        "action": "collect",
        "session_id": "uuid-xxx",          # 多用户隔离，必填（生产），开发可省略
        "entity_code": "by_my_task",       # 必填
        "entity_name": "我的任务",           # 可选，多轮填充
        "entity_desc": "个人任务管理",       # 可选
        "fields": [                        # 可选，多轮填充
            {
                "property_code": "title",
                "property_name": "标题",
                "data_type": "STRING",
                "ext_property": {
                    "property_role_rule": {"property_role": "DIMENSION", "rule_type": "name"}
                }
            }
        ]
    }

出参（stdout JSON）:
    {
        "ok": true,
        "state": { ...当前暂存状态... },
        "missing": ["entity_name"]         # 仍缺失的必填字段
    }

## 阶段二：信息提交（action="submit"）

入参（stdin JSON）:
    {
        "action": "submit",
        "session_id": "uuid-xxx",
        "entity_code": "by_my_task"
    }

出参（stdout JSON）:
    {"ok": true, "resource_id": "..."}
    {"ok": false, "missing": [...], "error": "..."}
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
    entity_code: str = params.get("entity_code", "").strip()

    if not entity_code:
        print(json.dumps({"ok": False, "error": "entity_code 不能为空"}), flush=True)
        sys.exit(1)

    from datacloud_knowledge.ingestion.ontology_build import OntologyBuildSession

    session = OntologyBuildSession()

    if action == "collect":
        state = session.collect_object_info(
            entity_code=entity_code,
            session_id=session_id,
            entity_name=params.get("entity_name", ""),
            entity_desc=params.get("entity_desc", ""),
            fields=params.get("fields"),
        )
        if not state.get("ok", True):
            print(json.dumps(state, ensure_ascii=False), flush=True)
            return
        missing = state.pop("missing", [])
        print(
            json.dumps({"ok": True, "state": state, "missing": missing}, ensure_ascii=False),
            flush=True,
        )

    elif action == "submit":
        result = session.submit_object(entity_code=entity_code, session_id=session_id)
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
