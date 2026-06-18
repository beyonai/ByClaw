#!/usr/local/bin/python3
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
        "kb_id": "kb-001",
        "kb_directory": "/meeting",
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

    params: dict = json.loads(raw)
    action: str = params.get("action", "collect").lower().strip()
    session_id: str = params.get("session_id", "")
    entity_code: str = params.get("entity_code", "").strip()

    if not entity_code:
        print(json.dumps({"ok": False, "error": "entity_code 不能为空"}), flush=True)
        sys.exit(1)

    if action == "collect":
        result = post_ontology_api(
            "/object/collect",
            {
                "entity_code": entity_code,
                "session_id": session_id,
                "entity_name": params.get("entity_name", ""),
                "entity_desc": params.get("entity_desc", ""),
                "fields": params.get("fields"),
                "kb_id": params.get("kb_id", ""),
                "kb_directory": params.get("kb_directory", ""),
            },
        )
        # 非结构化还需要 kb_id：检查入参而非 API 返回值
        if result.get("ok", True):
            missing = result.pop("missing", []) if isinstance(result.get("missing"), list) else []
            if not params.get("kb_id"):
                missing.append("kb_id")
            result["missing"] = missing
        if result and "entity_code" in result:
            result["entity_code"] = entity_code
        print(json.dumps(result, ensure_ascii=False), flush=True)

    elif action == "submit":
        load_embedding_model_from_redis()
        result = post_ontology_api(
            "/object/submit",
            {"entity_code": entity_code, "session_id": session_id},
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
