#!/usr/local/bin/python3
"""删除结构化本体对象。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON）:
    {
        "entity_code": "p_by_my_task_adminvip_a1b2c3",   # 必填
        "user_code": "adminvip"                           # 可选，建表删除需要
    }

出参（stdout JSON）:
    {"ok": true, "entity_code": "..."}
    {"ok": false, "error": "..."}

删除流程（三步顺序执行，任意一步失败终止）:
    1. delete_owl_scope("OBJECT", entity_code) — 清除术语库数据
    2. drop_table(entity_code) — 删建表（需要通过 user_code 定位服务）
    3. deleteResourceByCode(entity_code) — 下架本体（门户服务）

所有业务逻辑由 datacloud_data_service 的 ontology-manager API 提供服务。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from _common import post_ontology_api


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

    result = post_ontology_api(
        "/object/delete",
        {
            "entity_code": entity_code,
            "user_code": params.get("user_code", ""),
        },
    )
    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), flush=True)
        sys.exit(1)
