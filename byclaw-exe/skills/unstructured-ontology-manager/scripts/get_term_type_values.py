#!/usr/bin/env python3
"""查询指定术语类型的值列表（与 structured-ontology-manager 相同逻辑）。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON）:
    {"term_type_code": "user_name", "keyword": "黄"}

出参（stdout JSON）:
    {"ok": true, "data": [...]}
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))


def main() -> None:
    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
    if not raw:
        print(json.dumps({"ok": False, "error": "缺少入参，需要 term_type_code"}), flush=True)
        sys.exit(1)

    params: dict = json.loads(raw)
    term_type_code: str = params.get("term_type_code", "").strip()
    if not term_type_code:
        print(json.dumps({"ok": False, "error": "term_type_code 不能为空"}), flush=True)
        sys.exit(1)

    keyword: str = params.get("keyword", "")

    from datacloud_knowledge.ingestion.ontology_build import OntologyBuildSession

    session = OntologyBuildSession()
    data = session.get_term_type_values(term_type_code, keyword=keyword)
    print(json.dumps({"ok": True, "data": data}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), flush=True)
        sys.exit(1)
