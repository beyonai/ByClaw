#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Tuple


RESOURCE_TYPE_SKILL = 9
GENERIC_QUERY_HINTS = (
    "常用",
    "技能广场",
    "技能市场",
    "有哪些技能",
    "可以安装哪些技能",
    "能安装哪些技能",
    "帮我看看有哪些技能",
    "帮我看看有哪些技能可以安装",
    "看看有哪些技能",
    "全部技能",
    "所有技能",
    "找技能",
)


class MarketplaceUnavailableError(RuntimeError):
    pass


class MarketplaceAuthRequiredError(RuntimeError):
    pass


def sanitize_error(value: Any) -> str:
    text = str(value or "")
    text = re.sub(r"https?://[^\s\"'<>]+", "[url]", text)
    text = re.sub(r"(?i)(beyond-token|token|authorization)\s*[:=]\s*[^\s,;]+", r"\1=[redacted]", text)
    return text


def normalize_base_url(raw: str) -> str:
    base = raw.strip().rstrip("/")
    if base.endswith("/knowledge/knowledgeService"):
        return base
    if base.endswith("/knowledgeService"):
        return base
    return f"{base}/knowledgeService"


def build_headers(token_key: Optional[str], token_value: Optional[str]) -> Dict[str, str]:
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if token_key and token_value:
        headers[token_key] = token_value
    return headers


def resolve_auth() -> Tuple[Optional[str], Optional[str]]:
    env_api_key = os.getenv("BEYOND_TOKEN", "").strip()
    if env_api_key:
        return "beyond-token", env_api_key
    configured_api_key = os.getenv("IWHALEHUB_API_KEY", "").strip()
    if configured_api_key:
        return "beyond-token", configured_api_key
    return None, None


def require_auth() -> Tuple[str, str]:
    auth_key, auth_value = resolve_auth()
    if not auth_key or not auth_value:
        raise MarketplaceAuthRequiredError(
            "iWhale Hub api-key is missing. Pass configure skills.entries.iwhalehub.apiKey."
        )
    return auth_key, auth_value


def request_json(url: str, payload: Dict[str, Any], headers: Dict[str, str]) -> Any:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise MarketplaceUnavailableError("Skill marketplace is temporarily unavailable.") from exc
        detail = exc.read().decode("utf-8", "replace") if exc.fp else ""
        raise RuntimeError(f"HTTP {exc.code}: {detail or exc.reason}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Request failed: {exc.reason}") from exc

    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON response: {raw[:400]}") from exc


def request_bytes(url: str, headers: Dict[str, str], payload: Optional[Dict[str, Any]] = None) -> bytes:
    data = None
    method = "GET"
    request_headers = dict(headers)
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        method = "POST"
        request_headers.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=data, headers=request_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise MarketplaceUnavailableError("Skill marketplace is temporarily unavailable.") from exc
        detail = exc.read().decode("utf-8", "replace") if exc.fp else ""
        raise RuntimeError(f"HTTP {exc.code}: {detail or exc.reason}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Request failed: {exc.reason}") from exc


def unwrap_response(data: Any) -> Any:
    if isinstance(data, dict):
        if data.get("resultObject") is not None:
            return data["resultObject"]
        if isinstance(data.get("data"), dict) and data["data"].get("resultObject") is not None:
            return data["data"]["resultObject"]
        if data.get("data") is not None:
            return data["data"]
    return data


def is_success_response(data: Any) -> bool:
    return isinstance(data, dict) and str(data.get("resultCode")) == "0"


def extract_rows(payload: Any) -> List[Dict[str, Any]]:
    data = unwrap_response(payload)
    if isinstance(data, dict):
        rows = data.get("rows")
        if isinstance(rows, list):
            return [row for row in rows if isinstance(row, dict)]
        if isinstance(data.get("list"), list):
            return [row for row in data["list"] if isinstance(row, dict)]
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    return []


def trim(text: Any, limit: int = 240) -> str:
    value = str(text or "").strip()
    if len(value) <= limit:
        return value
    return value[: limit - 3].rstrip() + "..."


def normalize_query(query: str) -> str:
    value = (query or "").strip()
    if not value:
        return ""
    if any(hint in value for hint in GENERIC_QUERY_HINTS):
        return ""
    return value


def tag_names(value: Any) -> List[str]:
    if not isinstance(value, list):
        return []
    names: List[str] = []
    for tag in value:
        if isinstance(tag, dict):
            name = tag.get("tagName") or tag.get("name")
        else:
            name = tag
        if name:
            names.append(str(name))
    return names


def compact_skill(row: Dict[str, Any]) -> Dict[str, Any]:
    skill_id = row.get("skillInfoId") or row.get("skillId") or row.get("objId")
    item: Dict[str, Any] = {
        "objId": row.get("objId"),
        "skillId": skill_id,
        "name": row.get("name"),
        "code": row.get("code"),
        "description": trim(row.get("desc") or row.get("description"), 360),
        "version": row.get("version"),
        "tags": tag_names(row.get("tagNames")),
        "registryName": row.get("skillRegistryName") or row.get("skill_registry_name"),
    }
    return {key: value for key, value in item.items() if value not in (None, "", [])}
