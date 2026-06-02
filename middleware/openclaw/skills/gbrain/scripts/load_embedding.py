#!/usr/bin/env python3
"""
从 Redis 读取向量（EMBEDDING）与 LLM 模型配置，映射为 gbrain 可用的环境变量。

依赖: pip install redis

默认数据源（与 byclaw-be / byclaw-data 一致）:
  - Redis HASH 键: byai:aimodel:typelist
  - 字段 EMBEDDING / LLM: 各为 JSON 数组，元素含 authToken、url、modelCode、modelName、
    modelType、status、isDefault、instanceParam 等

连接（与沙箱 / .env.example 一致）:
  - REDIS_URL 优先；否则 REDIS_HOST, REDIS_PORT, REDIS_USERNAME, REDIS_PASSWORD,
    REDIS_DATABASE, REDIS_SSL

模式 GBRAIN_EMBEDDING_REDIS_MODE:
  - aimodel (默认): 解析 byai:aimodel:typelist 的 EMBEDDING + LLM 字段
  - json: STRING 键，值为 {"OPENAI_API_KEY":"...", ...} 的 JSON 对象（兼容旧配置）
  - env_hash: HASH 键，field 名即环境变量名

合并策略:
  - 默认不覆盖进程中已存在的非空环境变量；使用 --force 可覆盖。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

AI_MODEL_TYPE_REDIS_KEY = "byai:aimodel:typelist"
EMBEDDING_FIELD = "EMBEDDING"
LLM_FIELD = "LLM"
LLM_ABILITY_QA = "6"


def _require_redis():
    try:
        import redis  # type: ignore
    except ImportError:
        print(
            "缺少依赖：请执行 pip install redis",
            file=sys.stderr,
        )
        sys.exit(1)
    return redis


def _redis_client(redis_mod: Any):
    url = os.environ.get("REDIS_URL", "").strip()
    if url:
        return redis_mod.from_url(url, decode_responses=True)

    host = os.environ.get("REDIS_HOST", "127.0.0.1")
    port = int(os.environ.get("REDIS_PORT", "6379"))
    db = int(os.environ.get("REDIS_DATABASE", "0"))
    username = os.environ.get("REDIS_USERNAME") or None
    password = os.environ.get("REDIS_PASSWORD") or None
    ssl_flag = os.environ.get("REDIS_SSL", "").lower() in ("1", "true", "yes")
    return redis_mod.Redis(
        host=host,
        port=port,
        db=db,
        username=username,
        password=password,
        ssl=ssl_flag,
        decode_responses=True,
    )


def _decode_redis_json(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, bytes):
        value = value.decode("utf-8")
    if isinstance(value, str):
        return json.loads(value)
    return value


def _first_non_empty(*values: Any) -> str:
    for value in values:
        text = "" if value is None else str(value).strip()
        if text:
            return text
    return ""


def _parse_model_list(raw: Any, field_name: str) -> List[Dict[str, Any]]:
    if raw is None:
        return []
    try:
        payload = _decode_redis_json(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f"Redis 字段 {field_name!r} 不是合法 JSON 数组: {e}"
        ) from e
    if not isinstance(payload, list):
        raise RuntimeError(f"Redis 字段 {field_name!r} 必须是 JSON 数组")
    return [m for m in payload if isinstance(m, dict)]


def _is_active(model: Dict[str, Any]) -> bool:
    status = model.get("status")
    if status is None:
        return True
    try:
        return int(status) == 1
    except (TypeError, ValueError):
        return False


def _abilities(model: Dict[str, Any]) -> set[str]:
    raw = model.get("abilities")
    if raw is None:
        instance_param = model.get("instanceParam")
        if isinstance(instance_param, dict):
            raw = instance_param.get("abilities")
        elif isinstance(instance_param, str):
            try:
                parsed = json.loads(instance_param)
                raw = parsed.get("abilities") if isinstance(parsed, dict) else None
            except json.JSONDecodeError:
                raw = None
    if not isinstance(raw, list):
        return set()
    return {str(a) for a in raw}


def _select_embedding(models: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    active = [
        m
        for m in models
        if _is_active(m) and _first_non_empty(m.get("authToken"))
    ]
    for model in active:
        if model.get("isDefault") == 1:
            return model
    return active[0] if active else None


def _select_llm(models: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    active = [
        m
        for m in models
        if _is_active(m) and _first_non_empty(m.get("authToken"))
    ]
    for model in active:
        if LLM_ABILITY_QA in _abilities(model):
            return model
    for model in active:
        if model.get("isDefault") == 1:
            return model
    return active[0] if active else None


def _infer_provider(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    if "dashscope" in host or "aliyuncs.com" in host:
        return "dashscope"
    if "minimaxi.com" in host or "minimax" in host:
        return "minimax"
    if "anthropic" in host:
        return "anthropic"
    if "voyage" in host:
        return "voyage"
    if "azure" in host:
        return "azure-openai"
    if "google" in host or "generativelanguage" in host:
        return "google"
    return "openai"


def _embedding_dimensions(model: Dict[str, Any]) -> Optional[int]:
    instance_param = model.get("instanceParam")
    if not isinstance(instance_param, dict):
        return None
    for key in ("dimensions", "dimension", "dims"):
        raw = instance_param.get(key)
        if raw is None:
            continue
        try:
            parsed = int(str(raw).strip())
            if parsed > 0:
                return parsed
        except (TypeError, ValueError):
            continue
    return None


def _provider_api_key_env(provider: str, token: str) -> Dict[str, str]:
    mapping = {
        "dashscope": "DASHSCOPE_API_KEY",
        "minimax": "MINIMAX_API_KEY",
        "anthropic": "ANTHROPIC_API_KEY",
        "voyage": "VOYAGE_API_KEY",
        "google": "GOOGLE_GENERATIVE_AI_API_KEY",
        "azure-openai": "AZURE_OPENAI_API_KEY",
        "openai": "OPENAI_API_KEY",
    }
    env_key = mapping.get(provider, "OPENAI_API_KEY")
    return {env_key: token}


def _gbrain_env_from_embedding(model: Dict[str, Any]) -> Dict[str, str]:
    token = _first_non_empty(model.get("authToken"))
    url = _first_non_empty(model.get("url"))
    code = _first_non_empty(model.get("modelCode"), model.get("modelName"))
    if not token or not code:
        return {}

    provider = _infer_provider(url)
    env = _provider_api_key_env(provider, token)
    env["GBRAIN_EMBEDDING_MODEL"] = f"{provider}:{code}"

    dims = _embedding_dimensions(model)
    if dims is not None:
        env["GBRAIN_EMBEDDING_DIMENSIONS"] = str(dims)
    elif provider == "dashscope":
        env["GBRAIN_EMBEDDING_DIMENSIONS"] = "1024"

    if provider == "openai" and url and "api.openai.com" not in url.lower():
        env["OPENAI_BASE_URL"] = url.rstrip("/")

    return env


def _gbrain_env_from_llm(model: Dict[str, Any]) -> Dict[str, str]:
    token = _first_non_empty(model.get("authToken"))
    url = _first_non_empty(model.get("url"))
    if not token:
        return {}

    provider = _infer_provider(url)
    env = _provider_api_key_env(provider, token)

    if provider == "openai" and url and "api.openai.com" not in url.lower():
        env["OPENAI_BASE_URL"] = url.rstrip("/")

    return env


def _load_from_aimodel_typelist(client: Any, key: str) -> Dict[str, str]:
    emb_raw = client.hget(key, EMBEDDING_FIELD)
    llm_raw = client.hget(key, LLM_FIELD)
    if emb_raw is None and llm_raw is None:
        raise RuntimeError(
            f"Redis HASH {key!r} 中不存在字段 {EMBEDDING_FIELD!r} 或 {LLM_FIELD!r}"
        )

    env: Dict[str, str] = {}
    embedding = _select_embedding(_parse_model_list(emb_raw, EMBEDDING_FIELD))
    if embedding:
        env.update(_gbrain_env_from_embedding(embedding))

    llm = _select_llm(_parse_model_list(llm_raw, LLM_FIELD))
    if llm:
        for k, v in _gbrain_env_from_llm(llm).items():
            if k not in env:
                env[k] = v

    if not env:
        raise RuntimeError(
            f"Redis {key!r} 中未找到 status=1 且含 authToken 的 EMBEDDING/LLM 模型"
        )
    return env


def _load_legacy_env_blob(client: Any, key: str, mode: str) -> Dict[str, str]:
    if mode == "hash":
        data = client.hgetall(key)
        if not data:
            raise RuntimeError(
                f"Redis HASH 键为空或不存在: {key!r} (mode=env_hash)"
            )
        return {str(k): str(v) for k, v in data.items()}

    raw = client.get(key)
    if raw is None:
        raise RuntimeError(f"Redis STRING 键不存在: {key!r} (mode=json)")
    try:
        obj = _decode_redis_json(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Redis 值不是合法 JSON: {e}") from e
    if not isinstance(obj, dict):
        raise RuntimeError("JSON 顶层必须是对象 { ... }")
    out: Dict[str, str] = {}
    for k, v in obj.items():
        if v is None:
            continue
        out[str(k)] = str(v)
    return out


def fetch_embedding_env() -> Dict[str, str]:
    redis_mod = _require_redis()
    key = os.environ.get("GBRAIN_EMBEDDING_REDIS_KEY", AI_MODEL_TYPE_REDIS_KEY)
    mode = os.environ.get("GBRAIN_EMBEDDING_REDIS_MODE", "aimodel").lower()
    client = _redis_client(redis_mod)

    if mode == "aimodel":
        return _load_from_aimodel_typelist(client, key)
    if mode in ("json", "hash", "env_hash"):
        legacy_mode = "hash" if mode in ("hash", "env_hash") else "json"
        return _load_legacy_env_blob(client, key, legacy_mode)

    raise ValueError(f"未知 GBRAIN_EMBEDDING_REDIS_MODE: {mode!r}")


def compute_to_apply(
    mapping: Dict[str, str],
    *,
    force: bool,
) -> Dict[str, str]:
    to_apply: Dict[str, str] = {}
    for k, v in mapping.items():
        if not k or not str(k).strip():
            continue
        if (not force) and k in os.environ and os.environ[k] != "":
            continue
        to_apply[k] = v
    return to_apply


def _shell_escape_single(s: str) -> str:
    return "'" + s.replace("'", "'\\''") + "'"


def emit_shell_export(mapping: Dict[str, str]) -> None:
    for k, v in sorted(mapping.items()):
        print(f"export {k}={_shell_escape_single(v)}")


def emit_powershell(mapping: Dict[str, str]) -> None:
    for k, v in sorted(mapping.items()):
        esc = str(v).replace("'", "''")
        print(f"$env:{k}='{esc}'")


def emit_dotenv(mapping: Dict[str, str]) -> None:
    for k, v in sorted(mapping.items()):
        val = (
            str(v)
            .replace("\\", "\\\\")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
        )
        if any(c in val for c in ' "\'#'):
            val = val.replace('"', '\\"')
            print(f'{k}="{val}"')
        else:
            print(f"{k}={val}")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--force",
        action="store_true",
        help="覆盖当前环境中已存在的非空同名变量",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="不写入 os.environ（即使指定了 --apply）",
    )
    p.add_argument(
        "--apply",
        action="store_true",
        help="将变量写入当前 Python 进程环境（便于同进程后续 subprocess 调用 gbrain）",
    )
    fmt = p.add_mutually_exclusive_group()
    fmt.add_argument(
        "--export-shell",
        action="store_true",
        help="打印 POSIX sh 可 eval 的 export 行（默认）",
    )
    fmt.add_argument(
        "--export-powershell",
        action="store_true",
        help="打印 PowerShell 赋值语句",
    )
    fmt.add_argument(
        "--export-dotenv",
        action="store_true",
        help="打印 dotenv 行",
    )
    fmt.add_argument(
        "--json",
        action="store_true",
        help="将本次会应用的键值以 JSON 打印（便于调试；注意泄露风险）",
    )
    args = p.parse_args(argv)

    try:
        raw = fetch_embedding_env()
    except Exception as e:
        print(str(e), file=sys.stderr)
        return 2

    to_apply = compute_to_apply(raw, force=bool(args.force))

    write_env = bool(args.apply) and not bool(args.dry_run)
    if write_env:
        for k, v in to_apply.items():
            os.environ[k] = v

    if args.json:
        print(json.dumps(to_apply, ensure_ascii=False, indent=2))
        return 0

    if args.export_powershell:
        emit_powershell(to_apply)
        return 0

    if args.export_dotenv:
        emit_dotenv(to_apply)
        return 0

    should_emit_shell = bool(args.export_shell) or not args.apply
    if should_emit_shell:
        emit_shell_export(to_apply)

    if write_env:
        print(
            "已写入当前进程环境变量: " + ", ".join(sorted(to_apply.keys())),
            file=sys.stderr,
        )
    elif args.apply and args.dry_run:
        print(
            "[dry-run] 将写入: " + ", ".join(sorted(to_apply.keys())),
            file=sys.stderr,
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
