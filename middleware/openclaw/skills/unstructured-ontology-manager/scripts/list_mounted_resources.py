#!/usr/local/bin/python3
"""查询数字员工已挂载的资源列表。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON）:
    {
        "resource_id": 10004452,     # 必填，数字员工或个人助理的 resource_id
        "keyword": ""                 # 可选，资源名称关键词过滤
    }

出参（stdout JSON）:
    {
        "ok": true,
        "data": [
            {
                "resourceId": "10000044",
                "resourceCode": "by_task",
                "resourceName": "任务管理对象",
                "resourceBizType": "OBJECT",
                "resourceDesc": "任务管理对象描述"
            }
        ]
    }
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent / "lib"))

from _common import post_json


def main() -> None:
    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
    if not raw:
        print(json.dumps({"ok": False, "error": "缺少入参，需要 resource_id"}), flush=True)
        sys.exit(1)

    params: dict = json.loads(raw)

    resource_id = params.get("resource_id")
    if not resource_id:
        print(json.dumps({"ok": False, "error": "resource_id 不能为空"}), flush=True)
        sys.exit(1)

    keyword: str = params.get("keyword", "")

    data = post_json(
        path="/byaiService/auth/privilegeGrant/queryDigEmployeeRelResourceAuth",
        payload={
            "resourceId": resource_id,
            "keyword": keyword,
            "pageNum": 1,
            "pageSize": 100,
        },
    )
    items = (data or {}).get("list", [])
    result = [
        {
            "resourceId": item.get("resourceId"),
            "resourceCode": item.get("resourceCode"),
            "resourceName": item.get("resourceName"),
            "resourceBizType": item.get("resourceBizType"),
            "resourceDesc": item.get("resourceDesc"),
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
