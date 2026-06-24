"""DataCloud Gateway Worker."""

from __future__ import annotations

import asyncio
import contextvars
import hashlib
import json
import logging
import os
import re
import sys
import time
import traceback
import uuid
from collections import OrderedDict
from collections.abc import AsyncGenerator, Mapping
from contextlib import asynccontextmanager
from pathlib import Path
from typing import TYPE_CHECKING, Any, Optional

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

if TYPE_CHECKING:
    from by_framework.worker._execution_tracking import RunningExecution

from by_framework import (
    AskUserEvent,
    EventType,
    GatewayCommand,
    GatewayWorker,
    ResumeCommand,
    StreamChunkEvent,
)
from by_framework.common.constants import (
    RedisKeys,
    TASK_GROUP_FIELD_COMPLETED,
    TASK_GROUP_FIELD_TOTAL,
    TASK_GROUP_TTL_SECONDS,
)
from by_framework.common.logger import logger
from by_framework.core.extensions import PluginRegistry
from by_framework.core.protocol.agent_state import AgentState
from by_framework.core.protocol.commands import AskAgentCommand
from by_framework.core.protocol.content_type import SseMessageType, SseReasonMessageType
from by_framework.core.protocol.results import AgentTaskResult, normalize_process_result
from by_framework.worker.sandbox.hook_sandbox import active_workspace

from datacloud_analysis.agent import create_agent
from datacloud_analysis.command_plugins import CommandPluginManager
from datacloud_analysis.logging_setup import setup_logging
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.types import Command

from byclaw_data.byclaw_data_clarification import ByclawDataClarification


try:
    from datacloud_analysis.logging_setup import request_log_context
except ImportError:

    @asynccontextmanager
    async def request_log_context(
        request_id: str | None = None,
        *,
        extra_namespaces: tuple[str, ...] = (),
    ) -> AsyncGenerator[str, None]:
        del extra_namespaces
        yield request_id or uuid.uuid4().hex


# byclaw_data 命名空间 logger，输出到 app.log / error.log（by_framework logger 只写终端）
_dc_logger = logging.getLogger("byclaw_data.worker")

# 请求级 early Langfuse trace handle，供 process_command 的 finally 块关闭 span
_early_lf_trace_ctx: contextvars.ContextVar[Any] = contextvars.ContextVar(
    "early_lf_trace", default=None
)

_CHITCHAT_DIRECT_REPLY = "你好，我在。需要我帮你查询或分析什么数据？"
_CHITCHAT_TOKENS = {
    "hi",
    "hello",
    "hey",
    "thanks",
    "thank you",
    "你好",
    "您好",
    "喂",
    "哈喽",
    "在吗",
    "谢谢",
    "早上好",
    "中午好",
    "下午好",
    "晚上好",
}
_ANALYSIS_HINT_TOKENS = {
    "查",
    "查询",
    "分析",
    "统计",
    "报表",
    "销量",
    "销售",
    "订单",
    "数据",
    "多少",
    "趋势",
    "sql",
    "report",
    "query",
    "analy",
}

_NODE_THINKING_DESC_ZH: dict[str, str] = {
    "knowledge_enhance": "正在理解问题并补充上下文...\n\n",
    "planning": "正在生成任务计划...\n\n",
    "execution": "正在执行任务...\n\n",
    "end": "正在整理结果...",
}
_NODE_THINKING_DESC_EN: dict[str, str] = {
    "knowledge_enhance": "Understanding your question...\n\n",
    "planning": "Generating task plan...\n\n",
    "execution": "Executing tasks...\n\n",
    "end": "Summarizing results...",
}
_DEFAULT_THINKING_DESC_ZH = "正在处理，请稍候...\n\n"
_DEFAULT_THINKING_DESC_EN = "Processing, please wait...\n\n"

_NODE_PHASE_TITLE_ZH: dict[str, str] = {
    "knowledge_enhance": "问题理解",
    "execution": "任务执行",
    "end": "结果生成",
}
_NODE_PHASE_TITLE_EN: dict[str, str] = {
    "knowledge_enhance": "Understanding",
    "execution": "Execution",
    "end": "Result",
}

_PLANNING_PHASE_TITLE_ZH = "任务生成"
_PLANNING_PHASE_TITLE_EN = "Planning"

_LOCALE_ALIAS: dict[str, str] = {
    "zh-cn": "zh_CN",
    "zh_cn": "zh_CN",
    "en-us": "en_US",
    "en_us": "en_US",
}
_SUPPORTED_LOCALES: frozenset[str] = frozenset({"zh_CN", "en_US"})
_FALLBACK_LOCALE = "zh_CN"


def _normalize_locale(raw: str) -> str:
    """将前端 language 字段规范化为内部 locale 码。"""
    if not raw:
        return _FALLBACK_LOCALE
    normalized = _LOCALE_ALIAS.get(raw.lower(), raw)
    return normalized if normalized in _SUPPORTED_LOCALES else _FALLBACK_LOCALE


def _get_node_thinking_desc(node: str, locale: str) -> str:
    if locale == "en_US":
        return _NODE_THINKING_DESC_EN.get(node, _DEFAULT_THINKING_DESC_EN)
    return _NODE_THINKING_DESC_ZH.get(node, _DEFAULT_THINKING_DESC_ZH)


def _get_node_phase_title(node: str, locale: str) -> str | None:
    if locale == "en_US":
        return _NODE_PHASE_TITLE_EN.get(node)
    return _NODE_PHASE_TITLE_ZH.get(node)


def _get_planning_phase_title(locale: str) -> str:
    return _PLANNING_PHASE_TITLE_EN if locale == "en_US" else _PLANNING_PHASE_TITLE_ZH


def _get_received_message_text(locale: str) -> str:
    return (
        "Message received, processing..."
        if locale == "en_US"
        else "已接收到用户消息，开始处理"
    )


_HEARTBEAT_INTERVAL: float = 3.0

_LOG_COMMAND_CONTENT_MAX_CHARS: int = 4000

_RESOURCE_LIST_TOOL_TYPES: frozenset[str] = frozenset({"OBJECT", "VIEW"})


def _format_paradigm_form(form_str: str) -> str:
    """将 paradigm form JSON 格式化为可读维度选项列表。"""
    try:
        data = json.loads(form_str) if form_str else {}
        paradigm_list = data.get("paradigmList", [])
        if not paradigm_list:
            return form_str or ""
        lines = []
        for idx, item in enumerate(paradigm_list, 1):
            name = item.get("name") or item.get("termName") or ""
            desc = item.get("description") or item.get("fieldName") or ""
            if name:
                lines.append(f"{idx}. {name}" + (f" — {desc}" if desc else ""))
        return "\n".join(lines) if lines else form_str or ""
    except Exception:
        return form_str or ""


def _format_knowledge_snippet(knowledge_str: str) -> str:
    """将 knowledge JSON 提取为字段映射文本（name → fieldName/description）。"""
    try:
        data = json.loads(knowledge_str) if knowledge_str else {}
        paradigm_list = data.get("paradigmList", [])
        if not paradigm_list:
            return knowledge_str or ""
        lines = []
        for item in paradigm_list:
            name = item.get("name") or item.get("termName") or ""
            field = item.get("fieldName") or item.get("description") or ""
            if name and field:
                lines.append(f"{name} → {field}")
        return "\n".join(lines) if lines else knowledge_str or ""
    except Exception:
        return knowledge_str or ""


def _truncate_for_command_log(value: Any, max_chars: int) -> Any:
    """Shorten long strings inside command dicts so a single log line stays usable."""

    if isinstance(value, str) and len(value) > max_chars:
        return f"{value[:max_chars]}...<truncated total_chars={len(value)}"
    if isinstance(value, list):
        return [_truncate_for_command_log(item, max_chars) for item in value]
    if isinstance(value, dict):
        return {k: _truncate_for_command_log(v, max_chars) for k, v in value.items()}
    return value


def _json_line_for_console(obj: Any) -> str:
    """Serialize to one JSON line, preserving non-ASCII characters (e.g. Chinese)."""

    try:
        return json.dumps(obj, ensure_ascii=False, default=str, separators=(",", ":"))
    except (TypeError, ValueError):
        return json.dumps(str(obj), ensure_ascii=False)


def _command_question_for_log(command: GatewayCommand) -> str:
    """Return body ``content`` (user question) as a log-safe string, matching AskAgent JSON ``body.content``."""

    raw = getattr(command, "content", None)
    if raw is None:
        return '""'
    if isinstance(raw, str):
        clipped = (
            raw
            if len(raw) <= _LOG_COMMAND_CONTENT_MAX_CHARS
            else f"{raw[:_LOG_COMMAND_CONTENT_MAX_CHARS]}...<truncated total_chars={len(raw)}>"
        )
        return json.dumps(clipped, ensure_ascii=False)
    truncated = _truncate_for_command_log(raw, _LOG_COMMAND_CONTENT_MAX_CHARS)
    return _json_line_for_console(truncated)


def _format_gateway_command_for_log(command: GatewayCommand) -> str:
    """Return one JSON line describing the gateway command (header + body)."""

    to_dict = getattr(command, "to_dict", None)
    if not callable(to_dict):
        return _json_line_for_console(
            {"command_type": type(command).__name__, "error": "no_to_dict"}
        )
    try:
        payload = to_dict()
    except Exception as exc:
        return _json_line_for_console(
            {"command_type": type(command).__name__, "to_dict_error": str(exc)}
        )
    truncated = _truncate_for_command_log(payload, _LOG_COMMAND_CONTENT_MAX_CHARS)
    return _json_line_for_console(truncated)


def _now_monotonic() -> float:
    return asyncio.get_running_loop().time()


def _build_dynamic_mounted_objects(
    object_ids: list[Any],
    view_ids: list[Any],
) -> list[str]:
    """Filter, deduplicate, and order object_ids + view_ids into mounted_objects.

    Non-string, empty, and whitespace-only elements are discarded.
    object_ids appear before view_ids; first occurrence wins on duplicates.
    """
    seen: set[str] = set()
    result: list[str] = []
    for raw in list(object_ids) + list(view_ids):
        if not isinstance(raw, str):
            continue
        code = raw.strip()
        if code and code not in seen:
            result.append(code)
            seen.add(code)
    return result


def _build_dynamic_cache_key(mounted_objects: list[str]) -> str:
    """Return a stable 'dynamic:{sha1[:12]}' cache key for the given resource set."""
    fingerprint = hashlib.sha1("|".join(sorted(mounted_objects)).encode()).hexdigest()[
        :12
    ]
    return f"dynamic:{fingerprint}"


def _extract_tool_resource_codes(
    resource_list: list[Any],
) -> tuple[list[str], list[str]]:
    """从 resource_list 中提取 OBJECT / VIEW 的资源码。

    Args:
        resource_list: 前端透传的资源清单，元素为 dict。

    Returns:
        (object_codes, view_codes)，分别保留首次出现顺序、内部去重。
        资源码优先取 ``resouceCode``（前端历史拼写），回退 ``resourceCode``。
        非 dict / 资源类型不在 OBJECT/VIEW / 资源码空白 的项被跳过。

    每个返回的 code 在下游 ``OntologyToolLoader`` 中会被展开为该资源下的
    全部工具：虚拟 ``{QUERY_PREFIX}{code}`` / ``{COMPUTE_PREFIX}{code}``
    及 OWL/视图定义的 Action 工具。
    """
    object_codes: list[str] = []
    view_codes: list[str] = []
    seen_obj: set[str] = set()
    seen_view: set[str] = set()

    for item in resource_list:
        if not isinstance(item, dict):
            continue
        rtype_raw = item.get("resourceType")
        if not isinstance(rtype_raw, str):
            continue
        rtype = rtype_raw.strip().upper()
        if rtype not in _RESOURCE_LIST_TOOL_TYPES:
            continue
        code_raw = item.get("resouceCode") or item.get("resourceCode") or ""
        code = str(code_raw).strip()
        if not code:
            continue
        if rtype == "OBJECT" and code not in seen_obj:
            object_codes.append(code)
            seen_obj.add(code)
        elif rtype == "VIEW" and code not in seen_view:
            view_codes.append(code)
            seen_view.add(code)

    return object_codes, view_codes


_SKILL_PLACEHOLDER_RE = re.compile(
    r"\{\{(query|compute|action|ontology|view|inference|knowledge):([^}]+)\}\}"
)
_SKILL_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---", re.DOTALL)


def _parse_skill_meta(content: str) -> dict[str, str]:
    """从 SKILL.md 内容中解析 frontmatter 的 name 和 description 字段。"""
    m = _SKILL_FRONTMATTER_RE.match(content)
    if not m:
        return {}
    result: dict[str, str] = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, _, v = line.partition(":")
            result[k.strip()] = v.strip().strip('"')
    return result


def _extract_skill_resource_ids(resource_list: list[Any]) -> list[str]:
    """从 resource_list 中提取 SKILL 类型条目的 resourceId。

    SKILL 条目的 resourceCode 为 null，路径取 resourceId。
    示例 resourceId：/.openclaw/workspace-baiying-agent-10000289/skills/老鹰-战略全局分析
    """
    result: list[str] = []
    for item in resource_list:
        if not isinstance(item, dict):
            continue
        rtype = str(item.get("resourceType") or "").strip().upper()
        if rtype != "SKILL":
            continue
        rid = str(item.get("resourceId") or "").strip()
        if rid:
            result.append(rid)
    return result


def _replace_skill_placeholders(
    content: str,
    tools_dict: dict[str, Any],
) -> tuple[str, list[str]]:
    """替换 SKILL.md 中的 {{type:code}} 占位符为真实 tool 名。

    Returns:
        (替换后的内容, warning 列表)
    """
    warnings: list[str] = []

    def replacer(m: re.Match) -> str:  # type: ignore[type-arg]
        kind = m.group(1)
        code = m.group(2)

        # 本体语义类占位符预留，当前返回告警占位
        if kind in ("ontology", "view", "inference", "knowledge"):
            warnings.append(
                f"⚠️ 本体占位符 {{{{{kind}:{code}}}}} 暂未挂载，由后续本体推理模块填充"
            )
            return m.group(0)

        if kind == "action":
            parts = code.split(":", 1)
            obj_code = parts[0]
            act_name = parts[1] if len(parts) > 1 else ""
            candidates = [k for k in tools_dict if obj_code in k and act_name in k]
            if candidates:
                return candidates[0]
            tool_name = f"{act_name}_{obj_code}" if act_name else obj_code
        else:
            tool_name = f"{kind}_{code}"

        if tool_name not in tools_dict:
            # 兼容 tools_dict key 带 data_ 前缀的情况（如 data_query_scene_xxx）
            prefixed = f"data_{tool_name}"
            if prefixed in tools_dict:
                return prefixed
            warnings.append(f"⚠️ 工具 {tool_name} 未挂载到当前 agent，无法调用")
            return m.group(0)
        return tool_name

    replaced = _SKILL_PLACEHOLDER_RE.sub(replacer, content)
    return replaced, warnings


def _load_skills(
    resource_list: list[Any],
    user_code: str,
    tools_dict: dict[str, Any],
    agent_id: str = "",
) -> tuple[str, str, list[dict[str, str]]] | None:
    """加载 skill，返回 (task_prompt, first_skill_path, skill_catalog)；无 skill 时返回 None。

    路径A：resource_list 中有 SKILL 条目，按 resourceId 精确加载。
    路径B：无 SKILL 条目时，自动扫描 _build_skill_dirs 返回的目录（personal_dir 覆盖 agent_dir）。

    skill_catalog 格式：[{"name": ..., "description": ..., "location": "SKILL.md 绝对路径"}]
    由调用方写入 config["configurable"]["extras"]["skill_catalog"]，供 activate_skill 工具按需加载。

    Args:
        resource_list: extra_payload["resource_list"]
        user_code:     command.header.user_code
        tools_dict:    AgentConfig.extra["redirect_tools"]，key 为真实 tool 名
        agent_id:      agent id，用于路径B目录构建
    """
    skill_ids = _extract_skill_resource_ids(resource_list)

    minio_root = os.environ.get(
        "FILE_STORAGE_MINIO_MOUNT_PATH", "/data/byai/byaiAllInOne/mino"
    )
    # skill_entries: [(name, description, raw_content, skill_md_path)]
    skill_entries: list[tuple[str, str, str, Path]] = []
    all_warnings: list[str] = []
    first_skill_path = ""
    _log = logging.getLogger(__name__)

    if skill_ids:
        # 路径A：显式 SKILL 条目
        for resource_id in skill_ids:
            skill_path = (
                Path(minio_root) / f"byclaw-{user_code}" / "by" / resource_id.lstrip("/")
            )
            if not first_skill_path:
                first_skill_path = str(skill_path)
            skill_md = skill_path / "SKILL.md"
            if not skill_md.exists():
                _log.warning("_load_skills: SKILL.md not found at %s, skipping", skill_md)
                continue
            try:
                content = skill_md.read_text(encoding="utf-8")
            except OSError as exc:
                _log.warning("_load_skills: failed to read %s: %s, skipping", skill_md, exc)
                continue
            meta = _parse_skill_meta(content)
            content, w = _replace_skill_placeholders(content, tools_dict)
            all_warnings.extend(w)
            skill_entries.append((
                meta.get("name") or skill_path.name,
                meta.get("description") or "",
                content,
                skill_md,
            ))
    else:
        # 路径B：无显式条目，自动扫描 skill 目录。
        # _build_skill_dirs 返回 [agent_dir, personal_dir]，优先级从低到高。
        # 后扫描的目录（personal_dir）以 skill 目录名为 key 覆盖前者，避免重复注入。
        skill_dirs = _build_skill_dirs(user_code=user_code, agent_id=agent_id)
        _log.info(
            "_load_skills: no explicit SKILL entries, scanning dirs=%s", skill_dirs
        )
        # key = skill 目录名，value = skill_md Path；后扫描覆盖前扫描
        skill_map: dict[str, Path] = {}
        for skill_dir in skill_dirs:
            skill_dir_path = Path(skill_dir)
            if not skill_dir_path.is_dir():
                continue
            for skill_md in sorted(skill_dir_path.rglob("SKILL.md")):
                skill_map[skill_md.parent.name] = skill_md

        for skill_dir_name, skill_md in sorted(skill_map.items()):
            if not first_skill_path:
                first_skill_path = str(skill_md.parent)
            try:
                content = skill_md.read_text(encoding="utf-8")
            except OSError as exc:
                _log.warning(
                    "_load_skills: failed to read %s: %s, skipping", skill_md, exc
                )
                continue
            meta = _parse_skill_meta(content)
            content, w = _replace_skill_placeholders(content, tools_dict)
            all_warnings.extend(w)
            skill_entries.append((
                meta.get("name") or skill_dir_name,
                meta.get("description") or "",
                content,
                skill_md,
            ))
            _log.info(
                "_load_skills: auto-loaded skill '%s' from %s",
                meta.get("name") or skill_dir_name,
                skill_md,
            )

    if not skill_entries:
        return None

    # skill_catalog 供 activate_skill 工具按需加载完整指令
    skill_catalog = [
        {"name": name, "description": desc, "location": str(skill_md)}
        for name, desc, _, skill_md in skill_entries
    ]

    # system prompt 只注入轻量索引，完整指令由 activate_skill 按需拉取
    index_lines = ["## 可用 Skills\n"]
    for name, desc, _, _ in skill_entries:
        index_lines.append(f"- **{name}**：{desc}" if desc else f"- **{name}**")
    index_lines.append(
        "\n> 当用户提到某个 skill 名称或请求对应分析时，先调用 `activate_skill(name=...)` 加载完整指令，再按指令执行。"
    )
    task_prompt = "\n".join(index_lines)
    if all_warnings:
        task_prompt += "\n\n" + "\n".join(all_warnings)
    return task_prompt, first_skill_path, skill_catalog


