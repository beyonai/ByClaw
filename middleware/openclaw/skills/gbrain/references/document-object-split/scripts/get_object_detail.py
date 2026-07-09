#!/usr/local/bin/python3
"""查询 Ontology 对象详情（含属性字段定义）。

通过 byaiService POST /ontology/object/detail 获取。
接口**仅支持单条** objectCode 查询，每次调用只查一个对象。

objectCode 须由 OpenClaw Agent 从当前数字员工上下文取得后传入。
多个对象须**多次调用**本脚本，禁止传 object_codes 数组。

I/O 协议：命令行 JSON 参数（推荐）或 stdin JSON → stdout JSON

调用方式（在 skill 根目录执行）:
    /usr/local/bin/python3 scripts/get_object_detail.py '<JSON>'

入参（JSON）:
    {"object_code": "p_bug_0027024630_5406b7"}
    {"object_code": "p_order_0027024630_d73e14", "base_id": null}

出参（stdout JSON）:
    {
        "ok": true,
        "object_code": "p_bug_0027024630_5406b7",
        "object_name": "Bug",
        "object_source": "KNOWLEDGE_BASE",
        "object_desc": "...",
        "base_id": "",
        "actions": [],
        "properties": [...],
        "fields": ["handler", "deadline", "title"]
    }

接口约束:
    POST /byaiService/ontology/object/detail
    {"baseId": null, "objectCode": "p_bug_0027024630_5406b7"}
    — objectCode 必传；baseId 可选；不支持 resourceId；不支持批量。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))

from _common import fetch_object_detail_api, stdout_json


def _normalize_property(prop: dict[str, Any]) -> dict[str, Any]:
    return {
        "property_code": prop.get("propertyCode", prop.get("property_code", "")),
        "property_name": prop.get("propertyName", prop.get("property_name", "")),
        "data_type": prop.get("dataType", prop.get("data_type", "")),
        "is_required": bool(prop.get("isRequired") or prop.get("is_required")),
        "is_name": bool(prop.get("isName") or prop.get("is_name")),
        "business_key": bool(prop.get("businessKey") or prop.get("business_key")),
        "sort_no": prop.get("sortNo", prop.get("sort_no", 0)),
        "status": prop.get("status", 0),
    }


def _parse_base_id(params: dict[str, Any]) -> str | None:
    if "base_id" in params:
        value = params.get("base_id")
        if value is None:
            return None
        text = str(value).strip()
        return text or None
    if "baseId" in params:
        value = params.get("baseId")
        if value is None:
            return None
        text = str(value).strip()
        return text or None
    return None


def _parse_object_code(params: dict[str, Any]) -> str:
    if params.get("object_codes") is not None or params.get("objectCodes") is not None:
        raise ValueError(
            "接口不支持批量查询；禁止传 object_codes。"
            "请对每个 objectCode 分别调用一次本脚本"
        )
    code = str(params.get("object_code") or params.get("objectCode") or "").strip()
    if not code:
        raise ValueError(
            "object_code 为必传；请由 OpenClaw 从当前数字员工上下文取得 objectCode 后传入"
        )
    return code


def _build_response(data: dict[str, Any], *, object_code: str) -> dict[str, Any]:
    properties_raw = data.get("properties") or []
    properties = [_normalize_property(p) for p in properties_raw if isinstance(p, dict)]
    fields = [p["property_code"] for p in properties if p["property_code"]]

    resolved_code = str(
        data.get("objectCode", data.get("object_code", object_code))
    ).strip()

    return {
        "ok": True,
        "object_code": resolved_code,
        "object_name": data.get(
            "objectName",
            data.get("object_name", data.get("resourceName", "")),
        ),
        "object_source": data.get("objectSource", data.get("object_source", "")),
        "object_desc": data.get(
            "objectDesc",
            data.get("object_desc", data.get("resourceDesc", "")),
        ),
        "base_id": data.get("baseId", data.get("base_id", "")),
        "actions": data.get("actions") or [],
        "properties": properties,
        "fields": fields,
    }


def main() -> None:
    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
    if not raw:
        stdout_json(
            {
                "ok": False,
                "error": "缺少入参；请传 {\"object_code\": \"...\"}（每次只查一个对象）",
            }
        )
        sys.exit(1)

    params: dict[str, Any] = json.loads(raw)

    try:
        object_code = _parse_object_code(params)
        base_id = _parse_base_id(params)
        data = fetch_object_detail_api(object_code, base_id=base_id)
        stdout_json(_build_response(data, object_code=object_code))
    except ValueError as exc:
        stdout_json({"ok": False, "error": str(exc)})
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        stdout_json({"ok": False, "error": str(exc)})
        sys.exit(1)
