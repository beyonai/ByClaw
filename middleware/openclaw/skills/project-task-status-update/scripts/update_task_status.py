#!/usr/bin/env python3
"""Patch extended task statuses into a session projection JSON file."""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SUPPORTED_SCHEMA_VERSION = "2.0.0"
DEFAULT_STATUS_FILE_TEMPLATE = "/by/.acp-runs/sessions/{session_id}.json"
LIST_PATH = "/byaiService/devloop/project/taskStatuses/list"


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def field(item: dict[str, Any], *names: str, default: Any = None) -> Any:
    for name in names:
        if name in item and item[name] is not None:
            return item[name]
    return default


def normalize_status(item: dict[str, Any]) -> dict[str, Any]:
    dimension_name = str(field(item, "dimension_name", "dimensionName") or "").strip()
    status_code = str(field(item, "status_code", "statusCode") or "").strip()
    status_name = str(field(item, "status_name", "statusName") or "").strip()
    status_desc = str(field(item, "status_desc", "statusDesc") or "").strip()
    sort_order = field(item, "sort_order", "sortOrder", default=0)
    try:
        sort_order = int(sort_order)
    except (TypeError, ValueError):
        sort_order = 0
    return {
        "dimension_name": dimension_name,
        "status_code": status_code,
        "status_name": status_name,
        "status_desc": status_desc,
        "sort_order": sort_order,
    }


