#!/usr/bin/env python3
"""删除非结构化本体对象（不删知识库，不删表）。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON）:
    {
        "entity_code": "by_meeting_note"   # 必填
    }

出参（stdout JSON）:
    {"ok": true, "entity_code": "by_meeting_note"}
    {"ok": false, "error": "..."}

删除流程（两步顺序执行）:
    1. delete_owl_scope("OBJECT", entity_code) — 清除术语库数据
    2. deleteResourceByCode(entity_code) — 下架本体（门户服务）
    注意：不删除知识库，不删除 SQLite 表（非结构化无表）
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent / "lib"))

from _common import delete_resource_by_code


def main() -> None:
    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
    if not raw:
        print(json.dumps({"ok": False, "error": "缺少入参"}), flush=True)
        sys.exit(1)

    params: dict = json.loads(raw)
    entity_code: str = params.get("entity_code", "").strip()

    if not entity_code:
        print(json.dumps({"ok": False, "error": "entity_code 不能为空"}), flush=True)
        sys.exit(1)

    from datacloud_knowledge.ingestion.ontology_build import OntologyBuildSession

    session = OntologyBuildSession()

    # 步骤一：清除术语库数据
    session.delete_owl_scope("OBJECT", entity_code)

    # 步骤二：下架本体（不删知识库，不删表）
    delete_resource_by_code(entity_code)

    print(json.dumps({"ok": True, "entity_code": entity_code}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), flush=True)
        sys.exit(1)
