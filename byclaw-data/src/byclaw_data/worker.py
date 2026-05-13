"""DataCloud Gateway Worker."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import sys
from collections import OrderedDict
from collections.abc import AsyncGenerator, Mapping

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from typing import Any

from by_framework import (
    AskUserEvent,
    EventType,
    GatewayCommand,
    GatewayWorker,
    ResumeCommand,
    StreamChunkEvent,
)
from by_framework.common.logger import logger
from by_framework.core.extensions import PluginRegistry
from by_framework.core.protocol.commands import AskAgentCommand
from by_framework.core.protocol.content_type import SseMessageType, SseReasonMessageType
from datacloud_analysis.agent import create_agent
from datacloud_analysis.command_plugins import CommandPluginManager
from datacloud_analysis.logging_setup import setup_logging
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.types import Command

from byclaw_data.byclaw_data_clarification import ByclawDataClarification

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

_NODE_THINKING_DESC: dict[str, str] = {
    "knowledge_enhance": "正在理解问题并补充上下文...\n\n",
    "planning": "正在生成任务计划...\n\n",
    "execution": "正在执行任务...\n\n",
    "end": "正在整理结果...",
}
_DEFAULT_THINKING_DESC = "正在处理，请稍候...\n\n"

_NODE_PHASE_TITLE: dict[str, str] = {
    "knowledge_enhance": "问题理解",
    "execution": "任务执行",
    "end": "结果生成",
}

_PLANNING_PHASE_TITLE = "任务生成"

_HEARTBEAT_INTERVAL: float = 3.0

_LOG_COMMAND_CONTENT_MAX_CHARS: int = 4000


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
        return "{0}...<truncated total_chars={1}".format(value[:max_chars], len(value))
    if isinstance(value, list):
        return [_truncate_for_command_log(item, max_chars) for item in value]
    if isinstance(value, dict):
        return {k: _truncate_for_command_log(v, max_chars) for k, v in value.items()}
    return value


def _json_line_for_console(obj: Any) -> str:
    """Serialize to one line using ASCII escapes (Windows GBK consoles cannot print some Unicode)."""

    try:
        return json.dumps(obj, ensure_ascii=True, default=str, separators=(",", ":"))
    except (TypeError, ValueError):
        return json.dumps(str(obj), ensure_ascii=True)


def _command_question_for_log(command: GatewayCommand) -> str:
    """Return body ``content`` (user question) as a log-safe string, matching AskAgent JSON ``body.content``."""

    raw = getattr(command, "content", None)
    if raw is None:
        return '""'
    if isinstance(raw, str):
        clipped = (
            raw
            if len(raw) <= _LOG_COMMAND_CONTENT_MAX_CHARS
            else "{0}...<truncated total_chars={1}>".format(
                raw[:_LOG_COMMAND_CONTENT_MAX_CHARS],
                len(raw),
            )
        )
        return json.dumps(clipped, ensure_ascii=True)
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


def _dict_to_paradigm_answer(raw: Any) -> Any:
    """将前端 paradigm dict 转为 ParadigmAnswer；str 时原样返回。

    期望输入：{"paradigmList": [{"paradigmList": [{"choiceKeyword": ..., "recall": ...}]}]}
    """
    from datacloud_analysis.ontology_agent import (  # noqa: PLC0415
        ParadigmAnswer,
        ParadigmGroupSelection,
        ParadigmOption,
    )

    if isinstance(raw, str):
        return raw
    if not isinstance(raw, dict):
        return str(raw) if raw is not None else ""

    outer = list(raw.get("paradigmList") or [])
    items: list[dict[str, Any]] = []
    if outer and isinstance(outer[0], dict):
        items = list(outer[0].get("paradigmList") or [])

    options = [
        ParadigmOption(
            choice_keyword=str(item.get("choiceKeyword") or ""),
            recall=str(item.get("recall") or ""),
        )
        for item in items
        if isinstance(item, dict)
    ]
    return ParadigmAnswer(
        selections=[
            ParadigmGroupSelection(
                paradigm_id="",
                paradigm_name="",
                chosen_options=options,
            )
        ]
    )


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
) -> dict[str, Any]:
    """消费 OntologyAgent 事件流，翻译为 Gateway SSE。"""
    from datacloud_analysis.ontology_agent import (  # noqa: PLC0415
        AnswerEvent,
        ErrorEvent,
        InterruptEvent,
        StepEvent,
        ThinkingEvent,
    )

    interrupt_ev: Any = None

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
                await context.emit_chunk(
                    StreamChunkEvent(content=event.content),
                    event_type=EventType.ANSWER_DELTA.value,
                    content_type=SseMessageType.text.value,
                )
            await context.flush_to_history()
            await context.emit_chunk(
                StreamChunkEvent(
                    content="回答完成",
                    metadata={"relatedResources": _related_resources_from_reco_task(reco_task)},
                ),
                event_type=EventType.APP_STREAM_RESPONSE.value,
                content_type=SseMessageType.text.value,
            )
            return {"status": "done"}
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

    # 先推送"回答完成"信号
    await context.emit_chunk(
        StreamChunkEvent(
            content="回答完成",
            metadata={"relatedResources": _related_resources_from_reco_task(reco_task)},
        ),
        event_type=EventType.APP_STREAM_RESPONSE.value,
        content_type=SseMessageType.text.value,
    )

    if interrupt_ev.reason == "AGENT_DELEGATE_WAIT":
        logger.info(
            "_consume_agent_events: delegate wait interrupt thread_id=%s",
            interrupt_ev.thread_id,
        )
        return {"status": "waiting"}

    if interrupt_ev.reason == "PARADIGM_CLARIFICATION":
        paradigm_list: list[dict[str, Any]] = []
        for group in interrupt_ev.paradigm_list or []:
            paradigm_list.append(
                {
                    "paradigmId": group.paradigm_id,
                    "paradigmName": group.paradigm_name,
                    "paradigmResult": [
                        {"choiceKeyword": opt.choice_keyword, "recall": opt.recall}
                        for opt in group.options
                    ],
                }
            )
        await context.complex_ask_user(
            AskUserEvent(
                prompt=interrupt_ev.prompt,
                metadata={
                    "thread_id": interrupt_ev.thread_id,
                    "interrupt_reason": interrupt_ev.reason,
                    "paradigmList": paradigm_list,
                },
            )
        )
    else:
        await context.ask_user(
            AskUserEvent(
                prompt=interrupt_ev.prompt,
                metadata={
                    "thread_id": interrupt_ev.thread_id,
                    "interrupt_reason": interrupt_ev.reason,
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
        return hashlib.sha1(raw.encode("utf-8")).hexdigest()

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

    async def start_heartbeat(self) -> None:
        setup_logging(extra_namespaces=("byclaw_data",))
        await super().start_heartbeat()

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
            from datacloud_analysis.ontology_agent import OntologyAgent, OntologyAgentConfig  # noqa: PLC0415

            self._ontology_agent = OntologyAgent(
                OntologyAgentConfig(
                    api_key=self.api_key or "",
                    model=self.model_name or "",
                    base_url=self.base_url,
                    resource_path=self._resource_path,
                )
            )
            logger.info(
                "DataCloudWorker: OntologyAgent initialized resource_path=%s", self._resource_path
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
            "DataCloudWorker.process_command: session=%s command=%s",
            context.session_id,
            type(command).__name__,
        )
        # 处理模型环境变量，从redis获取
        from byclaw_data.model_environment import (
            build_embedding_config,
            build_llm_config,
        )

        build_llm_config(None)
        build_embedding_config(None)

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

        # ── 动态 Agent 路径检测 ─────────────────────────────────────────────
        # header_metadata 中存在非空 object_ids 或 view_ids 时进入动态路径，
        # 跳过 AgentConfig 查找，直接以这些资源码组装 mounted_objects 构建 graph。
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
            ensure_ascii=True,
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
        # 但后端图已 interrupt 等待 resume。将其转换为 Command(resume=...)，
        # 并复用 ResumeCommand 的幂等去重、inflight dedup 与 checkpoint 注入路径。
        _paradigm_resume_value: Any = None
        _paradigm_human_input_metadata: dict[str, Any] = {}
        if isinstance(command, AskAgentCommand) and isinstance(ext_params, dict):
            _human_input = ext_params.get("humanInput")
            if isinstance(_human_input, dict) and isinstance(
                _human_input.get("paradigmList"), list
            ):
                _paradigm_resume_value = _human_input
                # humanInput.metadata 由前端从 SSE 事件 metadata 中透传，
                # 包含 checkpoint_id / checkpoint_ns / thread_id，
                # 供 _resolve_resume_checkpoint_target 使用。
                _paradigm_human_input_metadata = (
                    _human_input.get("metadata")
                    if isinstance(_human_input.get("metadata"), dict)
                    else {}
                )
                logger.info(
                    "AskAgentCommand carries paradigm reply, converting to graph resume: "
                    "session=%s paradigmList_len=%d checkpoint_id=%s",
                    context.session_id,
                    len(_human_input["paradigmList"]),
                    _paradigm_human_input_metadata.get("checkpoint_id", ""),
                )

        resume_cache_key: str | None = None
        if isinstance(command, ResumeCommand) or _paradigm_resume_value is not None:
            if isinstance(command, ResumeCommand):
                resume_value_probe = (
                    command.reply_data
                    if command.reply_data is not None
                    else command.content
                )
            else:
                resume_value_probe = _paradigm_resume_value
            # paradigm resume：checkpoint_id 在 humanInput.metadata 而非请求头，需合并后解析
            _probe_metadata = (
                {**_paradigm_human_input_metadata, **header_metadata}
                if _paradigm_resume_value is not None
                else header_metadata
            )
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
                return dict(cached)

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
                return {"status": "done"}

        if isinstance(command, AskAgentCommand) and _paradigm_resume_value is None:
            # 推送初始思考内容（不再包裹"问题理解"标题）
            _init_msg_id = context.generate_message_id()
            await context.emit_chunk(
                StreamChunkEvent(content="已接收到用户消息，开始处理"),
                event_type=EventType.REASONING_LOG_START.value,
                content_type=SseReasonMessageType.think_text.value,
                message_id=_init_msg_id,
            )
            context._knowledge_enhance_node_id = _init_msg_id
            user_text = _latest_user_text_from_content(command.content)
            if _is_light_chitchat(user_text):
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
                return {"status": "done"}
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
            if not dyn_thread_id:
                dyn_thread_id = self._build_thread_id(
                    session_id=context.session_id,
                    agent_key=runtime_agent_key,
                )

            assert self._ontology_agent is not None, (  # noqa: S101
                "OntologyAgent not initialized; ensure start_heartbeat() completed"
            )

            if isinstance(command, ResumeCommand) or _paradigm_resume_value is not None:
                raw_paradigm = (
                    _paradigm_resume_value
                    if _paradigm_resume_value is not None
                    else (
                        command.reply_data
                        if isinstance(command, ResumeCommand) and command.reply_data is not None
                        else command.content  # type: ignore[union-attr]
                    )
                )
                resume_input = _dict_to_paradigm_answer(raw_paradigm)
                event_iter = self._ontology_agent.resume(
                    dyn_thread_id,
                    resume_input,
                    view_codes=_dyn_view_ids,
                    object_codes=_dyn_object_ids,
                )
            else:
                latest_user_text_dyn = _latest_user_text_from_content(command.content)
                event_iter = self._ontology_agent.ask(
                    question=latest_user_text_dyn,
                    view_codes=_dyn_view_ids,
                    object_codes=_dyn_object_ids,
                    thread_id=dyn_thread_id,
                    user_code=_get_gateway_user_code(context),
                )

            dynamic_result = await _consume_agent_events(event_iter, context, reco_task=None)
            if resume_cache_key is not None:
                self._cache_resume_result(resume_cache_key, dynamic_result)
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
                raise RuntimeError(
                    "Agent config not found for request: "
                    f"agent_id={by_agent_id or ''} runtime_agent_key={runtime_agent_key or ''} "
                    f"available_agent_ids={available_ids}"
                )
            logger.info(
                "Agent config match result: by_agent_id=%s matched=%s agent_id=%s",
                by_agent_id,
                bool(config_for_this_call),
                getattr(config_for_this_call, "agent_id", None),
            )

            prompts_dict = getattr(config_for_this_call, "prompts", None) or {}
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
                f"{by_agent_id}:{conf_hash}" if by_agent_id else f"default:{conf_hash}"
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
            }
        }
        context._langgraph_thread_id = thread_id

        if isinstance(command, ResumeCommand):
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
        elif _paradigm_resume_value is not None:
            # AskAgentCommand 携带 paradigm 回复：转为图恢复，不重新执行
            graph_input = Command(resume=_paradigm_resume_value)
        else:
            latest_user_text = _latest_user_text_from_content(command.content)
            history_messages = await _load_recent_history_messages(
                context=context,
                limit=_history_inject_limit(),
                current_user_text=latest_user_text,
            )
            input_messages = _normalize_messages(command.content)
            # content 为 [] 或无法解析时，避免只有历史且最后一条为 assistant → intend 误用 AIMessage
            if not input_messages and latest_user_text:
                input_messages = [HumanMessage(content=latest_user_text)]
            combined_messages = history_messages + input_messages
            graph_input = {
                "messages": combined_messages,
                "query_received_at": _now_monotonic(),
            }

        if isinstance(command, ResumeCommand) or _paradigm_resume_value is not None:
            # paradigm resume：checkpoint_id 在 humanInput.metadata 而非请求头，需合并后解析
            md = (
                {**_paradigm_human_input_metadata, **header_metadata}
                if _paradigm_resume_value is not None
                else header_metadata
            )
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
                return dict(inflight_result)
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
                    rq = _latest_user_text_from_content(command.content).strip()
                    if rq:
                        reco_task = asyncio.create_task(gen_fn(rq))

        # if _is_dynamic_agent:
        #     # 动态路径：抑制 ANSWER_DELTA 推送（由调用方接收 return 值），
        #     # 思考过程（REASONING_LOG_DELTA）照常 emit 供前端展示。
        #     _answer_parts: list[str] = []
        #     _orig_emit = context.emit_chunk

        #     async def _suppress_answer_emit(
        #         chunk: Any, *, event_type: str | None = None, **kw: Any
        #     ) -> None:
        #         if event_type == EventType.ANSWER_DELTA.value:
        #             _c = getattr(chunk, "content", "") or ""
        #             if isinstance(_c, str):
        #                 _answer_parts.append(_c)
        #             return
        #         await _orig_emit(chunk, event_type=event_type, **kw)

        #     context.emit_chunk = _suppress_answer_emit  # type: ignore[method-assign]
        #     try:
        #         async for _ in target_graph.astream_events(
        #             graph_input, config=config, version="v2"
        #         ):
        #             pass
        #     finally:
        #         context.emit_chunk = _orig_emit

        #     # 始终获取 snapshot，用于中断检测和 fallback answer 提取
        #     _snap_cfg: dict[str, Any] = {
        #         "configurable": {**config.get("configurable", {})}
        #     }
        #     _snap_cfg["configurable"].pop("checkpoint_id", None)
        #     _snapshot = await target_graph.aget_state(_snap_cfg)

        #     # 中断处理：与 _stream_graph 保持一致
        #     if _snapshot is not None and _snapshot.interrupts:
        #         _first = _snapshot.interrupts[0]
        #         _interrupt_value = _first.value
        #         _interrupt_reason = "unknown_interrupt"
        #         if isinstance(_interrupt_value, dict):
        #             _prompt = _interrupt_value.get("prompt", str(_interrupt_value))
        #             _interrupt_reason = str(
        #                 _interrupt_value.get("reason_code")
        #                 or _interrupt_value.get("interrupt_reason")
        #                 or "interrupt"
        #             )
        #         else:
        #             _prompt = str(_interrupt_value) if _interrupt_value else "请补充您的回答。"
        #             if _prompt:
        #                 _interrupt_reason = "prompt_interrupt"

        #         _ckpt_id = _snapshot.config.get("configurable", {}).get("checkpoint_id", "")
        #         _ckpt_ns = _snapshot.config.get("configurable", {}).get("checkpoint_ns", "")
        #         _snap_vals: dict[str, Any] = (
        #             _snapshot.values if isinstance(_snapshot.values, dict) else {}
        #         )
        #         _todo_active_id = str(_snap_vals.get("todo_active_id") or "")
        #         _active_tools = _snap_vals.get("active_tools")
        #         _pending_cap = ""
        #         if isinstance(_active_tools, list) and _active_tools:
        #             _pending_cap = str(_active_tools[0] or "")
        #         if not _pending_cap:
        #             _pending_cap = str(_snap_vals.get("target_tool") or "")

        #         logger.info(
        #             "DataCloudWorker: dynamic agent interrupted session=%s "
        #             "checkpoint_id=%s prompt=%r",
        #             context.session_id,
        #             _ckpt_id,
        #             _prompt,
        #         )
        #         if _interrupt_reason == "AGENT_DELEGATE_WAIT":
        #             return {"status": "waiting"}

        #         _paradigm_list: list[Any] = []
        #         _clarify_knowledge = ""
        #         _clarify_query = ""
        #         if isinstance(_interrupt_value, dict):
        #             if isinstance(_interrupt_value.get("ask_user_payload"), dict):
        #                 _aup: dict[str, Any] = _interrupt_value["ask_user_payload"]
        #                 _paradigm_list = _aup.get("paradigmList", [])
        #                 _clarify_query = str(_aup.get("query") or "")
        #             _clarify_knowledge = str(
        #                 _interrupt_value.get("_clarify_knowledge") or ""
        #             )

        #         _int_meta: dict[str, Any] = {
        #             "thread_id": config["configurable"]["thread_id"],
        #             "checkpoint_id": _ckpt_id,
        #             "checkpoint_ns": _ckpt_ns,
        #             "agent_id": by_agent_id or "",
        #             "conf_hash": conf_hash,
        #             "todo_active_id": _todo_active_id,
        #             "react_step_id": _todo_active_id,
        #             "pending_capability": _pending_cap,
        #             "interrupt_reason": _interrupt_reason,
        #         }
        #         if _paradigm_list:
        #             await context.complex_ask_user(
        #                 AskUserEvent(
        #                     prompt=_prompt,
        #                     metadata={
        #                         **_int_meta,
        #                         "paradigmList": _paradigm_list,
        #                         "query": _clarify_query,
        #                         "clarify_knowledge": _clarify_knowledge,
        #                     },
        #                 )
        #             )
        #         else:
        #             if isinstance(_interrupt_value, dict) and isinstance(
        #                 _interrupt_value.get("ask_user_payload"), dict
        #             ):
        #                 _int_meta["ask_user_payload"] = _interrupt_value["ask_user_payload"]
        #             await context.ask_user(
        #                 AskUserEvent(prompt=_prompt, metadata=_int_meta)
        #             )
        #         await context.emit_chunk(
        #             StreamChunkEvent(
        #                 content="回答完成",
        #                 metadata={
        #                     "relatedResources": _related_resources_from_reco_task(reco_task),
        #                 },
        #             ),
        #             event_type=EventType.APP_STREAM_RESPONSE.value,
        #             content_type=SseMessageType.text.value,
        #         )
        #         return {"status": "waiting"}

        #     # 优先用流式收集的完整内容（包含 formatter 生成的表格等附加部分）；
        #     # react_final["answer"] 仅含 finish_react 工具参数，不含后续格式化追加内容。
        #     if _answer_parts:
        #         _final_answer = "".join(_answer_parts).strip()
        #     else:
        #         _final_answer = ""
        #         if _snapshot and _snapshot.values:
        #             _rf: dict[str, Any] = _snapshot.values.get("react_final") or {}
        #             _final_answer = str(_rf.get("answer") or "").strip()
        #     logger.info(
        #         "DataCloudWorker: dynamic agent done session=%s answer_len=%d",
        #         context.session_id,
        #         len(_final_answer),
        #     )
        #     return _final_answer

        try:
            logger.info(
                "_stream_graph invoke session=%s input_is_command_resume=%s",
                context.session_id,
                isinstance(graph_input, Command),
            )
            stream_result = await self._stream_graph(
                target_graph=target_graph,
                graph_input=graph_input,
                config=config,
                context=context,
                by_agent_id=by_agent_id or "",
                conf_hash=conf_hash,
                reco_task=reco_task,
                is_paradigm_resume=(_paradigm_resume_value is not None),
            )
            if isinstance(command, ResumeCommand) and resume_cache_key:
                self._cache_resume_result(resume_cache_key, stream_result)
            if (
                resume_inflight_owner
                and resume_inflight_future is not None
                and not resume_inflight_future.done()
            ):
                resume_inflight_future.set_result(dict(stream_result))
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
    ) -> dict:
        """Drive the graph stream and handle interrupt/done branches."""
        is_agent_delegate = False
        stream_event_count = 0
        phase_emitted: set[str] = set()
        last_emit_time_ref: list[float] = [_now_monotonic()]
        heartbeat_stop = asyncio.Event()
        heartbeat_task = asyncio.create_task(
            _heartbeat_loop(context, heartbeat_stop, last_emit_time_ref)
        )
        # paradigm resume 时，把标志注入 config，供 execution_node 读取
        if is_paradigm_resume:
            config.setdefault("configurable", {})["_is_paradigm_resume"] = True

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

                if kind == "on_chat_model_end":
                    node_name = str(
                        (event.get("metadata") or {}).get("langgraph_node") or ""
                    )
                    if (
                        node_name == "planning"
                        and _PLANNING_PHASE_TITLE not in phase_emitted
                    ):
                        phase_emitted.add(_PLANNING_PHASE_TITLE)
                        async with context.sub_step(_PLANNING_PHASE_TITLE):
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
                        if _NODE_PHASE_TITLE["end"] not in phase_emitted:
                            phase_emitted.add(_NODE_PHASE_TITLE["end"])
                            await context.emit_chunk(
                                StreamChunkEvent(content=_NODE_THINKING_DESC["end"]),
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

                if paradigm_list:
                    await context.complex_ask_user(
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
                                "paradigmList": paradigm_list,
                                "query": clarify_query,
                                "clarify_knowledge": clarify_knowledge,
                            },
                        )
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
            if snapshot and snapshot.values:
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
            return {"status": "done", "conclusion": final_message or ""}
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


# ------------------------------------------------------------------

# ------------------------------------------------------------------


def _normalize_messages(
    content: Any,
) -> list[HumanMessage | AIMessage | SystemMessage]:
    """Convert gateway command content to a list of LangChain BaseMessage.

    Supports:
    """
    if isinstance(content, str):
        return [HumanMessage(content=content)]

    if not isinstance(content, list):
        return [HumanMessage(content=str(content))]

    messages: list[HumanMessage | AIMessage | SystemMessage] = []
    for item in content:
        if isinstance(item, dict) and "role" in item:
            role = item["role"]
            text = item.get("content", "")
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

    history_messages: list[HumanMessage | AIMessage | SystemMessage] = []
    for item in raw_history:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip().lower()
        content = str(item.get("content") or "").strip()
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


def _latest_user_text_from_content(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if not isinstance(content, list) or not content:
        return str(content).strip() if content is not None else ""
    last = content[-1]
    if isinstance(last, dict):
        raw = last.get("content", "")
        return raw.strip() if isinstance(raw, str) else str(raw).strip()
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
