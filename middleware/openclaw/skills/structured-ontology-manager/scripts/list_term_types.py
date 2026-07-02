#!/usr/local/bin/python3
"""查询可绑定的术语类型列表。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON，可选）:
    {"keyword": "用户"}   # 可选，按 type_code 模糊过滤

出参（stdout JSON）:
    {
        "ok": true,
        "data": [
            {
                "type_code": "user_name",
                "samples": [{"term_code": "001", "term_name": "黄药师"}]
            }
        ]
    }

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
    params: dict = json.loads(raw) if raw else {}
    keyword: str = params.get("keyword", "")

    result = post_ontology_api(
        "/term-types/list",
        {"keyword": keyword},
    )
    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), flush=True)
        sys.exit(1)