# ── 路径B：自动 skill 发现（路径构建在此，扫描/解析委托 SDK）─────────────────────


def _extract_rel_skills(agent_list: list[Any]) -> set[str]:
    """从 agent_list 第一个 agent 的 relSkills 提取白名单。空集合=不过滤。"""
    agent_cfg = agent_list[0] if agent_list and isinstance(agent_list, list) else {}
    if not isinstance(agent_cfg, dict):
        return set()
    rel = agent_cfg.get("relSkills") or []
    if isinstance(rel, str):
        try:
            rel = json.loads(rel)
        except (ValueError, TypeError):
            rel = []
    return {str(s).strip() for s in rel if s}


def _build_skill_dirs(user_code: str, agent_id: str) -> list[str]:
    """构建 skill 目录列表（agent 级 + 个人级），供 OntologyAgent.ask(skill_dirs=) 使用。"""
    minio_root = os.environ.get(
        "FILE_STORAGE_MINIO_MOUNT_PATH", "/data/byai/byaiAllInOne/mino"
    )
    agent_dir = os.environ.get("AGENT_SKILLS_DIR", "/app/skills")
    personal_dir = str(
        Path(minio_root)
        / f"byclaw-{user_code}"
        / "by"
        / f"byclaw-{user_code}"
        / "by"
        / ".bydc"
        / f"agent_{agent_id}"
        / "skills"
    )
    return [agent_dir, personal_dir]


def _normalize_recall(raw: Any) -> list[str]:
    """将 recall 值规范化为 list[str]：list 原样返回，str 包装为单元素列表。"""
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str) and raw:
        return [raw]
    return []


def _dict_to_paradigm_answer(raw: Any) -> Any:
    """将前端 paradigm dict 转为 user_clarify_node 能解析的 dict；str 时原样返回。

    前端回传格式（实际结构）：
    humanInput = {
        "metadata": {...},
        "paradigmList": [  ← 外层只有 1 个包装元素
            {
                "query": "...",
                "paradigmList": [  ← 每个元素是范式组
                    {"paradigmId": "1", "paradigmName": "查询值",
                     "paradigmResult": [{"choiceKeyword": ..., "recall": ...}]},
                    ...
                ]
            }
        ]
    }

    user_clarify_node 期望格式（保留 group 结构）：
    {"paradigmList": [{"paradigmList": [{paradigmId, paradigmName, paradigmResult: [...]}, ...]}]}
    """
    if isinstance(raw, str):
        return raw
    if not isinstance(raw, dict):
        return str(raw) if raw is not None else ""
    if _is_operation_form_resume(raw):
        return raw

    # 从 metadata.paradigmList 构建 (paradigmId, keyword) → {kid, ktype} 索引
    # 用户回传的选项里没有 kid/ktype，后端需从 metadata 补全。
    # metadata 是前端从 SSE emit 透传回来的，结构可信。
    _meta_kid_map: dict[str, dict[str, Any]] = {}
    _meta_raw = raw.get("metadata") or {}
    _meta_pl = _meta_raw.get("paradigmList")
    if isinstance(_meta_pl, list):
        for _mg in _meta_pl:
            if not isinstance(_mg, dict):
                continue
            _pid = str(_mg.get("paradigmId", ""))
            for _mr in _mg.get("paradigmResult") or []:
                if isinstance(_mr, dict) and _mr.get("keyword"):
                    _meta_kid_map[_mr["keyword"]] = {
                        "kid": _mr.get("kid", 0),
                        "ktype": str(_mr.get("ktype") or ""),
                    }

    # 外层 paradigmList → 包装元素 → 内层 paradigmList → 范式组
    result_groups: list[dict[str, Any]] = []
    outer_list = list(raw.get("paradigmList") or [])
    for wrapper in outer_list:
        if not isinstance(wrapper, dict):
            continue
        groups = list(wrapper.get("paradigmList") or [])
        for group in groups:
            if not isinstance(group, dict):
                continue
            # 每个范式组下的 paradigmResult 才是真正的选项列表
            items = list(group.get("paradigmResult") or [])
            group_result_items: list[dict[str, Any]] = []
            for item in items:
                if isinstance(item, dict):
                    kw = str(item.get("keyword") or "")
                    # 从 metadata 索引补全 kid/ktype
                    _meta_info = _meta_kid_map.get(kw) or {}
                    group_result_items.append(
                        {
                            "choiceKeyword": str(item.get("choiceKeyword") or ""),
                            "recall": _normalize_recall(item.get("recall")),
                            "keyword": kw,
                            "kid": item.get("kid") or _meta_info.get("kid", 0),
                            "ktype": str(
                                item.get("ktype") or _meta_info.get("ktype", "")
                            ),
                            "field": str(item.get("field") or ""),
                            "comparison": str(item.get("comparison") or ""),
                            "value": str(item.get("value") or ""),
                            "choiceField": str(item.get("choiceField") or ""),
                            "choiceComparison": str(item.get("choiceComparison") or ""),
                            "fieldRecall": item.get("fieldRecall")
                            if isinstance(item.get("fieldRecall"), list)
                            else [],
                            "comparisonRecall": item.get("comparisonRecall")
                            if isinstance(item.get("comparisonRecall"), list)
                            else [],
                            "valueRecall": item.get("valueRecall")
                            if isinstance(item.get("valueRecall"), list)
                            else [],
                        }
                    )

            result_groups.append(
                {
                    "paradigmId": str(group.get("paradigmId") or ""),
                    "paradigmName": str(group.get("paradigmName") or ""),
                    "paradigmResult": group_result_items,
                }
            )

    # 返回 user_clarify_node 期望的纯 dict 结构
    # metadata 透传仍保留供 user_clarify_node L316-317 兜底读取 meta_paradigm_list
    return {
        "paradigmList": [
            {
                "paradigmList": result_groups,
            }
        ],
        "metadata": raw.get("metadata", {}),
    }


def _is_operation_form_resume(raw: dict[str, Any]) -> bool:
    """判断前端恢复值是否为操作确认表单，而不是查询澄清 paradigm。"""
    return (
        str(raw.get("interrupt_type") or "") == "operation_form"
        or ("formId" in raw and isinstance(raw.get("actions"), list))
        or (
            "formId" in raw and "confirmed" in raw and isinstance(raw.get("rule"), list)
        )
    )


def _operation_form_resume_from_human_input(
    human_input: dict[str, Any],
) -> dict[str, Any] | None:
    """从前端 humanInput.operationForm 恢复值组装 LangGraph resume payload。"""
    operation_form = human_input.get("operationForm") or human_input.get(
        "operation_form"
    )
    if not isinstance(operation_form, dict):
        return None
    query_text = str(human_input.get("query") or "").strip()
    confirmed = query_text not in {"取消", "cancel", "Cancel", "CANCEL"}
    actions = operation_form.get("actions")
    if isinstance(actions, list):
        resume_value = dict(operation_form)
        resume_value["interrupt_type"] = "operation_form"
        normalized_actions: list[dict[str, Any]] = []
        for action in actions:
            if not isinstance(action, dict):
                continue
            normalized_action = dict(action)
            if not confirmed:
                normalized_action["confirmed"] = False
                normalized_action.setdefault("reason", query_text or "用户取消操作")
            normalized_actions.append(normalized_action)
        resume_value["actions"] = normalized_actions
        return resume_value

    resume_value: dict[str, Any] = {
        "interrupt_type": "operation_form",
        "formId": str(operation_form.get("formId") or ""),
        "confirmed": confirmed,
        "rule": operation_form.get("rule")
        if isinstance(operation_form.get("rule"), list)
        else [],
    }
    if not confirmed:
        resume_value["reason"] = query_text or "用户取消操作"
    return resume_value


def _human_input_from_payload(
    *,
    ext_params: Any,
    extra_payload: dict[str, Any],
) -> dict[str, Any]:
    """兼容 ext_params.humanInput 与前端直接透传 humanInput 两种位置。"""
    if isinstance(ext_params, dict):
        human_input = ext_params.get("humanInput")
        if isinstance(human_input, dict):
            return human_input
    human_input = extra_payload.get("humanInput")
    return human_input if isinstance(human_input, dict) else {}


def _paradigm_option_to_dict(opt: Any) -> dict[str, Any]:
    """将 ParadigmOption 转为前端 paradigmResult 字典，包含查询值和过滤条件字段。"""
    result: dict[str, Any] = {
        "keyword": getattr(opt, "keyword", ""),
        "recall": getattr(opt, "recall", []),
        "kid": getattr(opt, "kid", 0),
        "ktype": getattr(opt, "ktype", ""),
        "choiceKeyword": getattr(opt, "choice_keyword", ""),
    }
    # 过滤条件专用字段：仅当有值时输出，避免前端收到大量空字段
    filter_field = getattr(opt, "filter_field", "")
    if filter_field:
        result["field"] = filter_field
        result["choiceField"] = getattr(opt, "choice_field", "")
    comparison = getattr(opt, "comparison", "")
    if comparison:
        result["comparison"] = comparison
        result["choiceComparison"] = getattr(opt, "choice_comparison", "")
    value = getattr(opt, "value", "")
    if value:
        result["value"] = value
    field_recall = getattr(opt, "field_recall", None)
    if field_recall:
        result["fieldRecall"] = field_recall
    comparison_recall = getattr(opt, "comparison_recall", None)
    if comparison_recall:
        result["comparisonRecall"] = comparison_recall
    value_recall = getattr(opt, "value_recall", None)
    if value_recall:
        result["valueRecall"] = value_recall
    return result


def _operation_form_field_to_dict(field: Any) -> dict[str, Any]:
    """将 OperationFormField 转为前端表单协议字段 dict。"""
    result: dict[str, Any] = {
        "formType": getattr(field, "form_type", ""),
        "fieldCode": getattr(field, "field_code", ""),
        "fieldName": getattr(field, "field_name", ""),
        "fieldType": getattr(field, "field_type", ""),
        "fieldPath": getattr(field, "field_path", ""),
        "required": bool(getattr(field, "required", False)),
        "readonly": bool(getattr(field, "readonly", False)),
        "disabled": bool(getattr(field, "disabled", False)),
        "isHidden": bool(getattr(field, "is_hidden", False)),
        "defaultFiles": list(getattr(field, "default_files", []) or []),
    }
    item_id = str(getattr(field, "item_id", "") or "")
    if item_id:
        result["itemId"] = item_id
    description = str(getattr(field, "description", "") or "")
    if description:
        result["description"] = description
    term = getattr(field, "term", None)
    if isinstance(term, dict):
        result["term"] = dict(term)
    children = getattr(field, "children", None)
    if children is not None:
        result["children"] = [
            [_operation_form_field_to_dict(item) for item in row] for row in children
        ]
    else:
        result["fieldValue"] = getattr(field, "field_value", None)
    return result


def _operation_form_to_dict(operation_form: Any) -> dict[str, Any]:
    """将 OntologyAgent OperationForm 转为前端表单协议 dict。"""
    if operation_form is None:
        return {}
    if isinstance(operation_form, dict):
        return dict(operation_form)
    raw = getattr(operation_form, "raw", None)
    if isinstance(raw, dict) and raw:
        return dict(raw)
    rule = getattr(operation_form, "rule", []) or []
    return {
        "schemaVersion": getattr(operation_form, "schema_version", ""),
        "formId": getattr(operation_form, "form_id", ""),
        "actionCode": getattr(operation_form, "action_code", ""),
        "actionName": getattr(operation_form, "action_name", ""),
        "title": getattr(operation_form, "title", ""),
        "description": getattr(operation_form, "description", ""),
        "rule": [
            [_operation_form_field_to_dict(field) for field in row] for row in rule
        ],
    }


def _create_early_langfuse_trace(
    *,
    trace_id: str,
    session_id: str,
    user_id: str,
    message_id: str,
    agent_id: str,
    question: str = "",
    history: list[dict[str, str]] | None = None,
    parent_observation_id: str = "",
) -> Any | None:
    """在 LLM 调用之前立即建 Langfuse trace，保持跨服务链路完整。

    trace_id 规则：
    - 上游提供合法 32 位小写 hex → 直接使用，与其他服务 trace 对齐
    - 非法格式 → 不传 trace_id，让 Langfuse 自动生成，原始值存入 metadata
    parent_observation_id: LangfusePlugin.on_task_start 创建的 span id，
        设置后 datacloud-agent span 会作为其子节点，确保完整父子层级。
    """
    if not os.getenv("LANGFUSE_SECRET_KEY"):
        return None
    try:
        from langfuse import Langfuse  # noqa: PLC0415
        from langfuse.types import TraceContext  # noqa: PLC0415

        _is_valid_lf_id = bool(trace_id and re.fullmatch(r"[0-9a-f]{32}", trace_id))
        _tc: dict[str, str] = {}
        if _is_valid_lf_id:
            _tc["trace_id"] = trace_id
        if parent_observation_id:
            _tc["parent_span_id"] = parent_observation_id
        trace_context = TraceContext(**_tc) if _tc else None

        # LANGFUSE_BASE_URL 是 SDK 4.x 标准变量，LANGFUSE_HOST 为旧版兼容
        _lf_host = (
            os.getenv("LANGFUSE_BASE_URL")
            or os.getenv("LANGFUSE_HOST")
            or "https://cloud.langfuse.com"
        )
        lf = Langfuse(
            secret_key=os.getenv("LANGFUSE_SECRET_KEY"),
            public_key=os.getenv("LANGFUSE_PUBLIC_KEY"),
            host=_lf_host,
        )
        # 用 start_observation（不激活 OTel context），避免和 LangChain callback 的
        # use_span() 冲突导致 LangGraph spans 消失。
        # 层级靠显式 parent_span_id 传递，不依赖 OTel context propagation。
        span = lf.start_observation(
            trace_context=trace_context,
            name="datacloud-agent",
            as_type="agent",
            input={
                "question": question,
                "message_id": message_id,
                "user_code": user_id,
                "session_id": session_id,
                "agent_id": agent_id,
                "history_count": len(history) if history else 0,
                "context_messages": (history or []) + [{"role": "user", "content": str(question)[:500]}],
            },
            metadata={
                "object_type": "early_span",
                "biz_trace_id": trace_id,
                "message_id": message_id,
                "agent_id": agent_id,
                "session_id": session_id,
                "user_code": user_id,
                "env": os.getenv("HOST", ""),
                "worker": os.getenv("DATACLOUD_GATEWAY_WORKER_ID", ""),
            },
        )
        return (lf, span)
    except Exception:
        logger.debug("early langfuse trace creation skipped", exc_info=True)
        return None


def _update_early_langfuse_trace(
    handle: Any,
    *,
    status: str,
    error: str = "",
) -> None:
    """更新 early trace 的最终状态并关闭 OTel span。"""
    if handle is None:
        return
    try:
        lf, span = handle
        if status == "error":
            span.update(output={"error": error}, level="ERROR", status_message=error)
        else:
            span.update(output={"status": "ok"})
        span.end()
        lf.flush()
    except Exception:
        pass


def _get_gateway_user_code(context: Any) -> str | None:
    """从 Gateway context 提取用户标识，失败时返回 None。"""
    try:
        from datacloud_analysis.orchestration.gateway_user import (  # noqa: PLC0415
            get_gateway_user_id,
        )

        return get_gateway_user_id(context)
    except Exception:
        return None


