#!/usr/bin/env python3
"""删除结构化本体对象（含删表）。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON）:
    {
        "entity_code": "by_my_task",   # 必填
        "user_code": "00270025"        # 可选，用于 SQLite 操作日志
    }

出参（stdout JSON）:
    {"ok": true, "entity_code": "by_my_task"}
    {"ok": false, "error": "..."}

删除流程（三步顺序执行，步骤一失败则终止）:
    1. deleteResourceByCode(entity_code) — 下架本体（门户服务），被引用时失败终止
    2. drop_table(entity_code)           — 删除 SQLite 表（IF EXISTS，表不存在也安全）
    3. delete_owl_scope("OBJECT", ...)   — 清除术语库数据
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

    from datacloud_data_sdk.ddl.table_manager import drop_table
    from datacloud_knowledge.ingestion.ontology_build import OntologyBuildSession

    session = OntologyBuildSession()

    # 步骤一：下架本体（被引用时门户会拒绝，直接终止）
    delete_resource_by_code(entity_code)

    # 步骤二：删除 SQLite 表（IF EXISTS，表不存在也安全）
    drop_table(entity_code)

    # 步骤三：清除术语库数据
    session.delete_owl_scope("OBJECT", entity_code)

    print(json.dumps({"ok": True, "entity_code": entity_code}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), flush=True)
        sys.exit(1)
