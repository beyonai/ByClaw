#!/usr/bin/env python3
"""查询可绑定的术语类型列表（与 structured-ontology-manager 相同逻辑）。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON，可选）:
    {"keyword": "用户"}

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
    params: dict = json.loads(raw) if raw else {}
    keyword: str = params.get("keyword", "")

    from datacloud_knowledge.ingestion.ontology_build import OntologyBuildSession

    session = OntologyBuildSession()
    data = session.list_bindable_term_types(keyword=keyword)
    print(json.dumps({"ok": True, "data": data}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), flush=True)
        sys.exit(1)
