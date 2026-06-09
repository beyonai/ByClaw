#!/usr/bin/env python3
"""创建非结构化本体对象（信息收集 + 提交两阶段）。

I/O 协议：stdin JSON → stdout JSON

## 阶段一：信息收集（action="collect"）

入参（stdin JSON）:
    {
        "action": "collect",
        "session_id": "uuid-xxx",
        "entity_code": "by_meeting_note",
        "entity_name": "会议纪要",
        "entity_desc": "会议纪要文档对象",
        "kb_id": "kb-001",              # 知识库编码（resourceCode），来自 list_knowledge_bases.py 返回的 resourceCode 字段，不是 resourceId
        "kb_directory": "/meeting",     # 知识库目录，来自 list_kb_directories.py
        "fields": [
            {
                "property_code": "topic",
                "property_name": "主题",
                "data_type": "STRING",
                "ext_property": {}
            }
        ]
    }

出参（stdout JSON）:
    {
        "ok": true,
        "state": { ...当前暂存状态... },
        "missing": ["entity_name", "kb_id"]
    }

## 阶段二：信息提交（action="submit"）

入参（stdin JSON）:
    {
        "action": "submit",
        "session_id": "uuid-xxx",
        "entity_code": "by_meeting_note"
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
            kb_id=params.get("kb_id", ""),
            kb_directory=params.get("kb_directory", ""),
        )
        if not state.get("ok", True):
            print(json.dumps(state, ensure_ascii=False), flush=True)
            return
        missing = state.pop("missing", [])
        # 非结构化还需要 kb_id
        if not state.get("kb_id"):
            missing.append("kb_id")
        print(
            json.dumps({"ok": True, "state": state, "missing": missing}, ensure_ascii=False),
            flush=True,
        )

    elif action == "submit":
        from _common import load_embedding_model_from_redis

        load_embedding_model_from_redis()
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
