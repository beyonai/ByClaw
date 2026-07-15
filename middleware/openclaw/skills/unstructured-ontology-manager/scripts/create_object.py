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
        "kb_resource_id": "10000003",              // 必填：知识库资源 ID，脚本自动从 Redis 解析 kb_id
        "kb_directory": "/meeting",
        "fields": [
            {
                "property_code": "topic",
                "property_name": "主题",
                "data_type": "STRING",
                "ext_property": {}
            }
        ],
        "relations": [                             // 可选：与其他本体对象的关联关系
            {
                "relation_code": "has_participant",    // 关系编码（英文下划线）
                "relation_name": "参会人",              // 关系名称
                "target_entity_code": "by_employee",   // 目标对象编码（对方对象必须已存在）
                "relation_type": "MANY_TO_ONE",        // 关系类型：ONE_TO_ONE / ONE_TO_MANY / MANY_TO_ONE / MANY_TO_MANY
                "join_keys": [                         // 连接键：本对象哪个字段 → 目标对象哪个字段
                    {"from_field": "employee_code", "to_field": "code"}
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
      target_entity_code（目标对象编码）、relation_type（关系基数）四个字段；
      target_entity_code 引用的对象必须已在本体库中存在，否则 API 侧会报错；
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

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _common import load_embedding_model_from_redis, post_json, post_ontology_api


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

    if not entity_code:
        print(json.dumps({"ok": False, "error": "entity_code 不能为空"}), flush=True)
        sys.exit(1)

    if action == "collect":
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


        result = post_ontology_api(
            "/object/collect",
            {
                "entity_code": entity_code,
                "session_id": session_id,
                "entity_name": params.get("entity_name", ""),
                "entity_desc": params.get("entity_desc", ""),
                "fields": params.get("fields"),
                "relations": params.get("relations") or [],
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
