#!/usr/local/bin/python3
"""将本体资源挂载到当前数字员工/个人助理。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON）:
    {
        "agent_id": 10004452,              # 必填，数字员工或个人助理的 ID
        "resource_biz_type": "OBJECT",     # 资源业务类型，默认 "OBJECT"
        "resource_code": "by_my_device"    # 必填，本体编码
    }

出参（stdout JSON）：
    {
        "ok": true,                        # 挂载成功
        "data": { ... }                    # 接口原始返回
    }
    或
    {
        "ok": false,
        "error": "错误信息",
        "response": { ... }                # 原始响应体
    }
"""

from __future__ import annotations

import contextlib
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent / "lib"))

from _common import get_default_base_id, post_json


def main() -> None:
    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
    if not raw:
        print(
            json.dumps({"ok": False, "error": "缺少入参，需要 agent_id 和 resource_code"}),
            flush=True,
        )
        sys.exit(1)

    params: dict[str, Any] = json.loads(raw)

    agent_id = params.get("agent_id")
    if not agent_id:
        print(json.dumps({"ok": False, "error": "agent_id 不能为空"}), flush=True)
        sys.exit(1)

    resource_code: str = params.get("resource_code", "").strip()
    if not resource_code:
        print(json.dumps({"ok": False, "error": "resource_code 不能为空"}), flush=True)
        sys.exit(1)

    resource_biz_type: str = params.get("resource_biz_type", "OBJECT").upper().strip()

    try:
        result = post_json(
            path="/byaiService/open/api/v1/mountDigEmployeeResource",
            payload={
                "agentId": agent_id,
                "relResourceCode": resource_code,
                "relResourceBizType": resource_biz_type,
                "ontologyBaseCode": get_default_base_id(),
            },
        )
        print(json.dumps({"ok": True, "data": result}, ensure_ascii=False), flush=True)
    except Exception as exc:
        err_str = str(exc)
        # 从 "HTTP 200 ByaiService/path: {json}" 中提取 JSON body
        response_data = None
        idx = err_str.find("{")
        if idx != -1:
            with contextlib.suppress(json.JSONDecodeError):
                response_data, _ = json.JSONDecoder().raw_decode(err_str, idx)
        out = {"ok": False, "error": err_str}
        if response_data:
            out["response"] = response_data
        print(json.dumps(out, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
