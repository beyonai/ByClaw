#!/usr/local/bin/python3
"""创建非结构化本体对象（信息收集 + 提交两阶段）。

I/O 协议：stdin JSON → stdout JSON

## 阶段一：信息收集（action="collect"）

入参（stdin JSON）:
    {
        "action": "collect",
        "session_id": "uuid-xxx",
        "entity_code": "by_meeting_note",
        "entity_name": "会议纪要",
        "entity_desc": "会议纪要文档对象",
        "use_domain": "ods",                         // 可选：ods=原始对象，ads=应用对象；默认 ads
        "kb_resource_id": "10000003",              // 必填：知识库资源 ID，脚本自动从 Redis 解析 kb_id
        "kb_id": "59",                             // 必填：知识库 resourceCode
        "kb_directory": "/meeting",
        "fields": [
            {
                "property_code": "topic",
                "property_name": "主题",
                "data_type": "STRING",
                "ext_property": {}
            },
            {
                "property_code": "participant_code",
                "property_name": "参会人",
                "data_type": "STRING",
                "term_type_code": "user_name",       // 绑定已有术语类型（与 term_values 互斥）
                "rel_term_codeorname": "code"         // code=字段存编码；name=字段存名称
            },
            {
                "property_code": "meeting_type",
                "property_name": "会议类型",
                "data_type": "STRING",
                "term_values": ["周例会", "评审会", "启动会"]  // 自定义枚举字符串列表（与 term_type_code 互斥）
            }
        ],
        "relations": [                             // 可选：与其他本体对象的关联关系
            {
                "relation_code": "has_participant",    // 关系编码（英文下划线）
                "relation_name": "参会人",              // 关系名称
                "target_object_code": "by_employee",    // 目标对象编码（对方对象必须已存在）
                "relation_type": "MANY_TO_ONE",        // 关系类型：ONE_TO_ONE / ONE_TO_MANY / MANY_TO_ONE / MANY_TO_MANY
                "join_keys": [                         // 连接键：本对象哪个字段 → 目标对象哪个字段
                    {"sourceField": "employee_code", "targetField": "code"}
                ]
            }
        ],
        "template_file_path": "/path/to/template.json",  // 可选：模板文件路径
        "rules_file_path": "/path/to/rules.json"          // 可选：规则文件路径
    }

    说明：
    - kb_resource_id 必填，脚本通过 Redis key KG_DOC_{kb_resource_id} 自动解析 kb_id（resourceCode）；
    - relations 为可选数组，描述本对象与其他已有本体对象之间的语义关联；
      每条关系包含 relation_code（关系编码）、relation_name（关系名称）、
      target_object_code（目标对象编码）、relation_type（关系基数）四个字段；
      target_object_code 引用的对象必须已在本体库中存在，否则 API 侧会报错；
    - use_domain 表示对象的使用领域，仅支持 ods / ads，省略时默认 ads；
      脚本将其写入 ext_property.use_domain 后传给 ontology API；
    - template_file_path / rules_file_path 为可选文件路径；
    - 若路径不为空，脚本会通过外部接口读取文件内容，分别以 template / rules 为键写入 ext_property 字典后传给 ontology API；
    - 若路径不为空但读取内容为空，直接报错，不会继续调用 ontology API。

出参（stdout JSON）:
    {
        "ok": true,
        "state": { ...当前暂存状态... },
        "missing": ["entity_name"]
    }

## 阶段二：信息提交（action="submit"）

入参（stdin JSON）:
    {
        "action": "submit",
        "session_id": "uuid-xxx",
        "entity_code": "by_meeting_note"
    }

出参（stdout JSON）:
    {"ok": true, "resource_id": "..."}

所有业务逻辑由 datacloud_platform 的 ontology-manager API 提供服务。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _common import load_embedding_model_from_redis, post_json, post_ontology_api


_VALID_RELATION_TYPES = {
    "ONE_TO_ONE",
    "ONE_TO_MANY",
    "MANY_TO_ONE",
    "MANY_TO_MANY",
}
_CASCADE_RELATION_TYPES = {"ONE_TO_ONE", "MANY_TO_ONE"}


def normalize_object_relations(params: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalize the Skill relation protocol to ByDC ``object_relations``."""
    raw_relations = params.get("object_relations")
    if raw_relations is None:
        raw_relations = params.get("relations") or []
    if not isinstance(raw_relations, list):
        raise ValueError("relations/object_relations 必须是数组")

    fields = params.get("fields")
    if not isinstance(fields, list):
        fields = []
    fields_by_code = {
        str(field.get("property_code") or ""): field
        for field in fields
        if isinstance(field, dict) and str(field.get("property_code") or "")
    }
    seen_codes: set[str] = set()
    normalized: list[dict[str, Any]] = []

    for raw_relation in raw_relations:
        if not isinstance(raw_relation, dict):
            raise ValueError("每条关系必须是对象")
        relation_code = str(raw_relation.get("relation_code") or "").strip()
        if not relation_code:
            raise ValueError("relation_code 不能为空")
        if relation_code in seen_codes:
            raise ValueError(f"relation_code 重复: {relation_code}")
        seen_codes.add(relation_code)

        target_object_code = str(
            raw_relation.get("target_object_code")
            or raw_relation.get("target_class")
            or raw_relation.get("target_entity_code")
            or ""
        ).strip()
        if not target_object_code:
            raise ValueError(f"关系 {relation_code} 缺少 target_object_code")

        relation_type = str(
            raw_relation.get("relation_type") or "MANY_TO_ONE"
        ).strip().upper()
        if relation_type not in _VALID_RELATION_TYPES:
            raise ValueError(f"关系 {relation_code} 的 relation_type 非法: {relation_type}")

        cascade_present = "cascade_delete" in raw_relation
        cascade_delete = raw_relation.get("cascade_delete", False)
        if cascade_present and type(cascade_delete) is not bool:
            raise ValueError(f"关系 {relation_code} 的 cascade_delete 必须是 boolean")
        if cascade_delete and relation_type not in _CASCADE_RELATION_TYPES:
            raise ValueError(
                f"级联关系 {relation_code} 的 relation_type 只能是 MANY_TO_ONE 或 ONE_TO_ONE"
            )

        raw_join_keys = raw_relation.get("join_keys") or []
        if not isinstance(raw_join_keys, list) or not raw_join_keys:
            raise ValueError(f"关系 {relation_code} 的 join_keys 不能为空")
        join_keys: list[dict[str, str]] = []
        for raw_join_key in raw_join_keys:
            if not isinstance(raw_join_key, dict):
                raise ValueError(f"关系 {relation_code} 的 join_keys 项必须是对象")
            source_field = str(
                raw_join_key.get("sourceField")
                or raw_join_key.get("from_field")
                or ""
            ).strip()
            target_field = str(
                raw_join_key.get("targetField")
                or raw_join_key.get("to_field")
                or ""
            ).strip()
            if not source_field or not target_field:
                raise ValueError(f"关系 {relation_code} 的 join key 两端字段不能为空")
            source_definition = fields_by_code.get(source_field)
            if source_definition is None:
                raise ValueError(
                    f"关系 {relation_code} 的 source join key 字段不存在: {source_field}"
                )
            if cascade_delete and bool(
                source_definition.get("is_required")
                or source_definition.get("required")
            ):
                raise ValueError(
                    f"级联关系 {relation_code} 的 source join key 必须允许清空: {source_field}"
                )
            join_keys.append(
                {
                    "sourceField": source_field,
                    "targetField": target_field,
                }
            )

        relation = {
            "relation_code": relation_code,
            "relation_name": str(raw_relation.get("relation_name") or ""),
            "target_object_code": target_object_code,
            "relation_type": relation_type,
            "join_keys": join_keys,
        }
        if cascade_present:
            relation["cascade_delete"] = cascade_delete
        else:
            relation["cascade_delete"] = False
        normalized.append(relation)
    return normalized


