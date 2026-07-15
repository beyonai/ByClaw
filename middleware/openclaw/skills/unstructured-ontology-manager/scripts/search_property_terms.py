#!/usr/local/bin/python3
"""查询对象指定属性关联的术语，支持关键字过滤。

通过对象编码和属性编码定位该属性的 terminology.term_type_code，
再查询对应的术语列表，可用 keyword 进一步过滤术语名称。

I/O 协议：stdin JSON → stdout JSON

入参（stdin JSON）:
    {
        "object_code":   "p_Product_0027024630_ddbd4f",  # 必填
        "property_code": "product_code",                 # 必填
        "keyword":       "教育",                          # 可选，术语名称关键字过滤
        "page_index":    1,                              # 可选，默认 1
        "page_size":     20                              # 可选，默认 20
    }

出参（成功）:
    {
        "ok": true,
        "data": {
            "propertyCode": "product_code",
            "propertyName": "编码",
            "termTypeCode": "industry",
            "terms": [
                {
                    "term_id": "a05efd83-...",
                    "term_code": "教育",
                    "term_name": "教育",
                    "term_type_code": "industry",
                    "desc_summary": null
                }
            ],
            "pageIndex": 1,
            "pageSize": 20,
            "totalCount": 1,
            "totalPages": 1
        }
    }
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))

from _common import get_ontology_base, post_rpc, stdout_json


def _parse_terminology(raw: Any) -> dict[str, Any] | None:
    """解析 terminology 字段（dict 或 JSON 字符串）。"""
    if not raw:
        return None
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        raw = raw.strip()
        if not raw:
            return None
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else None
        except (json.JSONDecodeError, ValueError):
            return None
    return None


def main() -> None:
    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
    if not raw:
        stdout_json({"ok": False, "error": "缺少入参，需要 object_code 和 property_code"})
        sys.exit(1)

    params: dict[str, Any] = json.loads(raw)
    object_code: str = params.get("object_code", "").strip()
    property_code: str = params.get("property_code", "").strip()

    if not object_code:
        stdout_json({"ok": False, "error": "object_code 不能为空"})
        sys.exit(1)
    if not property_code:
        stdout_json({"ok": False, "error": "property_code 不能为空"})
        sys.exit(1)

    keyword: str = params.get("keyword", "").strip()
    page_index: int = int(params.get("page_index", 1))
    page_size: int = int(params.get("page_size", 20))

    # 1. 拉取对象详情，找到目标属性
    obj_data = get_ontology_base(f"objects/{object_code}")
    if not isinstance(obj_data, dict):
        stdout_json({"ok": False, "error": f"对象详情返回格式异常: {obj_data!r}"})
        sys.exit(1)

    raw_props: list[dict[str, Any]] = obj_data.get("properties") or []
    target_prop: dict[str, Any] | None = next(
        (p for p in raw_props if isinstance(p, dict) and p.get("propertyCode") == property_code),
        None,
    )

    if target_prop is None:
        stdout_json({"ok": False, "error": f"对象 {object_code} 中未找到属性 {property_code}"})
        sys.exit(1)

    # 2. 解析术语绑定
    terminology = _parse_terminology(target_prop.get("terminology"))
    if not terminology:
        stdout_json({"ok": False, "error": f"属性 {property_code} 未绑定术语"})
        sys.exit(1)

    term_type_code: str = (terminology.get("term_type_code") or "").strip()
    if not term_type_code:
        stdout_json({"ok": False, "error": f"属性 {property_code} 的 terminology 缺少 term_type_code"})
        sys.exit(1)

    # 3. 查询术语列表
    rpc_params: dict[str, Any] = {
        "term_type": term_type_code,
        "page_index": page_index,
        "page_size": page_size,
    }
    if keyword:
        rpc_params["keyword"] = keyword

    term_data = post_rpc("term/list", {"params": rpc_params})
    if not isinstance(term_data, dict):
        stdout_json({"ok": False, "error": f"术语查询返回格式异常: {term_data!r}"})
        sys.exit(1)

    items: list[dict[str, Any]] = term_data.get("data", [])
    terms = [
        {
            "term_id": item.get("term_id", ""),
            "term_code": item.get("term_code", ""),
            "term_name": item.get("term_name", ""),
            "term_type_code": item.get("term_type_code", ""),
            "desc_summary": item.get("desc_summary"),
        }
        for item in items
        if isinstance(item, dict)
    ]

    stdout_json(
        {
            "ok": True,
            "data": {
                "propertyCode": property_code,
                "propertyName": target_prop.get("propertyName", ""),
                "termTypeCode": term_type_code,
                "terms": terms,
                "pageIndex": term_data.get("pageIndex", page_index),
                "pageSize": term_data.get("pageSize", page_size),
                "totalCount": term_data.get("totalCount", 0),
                "totalPages": term_data.get("totalPages", 0),
            },
        }
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        stdout_json({"ok": False, "error": str(exc)})
        sys.exit(1)
