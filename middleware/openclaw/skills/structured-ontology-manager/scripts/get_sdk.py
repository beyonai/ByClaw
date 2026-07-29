#!/usr/local/bin/python3
"""重新获取 SDK 文件并写入本地。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON）:
    {
        "workspace_name": "travel_reimbursement",   # 必填
        "entity_code":    "travel_application"      # 必填
    }

出参（stdout JSON）:
    {
        "ok":          true,
        "entity_code": "travel_application",
        "sdk_path":    "workspace/travel_reimbursement/sdk/travel_application_sdk.py"
    }
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).parent))

from _common import get_ontology_api, stdout_json


def main() -> None:
    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
    if not raw:
        stdout_json({"ok": False, "error": "缺少入参，需要 workspace_name 和 entity_code"})
        sys.exit(1)

    params: dict = json.loads(raw)
    workspace_name: str = params.get("workspace_name", "").strip()
    entity_code: str = params.get("entity_code", "").strip()

    if not workspace_name:
        stdout_json({"ok": False, "error": "workspace_name 不能为空"})
        sys.exit(1)
    if not entity_code:
        stdout_json({"ok": False, "error": "entity_code 不能为空"})
        sys.exit(1)

    result = get_ontology_api(f"/workspace/{workspace_name}/sdk/{entity_code}")

    # 写入本地 sdk 目录
    sdk_content: str = result.get("sdk_content", "") if isinstance(result, dict) else ""
    if sdk_content:
        sdk_dir = Path("workspace") / workspace_name / "sdk"
        sdk_dir.mkdir(parents=True, exist_ok=True)
        sdk_path = sdk_dir / f"{entity_code}_sdk.py"
        sdk_path.write_text(sdk_content, encoding="utf-8")
        if isinstance(result, dict):
            result["sdk_path"] = str(sdk_path)

    stdout_json(result)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        stdout_json({"ok": False, "error": str(exc)})
        sys.exit(1)