async def _consume_agent_events(
    event_iter: AsyncGenerator[Any, None],
    context: Any,
    reco_task: asyncio.Task[list[str]] | None,
    emit_done: bool = True,
    agent_id: str | None = None,
    dyn_object_ids: list[str] | None = None,
    dyn_view_ids: list[str] | None = None,
    header_metadata: dict = {},
) -> dict[str, Any]:
    """消费 OntologyAgent 事件流，翻译为 Gateway SSE。"""
    logger.info(
        "_consume_agent_events: session=%s message_id=%s parent_message_id=%s",
        getattr(context, "session_id", ""),
        getattr(context, "message_id", ""),
        getattr(context, "parent_message_id", ""),
    )
    from datacloud_analysis.ontology_agent import (  # noqa: PLC0415
        AnswerEvent,
        ErrorEvent,
        InterruptEvent,
        StepEvent,
        ThinkingEvent,
    )

    interrupt_ev: Any = None
    _answer_parts: list[str] = []

    async for event in event_iter:
        if isinstance(event, ThinkingEvent):
            await context.emit_chunk(
                StreamChunkEvent(content=event.content),
                event_type=EventType.REASONING_LOG_START.value,
                content_type=SseReasonMessageType.think_text.value,
            )
        elif isinstance(event, StepEvent):
            await context.emit_chunk(
                StreamChunkEvent(content=event.title),
                event_type=EventType.REASONING_LOG_START.value,
                content_type=SseReasonMessageType.think_text.value,
            )
        elif isinstance(event, AnswerEvent):
            if event.content:
                _answer_parts.append(event.content)
                await context.emit_chunk(
                    StreamChunkEvent(content=event.content),
                    event_type=EventType.ANSWER_DELTA.value,
                    content_type=SseMessageType.text.value,
                )
            await context.flush_to_history()
            if emit_done:
                await context.emit_chunk(
                    StreamChunkEvent(
                        content="回答完成",
                        metadata={
                            "relatedResources": _related_resources_from_reco_task(
                                reco_task
                            )
                        },
                    ),
                    event_type=EventType.APP_STREAM_RESPONSE.value,
                    content_type=SseMessageType.text.value,
                )
            return {"status": "done", "content": "".join(_answer_parts)}
        elif isinstance(event, InterruptEvent):
            interrupt_ev = event
            break
        elif isinstance(event, ErrorEvent):
            logger.error(
                "_consume_agent_events: error message=%s code=%s",
                event.message,
                event.code,
            )
            await context.emit_chunk(
                StreamChunkEvent(content=event.message),
                event_type=EventType.ANSWER_DELTA.value,
                content_type=SseMessageType.text.value,
            )
            return {"status": "done"}

    if interrupt_ev is None:
        return {"status": "done"}

    if interrupt_ev.reason == "AGENT_DELEGATE_WAIT":
        logger.info(
            "_consume_agent_events: delegate wait interrupt thread_id=%s",
            interrupt_ev.thread_id,
        )
        await context.emit_chunk(
            StreamChunkEvent(
                content="回答完成",
                metadata={
                    "relatedResources": _related_resources_from_reco_task(reco_task)
                },
            ),
            event_type=EventType.APP_STREAM_RESPONSE.value,
            content_type=SseMessageType.text.value,
        )
        return {"status": "waiting"}

    await context.emit_chunk(
        StreamChunkEvent(
            content="回答完成",
            metadata={"relatedResources": _related_resources_from_reco_task(reco_task)},
        ),
        event_type=EventType.APP_STREAM_RESPONSE.value,
        content_type=SseMessageType.text.value,
    )

    operation_form = _operation_form_to_dict(
        getattr(interrupt_ev, "operation_form", None)
    )
    if (
        operation_form
        or getattr(interrupt_ev, "interrupt_type", "") == "operation_form"
        or interrupt_ev.reason == "OPERATION_FORM_CONFIRMATION"
    ):
        custom_metadata = {
            "thread_id": interrupt_ev.thread_id,
            "interrupt_reason": interrupt_ev.reason,
            "interrupt_type": "operation_form",
            "operation_form": operation_form,
            "agent_id": agent_id or "",
            "is_dynamic_agent": True,
            "call_object_ids": dyn_object_ids or [],
            "call_view_ids": dyn_view_ids or [],
        }
        await context.complex_ask_user(
            event=AskUserEvent(
                prompt=interrupt_ev.prompt,
                metadata={**custom_metadata, **header_metadata},
            ),
            message_id=getattr(context, "message_id", None),
            parent_message_id=getattr(context, "parent_message_id", None),
        )
    elif interrupt_ev.reason == "PARADIGM_CLARIFICATION":
        paradigm_list: list[dict[str, Any]] = []
        for group in interrupt_ev.paradigm_list or []:
            paradigm_list.append(
                {
                    "paradigmId": group.paradigm_id,
                    "paradigmName": group.paradigm_name,
                    "paradigmResult": [
                        _paradigm_option_to_dict(opt) for opt in group.options
                    ],
                }
            )
        custom_metadata = {
            "thread_id": interrupt_ev.thread_id,
            "interrupt_reason": interrupt_ev.reason,
            "paradigmList": paradigm_list,
            "query": interrupt_ev.query,
            "agent_id": agent_id or "",
            "is_dynamic_agent": True,
            "call_object_ids": dyn_object_ids or [],
            "call_view_ids": dyn_view_ids or [],
        }
        await context.complex_ask_user(
            event=AskUserEvent(
                prompt=interrupt_ev.prompt,
                metadata={**custom_metadata, **header_metadata},
            ),
            message_id=getattr(context, "message_id", None),
            parent_message_id=getattr(context, "parent_message_id", None),
        )
    else:
        await context.ask_user(
            AskUserEvent(
                prompt=interrupt_ev.prompt,
                metadata={
                    "thread_id": interrupt_ev.thread_id,
                    "interrupt_reason": interrupt_ev.reason,
                    "agent_id": agent_id or "",
                    "is_dynamic_agent": True,
                    "call_object_ids": dyn_object_ids or [],
                    "call_view_ids": dyn_view_ids or [],
                },
            )
        )
    return {"status": "waiting"}


async def _heartbeat_loop(
    context: ByclawDataClarification,
    stop_event: asyncio.Event,
    last_emit_time_ref: list[float],
) -> None:
    """Keep a silence watchdog alive without emitting frontend heartbeat text."""
    _ = context
    try:
        while not stop_event.is_set():
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=1.0)
                break
            except TimeoutError:
                pass

            now = _now_monotonic()
            if now - last_emit_time_ref[0] < _HEARTBEAT_INTERVAL:
                continue
            last_emit_time_ref[0] = now
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.warning("heartbeat loop exited with error: %s", exc)


def _compiled_graph_has_checkpointer(graph: Any) -> bool:
    """Return True if LangGraph was compiled with a usable checkpointer.

    ``Pregel.aget_state`` raises ``ValueError('No checkpointer set')`` when this is false.
    """

    cp = getattr(graph, "checkpointer", None)
    if cp is True:
        return True
    return isinstance(cp, BaseCheckpointSaver)


_no_checkpointer_logged: bool = False


