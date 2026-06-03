#!/usr/bin/env python3
"""查询指定知识库下的目录列表。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON）:
    {
        "resource_code": "2",          # 必填，知识库编码（来自 list_knowledge_bases.py）
        "directory_path": "/"          # 可选，目录路径，默认根目录 "/"
    }

出参（stdout JSON）:
    {
        "ok": true,
        "data": [
            {
                "name": "一级目录",
                "type": "directory",
                "directoryPath": "/一级目录"
            },
            {
                "name": "会议纪要.docx",
                "type": "file",
                "directoryPath": "/会议纪要.docx"
            }
        ]
    }
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent / "lib"))

from _common import post_json


def main() -> None:
    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
    if not raw:
        print(json.dumps({"ok": False, "error": "缺少入参，需要 resource_code"}), flush=True)
        sys.exit(1)

    params: dict = json.loads(raw)
    resource_code: str = params.get("resource_code", "").strip()
    if not resource_code:
        print(json.dumps({"ok": False, "error": "resource_code 不能为空"}), flush=True)
        sys.exit(1)

    directory_path: str = params.get("directory_path", "/")

    data = post_json(
        path="/byaiService/open/api/v1/dataset/listDir",
        payload={
            "resourceCode": resource_code,
            "directoryPath": directory_path,
            "language": "zh-CN",
        },
    )
    items = data if isinstance(data, list) else []
    result = [
        {
            "name": item.get("name"),
            "type": item.get("type"),
            "directoryPath": item.get("directoryPath"),
        }
        for item in items
    ]
    print(json.dumps({"ok": True, "data": result}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), flush=True)
        sys.exit(1)
