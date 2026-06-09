#!/usr/bin/env python3
"""将本体资源挂载到当前数字员工/个人助理。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON）:
    {
        "agent_id": 10004452,              # 必填，数字员工或个人助理的 ID
        "resource_code": "by_my_device"   # 必填，本体编码
    }

出参（stdout JSON）:
    {
        "ok": true
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
        print(json.dumps({"ok": False, "error": "缺少入参，需要 agent_id 和 resource_code"}), flush=True)
        sys.exit(1)

    params: dict = json.loads(raw)

    agent_id = params.get("agent_id")
    if not agent_id:
        print(json.dumps({"ok": False, "error": "agent_id 不能为空"}), flush=True)
        sys.exit(1)

    resource_code: str = params.get("resource_code", "").strip()
    if not resource_code:
        print(json.dumps({"ok": False, "error": "resource_code 不能为空"}), flush=True)
        sys.exit(1)

    post_json(
        path="/byaiService/open/api/v1/mountDigEmployeeResource",
        payload={
            "agentId": agent_id,
            "relResourceCode": resource_code,
        },
    )
    print(json.dumps({"ok": True}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), flush=True)
        sys.exit(1)