class DataCloudWorker(GatewayWorker):
    """Worker that drives the datacloud-analysis graph inside the Gateway worker protocol."""

    _GRAPH_CACHE_MAX: int = 32
    _RESUME_RESULT_CACHE_MAX: int = 256

    def __init__(
        self,
        model_name: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
        plugin_registry: PluginRegistry | None = None,
        *args: Any,
        **kwargs: Any,
    ) -> None:
        super().__init__(plugin_registry=plugin_registry, *args, **kwargs)
        self.model_name = model_name
        self.api_key = api_key
        self.base_url = base_url
        self.graphs: OrderedDict = OrderedDict()
        self._resume_result_cache: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._resume_inflight: dict[str, asyncio.Future[dict[str, Any]]] = {}
        self.command_plugin_manager = CommandPluginManager.from_defaults()
        self._shared_loader: Any | None = None
        self._resource_path: str = os.environ.get("DATACLOUD_ONTOLOGY_PATH", "")
        self._ontology_agent: Any | None = None
        self._model_config_sig: str = ""
        self._ontology_agent_lock: asyncio.Lock = asyncio.Lock()
        logger.info(
            "[DIAG_INIT] DataCloudWorker.__init__: model_name=%s base_url=%s api_key=%s "
            "env_OPENAI_API_KEY=%s env_OPENAI_BASE_URL=%s env_DATACLOUD_LLM_MODEL=%s env_LOAD_MODE=%s",
            self.model_name,
            self.base_url,
            "***" if self.api_key else "<EMPTY>",
            "***" if os.environ.get("OPENAI_API_KEY") else "<EMPTY>",
            os.environ.get("OPENAI_BASE_URL", "<EMPTY>"),
            os.environ.get("DATACLOUD_LLM_MODEL", "<EMPTY>"),
            os.environ.get("DATACLOUD_LLM_MODEL_LOAD_MODE", "<EMPTY>"),
        )

    def _build_resume_dedup_key(
        self,
        *,
        session_id: str,
        checkpoint_id: str,
        checkpoint_ns: str,
        resume_value: Any,
    ) -> str:
        try:
            resume_payload = json.dumps(
                resume_value, ensure_ascii=False, sort_keys=True, default=str
            )
        except Exception:
            resume_payload = repr(resume_value)
        raw = json.dumps(
            {
                "session_id": session_id,
                "checkpoint_id": checkpoint_id,
                "checkpoint_ns": checkpoint_ns,
                "resume_payload": resume_payload,
            },
            ensure_ascii=False,
            sort_keys=True,
        )
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def _cache_resume_result(self, key: str, result: dict[str, Any]) -> None:
        self._resume_result_cache[key] = dict(result)
        self._resume_result_cache.move_to_end(key)
        while len(self._resume_result_cache) > self._RESUME_RESULT_CACHE_MAX:
            self._resume_result_cache.popitem(last=False)

    def invalidate_agent_graph_cache(self, agent_ids: set[str]) -> None:
        """Drop cached compiled graphs for the given agent ids."""
        normalized_ids = {
            str(agent_id).strip() for agent_id in agent_ids if str(agent_id).strip()
        }
        if not normalized_ids:
            return
        for cache_key in list(self.graphs.keys()):
            agent_prefix = cache_key.split(":", 1)[0]
            if agent_prefix in normalized_ids:
                self.graphs.pop(cache_key, None)
                logger.info("Graph cache invalidated: key=%s", cache_key)

    async def _ensure_agent_config_loaded(
        self,
        *,
        context: ByclawDataClarification,
        command: GatewayCommand,
        agent_id: str,
    ) -> None:
        """Ensure the requested agent config is loaded before matching configs."""

        normalized_agent_id = str(agent_id or "").strip()
        if not normalized_agent_id:
            return
        if isinstance(command, ResumeCommand):
            return
        if any(
            str(cfg.agent_id) == normalized_agent_id
            for cfg in self.plugin_registry.agent_configs
        ):
            return

        init_plugin = self.plugin_registry.get_plugin("datacloud_init_agent_conf")
        if init_plugin is None or not hasattr(init_plugin, "reload_agents"):
            return

        logger.info(
            "Agent config missing before process_command, attempting dynamic load: session=%s agent_id=%s",
            context.session_id,
            normalized_agent_id,
        )
        result = await init_plugin.reload_agents(
            registry=self.plugin_registry,
            reason="process_command_missing",
            target_agent_id=normalized_agent_id,
            strict=False,
        )
        context.set_agent_configs(self.plugin_registry.agent_configs)
        self.invalidate_agent_graph_cache(
            result.changed_agent_ids | result.removed_agent_ids
        )

    @staticmethod
    def _stringify_metadata_value(value: Any) -> str:
        return str(value or "").strip()

    def _resolve_runtime_agent_key(
        self,
        *,
        command: GatewayCommand,
        by_agent_id: Any,
        header_metadata: dict[str, Any],
    ) -> str:
        if isinstance(command, ResumeCommand):
            resume_agent_id = self._stringify_metadata_value(
                header_metadata.get("resume_agent_id")
            )
            if resume_agent_id:
                return resume_agent_id
            resume_agent_type = self._stringify_metadata_value(
                header_metadata.get("resume_agent_type")
            )
            if resume_agent_type:
                return resume_agent_type

        by_agent_text = self._stringify_metadata_value(by_agent_id)
        if by_agent_text:
            return by_agent_text
        target_agent_type = self._stringify_metadata_value(
            getattr(command.header, "target_agent_type", "")
        )
        if target_agent_type:
            return target_agent_type
        return self.worker_id

    @classmethod
    def _resolve_resume_checkpoint_target(
        cls,
        *,
        header_metadata: Mapping[str, Any],
    ) -> tuple[str, str]:
        resume_checkpoint_id = cls._stringify_metadata_value(
            header_metadata.get("resume_checkpoint_id")
        )
        resume_checkpoint_ns = cls._stringify_metadata_value(
            header_metadata.get("resume_checkpoint_ns")
        )
        plain_checkpoint_id = cls._stringify_metadata_value(
            header_metadata.get("checkpoint_id")
        )
        plain_checkpoint_ns = cls._stringify_metadata_value(
            header_metadata.get("checkpoint_ns")
        )
        resume_thread_id = cls._stringify_metadata_value(
            header_metadata.get("resume_thread_id")
        )

        if resume_checkpoint_id:
            return resume_checkpoint_id, resume_checkpoint_ns or plain_checkpoint_ns

        if resume_thread_id and plain_checkpoint_id:
            logger.warning(
                "ResumeCommand metadata contains resume_thread_id=%s but only plain checkpoint_id=%s; "
                "ignoring plain checkpoint_id and resuming from latest checkpoint on that thread",
                resume_thread_id,
                plain_checkpoint_id,
            )
            return "", ""

        return plain_checkpoint_id, plain_checkpoint_ns

    @classmethod
    def _build_thread_id(cls, *, session_id: str, agent_key: str) -> str:
        agent_text = cls._stringify_metadata_value(agent_key)
        session_text = cls._stringify_metadata_value(session_id)
        if not agent_text or not session_text:
            return session_text or agent_text
        return f"{agent_text}:{session_text}"

    @staticmethod
    def _is_internal_wait_result(
        process_result: Any, context: ByclawDataClarification
    ) -> bool:
        if not getattr(context, "_is_suspended", False):
            return False
        if not isinstance(process_result, dict):
            return False
        return str(process_result.get("status") or "").strip().lower() == "waiting"

    def get_context_class(self) -> type[ByclawDataClarification]:
        return ByclawDataClarification

    @staticmethod
    def _consume_future_exception(fut: asyncio.Future[dict[str, Any]]) -> None:
        if fut.cancelled():
            return
        try:
            fut.exception()
        except Exception:
            return

    def _build_graph(
        self,
        prompts_dict: dict | None = None,
        tools_dict: dict | None = None,
        mounted_objects: list[str] | None = None,
        loader: Any | None = None,
        skip_action_families: frozenset[str] = frozenset(),
        agent_id: str | None = None,
    ) -> Any:
        """Instantiate the datacloud-analysis compiled graph with dynamic context."""
        logger.info(
            "[DIAG_BUILD_GRAPH] model=%s base_url=%s api_key=%s",
            self.model_name,
            self.base_url,
            "***" if self.api_key else "<EMPTY>",
        )
        return create_agent(
            model=self.model_name,
            api_key=self.api_key,
            base_url=self.base_url,
            prompts_overwrite=prompts_dict,
            tools=tools_dict,
            mounted_objects=mounted_objects,
            loader=loader,
            skip_action_families=skip_action_families,
            agent_id=agent_id,
        )

    def _extract_shared_loader(self) -> Any | None:
        """Return the first available OntologyLoader for the dynamic-agent path.

        Three-level fallback:
        1. First AgentConfig with a non-None extra["loader"].
        2. self._shared_loader cached at start_heartbeat time.
        3. None — OntologyToolLoader will skip OWL injection gracefully.
        """
        for cfg in self.plugin_registry.agent_configs if self.plugin_registry else []:
            extra = getattr(cfg, "extra", None) or {}
            loader = extra.get("loader")
            if loader is not None:
                return loader
        if self._shared_loader is not None:
            return self._shared_loader
        logger.warning(
            "DataCloudWorker._extract_shared_loader: no OntologyLoader found in any "
            "AgentConfig; dynamic agent will proceed with loader=None (OWL injection skipped)"
        )
        return None

    async def start_heartbeat(self, **kwargs: Any) -> None:
        setup_logging(extra_namespaces=("byclaw_data",))
        await super().start_heartbeat(**kwargs)

        init_plugin = self.plugin_registry.get_plugin("datacloud_init_agent_conf")
        loaded_agent_ids = (
            getattr(init_plugin, "loaded_agent_ids", []) if init_plugin else []
        )
        if not loaded_agent_ids:
            logger.warning("Worker started without any loaded digital employee config.")
        logger.info(
            "Init plugin loaded digital employees: count=%d ids=%s",
            len(loaded_agent_ids),
            loaded_agent_ids,
        )

        from datacloud_analysis import bootstrap

        await bootstrap.setup()

        logger.info("DataCloudWorker: SDK framework bootstrapped.")

        # 动态路径：初始化长生命周期 OntologyAgent（跨请求复用，发挥 T6 图缓存效益）
        # 若 DATACLOUD_ONTOLOGY_PATH 未设置，仅警告，不阻断静态路径启动；
        # 实际发起动态请求时再通过 assert 给出明确错误。
        if self._resource_path:
            from datacloud_analysis.ontology_agent import (
                OntologyAgent,
                OntologyAgentConfig,
            )  # noqa: PLC0415
            from datacloud_data_service.config import get_settings  # noqa: PLC0415

            from byclaw_data.mcp.result_file_storage import (
                build_result_file_storage,  # noqa: PLC0415
            )

            self._ontology_agent = OntologyAgent(
                OntologyAgentConfig(
                    api_key=self.api_key or "",
                    model=self.model_name or "",
                    base_url=self.base_url,
                    resource_path=self._resource_path,
                    result_file_storage=build_result_file_storage(
                        settings=get_settings()
                    ),
                )
            )
            logger.info(
                "DataCloudWorker: OntologyAgent initialized resource_path=%s",
                self._resource_path,
            )
        else:
            logger.warning(
                "DataCloudWorker: DATACLOUD_ONTOLOGY_PATH not set; "
                "OntologyAgent skipped. Dynamic agent path will fail on first request."
            )

        # 动态路径：从首个已加载 AgentConfig 取 loader 并缓存至 worker 级别
        self._shared_loader = self._extract_shared_loader()
        logger.info(
            "DataCloudWorker: _shared_loader=%s",
            "ready"
            if self._shared_loader is not None
            else "None (dynamic agents will skip OWL inject)",
        )

    async def _resolve_agent_configs_snapshot(
        self,
        execution: Any,
        session_id: str,
    ) -> Any:
        """Return the current in-memory snapshot without dill serialization.

        The framework's default implementation serializes AgentConfig objects via dill,
        which fails because OntologyLoader's LLM client holds ssl.SSLContext objects that
        are not picklable. Overriding here returns the current plugin_registry snapshot
        directly, bypassing persist/restore entirely.

        For resume cases this is safe: the current in-memory configs carry the real
        OntologyLoader (with plan_generator), which is what graph building needs anyway.
        """
        return self.plugin_registry.get_agent_configs_snapshot()

    def get_capabilities(self) -> list[str]:
        """Capabilities registered by this worker."""
        return [os.environ.get("DATACLOUD_GATEWAY_WORKER_ID", "datacloud")]

    def get_agent_types(self) -> list[str]:
        """Capabilities registered by this worker."""
        return [os.environ.get("DATACLOUD_GATEWAY_WORKER_ID", "datacloud")]

    async def _emit_6001(
        self, context: ByclawDataClarification, payload: dict[str, Any]
    ) -> None:
        """Emit one structured data-table JSON chunk (content_type=6001)."""
        data_table_type = getattr(SseMessageType, "data_table_json", None)
        content_type = data_table_type.value if data_table_type is not None else "6001"
        await context.emit_chunk(
            StreamChunkEvent(content=json.dumps(payload, ensure_ascii=False)),
            event_type=EventType.ANSWER_DELTA.value,
            content_type=content_type,
        )

    # ------------------------------------------------------------------
    # ------------------------------------------------------------------

    async def process_command(
        self, command: GatewayCommand, context: ByclawDataClarification
    ) -> dict:
        """Receive a command, run the graph, and stream events back to the caller.

        Handles two command types:
        - AskAgentCommand: fresh conversation turn, builds initial graph state.
        - ResumeCommand:   resumes a suspended graph via Command(resume=...).

        Returns:
            {"status": "done"}    normal completion, flush_to_history called.
            {"status": "waiting"} graph interrupted, ask_user emitted, no flush.
        """
        logger.info(
            ">>> process_command ENTRY: session=%s command_type=%s",
            context.session_id,
            type(command).__name__,
        )

        _trace_id = str(
            getattr(getattr(command, "header", None), "trace_id", "") or ""
        ).strip()
        _req_hint = _trace_id or context.session_id or None

        async with request_log_context(
            _req_hint,
            extra_namespaces=("by-framework", "byclaw_data"),
        ) as _rid:
            try:
                result = await self._process_command_inner(command, context, _rid)
                _update_early_langfuse_trace(
                    _early_lf_trace_ctx.get(), status="ok"
                )
                # ── 自动评分：写入客观指标到 Langfuse scores 表 ─────────────
                _lf_handle = _early_lf_trace_ctx.get()
                if _lf_handle is not None:
                    try:
                        _lf_s, _span_s = _lf_handle
                        _result_status = (result or {}).get("status", "")
                        # 1. 是否触发澄清中断（status=waiting 表示被中断，准确率下降信号）
                        _lf_s.create_score(
                            trace_id=_span_s.trace_id,
                            name="no_clarify",
                            value=0.0 if _result_status == "waiting" else 1.0,
                            data_type="BOOLEAN",
                        )
                        # 2. 无异常完成
                        _lf_s.create_score(
                            trace_id=_span_s.trace_id,
                            name="no_error",
                            value=1.0,
                            data_type="BOOLEAN",
                        )
                        _lf_s.flush()
                    except Exception:
                        pass
                return result
            except Exception:
                # 有异常时写 no_error=0
                _lf_handle_err = _early_lf_trace_ctx.get()
                if _lf_handle_err is not None:
                    try:
                        _lf_e, _span_e = _lf_handle_err
                        _lf_e.create_score(
                            trace_id=_span_e.trace_id,
                            name="no_error",
                            value=0.0,
                            data_type="BOOLEAN",
                        )
                        _lf_e.flush()
                    except Exception:
                        pass
                _update_early_langfuse_trace(
                    _early_lf_trace_ctx.get(),
                    status="error",
                    error=traceback.format_exc(limit=3),
                )
                raise

    async def _process_command_inner(
        self, command: GatewayCommand, context: ByclawDataClarification, request_id: str
    ) -> dict:
        """实际处理逻辑，所有日志自动写入 logs/requests/{request_id}.log。"""
        # ── Early Langfuse trace：立即建链，确保跨服务 trace_id 不断链 ─────────
        _cmd_header = getattr(command, "header", None)
        _cmd_trace_id = str(getattr(_cmd_header, "trace_id", "") or "").strip()
        _cmd_session_id = str(
            getattr(_cmd_header, "session_id", "") or context.session_id or ""
        )
        _cmd_user_code = str(getattr(_cmd_header, "user_code", "") or "")
        _cmd_user_name = str(getattr(_cmd_header, "user_name", "") or "")
        _cmd_message_id = str(getattr(_cmd_header, "message_id", "") or "")
        _cmd_agent_id = str(
            (getattr(_cmd_header, "metadata", None) or {}).get("agentId", "") or ""
        )
        _cmd_question = str(getattr(command, "content", "") or "")
        # 提前加载历史上下文，一次性写入 Langfuse，无需后续 update
        _early_history: list[dict[str, str]] = []
        try:
            from langchain_core.messages import (  # noqa: PLC0415
                AIMessage as _EAI,
                HumanMessage as _EHM,
                SystemMessage as _ESM,
            )

            _raw_hist = await _load_recent_history_messages(
                context=context,
                limit=_history_inject_limit(),
                current_user_text=_latest_user_text_from_content(
                    command.content,
                    locale=getattr(context, "locale", _FALLBACK_LOCALE),
                ),
            )
            for _m in _raw_hist:
                if isinstance(_m, _EHM):
                    _early_history.append({"role": "user", "content": str(_m.content or "")[:500]})
                elif isinstance(_m, _EAI):
                    _early_history.append({"role": "assistant", "content": str(_m.content or "")[:500]})
                elif isinstance(_m, _ESM):
                    _early_history.append({"role": "system", "content": str(_m.content or "")[:200]})
        except Exception:
            pass
        _early_lf_trace = _create_early_langfuse_trace(
            trace_id=_cmd_trace_id,
            session_id=_cmd_session_id,
            user_id=_cmd_user_code,
            message_id=_cmd_message_id,
            agent_id=_cmd_agent_id,
            question=_cmd_question,
            history=_early_history,
            # 把 LangfusePlugin 创建的 observation 作为父节点，确保层级正确
            parent_observation_id=str(
                getattr(getattr(context, "_langfuse_observation", None), "id", "") or ""
            ),
        )
        _early_lf_trace_ctx.set(_early_lf_trace)
        _dc_logger.info(
            "DataCloudWorker.process_command: session=%s command=%s request_id=%s "
            "trace_id=%s header_trace_id=%s message_id=%s user_code=%s agent_id=%s",
            context.session_id,
            type(command).__name__,
            request_id,
            context.trace_id,
            _cmd_trace_id,
            _cmd_message_id,
            _cmd_user_code,
            _cmd_agent_id,
        )
        # 处理模型环境变量，从redis获取
        from byclaw_data.model_environment import (
            build_embedding_config,
            build_llm_config,
            get_model_by_instance_id,
        )

        _new_llm_cfg = build_llm_config(None) or {}
        build_embedding_config(None)

        # 根据 Redis 返回的全量配置计算签名（涵盖 url/token/model/provider/temperature 等所有字段），
        # 任一字段变更都会触发 graph 缓存失效和 OntologyAgent 重建。
        _new_api_key = str(_new_llm_cfg.get("DATACLOUD_LLM_API_KEY") or "")
        _new_model = str(_new_llm_cfg.get("DATACLOUD_LLM_MODEL") or "")
        _new_base_url = str(_new_llm_cfg.get("DATACLOUD_LLM_API_BASE") or "")
        logger.info(
            "[model_env] process_command: llm_cfg_from_redis model=%s base_url=%s api_key=%s session=%s",
            _new_model or "<EMPTY>",
            _new_base_url or "<EMPTY>",
            "***" if _new_api_key else "<EMPTY>",
            context.session_id,
        )
        _model_sig: str = self._model_config_sig

        if _new_llm_cfg:
            _model_sig = hashlib.sha1(
                json.dumps(_new_llm_cfg, sort_keys=True, ensure_ascii=True).encode()
            ).hexdigest()[:12]
            if _model_sig != self._model_config_sig:
                async with self._ontology_agent_lock:
                    if _model_sig != self._model_config_sig:
                        logger.info(
                            "LLM config changed: old_sig=%s new_sig=%s session=%s",
                            self._model_config_sig,
                            _model_sig,
                            context.session_id,
                        )
                        if _new_api_key:
                            self.api_key = _new_api_key
                        if _new_model:
                            self.model_name = _new_model
                        if _new_base_url:
                            self.base_url = _new_base_url
                        self._model_config_sig = _model_sig
                        if self._resource_path and self._ontology_agent is not None:
                            from datacloud_analysis.ontology_agent import (
                                OntologyAgent,
                                OntologyAgentConfig,
                            )  # noqa: PLC0415
                            from datacloud_data_service.config import get_settings  # noqa: PLC0415

                            from byclaw_data.mcp.result_file_storage import (
                                build_result_file_storage,
                            )  # noqa: PLC0415

                            self._ontology_agent = OntologyAgent(
                                OntologyAgentConfig(
                                    api_key=self.api_key or "",
                                    model=self.model_name or "",
                                    base_url=self.base_url,
                                    resource_path=self._resource_path,
                                    result_file_storage=build_result_file_storage(
                                        settings=get_settings()
                                    ),
                                )
                            )
                            logger.info(
                                "OntologyAgent recreated: sig=%s session=%s",
                                _model_sig,
                                context.session_id,
                            )

        # if self.api_key:
        #     os.environ["DATACLOUD_LLM_API_KEY"] = self.api_key
        #     os.environ["OPENAI_API_KEY"] = self.api_key
        # if self.base_url:
        #     os.environ["DATACLOUD_LLM_API_BASE"] = self.base_url
        #     os.environ["OPENAI_BASE_URL"] = self.base_url
        # if self.model_name:
        # 只写入 reasoning 专属变量；不覆盖通用 DATACLOUD_LLM_MODEL，
        # 避免把 reasoning model 覆盖到普通推理/推荐问题等模块
        # os.environ["DATACLOUD_LLM_MODEL"] = self.model_name

        extra_payload = getattr(command, "extra_payload", {}) or {}
        # extra_payload = {"agent_id": "10025189", "call_object_ids": ["ads_grid_analysis"], "call_view_ids": ["scene_enterprise_analysis"]}
        header_metadata = (
            getattr(getattr(command, "header", None), "metadata", None) or {}
        )
        all_metadata = header_metadata

        # ── locale 设置（从 header_metadata.language 读取，规范化后写入 context）──
        _raw_language = str(header_metadata.get("language") or "").strip()
        _resolved_locale = _normalize_locale(_raw_language)
        try:
            context.locale = _resolved_locale
        except AttributeError:
            pass
        logger.debug(
            "[i18n-diag] locale resolved: header_metadata.language=%r → _resolved_locale=%r"
            " → context.locale(after set)=%r",
            _raw_language,
            _resolved_locale,
            getattr(context, "locale", "<not set>"),
        )

        # ── 用户 token 设置（从 Redis 读取，写入 context）──
        # 先用 user_code 查 SHARE_BFM_USER_CODE_{user_code} 得到 user_id，
        # 再用 user:{user_id}:login:auth 读取 token hash。
        _auth_user_id = _cmd_user_code
        _auth_user_name = _cmd_user_name
        if _auth_user_id:
            try:
                _uid_key = f"SHARE_BFM_USER_CODE_{_auth_user_id}"
                _real_user_id: str = str(await self.redis.get(_uid_key) or "").strip()
                if not _real_user_id:
                    logger.warning(
                        "[user-auth] user_id not found in redis: key=%s session=%s",
                        _uid_key,
                        context.session_id,
                    )
                _redis_auth_key = f"user:{_real_user_id or _auth_user_id}:login:auth"
                _redis_auth_data: dict[str, str] = await self.redis.hgetall(_redis_auth_key)
                if _redis_auth_data:
                    _whale_token = _redis_auth_data.get("WHALE_AGENT_AUTHORIZATION", "")
                    _sso_token = _redis_auth_data.get("Sso-Token", "")
                    _beyond_token = _redis_auth_data.get("Beyond-Token", "")
                    _auth_user_name = _redis_auth_data.get("userName")
                    # 写入 context 属性
                    try:
                        if _auth_user_name:
                            context.user_name = _auth_user_name
                        if _whale_token:
                            context.whale_agent_authorization = _whale_token
                        if _sso_token:
                            context.sso_token = _sso_token
                        if _beyond_token:
                            context.beyond_token = _beyond_token
                    except AttributeError:
                        pass
                    # 回填到 header_metadata，使下游 header_metadata.get("Beyond-Token") 等读取生效
                    if _whale_token and not header_metadata.get("WHALE_AGENT_AUTHORIZATION"):
                        header_metadata["WHALE_AGENT_AUTHORIZATION"] = _whale_token
                    if _sso_token and not header_metadata.get("Sso-Token"):
                        header_metadata["Sso-Token"] = _sso_token
                    if _beyond_token and not header_metadata.get("Beyond-Token"):
                        header_metadata["Beyond-Token"] = _beyond_token
                    if _auth_user_name and not header_metadata.get("userName"):
                        header_metadata["userName"] = _auth_user_name
                    logger.info(
                        "[user-auth] loaded tokens from redis: key=%s session=%s"
                        " whale=%s sso=%s beyond=%s",
                        _redis_auth_key,
                        context.session_id,
                        f"{_whale_token[:4]}...{_whale_token[-4:]}" if len(_whale_token) > 8 else ("***" if _whale_token else "<empty>"),
                        f"{_sso_token[:4]}...{_sso_token[-4:]}" if len(_sso_token) > 8 else ("***" if _sso_token else "<empty>"),
                        f"{_beyond_token[:4]}...{_beyond_token[-4:]}" if len(_beyond_token) > 8 else ("***" if _beyond_token else "<empty>"),
                    )
            except Exception:
                logger.warning(
                    "[user-auth] failed to load tokens from redis: user_id=%s session=%s",
                    _auth_user_id,
                    context.session_id,
                    exc_info=True,
                )

        # 来源 1：extra_payload.call_object_ids / call_view_ids（内部委派）
        # 来源 2：extra_payload.resource_list 中的 OBJECT / VIEW 资源码（前端选择）
        # 来源 3：header_metadata 中由 interrupt 写入的恢复值（ResumeCommand 时）
        # 任一来源非空即激活动态路径，旁路 AgentConfig；两源合并去重，call_*_ids 优先。
        _dyn_object_ids: list[str] = [
            s.strip()
            for s in (extra_payload.get("call_object_ids") or [])
            if isinstance(s, str) and s.strip()
        ]
        _dyn_view_ids: list[str] = [
            s.strip()
            for s in (extra_payload.get("call_view_ids") or [])
            if isinstance(s, str) and s.strip()
        ]

        _resource_list_raw = extra_payload.get("resource_list")
        _resource_list_for_extract: list[Any] = (
            _resource_list_raw if isinstance(_resource_list_raw, list) else []
        )
        _res_object_codes, _res_view_codes = _extract_tool_resource_codes(
            _resource_list_for_extract
        )
        for _code in _res_object_codes:
            if _code not in _dyn_object_ids:
                _dyn_object_ids.append(_code)
        for _code in _res_view_codes:
            if _code not in _dyn_view_ids:
                _dyn_view_ids.append(_code)

        # 来源 3：resume 时从 header_metadata 或 humanInput.metadata 恢复动态路径标识
        if not _dyn_object_ids and not _dyn_view_ids:
            # ResumeCommand：从 header_metadata 取
            # AskAgentCommand + humanInput（paradigm 回复）：从 extra_payload.ext_params.humanInput.metadata 取
            _human_input_meta: dict[str, Any] = {}
            _hi = _human_input_from_payload(
                ext_params=extra_payload.get("ext_params"),
                extra_payload=extra_payload,
            )
            if isinstance(_hi.get("metadata"), dict):
                _human_input_meta = _hi["metadata"]

            _resume_meta = _human_input_meta or header_metadata
            _resume_object_ids: list[str] = [
                s
                for s in (_resume_meta.get("call_object_ids") or [])
                if isinstance(s, str) and s.strip()
            ]
            _resume_view_ids: list[str] = [
                s
                for s in (_resume_meta.get("call_view_ids") or [])
                if isinstance(s, str) and s.strip()
            ]
            if _resume_object_ids or _resume_view_ids:
                _dyn_object_ids = _resume_object_ids
                _dyn_view_ids = _resume_view_ids
                logger.info(
                    "dynamic agent path restored from resume metadata: session=%s "
                    "object_ids=%s view_ids=%s source=%s",
                    context.session_id,
                    _dyn_object_ids,
                    _dyn_view_ids,
                    "humanInput.metadata" if _human_input_meta else "header_metadata",
                )
        if _res_object_codes or _res_view_codes:
            logger.info(
                "resource_list tool whitelist activated: session=%s "
                "object_codes=%s view_codes=%s",
                context.session_id,
                _res_object_codes,
                _res_view_codes,
            )

        _is_dynamic_agent: bool = bool(_dyn_object_ids or _dyn_view_ids)
        if _is_dynamic_agent:
            logger.info(
                "DataCloudWorker: dynamic agent path activated "
                "session=%s object_ids=%s view_ids=%s",
                context.session_id,
                _dyn_object_ids,
                _dyn_view_ids,
            )

        if isinstance(command, ResumeCommand):
            by_agent_id = (
                extra_payload.get("agent_id")
                or header_metadata.get("resume_agent_id")
                or header_metadata.get("agent_id")
            )
            by_agent_name = (
                extra_payload.get("agent_name")
                or header_metadata.get("resume_agent_name")
                or header_metadata.get("agent_name")
            )
        else:
            by_agent_id = extra_payload.get("agent_id") or header_metadata.get(
                "agent_id"
            )
            by_agent_name = extra_payload.get("agent_name") or header_metadata.get(
                "agent_name"
            )

        by_agent_name_log = json.dumps(
            "" if by_agent_name is None else str(by_agent_name),
            ensure_ascii=False,
        )

        logger.info(
            "DataCloudWorker.process_command: session=%s command_type=%s by_agent_id=%s "
            "by_agent_name=%s question=%s command=%s",
            context.session_id,
            type(command).__name__,
            by_agent_id,
            by_agent_name_log,
            _command_question_for_log(command),
            _format_gateway_command_for_log(command),
        )

        # if self.api_key:
        #     os.environ["DATACLOUD_LLM_API_KEY"] = self.api_key
        #     os.environ["OPENAI_API_KEY"] = self.api_key
        # if self.base_url:
        #     os.environ["DATACLOUD_LLM_API_BASE"] = self.base_url
        #     os.environ["OPENAI_BASE_URL"] = self.base_url
        # if self.model_name:
        # 只写入 reasoning 专属变量；不覆盖通用 DATACLOUD_LLM_MODEL，
        # 避免把 reasoning model 覆盖到普通推理/推荐问题等模块
        # os.environ["DATACLOUD_LLM_MODEL"] = self.model_name

        ext_params = extra_payload.get("ext_params")
        resource_list = _resource_list_for_extract
        # 仅支持 KG_DOC_FILE 类型的附件引用,且最多 1 个;多于 1 个直接抛错。
        _kg_doc_files: list[str] = [
            str(item.get("resourceId") or "").strip()
            for item in resource_list
            if isinstance(item, dict)
            and str(item.get("resourceType") or "").strip().upper() == "KG_DOC_FILE"
            and str(item.get("resourceId") or "").strip()
        ]
        if len(_kg_doc_files) > 1:
            raise ValueError(
                "目前仅支持引用 1 个 KG_DOC_FILE 附件,"
                f"收到 {len(_kg_doc_files)} 个:{_kg_doc_files}"
            )
        attached_file_path: str = _kg_doc_files[0] if _kg_doc_files else ""
        if attached_file_path:
            logger.info(
                "Attached file detected: session=%s path=%s",
                context.session_id,
                attached_file_path,
            )

        runtime_agent_key = self._resolve_runtime_agent_key(
            command=command,
            by_agent_id=by_agent_id,
            header_metadata=header_metadata,
        )
        logger.info(
            "Agent context: ID=%s (type=%s), Name=%s runtime_agent_key=%s",
            by_agent_id,
            type(by_agent_id).__name__,
            by_agent_name,
            runtime_agent_key,
        )

        if not _is_dynamic_agent:
            target_agent_id_for_load = str(
                by_agent_id or runtime_agent_key or ""
            ).strip()
            await self._ensure_agent_config_loaded(
                context=context,
                command=command,
                agent_id=target_agent_id_for_load,
            )

        # --- paradigm resume 检测（提前到 resume cache 之前）---
        # 前端通过 AskAgentCommand.ext_params.humanInput.paradigmList 回传 paradigm 选择结果，
        # 也可能通过 ResumeCommand.ext_params.humanInput.paradigmList 回传（静态路径）。
        # 将其转换为 Command(resume=...)，并复用幂等去重、inflight dedup 与 checkpoint 注入路径。
        _paradigm_resume_value: Any = None
        _paradigm_human_input_metadata: dict[str, Any] = {}
        _check_human_input = isinstance(ext_params, dict)
        if _check_human_input and (
            isinstance(command, AskAgentCommand) or isinstance(command, ResumeCommand)
        ):
            _human_input = _human_input_from_payload(
                ext_params=ext_params,
                extra_payload=extra_payload,
            )
            if isinstance(_human_input, dict) and isinstance(
                _human_input.get("paradigmList"), list
            ):
                _paradigm_resume_value = _human_input
                _paradigm_human_input_metadata = (
                    _human_input.get("metadata")
                    if isinstance(_human_input.get("metadata"), dict)
                    else {}
                )
                logger.info(
                    "%s carries paradigm reply via humanInput, converting to graph resume: "
                    "session=%s paradigmList_len=%d checkpoint_id=%s",
                    type(command).__name__,
                    context.session_id,
                    len(_human_input["paradigmList"]),
                    _paradigm_human_input_metadata.get("checkpoint_id", ""),
                )
            elif isinstance(_human_input, dict):
                _operation_resume_value = _operation_form_resume_from_human_input(
                    _human_input
                )
                if _operation_resume_value is not None:
                    _paradigm_resume_value = _operation_resume_value
                    _paradigm_human_input_metadata = (
                        _human_input.get("metadata")
                        if isinstance(_human_input.get("metadata"), dict)
                        else {}
                    )
                    logger.info(
                        "%s carries operation form reply via humanInput, converting to graph "
                        "resume: session=%s form_id=%s actions=%d confirmed=%s checkpoint_id=%s",
                        type(command).__name__,
                        context.session_id,
                        _operation_resume_value.get("formId", ""),
                        len(_operation_resume_value.get("actions") or []),
                        _operation_resume_value.get("confirmed"),
                        _paradigm_human_input_metadata.get("checkpoint_id", ""),
                    )

        resume_cache_key: str | None = None
        if isinstance(command, ResumeCommand) or _paradigm_resume_value is not None:
            if _paradigm_resume_value is not None:
                resume_value_probe = _paradigm_resume_value
            else:
                resume_value_probe = (
                    command.reply_data
                    if command.reply_data is not None
                    else command.content
                )
            # paradigm resume：checkpoint_id 在 humanInput.metadata 而非请求头，需合并后解析
            _probe_metadata = (
                {**_paradigm_human_input_metadata, **header_metadata}
                if _paradigm_resume_value is not None
                else header_metadata
            )
            all_metadata = _probe_metadata
            checkpoint_id_probe, checkpoint_ns_probe = (
                self._resolve_resume_checkpoint_target(header_metadata=_probe_metadata)
            )
            resume_cache_key = self._build_resume_dedup_key(
                session_id=context.session_id,
                checkpoint_id=checkpoint_id_probe,
                checkpoint_ns=checkpoint_ns_probe,
                resume_value=resume_value_probe,
            )
            cached = self._resume_result_cache.get(resume_cache_key)
            if cached is not None:
                logger.info(
                    "ResumeCommand idempotent hit: session=%s checkpoint_id=%s checkpoint_ns=%s",
                    context.session_id,
                    checkpoint_id_probe,
                    checkpoint_ns_probe,
                )
                self._resume_result_cache.move_to_end(resume_cache_key)
                cached_data = dict(cached)
                cached_data["metadata"] = all_metadata
                return cached_data

        from by_framework.worker.sandbox.hook_sandbox import active_workspace  # noqa: PLC0415

        workspace_dir = active_workspace.get()
        logger.info("Active workspace for task: %s", workspace_dir)

        if isinstance(command, AskAgentCommand) and isinstance(ext_params, dict):
            handled, payload = await self.command_plugin_manager.handle_ext_command(
                ext_params=ext_params,
                session_id=context.session_id,
                workspace_dir=workspace_dir,
                gateway_context=context,
            )
            if handled:
                if payload is not None:
                    await self._emit_6001(context, payload)
                if not bool(ext_params.get("silent")):
                    await context.emit_chunk(
                        StreamChunkEvent(content="回答完成"),
                        event_type=EventType.APP_STREAM_RESPONSE.value,
                        content_type=SseMessageType.text.value,
                    )
                    await context.flush_to_history()
                return {"status": "done", "metadata": all_metadata}

        if isinstance(command, AskAgentCommand) and _paradigm_resume_value is None:
            # 推送初始思考内容（不再包裹"问题理解"标题）
            _init_msg_id = context.generate_message_id()
            _locale_for_msg = getattr(context, "locale", "zh_CN")
            logger.debug(
                "[i18n-diag] received_message: context.locale=%r → text=%r",
                _locale_for_msg,
                _get_received_message_text(_locale_for_msg),
            )
            await context.emit_chunk(
                StreamChunkEvent(content=_get_received_message_text(_locale_for_msg)),
                event_type=EventType.REASONING_LOG_START.value,
                content_type=SseReasonMessageType.think_text.value,
                message_id=_init_msg_id,
            )
            context._knowledge_enhance_node_id = _init_msg_id
            user_text = _latest_user_text_from_content(
                command.content,
                locale=_locale_for_msg,
            )
            if _is_light_chitchat(user_text) and not attached_file_path:
                await context.emit_chunk(
                    StreamChunkEvent(
                        content=_CHITCHAT_DIRECT_REPLY,
                        metadata={"graph_nodes_executed": 0},
                    ),
                    event_type=EventType.ANSWER_DELTA.value,
                    content_type=SseMessageType.text.value,
                )
                await context.emit_chunk(
                    StreamChunkEvent(content="回答完成"),
                    event_type=EventType.APP_STREAM_RESPONSE.value,
                    content_type=SseMessageType.text.value,
                )
                await context.flush_to_history()
                return {"status": "done", "metadata": all_metadata}
        else:
            # ResumeCommand 或 paradigm resume：清空残留，避免旧 node_id 被带入下一轮图运行
            context._knowledge_enhance_node_id = ""

        if _is_dynamic_agent:
            # ── 动态路径：使用 OntologyAgent 驱动（T5 重构） ─────────────────────
            dyn_thread_id = str(
                header_metadata.get("resume_thread_id")
                or header_metadata.get("thread_id")
                or ""
            ).strip()
            # paradigm resume：thread_id 在 humanInput.metadata.thread_id，需单独读取
            if not dyn_thread_id and _paradigm_resume_value is not None:
                dyn_thread_id = str(
                    _paradigm_human_input_metadata.get("thread_id") or ""
                ).strip()
                if dyn_thread_id:
                    logger.info(
                        "dynamic agent thread_id restored from humanInput.metadata: "
                        "session=%s thread_id=%s",
                        context.session_id,
                        dyn_thread_id,
                    )
            if not dyn_thread_id:
                # 并行子任务场景：同一 session 内多个子任务并发调用 BYCLAW_DATA，
                # 若只用 session_id+agent_key 构建 thread_id 会导致所有子任务共享
                # 同一个 LangGraph checkpoint，并发写入触发 InvalidUpdateError。
                # 用 parent_message_id（即上游的 tool_call_id）区分不同子任务调用，
                # 确保每个子任务有独立的 thread_id 和 checkpoint。
                _tool_call_id = str(
                    getattr(getattr(command, "header", None), "parent_message_id", "")
                    or ""
                ).strip()
                if _tool_call_id and not isinstance(command, ResumeCommand):
                    dyn_thread_id = (
                        f"{runtime_agent_key}:{context.session_id}:{_tool_call_id}"
                    )
                    logger.info(
                        "dynamic agent thread_id uses tool_call_id: session=%s tool_call_id=%s thread_id=%s",
                        context.session_id,
                        _tool_call_id,
                        dyn_thread_id,
                    )
                else:
                    dyn_thread_id = self._build_thread_id(
                        session_id=context.session_id,
                        agent_key=runtime_agent_key,
                    )

            assert self._ontology_agent is not None, (  # noqa: S101
                "OntologyAgent not initialized; ensure start_heartbeat() completed"
            )

            # ── 动态路径 Skill 加载：resource_list 里有 SKILL 条目时注入 task_prompt ──
            _dyn_user_code = str(
                getattr(getattr(command, "header", None), "user_code", "") or ""
            ).strip()
            _dyn_beyond_token = header_metadata.get("Beyond-Token", "")
            _dyn_skill_task_prompt = _load_skills(
                resource_list=_resource_list_for_extract,
                user_code=_dyn_user_code,
                tools_dict={},  # 动态路径无 AgentConfig，占位符替换跳过
                agent_id=str(by_agent_id or ""),
            )
            _dyn_minio_root = os.environ.get(
                "FILE_STORAGE_MINIO_MOUNT_PATH", "/data/byai/byaiAllInOne/mino"
            )
            _dyn_skill_ws = str(
                Path(_dyn_minio_root) / f"byclaw-{_dyn_user_code}" / "by"
            )
            _dyn_extras: dict[str, Any] = {
                "user_code": _dyn_user_code,
                "user_name": _auth_user_name,
                "beyond_token": _dyn_beyond_token,
                "skill_workspace_dir": _dyn_skill_ws,
            }
            if _dyn_skill_task_prompt:
                _dyn_task_prompt, _dyn_first_dir, _dyn_catalog = _dyn_skill_task_prompt
                _dyn_extras["task_prompt"] = _dyn_task_prompt
                _dyn_extras["skill_catalog"] = _dyn_catalog
                logger.info(
                    "Skill loaded (dynamic path): session=%s skill_workspace_dir=%s catalog_size=%d",
                    context.session_id,
                    _dyn_skill_ws,
                    len(_dyn_catalog),
                )
            else:
                logger.info(
                    "No skill found (dynamic path): session=%s resource_list_len=%d",
                    context.session_id,
                    len(_resource_list_for_extract),
                )

            if isinstance(command, ResumeCommand) or _paradigm_resume_value is not None:
                raw_paradigm = (
                    _paradigm_resume_value
                    if _paradigm_resume_value is not None
                    else (
                        command.reply_data
                        if isinstance(command, ResumeCommand)
                        and command.reply_data is not None
                        else command.content  # type: ignore[union-attr]
                    )
                )
                resume_input = _dict_to_paradigm_answer(raw_paradigm)
                event_iter = self._ontology_agent.resume(
                    dyn_thread_id,
                    resume_input,
                    view_codes=_dyn_view_ids,
                    object_codes=_dyn_object_ids,
                    user_code=_get_gateway_user_code(context),
                    session_id=context.session_id,
                    extras=_dyn_extras,
                )
            else:
                latest_user_text_dyn = _latest_user_text_from_content(
                    command.content,
                    locale=getattr(context, "locale", _FALLBACK_LOCALE),
                )
                latest_user_text_dyn = latest_user_text_dyn + _build_attachment_hint(
                    attached_file_path
                )
                event_iter = self._ontology_agent.ask(
                    question=latest_user_text_dyn,
                    view_codes=_dyn_view_ids,
                    object_codes=_dyn_object_ids,
                    thread_id=dyn_thread_id,
                    user_code=_get_gateway_user_code(context),
                    session_id=context.session_id,
                    extras=_dyn_extras,
                )

            logger.info(
                "DataCloudWorker: _consume_agent_events START session=%s thread=%s",
                context.session_id,
                dyn_thread_id,
            )
            dynamic_result = await _consume_agent_events(
                event_iter,
                context,
                reco_task=None,
                emit_done=False,
                agent_id=str(by_agent_id or ""),
                dyn_object_ids=_dyn_object_ids,
                dyn_view_ids=_dyn_view_ids,
                header_metadata=header_metadata,
            )
            logger.info(
                "DataCloudWorker: _consume_agent_events DONE session=%s thread=%s result_status=%s",
                context.session_id,
                dyn_thread_id,
                dynamic_result.get("status")
                if isinstance(dynamic_result, dict)
                else type(dynamic_result).__name__,
            )
            if resume_cache_key is not None:
                self._cache_resume_result(resume_cache_key, dynamic_result)
            # 将内部状态映射为框架识别的 AgentState：
            #   "done"    → "COMPLETED"  触发 should_emit_stream_end
            #   "waiting" → "WAITING_USER" 触发框架挂起逻辑，使 resume 能正确路由回来
            if isinstance(dynamic_result, dict):
                _dyn_status = dynamic_result.get("status")
                if _dyn_status == "done":
                    _is_resume_cmd = (
                        isinstance(command, ResumeCommand)
                        or _paradigm_resume_value is not None
                    )
                    if _is_resume_cmd:
                        _resume_query = str(
                            _paradigm_human_input_metadata.get("query")
                            or (
                                command.content
                                if isinstance(command, ResumeCommand)
                                else ""
                            )
                            or ""
                        ).strip()[:80]
                        logger.info(
                            "[DIAG] dynamic resume done → finalAnswer will be emitted: "
                            "session=%s thread=%s query=%r",
                            context.session_id,
                            dyn_thread_id,
                            _resume_query,
                        )
                        await context.emit_chunk(
                            StreamChunkEvent(
                                content=(
                                    f"已收到您的回复，正在整理分析结果...\n\n"
                                    f"（当前问题：{_resume_query}）"
                                    if _resume_query
                                    else "已收到您的回复，正在整理分析结果...\n\n"
                                )
                            ),
                            event_type=EventType.REASONING_LOG_START.value,
                            content_type=SseReasonMessageType.think_text.value,
                        )
                    dynamic_result = {**dynamic_result, "status": "COMPLETED"}
                elif _dyn_status == "waiting":
                    dynamic_result = {**dynamic_result, "status": "WAITING_USER"}
            logger.info(
                "DataCloudWorker: line1480 returning session=%s status=%s",
                context.session_id,
                dynamic_result.get("status")
                if isinstance(dynamic_result, dict)
                else type(dynamic_result).__name__,
            )
            if isinstance(dynamic_result, dict):
                dynamic_result["metadata"] = all_metadata
            return dynamic_result

        else:
            # ── 静态路径（现有逻辑）────────────────────────────────────────────
            agent_configs = context.list_agent_configs()
            config_for_this_call = next(
                (cfg for cfg in agent_configs if str(cfg.agent_id) == str(by_agent_id)),
                None,
            )
            if config_for_this_call is None:
                available_ids = [str(cfg.agent_id) for cfg in agent_configs]
                logger.warning(
                    "No AgentConfig found for by_agent_id=%s; "
                    "falling back to runtime_agent_key=%s. available=%s",
                    by_agent_id,
                    runtime_agent_key,
                    available_ids,
                )
                # Fallback 1: match by runtime_agent_key (covers target_agent_type / worker_id)
                config_for_this_call = next(
                    (
                        cfg
                        for cfg in agent_configs
                        if str(cfg.agent_id) == str(runtime_agent_key)
                    ),
                    None,
                )
            if config_for_this_call is None:
                available_ids = [str(cfg.agent_id) for cfg in agent_configs]
                _err_msg = (
                    "Agent config not found for request: "
                    f"agent_id={by_agent_id or ''} runtime_agent_key={runtime_agent_key or ''} "
                    f"available_agent_ids={available_ids}"
                )
                _dc_logger.error("agent_config_not_found: %s", _err_msg)
                _update_early_langfuse_trace(
                    _early_lf_trace, status="error", error=_err_msg
                )
                raise RuntimeError(_err_msg)
            logger.info(
                "Agent config match result: by_agent_id=%s matched=%s agent_id=%s",
                by_agent_id,
                bool(config_for_this_call),
                getattr(config_for_this_call, "agent_id", None),
            )

            prompts_dict = dict(getattr(config_for_this_call, "prompts", None) or {})
            # 将 request locale 注入 prompts_overwrite，供 graph_builder 选择系统提示词语言
            _req_locale = str(getattr(context, "locale", "") or "zh_CN")
            if "locale" not in prompts_dict:
                prompts_dict["locale"] = _req_locale
            config_extra = getattr(config_for_this_call, "extra", None) or {}
            tools_dict = config_extra.get("redirect_tools", {})
            tool_metadata = config_extra.get("tool_metadata", {})
            ontology_loader = config_extra.get("loader")
            skip_action_families = frozenset(
                config_extra.get("skip_action_families") or frozenset()
            )

            logger.info(
                "Agent config payload: agent_id=%s prompt_keys=%s tool_keys=%s",
                by_agent_id,
                sorted(str(key) for key in prompts_dict.keys()),
                sorted(str(key) for key in tools_dict.keys()),
            )

            # 🆕 从 extra 中提取 mounted_objects（优先），或从 tool_metadata 中提取（兼容旧逻辑）
            mounted_objects = []
            if "mounted_objects" in config_extra:
                mounted_objects = config_extra.get("mounted_objects", [])
                logger.info(
                    "Agent config: agent_id=%s mounted_objects=%s (from extra)",
                    by_agent_id,
                    mounted_objects,
                )
            else:
                # 兼容旧逻辑：从 tool_metadata 中提取
                for tool_key, metadata in tool_metadata.items():
                    resource_biz_type = metadata.get("resource_biz_type")
                    resource_code = metadata.get("resource_code")
                    if resource_biz_type in {"OBJECT", "VIEW"} and resource_code:
                        mounted_objects.append(resource_code)
                logger.info(
                    "Agent config: agent_id=%s mounted_objects=%s (from tool_metadata)",
                    by_agent_id,
                    mounted_objects,
                )
            # 改动4: SkillsMiddleware 在运行时自动处理技能发现，无需在 worker 中手动加载
            logger.info(
                "Agent runtime tools: agent_id=%s tool_keys=%s",
                by_agent_id,
                sorted(str(key) for key in tools_dict),
            )

            # 🔍 打印工具的原始配置（用于诊断 mounted_objects 问题）
            logger.info("=" * 80)
            logger.info("WORKER: RAW TOOLS CONFIGURATION")
            logger.info("=" * 80)
            for tool_key, tool_value in tools_dict.items():
                logger.info("WORKER: tool_key=%s", tool_key)
                logger.info("WORKER:   type=%s", type(tool_value).__name__)
                if isinstance(tool_value, dict):
                    logger.info("WORKER:   dict_keys=%s", list(tool_value.keys()))
                    for k, v in tool_value.items():
                        if isinstance(v, str) and len(v) < 200:
                            logger.info("WORKER:     %s: %s", k, v)
                        else:
                            logger.info("WORKER:     %s: <%s>", k, type(v).__name__)
                elif hasattr(tool_value, "__dict__"):
                    logger.info(
                        "WORKER:   attributes=%s", list(vars(tool_value).keys())[:10]
                    )
                logger.info("WORKER:   ---")
            logger.info("=" * 80)

            conf_payload = json.dumps(
                {"prompts": prompts_dict, "tool_keys": sorted(tools_dict.keys())},
                ensure_ascii=False,
                sort_keys=True,
            )
            computed_conf_hash = hashlib.sha1(conf_payload.encode("utf-8")).hexdigest()[
                :12
            ]
            resume_conf_hash = ""
            if isinstance(command, ResumeCommand):
                resume_conf_hash = str(
                    header_metadata.get("resume_conf_hash")
                    or header_metadata.get("conf_hash")
                    or ""
                ).strip()
                if resume_conf_hash and resume_conf_hash != computed_conf_hash:
                    logger.warning(
                        "ResumeCommand conf_hash mismatch: metadata=%s computed=%s; "
                        "using metadata hash for cache affinity",
                        resume_conf_hash,
                        computed_conf_hash,
                    )
            conf_hash = resume_conf_hash or computed_conf_hash
            cache_key = (
                f"{by_agent_id}:{conf_hash}:{_model_sig}"
                if by_agent_id
                else f"default:{conf_hash}:{_model_sig}"
            )

            target_graph = self.graphs.get(cache_key)
            if not target_graph:
                if config_for_this_call:
                    target_graph = self._build_graph(
                        prompts_dict=prompts_dict,
                        tools_dict=tools_dict,
                        mounted_objects=mounted_objects,
                        loader=ontology_loader,
                        skip_action_families=skip_action_families,
                        agent_id=str(by_agent_id).strip() if by_agent_id else None,
                    )
                else:
                    logger.warning(
                        "AgentConfig for %s not found, fallback to defaults.",
                        by_agent_id,
                    )
                    target_graph = self._build_graph(
                        agent_id=str(by_agent_id).strip() if by_agent_id else None,
                    )
                self.graphs[cache_key] = target_graph
                while len(self.graphs) > self._GRAPH_CACHE_MAX:
                    evicted_key, _ = self.graphs.popitem(last=False)
                    logger.info("Graph cache evicted: key=%s", evicted_key)
            else:
                self.graphs.move_to_end(cache_key)

        thread_id = str(
            header_metadata.get("resume_thread_id")
            or header_metadata.get("thread_id")
            or ""
        ).strip()
        if not thread_id:
            thread_id = self._build_thread_id(
                session_id=context.session_id,
                agent_key=runtime_agent_key,
            )

        # ── per-agent llm_config：从 prologue.modelInfo.modelId 查 Redis ──────
        _agent_llm_config: dict[str, Any] | None = None
        if config_for_this_call is not None:
            _config_extra = getattr(config_for_this_call, "extra", None) or {}
            _prologue_raw = _config_extra.get("prologue") or {}
            if isinstance(_prologue_raw, str):
                try:
                    import json as _json_mod

                    _prologue_raw = _json_mod.loads(_prologue_raw)
                except Exception:
                    _prologue_raw = {}
            _model_info = (
                (_prologue_raw.get("modelInfo") or {})
                if isinstance(_prologue_raw, dict)
                else {}
            )
            _prologue_model_id = str(_model_info.get("modelId") or "").strip()
            if _prologue_model_id and _prologue_model_id not in ("", "0"):
                try:
                    _redis_model = get_model_by_instance_id(None, _prologue_model_id)
                    if _redis_model:
                        _ip = _redis_model.get("instanceParam") or {}
                        _agent_llm_config = {
                            "model": _redis_model.get("modelCode") or "",
                            "api_key": _redis_model.get("authToken") or "",
                            "base_url": _redis_model.get("url") or "",
                            "provider": str(
                                _ip.get("providerName") or "openai"
                            ).lower(),
                            "temperature": float(_ip.get("temperature") or 0.0),
                        }
                        logger.info(
                            "[per-agent-model] agent_id=%s prologue_model_id=%s "
                            "resolved model=%s base_url=%s",
                            by_agent_id,
                            _prologue_model_id,
                            _agent_llm_config["model"],
                            _agent_llm_config["base_url"],
                        )
                    else:
                        logger.warning(
                            "[per-agent-model] agent_id=%s prologue_model_id=%s "
                            "not found in Redis, falling back to default",
                            by_agent_id,
                            _prologue_model_id,
                        )
                except Exception as _exc:
                    logger.warning(
                        "[per-agent-model] agent_id=%s failed to resolve model: %s",
                        by_agent_id,
                        _exc,
                    )

        config = {
            "configurable": {
                "thread_id": thread_id,
                # DatacloudContext 字段平铺到 configurable（Deep Agents context_schema 要求）
                "gateway_context": context,
                "agent_id": str(by_agent_id or ""),
                "agent_name": str(by_agent_name or ""),
                "workspace_dir": workspace_dir,
                "session_id": context.session_id,
                "locale": str(getattr(context, "locale", "") or "zh_CN"),
                "trace_id": str(getattr(command.header, "trace_id", "") or ""),
                # "问题理解"节点的 message ID，供 intend_node 把知识增强事件挂在该节点下
                "knowledge_enhance_node_id": getattr(
                    context, "_knowledge_enhance_node_id", ""
                ),
                # per-agent LLM 配置（非 None 时覆盖环境变量）
                **({"llm_config": _agent_llm_config} if _agent_llm_config else {}),
            },
            "recursion_limit": 100,
        }

        try:
            # LangGraph 的根 span 必须挂在 datacloud-agent span 之下（父子关系），
            # 而不是框架层的 worker.execute/DEBUG 节点（否则两者平级）。
            # parent_observation_id = datacloud-agent span 的 id。
            _early_span = _early_lf_trace[1] if _early_lf_trace else None
            _lf_trace_id = str(getattr(_early_span, "trace_id", "") or "")
            _early_span_id = str(getattr(_early_span, "id", "") or "")

            _lf_handler = None
            if _lf_trace_id and _early_span_id:
                # 优先用新包（by_framework_trace_langfuse），parent 明确为 datacloud-agent span
                try:
                    from by_framework_trace_langfuse import (  # noqa: PLC0415
                        build_langchain_callback,
                    )
                    _lf_handler = build_langchain_callback(
                        trace_id=_lf_trace_id,
                        parent_observation_id=_early_span_id,
                    )
                except (ImportError, Exception):
                    pass

            if _lf_handler is None:
                # 降级：用旧包（datacloud_analysis.langfuse_handler）
                try:
                    from datacloud_analysis.langfuse_handler import (  # noqa: PLC0415
                        make_langfuse_callback,
                    )
                    _lf_handler = make_langfuse_callback(
                        _lf_trace_id or None,
                        parent_span_id=_early_span_id or None,
                    )
                except (ImportError, Exception):
                    pass

            if _lf_handler is not None:
                config["callbacks"] = [_lf_handler]
                config["metadata"] = {
                    "thread_id": thread_id,
                    "agent_id": str(by_agent_id or ""),
                    # LangChain CallbackHandler 读取这几个字段写入 Langfuse trace/span
                    "langfuse_trace_name": f"agent.workflow {by_agent_name or by_agent_id or ''}".strip(),
                    "langfuse_user_id": str(getattr(getattr(command, "header", None), "user_code", "") or ""),
                    "langfuse_session_id": context.session_id or "",
                    "langfuse_tags": [
                        f"agent_id:{by_agent_id or ''}",
                        f"agent_name:{by_agent_name or ''}",
                    ],
                }
                from datacloud_analysis.langfuse_handler import (  # noqa: PLC0415
                    current_tool_spans,
                )
                _lf_spans_list: list[dict[str, Any]] = []
                current_tool_spans.set(_lf_spans_list)
        except Exception:
            logger.warning("langfuse callback inject failed", exc_info=True)

        context._langgraph_thread_id = thread_id

        if _paradigm_resume_value is not None:
            # AskAgentCommand 携带 paradigm 回复：转为图恢复，不重新执行
            graph_input = Command(resume=_paradigm_resume_value)
        elif isinstance(command, ResumeCommand):
            try:
                resume_payload_json = json.dumps(
                    command.to_dict(),
                    ensure_ascii=False,
                    default=str,
                )
            except Exception:
                resume_payload_json = repr(command)
            logger.info(
                "ResumeCommand received session=%s trace_id=%s payload=%s",
                context.session_id,
                getattr(command.header, "trace_id", ""),
                resume_payload_json,
            )
            resume_value = (
                command.reply_data
                if command.reply_data is not None
                else command.content
            )
            if isinstance(resume_value, str):
                resume_preview = resume_value[:500]
            else:
                try:
                    resume_preview = json.dumps(
                        resume_value, ensure_ascii=False, default=str
                    )[:500]
                except (TypeError, ValueError):
                    resume_preview = repr(resume_value)[:500]
            logger.info(
                "ResumeCommand: resume_value type=%s preview=%s",
                type(resume_value).__name__,
                resume_preview,
            )
            graph_input: Any = Command(resume=resume_value)
        else:
            latest_user_text = _latest_user_text_from_content(
                command.content,
                locale=getattr(context, "locale", _FALLBACK_LOCALE),
            )
            _attachment_hint = _build_attachment_hint(attached_file_path)
            # 历史去重用未拼接版本匹配，避免提示文本干扰
            history_messages = await _load_recent_history_messages(
                context=context,
                limit=_history_inject_limit(),
                current_user_text=latest_user_text,
            )
            input_messages = _normalize_messages(
                command.content,
                locale=getattr(context, "locale", _FALLBACK_LOCALE),
            )
            # content 为 [] 或无法解析时，避免只有历史且最后一条为 assistant → intend 误用 AIMessage
            if not input_messages and latest_user_text:
                input_messages = [
                    HumanMessage(content=latest_user_text + _attachment_hint)
                ]
            elif _attachment_hint and input_messages:
                # 把附件提示追加到最后一条 HumanMessage
                _last = input_messages[-1]
                if isinstance(_last, HumanMessage):
                    input_messages[-1] = HumanMessage(
                        content=str(_last.content) + _attachment_hint
                    )
            combined_messages = history_messages + input_messages
            graph_input = {
                "messages": combined_messages,
                "query_received_at": _now_monotonic(),
                # 新问题进来时清除上一轮残留的澄清状态，防止 REPLAY GUARD 误触发
                "pending_clarification_context": None,
                "clarification_formatted_params": None,
                "agent_abort": False,
                "prompts_overwrite": {
                    "locale": str(getattr(context, "locale", "") or "zh_CN"),
                },
            }

            # ── Skill 加载：从 resource_list 提取 SKILL 条目，注入 task_prompt ──
            if not _is_dynamic_agent:
                _user_code_for_skill = str(
                    getattr(getattr(command, "header", None), "user_code", "") or ""
                ).strip()
                _beyond_token_for_skill = header_metadata.get("Beyond-Token", "")
                _minio_root = os.environ.get(
                    "FILE_STORAGE_MINIO_MOUNT_PATH", "/data/byai/byaiAllInOne/mino"
                )
                _skill_ids = _extract_skill_resource_ids(_resource_list_for_extract)
                _skill_paths_diag = [
                    str(
                        Path(_minio_root)
                        / f"byclaw-{_user_code_for_skill}"
                        / "by"
                        / rid.lstrip("/")
                        / "SKILL.md"
                    )
                    for rid in _skill_ids
                ]
                logger.info(
                    "[skill-diag] session=%s user_code=%s skill_ids=%s skill_paths=%s",
                    context.session_id,
                    _user_code_for_skill,
                    _skill_ids,
                    _skill_paths_diag,
                )
                _skill_task_prompt = _load_skills(
                    resource_list=_resource_list_for_extract,
                    user_code=_user_code_for_skill,
                    tools_dict=tools_dict,
                    agent_id=str(by_agent_id or ""),
                )
                if _skill_task_prompt:
                    _task_prompt, _first_skill_dir, _skill_catalog = _skill_task_prompt
                    graph_input["prompts_overwrite"]["task_prompt"] = _task_prompt
                    _skill_ws = str(
                        Path(_minio_root) / f"byclaw-{_user_code_for_skill}" / "by"
                    )
                    _skill_dir = _first_skill_dir or _skill_ws
                    config["configurable"]["extras"] = {
                        "user_code": _user_code_for_skill,
                        "beyond_token": _beyond_token_for_skill,
                        "skill_workspace_dir": _skill_ws,
                        "skill_dir": _skill_dir,
                        "task_prompt": _task_prompt,
                        "agent_id": str(by_agent_id or ""),
                        "be_domainname": os.environ.get("BE_DOMAINNAME", ""),
                        "skill_catalog": _skill_catalog,
                    }
                    logger.info(
                        "Skill loaded: session=%s skill_workspace_dir=%s skill_dir=%s",
                        context.session_id,
                        _skill_ws,
                        _skill_dir,
                    )
                else:
                    logger.warning(
                        "[skill-diag] skill load returned None: session=%s skill_ids=%s",
                        context.session_id,
                        _skill_ids,
                    )
            logger.debug(
                "[i18n-diag] graph_input.prompts_overwrite set: locale=%r",
                str(getattr(context, "locale", "") or "zh_CN"),
            )

        if isinstance(command, ResumeCommand) or _paradigm_resume_value is not None:
            # paradigm resume：checkpoint_id 在 humanInput.metadata 而非请求头，需合并后解析
            md = (
                {**_paradigm_human_input_metadata, **header_metadata}
                if _paradigm_resume_value is not None
                else header_metadata
            )
            all_metadata = md
            ckpt_id, ckpt_ns = self._resolve_resume_checkpoint_target(
                header_metadata=md
            )
            if ckpt_id:
                config["configurable"]["checkpoint_id"] = ckpt_id
                config["configurable"]["checkpoint_ns"] = ckpt_ns
            logger.info(
                "ResumeCommand: langgraph thread_id=%s checkpoint_id=%s checkpoint_ns=%r "
                "(from header.metadata / humanInput.metadata)",
                config["configurable"].get("thread_id", ""),
                config["configurable"].get("checkpoint_id", ""),
                config["configurable"].get("checkpoint_ns", ""),
            )

        resume_inflight_owner = False
        resume_inflight_future: asyncio.Future[dict[str, Any]] | None = None
        if isinstance(command, ResumeCommand) and resume_cache_key:
            inflight = self._resume_inflight.get(resume_cache_key)
            if inflight is not None:
                logger.info(
                    "ResumeCommand inflight hit: session=%s checkpoint_id=%s checkpoint_ns=%s",
                    context.session_id,
                    str(header_metadata.get("checkpoint_id") or ""),
                    str(header_metadata.get("checkpoint_ns") or ""),
                )
                inflight_result = await asyncio.shield(inflight)
                dict_inflight_result = dict(inflight_result)
                dict_inflight_result["metadata"] = all_metadata
                return dict_inflight_result
            resume_inflight_owner = True
            resume_inflight_future = asyncio.get_running_loop().create_future()
            resume_inflight_future.add_done_callback(self._consume_future_exception)
            self._resume_inflight[resume_cache_key] = resume_inflight_future

        reco_task: asyncio.Task[list[str]] | None = None
        if not _is_dynamic_agent:
            reco_plugin = (
                self.plugin_registry.get_plugin("datacloud_recommended_questions")
                if self.plugin_registry
                else None
            )
            if reco_plugin is not None and bool(
                getattr(reco_plugin.manifest, "enabled", True)
            ):
                gen_fn = getattr(reco_plugin, "generate_recommended_questions", None)
                if callable(gen_fn):
                    rq = _latest_user_text_from_content(
                        command.content,
                        locale=getattr(context, "locale", _FALLBACK_LOCALE),
                    ).strip()
                    if rq:
                        reco_task = asyncio.create_task(gen_fn(rq))

        try:
            logger.info(
                "_stream_graph invoke session=%s input_is_command_resume=%s",
                context.session_id,
                isinstance(graph_input, Command),
            )
            stream_result = await self._stream_graph(
                header_metadata=header_metadata,
                target_graph=target_graph,
                graph_input=graph_input,
                config=config,
                context=context,
                by_agent_id=by_agent_id or "",
                conf_hash=conf_hash,
                reco_task=reco_task,
                is_paradigm_resume=(_paradigm_resume_value is not None),
            )
            # ── Langfuse：补写 trace input / output ──────────────────────────
            try:
                _lf_callbacks = config.get("callbacks") or []
                # 兼容新旧两种 handler 类名：
                # 旧: LangchainCallbackHandler（datacloud_analysis.langfuse_handler）
                # 新: CallbackHandler（by_framework_trace_langfuse，来自 langfuse.langchain）
                _LANGFUSE_CB_NAMES = {"LangchainCallbackHandler", "CallbackHandler"}
                _lf_handler = next(
                    (
                        cb
                        for cb in _lf_callbacks
                        if type(cb).__name__ in _LANGFUSE_CB_NAMES
                    ),
                    None,
                )
                if _lf_handler is not None and getattr(
                    _lf_handler, "last_trace_id", None
                ):
                    _user_q = _latest_user_text_from_content(
                        command.content,
                        locale=getattr(context, "locale", _FALLBACK_LOCALE),
                    ).strip()
                    _answer = (
                        str(stream_result.get("conclusion") or "").strip()
                        if isinstance(stream_result, dict)
                        else ""
                    )
                    from langfuse import get_client as _lf_get_client  # noqa: PLC0415
                    import datetime as _dt  # noqa: PLC0415
                    import uuid as _uuid  # noqa: PLC0415
                    from langfuse.api.ingestion import (  # noqa: PLC0415
                        IngestionEvent_TraceCreate,
                        IngestionEvent_SpanCreate,
                        CreateSpanBody,
                        TraceBody,
                    )

                    _batch: list[Any] = [
                        IngestionEvent_TraceCreate(
                            id=str(_uuid.uuid4()),
                            timestamp=_dt.datetime.now(_dt.timezone.utc).isoformat(),
                            body=TraceBody(
                                id=_lf_handler.last_trace_id,
                                input=_user_q,
                                output=_answer,
                            ),
                        )
                    ]
                    _lf_tool_spans = (
                        stream_result.get("lf_tool_spans") or []
                        if isinstance(stream_result, dict)
                        else []
                    )
                    # 合并 react_loop.py 收集的业务工具调用（挂在最近 LLM obs 下）
                    try:
                        from datacloud_analysis.langfuse_handler import (
                            current_tool_spans as _cts,
                        )  # noqa: PLC0415

                        _react_spans = _cts.get() or []
                        for _rs in _react_spans:
                            _lf_tool_spans.append(
                                {
                                    **_rs,
                                    "parent_obs_id": _lf_last_llm_obs_id,  # noqa: F821
                                }
                            )
                    except Exception:
                        pass
                    for _span in _lf_tool_spans:
                        _batch.append(
                            IngestionEvent_SpanCreate(
                                id=str(_uuid.uuid4()),
                                timestamp=_span.get("start_time")
                                or _dt.datetime.now(_dt.timezone.utc).isoformat(),
                                body=CreateSpanBody(
                                    id=str(_uuid.uuid4()),
                                    trace_id=_lf_handler.last_trace_id,
                                    parent_observation_id=_span.get("parent_obs_id")
                                    or None,
                                    name=str(_span.get("name") or "tool"),
                                    input=_span.get("input"),
                                    output=str(_span.get("output") or "")
                                    if _span.get("output") is not None
                                    else None,
                                    start_time=_span.get("start_time")
                                    or _dt.datetime.now(_dt.timezone.utc).isoformat(),
                                    end_time=_span.get("end_time"),
                                ),
                            )
                        )
                    _lf_get_client().api.ingestion.batch(batch=_batch)
            except Exception:
                logger.debug("langfuse trace io update failed", exc_info=True)
            # lf_tool_spans 仅供 Langfuse 内部使用，不应序列化进框架返回值
            if isinstance(stream_result, dict):
                stream_result.pop("lf_tool_spans", None)
            if isinstance(command, ResumeCommand) and resume_cache_key:
                self._cache_resume_result(resume_cache_key, stream_result)
            if (
                resume_inflight_owner
                and resume_inflight_future is not None
                and not resume_inflight_future.done()
            ):
                resume_inflight_future.set_result(dict(stream_result))
            if isinstance(stream_result, dict):
                stream_result["metadata"] = all_metadata
            return stream_result
        except Exception as exc:
            if (
                resume_inflight_owner
                and resume_inflight_future is not None
                and not resume_inflight_future.done()
            ):
                resume_inflight_future.set_exception(exc)
            raise
        finally:
            if resume_inflight_owner and resume_cache_key:
                self._resume_inflight.pop(resume_cache_key, None)

    async def _stream_graph(
        self,
        *,
        target_graph: Any,
        graph_input: Any,
        config: dict,
        context: ByclawDataClarification,
        by_agent_id: str,
        conf_hash: str,
        reco_task: asyncio.Task[list[str]] | None = None,
        is_paradigm_resume: bool = False,
        header_metadata: dict = {},
    ) -> dict:
        """Drive the graph stream and handle interrupt/done branches."""
        is_agent_delegate = False
        stream_event_count = 0
        phase_emitted: set[str] = set()
        last_emit_time_ref: list[float] = [_now_monotonic()]
        _respond_final_answer: str = ""  # respond 节点写入的格式化最终回答
        heartbeat_stop = asyncio.Event()
        heartbeat_task = asyncio.create_task(
            _heartbeat_loop(context, heartbeat_stop, last_emit_time_ref)
        )
        # paradigm resume 时，把标志注入 config，供 execution_node 读取
        if is_paradigm_resume:
            config.setdefault("configurable", {})["_is_paradigm_resume"] = True

        # Langfuse 工具调用收集：on_tool_start/end 事件 → 图执行后批量写 span
        _lf_tool_spans: list[dict[str, Any]] = []
        _lf_last_llm_obs_id: str | None = (
            None  # 最近一次 LLM 调用的 Langfuse observation id
        )

        try:
            logger.info(
                "_stream_graph: astream_events begin session=%s conf_hash=%s",
                context.session_id,
                conf_hash,
            )
            async for event in target_graph.astream_events(
                graph_input, config=config, version="v2"
            ):
                stream_event_count += 1
                await context.check_cancelled()
                kind: str = str(event["event"])

                if kind == "on_chat_model_start":
                    # _runs 在此时刚写入，记录 LLM 调用的 Langfuse observation id
                    _lf_cbs_llm = config.get("callbacks") or []
                    _lf_h_llm = next(
                        (
                            cb
                            for cb in _lf_cbs_llm
                            if type(cb).__name__ == "LangchainCallbackHandler"
                        ),
                        None,
                    )
                    if _lf_h_llm is not None:
                        _llm_run_id_str = str(event.get("run_id") or "")
                        if _llm_run_id_str:
                            try:
                                _llm_runs = getattr(_lf_h_llm, "_runs", {})
                                _llm_obs = _llm_runs.get(
                                    __import__("uuid").UUID(_llm_run_id_str)
                                )
                                if _llm_obs is not None:
                                    _lf_last_llm_obs_id = str(
                                        getattr(_llm_obs, "id", "") or ""
                                    )
                            except Exception:
                                pass

                if kind == "on_tool_start":
                    _parent_run_id_str = str(event.get("parent_run_id") or "")
                    _parent_obs_id: str | None = None
                    if _parent_run_id_str:
                        _lf_cbs = config.get("callbacks") or []
                        _lf_h = next(
                            (
                                cb
                                for cb in _lf_cbs
                                if type(cb).__name__ == "LangchainCallbackHandler"
                            ),
                            None,
                        )
                        if _lf_h is not None:
                            try:
                                _runs = getattr(_lf_h, "_runs", {})
                                _parent_obs = _runs.get(
                                    __import__("uuid").UUID(_parent_run_id_str)
                                )
                                if _parent_obs is not None:
                                    _parent_obs_id = str(
                                        getattr(_parent_obs, "id", "") or ""
                                    )
                            except Exception:
                                pass
                    # parent_run_id 为空时回退到最近一次 LLM 调用的 observation id
                    if not _parent_obs_id:
                        _parent_obs_id = _lf_last_llm_obs_id
                    _lf_tool_spans.append(
                        {
                            "name": str(event.get("name") or ""),
                            "run_id": str(event.get("run_id") or ""),
                            "parent_run_id": _parent_run_id_str,
                            "parent_obs_id": _parent_obs_id,
                            "input": (event.get("data") or {}).get("input"),
                            "start_time": __import__("datetime")
                            .datetime.now(__import__("datetime").timezone.utc)
                            .isoformat(),
                        }
                    )
                elif kind == "on_tool_end":
                    _run_id = str(event.get("run_id") or "")
                    for _span in reversed(_lf_tool_spans):
                        if _span.get("run_id") == _run_id and "output" not in _span:
                            _raw_out = (event.get("data") or {}).get("output")
                            if _raw_out is None:
                                _span["output"] = None
                            elif isinstance(_raw_out, str):
                                _span["output"] = _raw_out
                            else:
                                try:
                                    import json as _json_mod

                                    _span["output"] = _json_mod.dumps(
                                        _raw_out
                                        if isinstance(_raw_out, (dict, list))
                                        else str(_raw_out),
                                        ensure_ascii=False,
                                        default=str,
                                    )
                                except Exception:
                                    _span["output"] = str(_raw_out)
                            _span["end_time"] = (
                                __import__("datetime")
                                .datetime.now(__import__("datetime").timezone.utc)
                                .isoformat()
                            )
                            break

                if kind == "on_chat_model_end":
                    node_name = str(
                        (event.get("metadata") or {}).get("langgraph_node") or ""
                    )
                    if (
                        node_name == "planning"
                        and _get_planning_phase_title(
                            getattr(context, "locale", "zh_CN")
                        )
                        not in phase_emitted
                    ):
                        _planning_title = _get_planning_phase_title(
                            getattr(context, "locale", "zh_CN")
                        )
                        phase_emitted.add(_planning_title)
                        async with context.sub_step(_planning_title):
                            pass

                elif kind == "on_chain_end":
                    if event.get("name") == "agent_delegate":
                        is_agent_delegate = True
                    else:
                        _node = str(
                            (event.get("metadata") or {}).get("langgraph_node") or ""
                        )
                        if _node == "intend":
                            _output = (event.get("data") or {}).get("output")
                            if not isinstance(_output, dict):
                                _output = {}
                            kp = _output.get("knowledge_payload") or {}
                            if kp:
                                if kp.get("needs_clarification"):
                                    _form_text = _format_paradigm_form(
                                        kp.get("form", "")
                                    )
                                    _kp_msg = f"问题可能存在歧义，正在确认查询维度：\n{_form_text}"
                                elif kp.get("knowledge"):
                                    _knowledge_text = _format_knowledge_snippet(
                                        kp.get("knowledge", "")
                                    )
                                    _kp_msg = f"已识别字段映射：\n{_knowledge_text}"
                                else:
                                    _kp_msg = None
                                if _kp_msg:
                                    _node_id = getattr(
                                        context, "_knowledge_enhance_node_id", ""
                                    )
                                    if _node_id:
                                        # 追加到已有"问题理解"节点下，与"已接收到用户消息"同级
                                        _kp_msg_id = context.generate_message_id()
                                        await context.emit_chunk(
                                            StreamChunkEvent(content=_kp_msg),
                                            event_type=EventType.REASONING_LOG_START.value,
                                            content_type=SseReasonMessageType.think_text.value,
                                            message_id=_kp_msg_id,
                                            parent_message_id=_node_id,
                                        )
                                    else:
                                        # 兜底：节点 id 不可用时直接推送（不新建 sub_step 标题）
                                        await context.emit_chunk(
                                            StreamChunkEvent(content=_kp_msg),
                                            event_type=EventType.REASONING_LOG_START.value,
                                            content_type=SseReasonMessageType.think_text.value,
                                        )

                        if _node == "respond":
                            _resp_output = (event.get("data") or {}).get("output") or {}
                            if isinstance(_resp_output, dict):
                                _fa = str(
                                    _resp_output.get("final_answer") or ""
                                ).strip()
                                if _fa:
                                    _respond_final_answer = _fa

                elif kind == "on_custom_event":
                    _ce_name = event.get("name", "")
                    if _ce_name == "dc_stream_chunk":
                        d: dict[str, Any] = event.get("data") or {}
                        _dc_content = d.get("content", "")
                        _dc_event_type = d.get("event_type", "")
                        _dc_content_type = d.get("content_type", "")
                        _dc_msg_id = d.get("message_id", "")
                        _dc_parent_msg_id = d.get("parent_message_id", "")
                        dc_emit_kwargs: dict[str, Any] = {
                            "event_type": _dc_event_type,
                            "content_type": _dc_content_type,
                            "message_id": _dc_msg_id,
                        }
                        if _dc_parent_msg_id:
                            dc_emit_kwargs["parent_message_id"] = _dc_parent_msg_id
                        await context.emit_chunk(
                            StreamChunkEvent(content=_dc_content),
                            **dc_emit_kwargs,
                        )

                elif kind == "on_chain_start":
                    _node = str(
                        (event.get("metadata") or {}).get("langgraph_node") or ""
                    )
                    if _node == "respond":
                        _end_title = _get_node_phase_title(
                            "end", getattr(context, "locale", "zh_CN")
                        )
                        if _end_title and _end_title not in phase_emitted:
                            phase_emitted.add(_end_title)
                            await context.emit_chunk(
                                StreamChunkEvent(
                                    content=_get_node_thinking_desc(
                                        "end", getattr(context, "locale", "zh_CN")
                                    )
                                ),
                                event_type=EventType.REASONING_LOG_START.value,
                                content_type=SseReasonMessageType.think_text.value,
                            )

                elif kind == "on_tool_start":
                    # 工具名已通过 react_loop 的 content 流式推送，无需再建 sub_step 节点。
                    # paradigm resume 重放时同样跳过。
                    pass

                # 工具名/出参由 react_loop content 流式推送，on_tool_start/on_tool_end 均不再额外推送。

            logger.info(
                "_stream_graph: astream_events end session=%s event_count=%d",
                context.session_id,
                stream_event_count,
            )

            if _compiled_graph_has_checkpointer(target_graph):
                snapshot_config = {
                    "configurable": dict(config.get("configurable") or {}),
                }
                snapshot_config["configurable"].pop("checkpoint_id", None)
                snapshot = await target_graph.aget_state(snapshot_config)
            else:
                global _no_checkpointer_logged
                if not _no_checkpointer_logged:
                    logger.warning(
                        "Graph has no checkpointer: aget_state skipped, HITL/resume disabled. "
                        "Ensure bootstrap.setup() finished before the first create_agent(), "
                        "or clear graph cache if bootstrap order was wrong."
                    )
                    _no_checkpointer_logged = True
                snapshot = None

            ckpt_after = (
                snapshot.config.get("configurable", {}).get("checkpoint_id", "")
                if snapshot is not None
                else ""
            )
            logger.info(
                "_stream_graph: after aget_state session=%s snapshot_present=%s "
                "has_interrupts=%s checkpoint_id=%s",
                context.session_id,
                snapshot is not None,
                bool(snapshot.interrupts) if snapshot is not None else False,
                ckpt_after,
            )

            if snapshot is not None and snapshot.interrupts:
                first = snapshot.interrupts[0]
                interrupt_value = first.value
                interrupt_reason = "unknown_interrupt"
                if isinstance(interrupt_value, dict):
                    prompt = interrupt_value.get("prompt", str(interrupt_value))
                    interrupt_reason = str(
                        interrupt_value.get("reason_code")
                        or interrupt_value.get("interrupt_reason")
                        or "interrupt"
                    )
                else:
                    prompt = (
                        str(interrupt_value) if interrupt_value else "请补充您的回答。"
                    )
                    if prompt:
                        interrupt_reason = "prompt_interrupt"

                checkpoint_id = snapshot.config.get("configurable", {}).get(
                    "checkpoint_id", ""
                )
                checkpoint_ns = snapshot.config.get("configurable", {}).get(
                    "checkpoint_ns", ""
                )
                snapshot_values = (
                    snapshot.values if isinstance(snapshot.values, dict) else {}
                )
                todo_active_id = str(snapshot_values.get("todo_active_id") or "")
                active_tools = snapshot_values.get("active_tools")
                pending_capability = ""
                if isinstance(active_tools, list) and active_tools:
                    pending_capability = str(active_tools[0] or "")
                if not pending_capability:
                    pending_capability = str(snapshot_values.get("target_tool") or "")

                logger.info(
                    "Graph interrupted: session=%s checkpoint_id=%s prompt=%r",
                    context.session_id,
                    checkpoint_id,
                    prompt,
                )
                if interrupt_reason == "AGENT_DELEGATE_WAIT":
                    # call_agent 已由 DelegateToAgentTool 基类（InterruptibleTool）在工具内部调用，
                    # worker 无需再处理，直接静默等待子 Agent 的 ResumeCommand 回调。
                    logger.info(
                        "_stream_graph: delegate wait interrupt, waiting for child agent resume "
                        "session=%s checkpoint_id=%s",
                        context.session_id,
                        checkpoint_id,
                    )
                    return {"status": "waiting"}

                paradigm_list = []
                operation_form = {}
                clarify_knowledge = ""
                clarify_query = ""
                if isinstance(interrupt_value, dict):
                    if isinstance(interrupt_value.get("ask_user_payload"), dict):
                        ask_user_payload = interrupt_value.get("ask_user_payload")
                        paradigm_list = ask_user_payload.get("paradigmList", [])
                        clarify_query = str(ask_user_payload.get("query") or "")
                    clarify_knowledge = str(
                        interrupt_value.get("_clarify_knowledge") or ""
                    )
                    if interrupt_value.get("interrupt_type") == "operation_form":
                        operation_form = interrupt_value.get("operation_form")

                if paradigm_list:
                    user_metadata = {
                        "thread_id": config["configurable"]["thread_id"],
                        "checkpoint_id": checkpoint_id,
                        "checkpoint_ns": checkpoint_ns,
                        "agent_id": by_agent_id,
                        "conf_hash": conf_hash,
                        "todo_active_id": todo_active_id,
                        "react_step_id": todo_active_id,
                        "pending_capability": pending_capability,
                        "interrupt_reason": interrupt_reason,
                        "paradigmList": paradigm_list,
                        "query": clarify_query,
                        "clarify_knowledge": clarify_knowledge,
                    }
                    await context.complex_ask_user(
                        event=AskUserEvent(
                            prompt=prompt,
                            metadata={**user_metadata, **header_metadata},
                        ),
                        message_id=getattr(context, "message_id", None),
                        parent_message_id=getattr(context, "parent_message_id", None),
                    )
                elif operation_form:
                    user_metadata = {
                        "thread_id": config["configurable"]["thread_id"],
                        "checkpoint_id": checkpoint_id,
                        "checkpoint_ns": checkpoint_ns,
                        "agent_id": by_agent_id,
                        "conf_hash": conf_hash,
                        "todo_active_id": todo_active_id,
                        "react_step_id": todo_active_id,
                        "pending_capability": pending_capability,
                        "interrupt_reason": interrupt_reason,
                        "operation_form": operation_form,
                    }
                    await context.complex_ask_user(
                        event=AskUserEvent(
                            prompt=prompt,
                            metadata={**user_metadata, **header_metadata},
                        ),
                        message_id=getattr(context, "message_id", None),
                        parent_message_id=getattr(context, "parent_message_id", None),
                    )
                else:
                    await context.ask_user(
                        AskUserEvent(
                            prompt=prompt,
                            metadata={
                                "thread_id": config["configurable"]["thread_id"],
                                "checkpoint_id": checkpoint_id,
                                "checkpoint_ns": checkpoint_ns,
                                "agent_id": by_agent_id,
                                "conf_hash": conf_hash,
                                "todo_active_id": todo_active_id,
                                "react_step_id": todo_active_id,
                                "pending_capability": pending_capability,
                                "interrupt_reason": interrupt_reason,
                                **(
                                    {
                                        "ask_user_payload": interrupt_value.get(
                                            "ask_user_payload"
                                        )
                                    }
                                    if isinstance(interrupt_value, dict)
                                    and isinstance(
                                        interrupt_value.get("ask_user_payload"), dict
                                    )
                                    else {}
                                ),
                            },
                        )
                    )
                await context.emit_chunk(
                    StreamChunkEvent(
                        content="回答完成",
                        metadata={
                            "relatedResources": _related_resources_from_reco_task(
                                reco_task
                            ),
                        },
                    ),
                    event_type=EventType.APP_STREAM_RESPONSE.value,
                    content_type=SseMessageType.text.value,
                )
                logger.info(
                    "_stream_graph: return session=%s status=waiting",
                    context.session_id,
                )
                return {"status": "waiting"}

            # conclusion 优先取 respond_node 写入的 final_answer，这是 format_result 后的最终结果。
            # 兜底再取当前轮 react_final["answer"]，而非 state["messages"] 里的最后 AIMessage。
            # react_loop 的 AIMessage 存在局部变量中，不写入 state["messages"]；
            # snapshot.values["messages"] 里的最后 AIMessage 始终是历史记录（上一轮），
            # 直接用它会导致两个问题：
            #   1. emit_chunk 把旧回复推送给用户（当前轮末尾多出上一轮内容）
            #   2. conclusion 携带旧回复，被 GatewayWorker 在下一轮二次推送
            final_message = None
            if _respond_final_answer:
                final_message = _respond_final_answer
            elif snapshot and snapshot.values:
                _ans = str(snapshot.values.get("final_answer") or "").strip()
                if not _ans:
                    react_final_snap = snapshot.values.get("react_final") or {}
                    _ans = str(react_final_snap.get("answer") or "").strip()
                if _ans:
                    final_message = _ans

            if not is_agent_delegate:
                await context.emit_chunk(
                    StreamChunkEvent(
                        content="回答完成",
                        metadata={
                            "relatedResources": _related_resources_from_reco_task(
                                reco_task
                            ),
                        },
                    ),
                    event_type=EventType.APP_STREAM_RESPONSE.value,
                    content_type=SseMessageType.text.value,
                )

            await context.flush_to_history()
            logger.info(
                "_stream_graph: return session=%s status=done conclusion_len=%d",
                context.session_id,
                len(final_message) if final_message else 0,
            )
            # conclusion 始终携带，父 Agent 恢复时可以从 reply_data 里取到结论文本
            return {
                "status": "done",
                "conclusion": final_message or "",
                "lf_tool_spans": _lf_tool_spans,
            }
        finally:
            heartbeat_stop.set()
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass
            if reco_task is not None and not reco_task.done():
                reco_task.cancel()
                try:
                    await reco_task
                except asyncio.CancelledError:
                    pass

    async def _handle_message(
        self,
        command: GatewayCommand,
        cancel_event: Optional[asyncio.Event] = None,
        cancel_reason: str = "",
        execution: Optional["RunningExecution"] = None,
    ) -> AgentTaskResult:
        """Handle incoming gateway command message."""
        trace_id = uuid.uuid4().hex
        raw_command = command
        command = self.prepare_command_for_processing(command)
        header = raw_command.header

        # Whether it's a return from calling another Agent or a return from waiting for
        # user input, RESUME is uniformly used to indicate the resumption of a suspended
        # task. Essentially, both are “resuming execution of the current workflow from a
        # suspended/waiting state”, so they are uniformly handled in lifecycle and state
        # recovery logic (like reloading workspace, persisting state, etc.).
        is_agent_return = isinstance(raw_command, ResumeCommand)
        source_agent_type = header.source_agent_type
        has_source_agent = bool(source_agent_type) and not is_agent_return

        # Get workspace dir from workspace_manager if available
        # Note: We don't use hasattr check because it doesn't work well with mocks
        workspace_dir = None

        # Determine context parent message id
        message_id = header.message_id
        parent_message_id = header.parent_message_id
        if execution and execution.is_resumed:
            parent_message_id = execution.parent_message_id
            logger.info(
                "[%s] Task Resumed: Successfully restored parent_message_id=%s "
                "from execution snapshot.",
                self.worker_id,
                parent_message_id,
            )
        else:
            logger.info(
                "[%s] New Task: message_id=%s, parent_message_id=%s",
                self.worker_id,
                message_id,
                parent_message_id,
            )

        agent_config_snapshot = await self._resolve_agent_configs_snapshot(
            execution,
            header.session_id,
        )

        context = self.get_context_class()(
            session_id=header.session_id,
            trace_id=header.trace_id if header.trace_id else trace_id,
            redis_client=self.redis,
            current_agent_id=header.target_agent_type
            if header.target_agent_type
            else "",
            message_id=message_id,
            parent_message_id=parent_message_id,
            current_command=command,
            cancel_event=cancel_event,
            cancel_reason=cancel_reason,
            plugin_registry=self.plugin_registry,
            user_code=header.user_code,
            user_name=header.user_name,
            workspace_dir=workspace_dir,
            agent_configs=list(agent_config_snapshot.configs),
            agent_configs_version=agent_config_snapshot.version,
            storage=self.storage,
            permission_policy=self.permission_policy,
            content_codec=self.get_content_codec(),
            layout_builder=self.get_data_layout_builder(),
            is_sub_agent=has_source_agent,
        )
        if execution:
            execution.context = context
        process_result: Any = None

        logger.info(
            "[%s] Received message: %s (Trace: %s)",
            self.worker_id,
            header.message_id,
            trace_id,
        )
        logger.info(
            "[%s] Target Agent Type: %s", self.worker_id, header.target_agent_type
        )
        logger.info("[%s] Session ID: %s", self.worker_id, header.session_id)

        token = None
        try:
            # Call plugin hooks at task start
            await self.plugin_registry.on_task_start(context)

            # 0. Automatically save user message to history
            if not is_agent_return and hasattr(raw_command, "content"):
                await context.agent_runtime_state.session_manager.history.save_message(
                    role="user",
                    content=raw_command.content,
                    metadata={
                        "message_id": header.message_id,
                        "trace_id": header.trace_id,
                    },
                )

            # 1. Setup workspace
            logger.info(
                "[%s] Setting up workspace for session: %s",
                self.worker_id,
                header.session_id,
            )
            paths = await self.workspace_manager.setup_workspace(
                header.session_id,
                header.message_id,
                user_code=header.user_code or "default",
                agent_id=header.target_agent_type or self.worker_id,
            )
            logger.debug("[%s] Workspace paths: %s", self.worker_id, paths)

            # 2. Setup Sandbox
            if self.sandbox:
                logger.info("[%s] Installing sandbox", self.worker_id)
                self.sandbox.install()

            token = active_workspace.set(paths["private"])

            # 3. Process
            logger.info("[%s] Starting task processing", self.worker_id)
            if cancel_event and cancel_event.is_set():
                raise asyncio.CancelledError(
                    f"Task cancelled before processing (reason: {cancel_reason})"
                )

            if is_agent_return:
                await self._persist_agent_return_state(paths, raw_command)

                # Check for scatter-gather join
                if header.task_group_id:
                    group_key = RedisKeys.task_group(header.task_group_id)
                    results_key = RedisKeys.task_group_results(header.task_group_id)
                    total_str = await self.redis.hget(group_key, TASK_GROUP_FIELD_TOTAL)
                    if total_str is not None:
                        # Store result in Redis Hash for distributed access
                        if isinstance(raw_command, ResumeCommand):
                            result_data = {
                                "status": raw_command.status,
                                "reply_data": raw_command.reply_data,
                                "content": raw_command.content,
                                "metadata": raw_command.header.metadata,
                                "extra_payload": raw_command.extra_payload,
                            }
                            await self.redis.hset(
                                results_key,
                                header.message_id,
                                json.dumps(result_data),
                            )
                            await self.redis.expire(results_key, TASK_GROUP_TTL_SECONDS)

                        completed = await self.redis.hincrby(
                            group_key, TASK_GROUP_FIELD_COMPLETED, 1
                        )
                        if completed < int(total_str):
                            logger.info(
                                "[%s] TaskGroup %s completed %d/%s, waiting...",
                                self.worker_id,
                                header.task_group_id,
                                completed,
                                total_str,
                            )
                            return AgentTaskResult(
                                status=f"{AgentState.QUEUED.value}: waiting_for_group"
                            )
                        logger.info(
                            "[%s] TaskGroup %s ALL COMPLETED (%s)!",
                            self.worker_id,
                            header.task_group_id,
                            total_str,
                        )

                # await context.emit_state(
                #     StateChangeEvent(state=AgentState.RESUMED.value)
                # )
            process_result = await self.process_command(command, context)
            task_result = normalize_process_result(process_result)

            # Determine the execution status to return
            # Prefer extracting status from business return results
            # (e.g., QUEUED, WAITING_USER, etc.)
            final_status = task_result.status

            if has_source_agent:
                await self._enqueue_agent_return(
                    raw_command,
                    status=task_result.status,
                    content=task_result.content,
                    reply_data=task_result.reply_data,
                    metadata=task_result.metadata,
                    extra_payload=task_result.extra_payload,
                )
            logger.info(
                "[%s] Task completed successfully with status: %s",
                self.worker_id,
                final_status,
            )
            # Call plugin hook on task completion
            await self.plugin_registry.on_task_complete(context, process_result)

            from by_framework.core.protocol.agent_state import is_terminal_state

            should_emit_stream_end = (
                not has_source_agent
                and is_terminal_state(final_status)
                and not getattr(context, "_permission_transferred", False)
                and not getattr(context, "_is_suspended", False)
            )

            final_message = None
            if isinstance(task_result.content, str) and task_result.content:
                final_message = task_result.content
            elif isinstance(task_result.reply_data, str) and task_result.reply_data:
                final_message = task_result.reply_data
            elif task_result.reply_data is not None:
                final_message = json.dumps(task_result.reply_data, ensure_ascii=False)

            if final_message is not None:
                await context.emit_chunk(
                    StreamChunkEvent(
                        content=final_message, metadata=task_result.metadata
                    ),
                    event_type=EventType.FINAL_ANSWER.value,
                )

            # Apply APP_STREAM_RESPONSE sending logic at the framework level
            if should_emit_stream_end:
                # If having permission and business hasn't closed the stream itself,
                # automatically send stream end event here
                if not getattr(context, "_is_stream_finished", False):
                    await context.emit_chunk(
                        "", event_type=EventType.APP_STREAM_RESPONSE.value
                    )
                    context._is_stream_finished = True
            else:
                # Fallback: if no permission to send stream end (or suspended),
                # force flush to history on completion
                await context.flush_to_history()

            return task_result

        except asyncio.CancelledError as e:
            reason = str(e)
            if not reason:
                reason = execution.cancel_reason if execution else cancel_reason
            logger.info("[%s] Task cancellation requested: %s", self.worker_id, reason)

            if has_source_agent:
                # Cascade cancellation scenario: check if parent Agent is also marked
                # for cancellation, skip callback if so
                # Note: parent Agent may be in COMPLETED state but marked
                # with cancel_requested
                should_callback = True
                parent_msg_id = header.parent_message_id
                if parent_msg_id and hasattr(self, "registry") and self.registry:
                    try:
                        parent_exec = await self.registry.get_execution_by_message_id(
                            parent_msg_id, session_id=header.session_id
                        )
                        if parent_exec and parent_exec.get("cancel_requested"):
                            should_callback = False
                            logger.info(
                                "[%s] Skipping cancel callback to parent "
                                "(parent cancel_requested): %s",
                                self.worker_id,
                                parent_msg_id,
                            )
                    except Exception:  # pylint: disable=broad-exception-caught
                        pass  # Conservatively send callback when query fails
                if should_callback:
                    await self._enqueue_agent_return(
                        command,
                        status=AgentState.CANCELLED.value,
                        reply_data={"reason": reason},
                    )

            should_emit_stream_end = not has_source_agent and not getattr(
                context, "_permission_transferred", False
            )
            if should_emit_stream_end and not getattr(
                context, "_is_stream_finished", False
            ):
                await context.emit_chunk(
                    "", event_type=EventType.APP_STREAM_RESPONSE.value
                )
            else:
                await context.flush_to_history()

            return AgentTaskResult(status=AgentState.CANCELLED.value)

        except Exception as e:  # pylint: disable=broad-exception-caught
            error_msg = f"[{self.worker_id}] Task failed: {str(e)}"
            logger.error(error_msg)
            if has_source_agent:
                await self._enqueue_agent_return(
                    command,
                    status=AgentState.FAILED.value,
                    reply_data={"error": str(e)},
                )
            logger.error(traceback.format_exc())
            # Call plugin hook on task error
            await self.plugin_registry.on_task_error(context, e)

            should_emit_stream_end = not has_source_agent and not getattr(
                context, "_permission_transferred", False
            )
            if should_emit_stream_end and not getattr(
                context, "_is_stream_finished", False
            ):
                await context.emit_chunk(
                    "", event_type=EventType.APP_STREAM_RESPONSE.value
                )
            else:
                await context.flush_to_history()

            return AgentTaskResult(status=AgentState.FAILED.value)
        finally:
            # 4. Cleanup
            if token is not None:
                active_workspace.reset(token)
            if self.sandbox:
                logger.info("[%s] Uninstalling sandbox", self.worker_id)
                self.sandbox.uninstall()
            logger.info("[%s] Cleaning up task: %s", self.worker_id, header.message_id)
            await self.workspace_manager.cleanup_task(
                header.session_id,
                header.message_id,
                user_code=header.user_code or "default",
                agent_id=header.target_agent_type or self.worker_id,
            )