def _read_file_content(file_path: str, session_id: str = "") -> str | None:
    """通过外部接口读取文件内容，参考 ByclawResultFileStorage.read_text 实现。"""
    import os
    import re

    # 处理 /.sessions?/<session_id>/<path> 格式，提取 session_id 并规范化路径
    file_path_normalized = file_path
    match = re.search(r"/\.sessions?/(\d+)/(.*)", file_path_normalized)
    if match:
        if not session_id:
            session_id = match.group(1)
        file_path_normalized = "/" + match.group(2)

    payload = {
        "filePath": file_path_normalized,
        "begin_line": 0,
        "end_line": -1,
        "userCode": os.environ.get("USER_CODE", "").strip(),
        "sessionId": session_id,
    }
    print(json.dumps({"debug": "read_file_content payload", "payload": payload}, ensure_ascii=False), file=sys.stderr)
    data = post_json("/byaiService/open/api/v1/conversation/read", payload)
    if isinstance(data, str):
        return data or None
    if isinstance(data, dict):
        content = data.get("content")
        if isinstance(content, str):
            return content or None
        nested = data.get("data")
        if isinstance(nested, dict):
            nested_content = nested.get("content")
            if isinstance(nested_content, str):
                return nested_content or None
    return None


def main() -> None:
    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
    if not raw:
        print(json.dumps({"ok": False, "error": "缺少入参"}), flush=True)
        sys.exit(1)

    params: dict = json.loads(raw)
    action: str = params.get("action", "collect").lower().strip()
    session_id: str = params.get("session_id", "")
    entity_code: str = params.get("entity_code", "").strip()
    template_file_path: str = params.get("template_file_path", "").strip()
    rules_file_path: str = params.get("rules_file_path", "").strip()
    template_file_path: str = params.get("template_file_path", "").strip()
    rules_file_path: str = params.get("rules_file_path", "").strip()

    if not entity_code:
        print(json.dumps({"ok": False, "error": "entity_code 不能为空"}), flush=True)
        sys.exit(1)

    if action == "collect":
        use_domain = str(params.get("use_domain") or "ads").strip().lower()
        if use_domain not in {"ods", "ads"}:
            print(
                json.dumps(
                    {"ok": False, "error": "use_domain 仅支持 ods 或 ads"},
                    ensure_ascii=False,
                ),
                flush=True,
            )
            sys.exit(1)

        kb_resource_id: str = params.get("kb_resource_id", "").strip()
        if not kb_resource_id:
            print(json.dumps({"ok": False, "error": "kb_resource_id 不能为空"}, ensure_ascii=False), flush=True)
            sys.exit(1)

        # try:
        #     kb_resource = get_kb_resource_from_redis(kb_resource_id)
        # except Exception as exc:
        #     print(json.dumps({"ok": False, "error": f"查询知识库资源失败: {exc}"}, ensure_ascii=False), flush=True)
        #     sys.exit(1)
        #
        # kb_id: str = str(kb_resource.get("resourceCode", "")).strip()
        kb_id: str = params.get("kb_id", "").strip()
        if not kb_id:
            print(
                json.dumps(
                    {"ok": False, "error": f"知识库资源 {kb_resource_id} 中 resourceCode 为空"},
                    ensure_ascii=False,
                ),
                flush=True,
            )
            sys.exit(1)

        template: str | None = None
        if template_file_path:
            template = _read_file_content(template_file_path, session_id)
            if not template:
                print(
                    json.dumps(
                        {"ok": False, "error": f"模板文件读取失败或内容为空：{template_file_path}"},
                        ensure_ascii=False,
                    ),
                    flush=True,
                )
                sys.exit(1)

        rules: str | None = None
        if rules_file_path:
            rules = _read_file_content(rules_file_path, session_id)
            if not rules:
                print(
                    json.dumps(
                        {"ok": False, "error": f"规则文件读取失败或内容为空：{rules_file_path}"},
                        ensure_ascii=False,
                    ),
                    flush=True,
                )
                sys.exit(1)

        ext_property: dict = params.get("ext_property") or {}
        if template:
            ext_property["template"] = template
        if rules:
            ext_property["rules"] = rules
        if params.get("kb_directory", ""):
            ext_property["kb_directory"] = params.get("kb_directory")
        if kb_resource_id:
            ext_property["kb_resource_id"] = str(kb_resource_id)
        if kb_id:
            ext_property["kb_id"] = str(kb_id)
        ext_property["use_domain"] = use_domain
        object_relations = normalize_object_relations(params)
        result = post_ontology_api(
            "/object/collect",
            {
                "entity_code": entity_code,
                "session_id": session_id,
                "entity_name": params.get("entity_name", ""),
                "entity_desc": params.get("entity_desc", ""),
                "fields": params.get("fields"),
                "object_relations": object_relations,
                "ext_property": ext_property,
                "kb_resource_id": kb_resource_id,
                "kb_id": kb_id,
                "kb_directory": params.get("kb_directory", ""),
            },
        )
        print(json.dumps(result, ensure_ascii=False), flush=True)

    elif action == "submit":
        load_embedding_model_from_redis()
        result = post_ontology_api(
            "/object/submit",
            {"entity_code": entity_code, "session_id": session_id},
        )
        print(json.dumps(result, ensure_ascii=False), flush=True)

    else:
        print(
            json.dumps(
                {"ok": False, "error": f"未知 action: {action}，合法值: collect/submit"},
                ensure_ascii=False,
            ),
            flush=True,
        )
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), flush=True)
        sys.exit(1)