def load_json_file(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    fd, tmp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
    except Exception:
        if os.path.exists(tmp_name):
            os.remove(tmp_name)
        raise


def first_env(*names: str, default: str = "") -> str:
    for name in names:
        value = os.getenv(name, "").strip()
        if value:
            return value
    return default


def request_dictionary(project_id: int, dimension_name: str | None) -> list[dict[str, Any]]:
    base_url = first_env("BYAI_BE_BASE_URL", "BE_DOMAINNAME").rstrip("/")
    if not base_url:
        raise ValueError("缺少 BYAI_BE_BASE_URL 或 BE_DOMAINNAME，无法查询状态字典")
    token = first_env("BEYOND_TOKEN", "BYAI_TOKEN")
    user_code = first_env("USER_CODE")
    payload = {"projectId": project_id}
    if dimension_name:
        payload["dimensionName"] = dimension_name
    body = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Beyond-Token"] = token
    if user_code:
        headers["X-User-Code"] = user_code
    request = urllib.request.Request(
        f"{base_url}{LIST_PATH}",
        data=body,
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise ValueError(f"查询状态字典失败: HTTP {exc.code} {detail}") from exc
    except urllib.error.URLError as exc:
        raise ValueError(f"查询状态字典失败: {exc.reason}") from exc
    if not isinstance(raw, dict):
        raise ValueError("状态字典响应必须是对象")
    success = raw.get("success", raw.get("code") in {0, 200})
    if not success:
        raise ValueError(f"查询状态字典失败: {raw.get('msg') or raw}")
    data = raw.get("data")
    if data is None:
        return []
    if not isinstance(data, list):
        raise ValueError("状态字典 data 必须是数组")
    return [item for item in data if isinstance(item, dict)]


def load_dictionary(
    project_id: int,
    dimension_name: str | None,
    dictionary_file: Path | None,
) -> list[dict[str, Any]]:
    if dictionary_file is not None:
        raw = load_json_file(dictionary_file)
        if not isinstance(raw, list):
            raise ValueError("字典文件必须是数组")
        items = [normalize_status(item) for item in raw if isinstance(item, dict)]
    else:
        items = [normalize_status(item) for item in request_dictionary(project_id, dimension_name)]
    if dimension_name:
        items = [item for item in items if item["dimension_name"] == dimension_name]
    return [item for item in items if item["dimension_name"] and item["status_code"]]


def resolve_dictionary_item(
    dictionary: list[dict[str, Any]],
    dimension_name: str,
    status_code: str,
) -> dict[str, Any]:
    for item in dictionary:
        if item["dimension_name"] == dimension_name and item["status_code"] == status_code:
            return item
    raise ValueError(f"状态不在项目字典中: {dimension_name}/{status_code}")


def default_status_file(session_id: str) -> Path:
    return Path(DEFAULT_STATUS_FILE_TEMPLATE.format(session_id=session_id))


def load_projection(path: Path, session_id: str) -> dict[str, Any]:
    if not path.exists():
        raise ValueError(f"会话状态文件不存在: {path}")
    payload = load_json_file(path)
    if not isinstance(payload, dict):
        raise ValueError("会话状态文件必须是 JSON 对象")
    schema_version = str(payload.get("schema_version") or "").strip()
    if schema_version and schema_version != SUPPORTED_SCHEMA_VERSION:
        raise ValueError(f"不支持的 schema_version: {schema_version}")
    file_session_id = str(payload.get("session_id") or "").strip()
    if file_session_id and file_session_id != session_id:
        raise ValueError(f"会话 ID 不匹配: 文件={file_session_id}, 参数={session_id}")
    return payload


def update_projection(
    payload: dict[str, Any],
    *,
    dictionary_item: dict[str, Any],
    reason: str,
) -> dict[str, Any]:
    now = utc_now()
    dimension_name = dictionary_item["dimension_name"]
    current = payload.get("task_statuses")
    statuses = [item for item in current if isinstance(item, dict)] if isinstance(current, list) else []
    previous = None
    next_statuses: list[dict[str, Any]] = []
    replaced = False
    for item in statuses:
        normalized = normalize_status(item)
        if normalized["dimension_name"] == dimension_name:
            previous = normalized
            next_statuses.append({
                **dictionary_item,
                "updated_at": now,
            })
            replaced = True
        else:
            next_statuses.append({
                **normalized,
                "updated_at": item.get("updated_at"),
            })
    if not replaced:
        next_statuses.append({**dictionary_item, "updated_at": now})
    next_statuses.sort(key=lambda item: (item.get("sort_order") or 0, item.get("dimension_name") or ""))

    revision = payload.get("revision")
    try:
        next_revision = int(revision) + 1 if revision is not None else 1
    except (TypeError, ValueError):
        next_revision = 1

    transitions = payload.get("transitions")
    next_transitions = [item for item in transitions] if isinstance(transitions, list) else []
    next_transitions.append({
        "sequence": len(next_transitions) + 1,
        "from": previous["status_code"] if previous else None,
        "to": dictionary_item["status_code"],
        "reason": reason,
        "dimension_name": dimension_name,
        "occurred_at": now,
    })

    payload["schema_version"] = payload.get("schema_version") or SUPPORTED_SCHEMA_VERSION
    payload["revision"] = next_revision
    payload["task_statuses"] = next_statuses
    payload["transitions"] = next_transitions
    payload["updated_at"] = now
    return payload


def emit(ok: bool, data: Any = None, message: str | None = None) -> int:
    payload: dict[str, Any] = {"ok": ok}
    if ok:
        payload["data"] = data
    else:
        payload["error"] = {"message": message}
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if ok else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="按项目状态字典更新会话扩展任务状态")
    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list", help="查询项目状态字典")
    list_parser.add_argument("--project-id", required=True)
    list_parser.add_argument("--dimension-name")
    list_parser.add_argument("--dictionary-file")

    update_parser = subparsers.add_parser("update", help="写入会话 JSON 的 task_statuses")
    update_parser.add_argument("--session-id", required=True)
    update_parser.add_argument("--project-id", required=True)
    update_parser.add_argument("--dimension-name", required=True)
    update_parser.add_argument("--status-code", required=True)
    update_parser.add_argument("--reason", default="")
    update_parser.add_argument("--status-file")
    update_parser.add_argument("--dictionary-file")
    return parser


def require_positive_id(name: str, value: str) -> int:
    text = str(value or "").strip()
    if not text.isdigit() or int(text) <= 0:
        raise ValueError(f"{name} 必须是正整数")
    return int(text)


def run_list(args: argparse.Namespace) -> dict[str, Any]:
    project_id = require_positive_id("project-id", args.project_id)
    dimension_name = str(args.dimension_name or "").strip() or None
    dictionary_file = Path(args.dictionary_file) if args.dictionary_file else None
    items = load_dictionary(project_id, dimension_name, dictionary_file)
    return {"project_id": project_id, "dimension_name": dimension_name, "items": items}


def run_update(args: argparse.Namespace) -> dict[str, Any]:
    session_id = str(args.session_id).strip()
    if not session_id:
        raise ValueError("session-id 不能为空")
    project_id = require_positive_id("project-id", args.project_id)
    dimension_name = str(args.dimension_name or "").strip()
    status_code = str(args.status_code or "").strip()
    if not dimension_name or not status_code:
        raise ValueError("dimension-name 和 status-code 不能为空")
    dictionary_file = Path(args.dictionary_file) if args.dictionary_file else None
    dictionary = load_dictionary(project_id, dimension_name, dictionary_file)
    item = resolve_dictionary_item(dictionary, dimension_name, status_code)
    status_file = Path(args.status_file) if args.status_file else default_status_file(session_id)
    payload = load_projection(status_file, session_id)
    updated = update_projection(payload, dictionary_item=item, reason=str(args.reason or "").strip())
    write_json_atomic(status_file, updated)
    current = next(
        (entry for entry in updated["task_statuses"] if entry["dimension_name"] == dimension_name),
        item,
    )
    return {
        "session_id": session_id,
        "project_id": project_id,
        "status_file": str(status_file),
        "revision": updated["revision"],
        "task_status": current,
        "updated": True,
    }


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "list":
            return emit(True, run_list(args))
        if args.command == "update":
            return emit(True, run_update(args))
        raise ValueError(f"未知命令: {args.command}")
    except Exception as exc:
        return emit(False, message=str(exc))


if __name__ == "__main__":
    sys.exit(main())