# ------------------------------------------------------------------

# ------------------------------------------------------------------


def _format_uploaded_files_for_message(
    files: Any,
    *,
    locale: str = _FALLBACK_LOCALE,
) -> str:
    """Format frontend uploaded-file metadata as markdown for LLM context."""
    locale = _normalize_locale(locale)
    if not files:
        return ""

    if isinstance(files, Mapping):
        file_items = [files]
    elif isinstance(files, list):
        file_items = files
    else:
        return ""

    lines: list[str] = []
    for index, file_item in enumerate(file_items, start=1):
        if not isinstance(file_item, Mapping):
            continue

        file_path = str(file_item.get("filePath") or "").strip()
        if not file_path:
            continue

        file_name = str(file_item.get("fileName") or "").strip()
        if not file_name:
            default_prefix = "File" if locale == "en_US" else "文件"
            file_name = (
                os.path.basename(file_path.rstrip("/")) or f"{default_prefix}{index}"
            )

        lines.append(f"{index}. [{file_name}]({file_path})")

    if not lines:
        return ""

    title = "User uploaded file(s):" if locale == "en_US" else "用户上传了文件："
    return f"{title}\n" + "\n".join(lines)


def _join_text_with_uploaded_files(text: str, uploaded_files_text: str) -> str:
    if not uploaded_files_text:
        return text
    return f"{text}\n\n{uploaded_files_text}" if text else uploaded_files_text


