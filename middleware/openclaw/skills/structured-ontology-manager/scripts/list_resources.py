#!/usr/bin/env python3
"""查询个人本体对象/视图列表。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON，可选）:
    {
        "resource_biz_type": "OBJECT",   # "OBJECT" 或 "VIEW"，默认 "OBJECT"
        "keyword": ""                    # 名称关键词过滤，默认空
    }

出参（stdout JSON）:
    {
        "ok": true,
        "data": [
            {
                "resourceId": "10000044",
                "resourceCode": "by_task",
                "resourceName": "任务管理对象"
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
    resource_biz_type: str = params.get("resource_biz_type", "OBJECT").upper().strip()
    keyword: str = params.get("keyword", "")

    data = post_json(
        path="/byaiService/auth/privilegeGrant/listResourceUseAuth",
        payload={
            "keyword": keyword,
            "pageNum": 1,
            "pageSize": 100,
            "ownerType": "personal",
            "resourceStatus": "2",
            "resourceBizTypeList": [resource_biz_type],
            "permission": "",
            "language": "zh-CN",
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
