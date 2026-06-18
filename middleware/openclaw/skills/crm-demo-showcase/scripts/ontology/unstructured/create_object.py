#!/usr/local/bin/python3
"""创建非结构化本体对象（信息收集 + 提交两阶段）。

I/O 协议：stdin JSON → stdout JSON

所有业务逻辑由 datacloud_data_service 的 ontology-manager API 提供服务。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import _common


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
        result = _common.post_ontology_api(
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
        if not result.get("ok", True):
            result["entity_code"] = entity_code
            print(json.dumps(result, ensure_ascii=False), flush=True)
            return
        missing = result.pop("missing", []) if isinstance(result.get("missing"), list) else []
        if not params.get("kb_id"):
            missing.append("kb_id")
        result["entity_code"] = entity_code
        print(
            json.dumps({"ok": True, "state": result, "missing": missing}, ensure_ascii=False),
            flush=True,
        )

    elif action == "submit":
        _common.load_embedding_model_from_redis()
        result = _common.post_ontology_api(
            "/object/submit",
            {"entity_code": entity_code, "session_id": session_id},
        )
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