def _collect_content_part(
    part: Any,
    *,
    text_parts: list[str],
    file_items: list[Any],
) -> None:
    if not isinstance(part, Mapping):
        if part is not None:
            text = str(part).strip()
            if text:
                text_parts.append(text)
        return

    text_value = part.get("text")
    if text_value is not None:
        text = str(text_value).strip()
        if text:
            text_parts.append(text)

    file_value = part.get("file")
    if isinstance(file_value, Mapping):
        file_items.append(file_value)

    files_value = part.get("files")
    if isinstance(files_value, Mapping):
        file_items.append(files_value)
    elif isinstance(files_value, list):
        file_items.extend(files_value)

    if "filePath" in part:
        file_items.append(part)


def _format_content_for_message(
    raw_content: Any,
    *,
    locale: str = _FALLBACK_LOCALE,
) -> str:
    """Convert gateway/history content shapes to text plus markdown file links."""
    if raw_content is None:
        return ""
    if isinstance(raw_content, str):
        return raw_content

    text_parts: list[str] = []
    file_items: list[Any] = []

    if isinstance(raw_content, list):
        for part in raw_content:
            _collect_content_part(
                part,
                text_parts=text_parts,
                file_items=file_items,
            )
    elif isinstance(raw_content, Mapping):
        _collect_content_part(
            raw_content,
            text_parts=text_parts,
            file_items=file_items,
        )
    else:
        return str(raw_content)

    if not text_parts and not file_items:
        return str(raw_content)

    text = "\n".join(text_parts)
    uploaded_files_text = _format_uploaded_files_for_message(
        file_items,
        locale=locale,
    )
    return _join_text_with_uploaded_files(text, uploaded_files_text)


