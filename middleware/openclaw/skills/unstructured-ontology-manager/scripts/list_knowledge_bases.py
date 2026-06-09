#!/usr/bin/env python3
"""查询个人知识库列表。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON，可选）:
    {
        "keyword": "会议"   # 可选，按知识库名称过滤
    }

出参（stdout JSON）:
    {
        "ok": true,
        "data": [
            {
                "resourceId": "10000319",
                "resourceCode": "2",
                "resourceName": "平台管理员的个人知识库"
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
    params: dict = json.loads(raw) if raw else {}
    keyword: str = params.get("keyword", "")

    data = post_json(
        path="/byaiService/open/api/v1/getUserAuthResource",
        payload={
            "pageNum": 1,
            "pageSize": 100,
            "keyword": keyword,
            "resourceBizTypes": ["DOC"],
            "ownershipType": 1,
        },
    )
    items = (data or {}).get("list", [])
    result = [
        {
            "resourceId": item.get("resourceId"),
            "resourceCode": item.get("resourceCode"),
            "resourceName": item.get("resourceName"),
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
