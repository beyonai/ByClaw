#!/usr/local/bin/python3
"""在指定知识库下创建目录或文件夹。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON）:
    {
        "resource_id": "10000765",    # 必填，知识库 resourceId（来自 list_knowledge_bases.py）
        "directory_name": "会议纪要"   # 必填，目录或文件夹名称
    }

directoryPath 固定为根目录 "/"，无需传入。

出参（stdout JSON）:
    {
        "ok": true,
        "data": {
        "knCode": "21",
        "directoryPath": "/测试2",
        "directoryDescription": null
    }
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
        print(json.dumps({"ok": False, "error": "缺少入参，需要 resource_id 和 directory_name"}), flush=True)
        sys.exit(1)

    params: dict = json.loads(raw)
    resource_id: str = str(params.get("resource_id", "")).strip()
    if not resource_id:
        print(json.dumps({"ok": False, "error": "resource_id 不能为空"}), flush=True)
        sys.exit(1)

    directory_name: str = params.get("directory_name", "").strip()
    if not directory_name:
        print(json.dumps({"ok": False, "error": "directory_name 不能为空"}), flush=True)
        sys.exit(1)

    data = post_json(
        path="/byaiService/datasetController/createFolder",
        payload={"resourceId": int(resource_id), "directoryName": directory_name, "directoryPath": "/"},
    )
    print(json.dumps({"ok": True, "data": data if isinstance(data, dict) else {}}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), flush=True)
        sys.exit(1)