def _normalize_messages(
    content: Any,
    *,
    locale: str = _FALLBACK_LOCALE,
) -> list[HumanMessage | AIMessage | SystemMessage]:
    """Convert gateway command content to a list of LangChain BaseMessage.

    Supports:
    """
    if isinstance(content, str):
        return [HumanMessage(content=content)]

    if not isinstance(content, list):
        return [HumanMessage(content=str(content))]

    if not any(isinstance(item, Mapping) and "role" in item for item in content):
        return [
            HumanMessage(content=_format_content_for_message(content, locale=locale))
        ]

    messages: list[HumanMessage | AIMessage | SystemMessage] = []
    for item in content:
        if isinstance(item, dict) and "role" in item:
            role = item["role"]
            raw_content = item.get("content", "")
            text = _format_content_for_message(raw_content, locale=locale)
            if role == "assistant":
                messages.append(AIMessage(content=text))
            elif role == "system":
                messages.append(SystemMessage(content=text))
            else:
                messages.append(HumanMessage(content=text))
        else:
            messages.append(HumanMessage(content=str(item)))

    return messages


def _history_inject_limit() -> int:
    """How many recent DB history rows to merge into graph ``messages`` (Human/Assistant per row)."""
    raw = os.environ.get("DATACLOUD_HISTORY_MESSAGE_LIMIT", "12")
    try:
        n = int(raw.strip())
    except ValueError:
        return 12
    return max(1, min(n, 200))


