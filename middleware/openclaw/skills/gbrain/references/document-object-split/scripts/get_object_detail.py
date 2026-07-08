#!/usr/local/bin/python3
"""查询 Ontology 对象详情（含属性字段定义）。

通过 byaiService POST /ontology/object/detail 获取（**仅支持 objectCode 单条查询**）。

默认从 openclaw 读取当前数字员工挂载的 OBJECT 资源，提取 objectCode 后逐条调接口。

I/O 协议：命令行 JSON 参数（推荐）或 stdin JSON → stdout JSON

调用方式（在 skill 根目录执行）:
    /usr/local/bin/python3 scripts/get_object_detail.py '<JSON>'

入参（JSON）:
    # 默认：从 openclaw 获取当前数字员工全部 OBJECT 的 objectCode，逐条查详情
    {}

    # 单个 objectCode（接口仅支持单条）
    {"object_code": "p_bug_0027024630_5406b7"}

    # 可选 baseId（默认 null）
    {"object_code": "p_order_0027024630_d73e14", "base_id": null}

    # 子集：先从 openclaw 取挂载列表，再只查指定 objectCode（仍逐条调接口）
    {"object_codes": ["p_bug_0027024630_5406b7", "p_order_0027024630_d73e14"]}

出参（stdout JSON）:
    # 单个
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

    # 多个（脚本内循环单条接口，聚合输出）
    {
        "ok": true,
        "objects": [ { ... 同上 ... }, ... ],
        "object_codes": ["p_bug_...", "p_order_..."]
    }

接口约束:
    POST /byaiService/ontology/object/detail
    {"baseId": null, "objectCode": "p_bug_0027024630_5406b7"}
    — objectCode **必传**；baseId 可选；不支持 resourceId；不支持批量（脚本内逐条循环）。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))

from _common import (
    fetch_employee_object_entries,
    fetch_object_detail_api,
    resolve_employee_id,
    stdout_json,
)


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


def _resolve_detail_requests(params: dict[str, Any]) -> list[dict[str, Any]]:
    """解析为 [{object_code, resource_id?, base_id?}, ...]。"""
    base_id = _parse_base_id(params)
    employee_id = str(
        params.get("employee_id") or params.get("employeeId") or resolve_employee_id()
    ).strip()

    object_code = str(params.get("object_code") or params.get("objectCode") or "").strip()
    if object_code:
        return [{"object_code": object_code, "base_id": base_id}]

    entries = fetch_employee_object_entries(employee_id)
    if not entries:
        raise ValueError(
            "当前数字员工未挂载 OBJECT 资源，或 openclaw 资源列表中缺少 objectCode"
        )

    filter_codes = params.get("object_codes") or params.get("objectCodes")
    if isinstance(filter_codes, list):
        allowed = {str(code).strip() for code in filter_codes if str(code).strip()}
        if not allowed:
            raise ValueError("object_codes 不能为空列表")
        entries = [entry for entry in entries if entry["object_code"] in allowed]
        if not entries:
            raise ValueError(
                f"openclaw 挂载列表中未找到指定 objectCode: {sorted(allowed)}"
            )

    requests: list[dict[str, Any]] = []
    for entry in entries:
        code = str(entry.get("object_code", "")).strip()
        if not code:
            continue
        requests.append(
            {
                "object_code": code,
                "resource_id": entry.get("resource_id", ""),
                "base_id": base_id,
            }
        )
    if not requests:
        raise ValueError("openclaw 挂载的 OBJECT 资源均缺少 objectCode，无法调详情接口")
    return requests


def _build_response(
    data: dict[str, Any],
    *,
    object_code: str = "",
    resource_id: str = "",
) -> dict[str, Any]:
    properties_raw = data.get("properties") or []
    properties = [_normalize_property(p) for p in properties_raw if isinstance(p, dict)]
    fields = [p["property_code"] for p in properties if p["property_code"]]

    resolved_code = str(
        data.get("objectCode", data.get("object_code", object_code))
    ).strip()

    result: dict[str, Any] = {
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
    if resource_id:
        result["resource_id"] = resource_id
    return result


def _fetch_object_detail(req: dict[str, Any]) -> dict[str, Any]:
    object_code = str(req.get("object_code", "")).strip()
    if not object_code:
        raise ValueError("objectCode 为必传参数，不能为空")
    data = fetch_object_detail_api(
        object_code,
        base_id=req.get("base_id"),
    )
    return _build_response(
        data,
        object_code=object_code,
        resource_id=str(req.get("resource_id", "")).strip(),
    )


def main() -> None:
    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
    params: dict[str, Any] = json.loads(raw) if raw else {}

    try:
        requests = _resolve_detail_requests(params)
    except ValueError as exc:
        stdout_json({"ok": False, "error": str(exc)})
        sys.exit(1)

    if not requests:
        stdout_json(
            {
                "ok": False,
                "error": "未解析到可查询的 objectCode；请传 object_code 或确保 openclaw 已挂载 OBJECT 资源",
            }
        )
        sys.exit(1)

    if len(requests) == 1:
        stdout_json(_fetch_object_detail(requests[0]))
        return

    objects: list[dict[str, Any]] = []
    errors: list[str] = []
    for req in requests:
        code = req["object_code"]
        try:
            objects.append(_fetch_object_detail(req))
        except ValueError as exc:
            errors.append(f"{code}: {exc}")

    if not objects:
        stdout_json({"ok": False, "error": "; ".join(errors) if errors else "未查询到任何对象"})
        sys.exit(1)

    result: dict[str, Any] = {
        "ok": True,
        "objects": objects,
        "object_codes": [obj["object_code"] for obj in objects if obj.get("object_code")],
    }
    if errors:
        result["errors"] = errors
    stdout_json(result)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        stdout_json({"ok": False, "error": str(exc)})
        sys.exit(1)
