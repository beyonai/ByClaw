#!/usr/local/bin/python3
"""查询对象详情（含属性列表）。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON）:
    {
        "object_code": "p_Product_0027024630_ddbd4f"   # 必填
    }

出参（stdout JSON）:
    {
        "ok": true,
        "data": {
            "objectCode": "p_Product_0027024630_ddbd4f",
            "objectName": "Product",
            "objectSource": "KNOWLEDGE_BASE",
            "objectDesc": "...",
            "ownerType": "personal",
            "userCode": "0027024630",
            "properties": [
                {
                    "propertyCode": "product_code",
                    "propertyName": "编码",
                    "dataType": "STRING",
                    "isRequired": 0,
                    "isName": 0,
                    "businessKey": 0,
                    "terminology": {"term_type_code": "industry", ...}
                }
            ]
        }
    }
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))

from _common import get_ontology_base, stdout_json


def main() -> None:
    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
    if not raw:
        stdout_json({"ok": False, "error": "缺少入参，需要 object_code"})
        sys.exit(1)

    params: dict[str, Any] = json.loads(raw)
    object_code: str = params.get("object_code", "").strip()
    if not object_code:
        stdout_json({"ok": False, "error": "object_code 不能为空"})
        sys.exit(1)

    obj_data = get_ontology_base(f"objects/{object_code}")
    if not isinstance(obj_data, dict):
        stdout_json({"ok": False, "error": f"对象详情返回格式异常: {obj_data!r}"})
        sys.exit(1)

    raw_props: list[dict[str, Any]] = obj_data.get("properties") or []
    properties = [
        {
            "propertyCode": p.get("propertyCode", ""),
            "propertyName": p.get("propertyName", ""),
            "dataType": p.get("dataType", ""),
            "isRequired": p.get("isRequired", 0),
            "isName": p.get("isName", 0),
            "businessKey": p.get("businessKey", 0),
            "terminology": p.get("terminology"),
        }
        for p in raw_props
        if isinstance(p, dict)
    ]
    ext_property = obj_data.get("extProperty", {})
    template = ext_property.get("template", "")
    rules = ext_property.get("rules", {})
    kd_dir = ext_property.get("kb_directory", "")
    kd_resource_id = ext_property.get("kb_resource_id", "")
    stdout_json(
        {
            "ok": True,
            "data": {
                "objectCode": obj_data.get("objectCode", ""),
                "objectName": obj_data.get("objectName", ""),
                "objectSource": obj_data.get("objectSource", ""),
                "objectDesc": obj_data.get("objectDesc", ""),
                "ownerType": obj_data.get("ownerType", ""),
                "userCode": obj_data.get("userCode", ""),
                "properties": properties,
                "template": template,
                "rules": rules,
                f"<{obj_data.get("objectName", "")}>对应的知识库id": kd_resource_id,
                f"<{obj_data.get("objectName", "")}>对应的知识库目录": kd_dir
            },
        }
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        stdout_json({"ok": False, "error": str(exc)})
        sys.exit(1)