async def _load_recent_history_messages(
    *,
    context: ByclawDataClarification,
    limit: int = 12,
    current_user_text: str = "",
) -> list[HumanMessage | AIMessage | SystemMessage]:
    """Load recent business history and convert to LangChain messages."""
    try:
        raw_history = (
            await context.agent_runtime_state.session_manager.history.get_history(
                limit=limit
            )
        )
    except Exception as exc:
        logger.warning("_load_recent_history_messages failed: %s", exc)
        return []

    if not isinstance(raw_history, list):
        return []

    raw_history = list(reversed(raw_history))

    locale = getattr(context, "locale", _FALLBACK_LOCALE)
    history_messages: list[HumanMessage | AIMessage | SystemMessage] = []
    for item in raw_history:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip().lower()
        content = _format_content_for_message(
            item.get("content"),
            locale=locale,
        ).strip()
        if not content:
            continue
        if role == "user":
            history_messages.append(HumanMessage(content=content))
        elif role in {"assistant", "ai"}:
            history_messages.append(AIMessage(content=content))
        elif role == "system":
            history_messages.append(SystemMessage(content=content))

    if current_user_text and history_messages:
        last_message = history_messages[-1]
        if (
            isinstance(last_message, HumanMessage)
            and str(last_message.content).strip() == current_user_text
        ):
            history_messages.pop()

    return history_messages


def _related_resources_from_reco_task(
    task: asyncio.Task[list[str]] | None,
) -> list[str]:
    """Return LLM recommendations only if the background task already finished (no extra wait).

    This keeps tail latency unchanged: we never await an in-flight recommendation task at
    emit time; if the model finishes before the main graph, results are attached.
    """

    if task is None:
        return []
    if not task.done():
        return []
    try:
        out = task.result()
    except Exception as exc:
        logger.debug("recommendation task failed: %s", exc)
        return []
    if not isinstance(out, list):
        return []
    return [str(x).strip() for x in out if str(x).strip()]


def _build_attachment_hint(attached_file_path: str) -> str:
    """生成附件提示文本,追加到用户消息末尾,由 LLM 自主决定是否调用 read_file。"""
    if not attached_file_path:
        return ""
    return (
        f"\n\n[用户附件] 用户引用了 1 个文件,路径:{attached_file_path}\n"
        f"如需读取该文件内容以辅助回答,请调用 read_file 工具,"
        f"path 参数传入:{attached_file_path}"
    )


def _latest_user_text_from_content(
    content: Any,
    *,
    locale: str = _FALLBACK_LOCALE,
) -> str:
    if isinstance(content, str):
        return content.strip()
    if not isinstance(content, list) or not content:
        return str(content).strip() if content is not None else ""
    if not any(isinstance(item, Mapping) and "role" in item for item in content):
        return _format_content_for_message(content, locale=locale).strip()
    last = content[-1]
    if isinstance(last, dict):
        raw = last.get("content", "")
        return _format_content_for_message(raw, locale=locale).strip()
    return str(last).strip()


def _is_light_chitchat(text: str) -> bool:
    normalized = " ".join(text.lower().split())
    if not normalized:
        return False
    if any(token in normalized for token in _ANALYSIS_HINT_TOKENS):
        return False
    if normalized in _CHITCHAT_TOKENS:
        return True
    # Keep heuristic narrow to avoid hijacking real requests.
    return len(normalized) <= 10 and any(
        token in normalized for token in _CHITCHAT_TOKENS
    )
