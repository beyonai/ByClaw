"""T5: worker.py 动态路径 OntologyAgent 重构单元测试（先红后绿）。

验收范围：
- PART 1: 源码结构检查（静态断言，验证骨架已存在）
- PART 2: _dict_to_paradigm_answer 纯函数单元测试
- PART 3: _consume_agent_events 行为单元测试
- PART 4: process_command 动态路径使用 OntologyAgent
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

_WORKER_PY = (
    Path(__file__).resolve().parent.parent / "src" / "byclaw_data" / "worker.py"
)


def _src() -> str:
    return _WORKER_PY.read_text(encoding="utf-8")


# ===========================================================================
# PART 1 — 源码结构检查
# ===========================================================================


def test_t5_src_resource_path_attr() -> None:
    """`_resource_path` 属性在 __init__ 中声明，读取 DATACLOUD_ONTOLOGY_PATH 环境变量。"""
    src = _src()
    assert "_resource_path" in src
    assert "DATACLOUD_ONTOLOGY_PATH" in src


def test_t5_src_ontology_agent_attr() -> None:
    """`_ontology_agent` 属性在 __init__ 中声明。"""
    assert "_ontology_agent" in _src()


def test_t5_src_dict_to_paradigm_answer_exists() -> None:
    """`_dict_to_paradigm_answer` 模块级函数已定义。"""
    assert "def _dict_to_paradigm_answer" in _src()


def test_t5_src_get_gateway_user_code_exists() -> None:
    """`_get_gateway_user_code` 模块级函数已定义。"""
    assert "def _get_gateway_user_code" in _src()


def test_t5_src_consume_agent_events_exists() -> None:
    """`_consume_agent_events` 模块级函数已定义（async）。"""
    src = _src()
    assert (
        "async def _consume_agent_events" in src or "def _consume_agent_events" in src
    )


def test_t5_src_dynamic_path_uses_ontology_agent() -> None:
    """动态路径中调用 `_ontology_agent.ask` 或 `.resume`。"""
    src = _src()
    assert "_ontology_agent.ask" in src or "_ontology_agent.resume" in src


# ── 方案 A 红测试：动态路径透传 result_file_storage 与 gateway_context ───────


def test_dynamic_path_passes_result_file_storage_to_ontology_agent_config() -> None:
    """创建 OntologyAgentConfig 时必须注入 result_file_storage。"""
    src = _src()
    assert "result_file_storage=" in src
    assert "build_result_file_storage" in src


def _slice_after(src: str, marker: str, span: int = 800) -> str:
    """Return up to ``span`` chars starting at ``marker`` (empty if not found)."""
    idx = src.find(marker)
    return "" if idx < 0 else src[idx : idx + span]


def test_dynamic_path_ask_passes_session_id() -> None:
    """worker.py 调用 `_ontology_agent.ask(` 时必须传 `session_id=context.session_id`。

    解耦原则:不向 datacloud-analysis 公开 API 传 `gateway_context`,
    只传 datacloud 自己的具体字段(user_code 已有,session_id 新增)。
    """
    src = _src()
    block = _slice_after(src, "_ontology_agent.ask(")
    assert block, "_ontology_agent.ask( 调用未找到"
    assert "session_id=context.session_id" in block
    assert "gateway_context=" not in block, (
        "动态分支不应在 ask() 上传 gateway_context(违反 by-datacloud 解耦)"
    )


def test_dynamic_path_resume_passes_session_id() -> None:
    """worker.py 调用 `_ontology_agent.resume(` 时也必须传 `session_id=context.session_id`。"""
    src = _src()
    block = _slice_after(src, "_ontology_agent.resume(")
    assert block, "_ontology_agent.resume( 调用未找到"
    assert "session_id=context.session_id" in block
    assert "gateway_context=" not in block, (
        "动态分支不应在 resume() 上传 gateway_context(违反 by-datacloud 解耦)"
    )


# ===========================================================================
# PART 2 — _dict_to_paradigm_answer 单元测试
# ===========================================================================


def _import_dict_to_paradigm_answer() -> Any:
    from byclaw_data.worker import _dict_to_paradigm_answer  # type: ignore[attr-defined]

    return _dict_to_paradigm_answer


def test_t5_dict_to_paradigm_answer_str_passthrough() -> None:
    """`_dict_to_paradigm_answer` 收到 str 时原样返回。"""
    fn = _import_dict_to_paradigm_answer()
    result = fn("用户文本回复")
    assert result == "用户文本回复"


def test_t5_dict_to_paradigm_answer_dict_returns_paradigm_answer() -> None:
    """`_dict_to_paradigm_answer` 收到 paradigm dict 时返回 ParadigmAnswer。"""
    from datacloud_analysis.ontology_agent import ParadigmAnswer  # noqa: PLC0415

    fn = _import_dict_to_paradigm_answer()
    raw = {
        "paradigmList": [
            {
                "paradigmList": [
                    {"choiceKeyword": "华东", "recall": "east_china"},
                ]
            }
        ]
    }
    result = fn(raw)
    assert isinstance(result, ParadigmAnswer)


def test_t5_dict_to_paradigm_answer_options_mapped() -> None:
    """ParadigmAnswer 中的 chosen_options 与输入 choiceKeyword/recall 一致。"""
    fn = _import_dict_to_paradigm_answer()
    raw = {
        "paradigmList": [
            {
                "paradigmList": [
                    {"choiceKeyword": "华东", "recall": "east_china"},
                    {"choiceKeyword": "华南", "recall": "south_china"},
                ]
            }
        ]
    }
    result = fn(raw)
    options = result.selections[0].chosen_options  # type: ignore[union-attr]
    assert len(options) == 2
    assert options[0].choice_keyword == "华东"
    assert options[0].recall == ["east_china"]


def test_t5_dict_to_paradigm_answer_empty_paradigm_list() -> None:
    """空 paradigmList 不抛异常，返回空 ParadigmAnswer。"""
    from datacloud_analysis.ontology_agent import ParadigmAnswer  # noqa: PLC0415

    fn = _import_dict_to_paradigm_answer()
    result = fn({"paradigmList": []})
    assert isinstance(result, ParadigmAnswer)


# ===========================================================================
# PART 3 — _consume_agent_events 单元测试
# ===========================================================================


def _import_consume_agent_events() -> Any:
    from byclaw_data.worker import _consume_agent_events  # type: ignore[attr-defined]

    return _consume_agent_events


def _make_ctx() -> Any:
    ctx = MagicMock()
    ctx.session_id = "sess_test"
    ctx.emit_chunk = AsyncMock()
    ctx.flush_to_history = AsyncMock()
    ctx.ask_user = AsyncMock()
    ctx.complex_ask_user = AsyncMock()
    return ctx


async def _async_gen(*events: Any):  # type: ignore[no-untyped-def]
    """辅助：将普通列表包装为 AsyncGenerator。"""
    for e in events:
        yield e


@pytest.mark.asyncio
async def test_t5_consume_thinking_event_emits_reasoning_log() -> None:
    """ThinkingEvent → REASONING_LOG_START emit_chunk 调用。"""
    from by_framework import EventType  # noqa: PLC0415
    from datacloud_analysis.ontology_agent import ThinkingEvent  # noqa: PLC0415

    fn = _import_consume_agent_events()
    ctx = _make_ctx()

    async def _gen():  # type: ignore[no-untyped-def]
        yield ThinkingEvent(content="思考中...")
        from datacloud_analysis.ontology_agent import AnswerEvent  # noqa: PLC0415

        yield AnswerEvent(content="答案")

    await fn(_gen(), ctx, reco_task=None)

    calls = ctx.emit_chunk.call_args_list
    reasoning_calls = [
        c
        for c in calls
        if c.kwargs.get("event_type") == EventType.REASONING_LOG_START.value
    ]
    assert len(reasoning_calls) >= 1


@pytest.mark.asyncio
async def test_t5_consume_step_event_emits_reasoning_log() -> None:
    """StepEvent → REASONING_LOG_START emit_chunk 调用。"""
    from by_framework import EventType  # noqa: PLC0415
    from datacloud_analysis.ontology_agent import AnswerEvent, StepEvent  # noqa: PLC0415

    fn = _import_consume_agent_events()
    ctx = _make_ctx()

    async def _gen():  # type: ignore[no-untyped-def]
        yield StepEvent(title="任务执行")
        yield AnswerEvent(content="答案")

    await fn(_gen(), ctx, reco_task=None)

    calls = ctx.emit_chunk.call_args_list
    reasoning_calls = [
        c
        for c in calls
        if c.kwargs.get("event_type") == EventType.REASONING_LOG_START.value
    ]
    assert len(reasoning_calls) >= 1


@pytest.mark.asyncio
async def test_t5_consume_answer_event_returns_done() -> None:
    """AnswerEvent → flush_to_history 调用 + 返回 {'status': 'done'}。"""
    from datacloud_analysis.ontology_agent import AnswerEvent  # noqa: PLC0415

    fn = _import_consume_agent_events()
    ctx = _make_ctx()

    async def _gen():  # type: ignore[no-untyped-def]
        yield AnswerEvent(content="最终答案")

    result = await fn(_gen(), ctx, reco_task=None)

    assert result.get("status") == "done"
    ctx.flush_to_history.assert_awaited_once()


@pytest.mark.asyncio
async def test_t5_consume_paradigm_interrupt_returns_waiting() -> None:
    """InterruptEvent(PARADIGM_CLARIFICATION) → complex_ask_user + {'status': 'waiting'}。"""
    from datacloud_analysis.ontology_agent import (
        InterruptEvent,
        ParadigmGroup,
        ParadigmOption,
    )  # noqa: PLC0415

    fn = _import_consume_agent_events()
    ctx = _make_ctx()

    async def _gen():  # type: ignore[no-untyped-def]
        yield InterruptEvent(
            thread_id="tid_001",
            reason="PARADIGM_CLARIFICATION",
            prompt="请选择维度",
            paradigm_list=[
                ParadigmGroup(
                    paradigm_id="pg1",
                    paradigm_name="区域",
                    options=[ParadigmOption(choice_keyword="华东", recall="east")],
                )
            ],
        )

    result = await fn(_gen(), ctx, reco_task=None)

    assert result.get("status") == "waiting"
    ctx.complex_ask_user.assert_awaited_once()


@pytest.mark.asyncio
async def test_t5_consume_other_interrupt_returns_waiting() -> None:
    """InterruptEvent(其他 reason) → ask_user + {'status': 'waiting'}。"""
    from datacloud_analysis.ontology_agent import InterruptEvent  # noqa: PLC0415

    fn = _import_consume_agent_events()
    ctx = _make_ctx()

    async def _gen():  # type: ignore[no-untyped-def]
        yield InterruptEvent(
            thread_id="tid_001",
            reason="ASK_USER",
            prompt="请补充信息",
            paradigm_list=None,
        )

    result = await fn(_gen(), ctx, reco_task=None)

    assert result.get("status") == "waiting"
    ctx.ask_user.assert_awaited_once()


@pytest.mark.asyncio
async def test_t5_consume_error_event_returns_done() -> None:
    """ErrorEvent → emit + 返回 {'status': 'done'}，不抛异常。"""
    from datacloud_analysis.ontology_agent import ErrorEvent  # noqa: PLC0415

    fn = _import_consume_agent_events()
    ctx = _make_ctx()

    async def _gen():  # type: ignore[no-untyped-def]
        yield ErrorEvent(message="图执行失败")

    result = await fn(_gen(), ctx, reco_task=None)

    assert result.get("status") == "done"
    ctx.emit_chunk.assert_awaited()


# ===========================================================================
# PART 4 — process_command 动态路径使用 OntologyAgent
# ===========================================================================


def _make_worker_bare_t5() -> Any:
    """裸 DataCloudWorker 实例（含 T5 新属性）。"""
    import asyncio  # noqa: PLC0415
    from collections import OrderedDict  # noqa: PLC0415

    from byclaw_data.worker import DataCloudWorker  # noqa: PLC0415

    w = DataCloudWorker.__new__(DataCloudWorker)
    w.model_name = None
    w.api_key = None
    w.base_url = None
    w.graphs = OrderedDict()
    w._resume_result_cache = OrderedDict()
    w._resume_inflight = {}
    w._shared_loader = None
    w.command_plugin_manager = MagicMock()
    w.worker_id = "test_worker"
    w._resource_path = "/fake/resource"
    w._ontology_agent = None
    w._model_config_sig = ""
    w._ontology_agent_lock = asyncio.Lock()

    registry = MagicMock()
    registry.agent_configs = []
    w.plugin_registry = registry
    return w


def _make_ask_command_t5(
    call_view_ids: list[str] | None = None,
    call_object_ids: list[str] | None = None,
    content: str = "查询各部门销售额",
) -> Any:
    """正确使用 extra_payload 的 AskAgentCommand stub。"""
    from by_framework.core.protocol.commands import AskAgentCommand  # noqa: PLC0415

    cmd = MagicMock()
    cmd.__class__ = AskAgentCommand
    cmd.extra_payload = {
        "call_view_ids": call_view_ids or [],
        "call_object_ids": call_object_ids or [],
    }
    cmd.content = content
    header = MagicMock()
    header.metadata = {}
    header.trace_id = ""
    header.target_agent_type = ""
    cmd.header = header
    return cmd


def _make_context_t5(session_id: str = "sess_t5") -> Any:
    ctx = MagicMock()
    ctx.session_id = session_id
    ctx.generate_message_id = MagicMock(return_value="msg_001")
    ctx.emit_chunk = AsyncMock()
    ctx.flush_to_history = AsyncMock()
    ctx.check_cancelled = AsyncMock()
    ctx._knowledge_enhance_node_id = ""
    ctx.list_agent_configs = MagicMock(return_value=[])
    ctx.set_agent_configs = MagicMock()
    ctx.agent_runtime_state = MagicMock()
    return ctx


def _patch_external() -> list[Any]:
    import unittest.mock as m  # noqa: PLC0415

    return [
        m.patch("byclaw_data.model_environment.build_llm_config", return_value={}),
        m.patch(
            "byclaw_data.model_environment.build_embedding_config", return_value={}
        ),
        m.patch("by_framework.worker.sandbox.hook_sandbox.active_workspace"),
        m.patch(
            "byclaw_data.worker._load_recent_history_messages",
            new=AsyncMock(return_value=[]),
        ),
    ]


@pytest.mark.asyncio
async def test_t5_dynamic_path_calls_ontology_agent_ask() -> None:
    """动态路径（call_view_ids 非空）调用 _ontology_agent.ask()，不调用 _build_graph。"""
    import contextlib  # noqa: PLC0415

    from datacloud_analysis.ontology_agent import AnswerEvent  # noqa: PLC0415

    worker = _make_worker_bare_t5()
    worker.command_plugin_manager.handle_ext_command = AsyncMock(
        return_value=(False, None)
    )
    worker._build_graph = MagicMock()

    mock_agent = MagicMock()

    async def _fake_ask(**kwargs: Any):  # type: ignore[no-untyped-def]
        yield AnswerEvent(content="答案")

    mock_agent.ask = MagicMock(side_effect=_fake_ask)
    worker._ontology_agent = mock_agent

    cmd = _make_ask_command_t5(call_view_ids=["scene_sales"])
    ctx = _make_context_t5()

    with contextlib.ExitStack() as stack:
        for p in _patch_external():
            stack.enter_context(p)
        result = await worker.process_command(cmd, ctx)

    mock_agent.ask.assert_called_once()
    worker._build_graph.assert_not_called()
    # 动态路径将 "done" 转换为 "COMPLETED" 返回给框架层（触发 stream_end 信号）
    assert result.get("status") in {"done", "COMPLETED"}


@pytest.mark.asyncio
async def test_t5_dynamic_path_no_reco_task() -> None:
    """动态路径（call_object_ids 非空）不触发推荐问题插件。"""
    import contextlib  # noqa: PLC0415

    from datacloud_analysis.ontology_agent import AnswerEvent  # noqa: PLC0415

    worker = _make_worker_bare_t5()
    worker.command_plugin_manager.handle_ext_command = AsyncMock(
        return_value=(False, None)
    )

    mock_agent = MagicMock()

    async def _fake_ask(**kwargs: Any):  # type: ignore[no-untyped-def]
        yield AnswerEvent(content="答案")

    mock_agent.ask = MagicMock(side_effect=_fake_ask)
    worker._ontology_agent = mock_agent

    reco_plugin = MagicMock()
    reco_plugin.manifest.enabled = True
    gen_fn = AsyncMock(return_value=["推荐问题1"])
    reco_plugin.generate_recommended_questions = gen_fn
    worker.plugin_registry.get_plugin = MagicMock(
        side_effect=lambda pid: reco_plugin
        if pid == "datacloud_recommended_questions"
        else None
    )

    cmd = _make_ask_command_t5(call_object_ids=["by_order"])
    ctx = _make_context_t5()

    with contextlib.ExitStack() as stack:
        for p in _patch_external():
            stack.enter_context(p)
        await worker.process_command(cmd, ctx)

    gen_fn.assert_not_called()


# ===========================================================================
# PART 2-B — _paradigm_option_to_dict 单元测试（BUGFIX: 过滤字段不丢失）
# ===========================================================================


def _import_paradigm_option_to_dict() -> Any:
    from byclaw_data.worker import _paradigm_option_to_dict  # type: ignore[attr-defined]

    return _paradigm_option_to_dict


class TestParadigmOptionToDict:
    """T-BUGFIX: _paradigm_option_to_dict 序列化包含查询值和过滤条件全部字段。"""

    @staticmethod
    def _make_option(**kwargs: Any) -> Any:
        """构造 ParadigmOption，未指定的字段使用默认值。"""
        from datacloud_analysis.ontology_agent import ParadigmOption  # noqa: PLC0415

        defaults: dict[str, Any] = {
            "choice_keyword": "",
            "recall": [],
            "keyword": "",
            "kid": 0,
            "ktype": "",
            "filter_field": "",
            "comparison": "",
            "value": "",
            "choice_field": "",
            "choice_comparison": "",
            "field_recall": [],
            "comparison_recall": [],
            "value_recall": [],
        }
        defaults.update(kwargs)
        return ParadigmOption(**defaults)

    # ── 查询值 option ──

    def test_query_value_option_outputs_only_query_fields(self) -> None:
        """查询值 option：输出 keyword/kid/ktype/choiceKeyword，不含过滤键。"""
        fn = _import_paradigm_option_to_dict()
        opt = self._make_option(
            choice_keyword="商机名称",
            recall=["商机名称"],
            keyword="opp_name",
            kid=1,
            ktype="select",
        )
        result = fn(opt)
        assert result["choiceKeyword"] == "商机名称"
        assert result["recall"] == ["商机名称"]
        assert result["keyword"] == "opp_name"
        assert result["kid"] == 1
        assert result["ktype"] == "select"
        # 过滤键不应出现（字段为空/默认值）
        assert "field" not in result
        assert "comparison" not in result
        assert "value" not in result
        assert "choiceField" not in result
        assert "choiceComparison" not in result
        assert "fieldRecall" not in result
        assert "comparisonRecall" not in result
        assert "valueRecall" not in result

    def test_query_value_default_fields_still_output(self) -> None:
        """即使 keyword/kid 为默认值，查询基础字段仍输出（前端依赖）。"""
        fn = _import_paradigm_option_to_dict()
        opt = self._make_option()
        result = fn(opt)
        assert result["keyword"] == ""
        assert result["recall"] == []
        assert result["kid"] == 0
        assert result["ktype"] == ""
        assert result["choiceKeyword"] == ""

    # ── 过滤条件 option ──

    def test_filter_option_outputs_all_filter_fields(self) -> None:
        """过滤条件 option：输出 field/comparison/value 及 recall 列表。"""
        fn = _import_paradigm_option_to_dict()
        opt = self._make_option(
            filter_field="sales_user_id",
            comparison="eq",
            value="韦小二",
            choice_field="所属销售用户编码",
            choice_comparison="eq",
            field_recall=["所属销售用户编码"],
            comparison_recall=["eq", "gt", "lt"],
            value_recall=["韦小宝", "韦一笑", "韦小二"],
        )
        result = fn(opt)
        assert result["field"] == "sales_user_id"
        assert result["comparison"] == "eq"
        assert result["value"] == "韦小二"
        assert result["choiceField"] == "所属销售用户编码"
        assert result["choiceComparison"] == "eq"
        assert result["fieldRecall"] == ["所属销售用户编码"]
        assert result["comparisonRecall"] == ["eq", "gt", "lt"]
        assert result["valueRecall"] == ["韦小宝", "韦一笑", "韦小二"]

    def test_filter_option_partial_fields(self) -> None:
        """仅有 filter_field 时，只输出 field/choiceField，不输出空的 comparison/value。"""
        fn = _import_paradigm_option_to_dict()
        opt = self._make_option(
            filter_field="code",
            choice_field="编码",
        )
        result = fn(opt)
        assert result["field"] == "code"
        assert result["choiceField"] == "编码"
        assert "comparison" not in result
        assert "value" not in result
        assert "choiceComparison" not in result

    def test_filter_option_with_empty_recall_lists(self) -> None:
        """空 recall 列表不应出现在输出中。"""
        fn = _import_paradigm_option_to_dict()
        opt = self._make_option(
            filter_field="code",
            choice_field="编码",
            field_recall=[],
            comparison_recall=[],
            value_recall=[],
        )
        result = fn(opt)
        assert "fieldRecall" not in result
        assert "comparisonRecall" not in result
        assert "valueRecall" not in result

    # ── 混合 option（防御性）──

    def test_mixed_option_outputs_both_query_and_filter_fields(self) -> None:
        """同时有 keyword + filter_field 时，两边字段都输出，互不覆盖。"""
        fn = _import_paradigm_option_to_dict()
        opt = self._make_option(
            choice_keyword="商机名称",
            keyword="opp_name",
            kid=1,
            ktype="select",
            filter_field="sales_user_id",
            comparison="eq",
            value="韦小二",
            choice_field="销售用户",
            choice_comparison="eq",
        )
        result = fn(opt)
        # 查询字段
        assert result["choiceKeyword"] == "商机名称"
        assert result["keyword"] == "opp_name"
        # 过滤字段
        assert result["field"] == "sales_user_id"
        assert result["comparison"] == "eq"
        assert result["value"] == "韦小二"


# ===========================================================================
# PART 2-C — _dict_to_paradigm_answer 过滤字段解析测试（BUGFIX: resume 保留 filter）
# ===========================================================================


class TestDictToParadigmAnswerFilterFields:
    """T-BUGFIX: _dict_to_paradigm_answer 从用户回复中提取过滤条件字段。"""

    def test_filter_fields_extracted_from_input(self) -> None:
        """用户回复含 field/comparison/value 时，ParadigmOption 对应字段正确。"""
        fn = _import_dict_to_paradigm_answer()
        raw: dict[str, Any] = {
            "paradigmList": [
                {
                    "paradigmList": [
                        {
                            "field": "sales_user_id",
                            "comparison": "eq",
                            "value": "韦小二",
                            "choiceField": "所属销售用户编码",
                            "choiceComparison": "eq",
                            "fieldRecall": ["所属销售用户编码"],
                            "comparisonRecall": ["eq", "gt"],
                            "valueRecall": ["韦小宝", "韦小二"],
                        }
                    ]
                }
            ]
        }
        result = fn(raw)
        opt = result.selections[0].chosen_options[0]  # type: ignore[union-attr]
        assert opt.filter_field == "sales_user_id"
        assert opt.comparison == "eq"
        assert opt.value == "韦小二"
        assert opt.choice_field == "所属销售用户编码"
        assert opt.choice_comparison == "eq"
        assert opt.field_recall == ["所属销售用户编码"]
        assert opt.comparison_recall == ["eq", "gt"]
        assert opt.value_recall == ["韦小宝", "韦小二"]

    def test_filter_recall_list_not_string(self) -> None:
        """recall 列表输入为 list 时保持 list，不转为字符串。"""
        fn = _import_dict_to_paradigm_answer()
        raw: dict[str, Any] = {
            "paradigmList": [
                {
                    "paradigmList": [
                        {
                            "field": "code",
                            "comparison": "eq",
                            "value": "test",
                            "fieldRecall": ["编码A", "编码B"],
                            "comparisonRecall": ["eq"],
                            "valueRecall": ["值1", "值2"],
                        }
                    ]
                }
            ]
        }
        result = fn(raw)
        opt = result.selections[0].chosen_options[0]  # type: ignore[union-attr]
        assert isinstance(opt.field_recall, list)
        assert opt.field_recall == ["编码A", "编码B"]
        assert isinstance(opt.comparison_recall, list)
        assert isinstance(opt.value_recall, list)

    def test_recall_string_fallback(self) -> None:
        """recall 为字符串时（旧格式），filter 字段回退为空列表。"""
        fn = _import_dict_to_paradigm_answer()
        raw: dict[str, Any] = {
            "paradigmList": [
                {
                    "paradigmList": [
                        {
                            "field": "code",
                            "comparison": "eq",
                            "fieldRecall": "not-a-list",
                            "comparisonRecall": "not-a-list",
                            "valueRecall": "not-a-list",
                        }
                    ]
                }
            ]
        }
        result = fn(raw)
        opt = result.selections[0].chosen_options[0]  # type: ignore[union-attr]
        assert opt.field_recall == []
        assert opt.comparison_recall == []
        assert opt.value_recall == []

    def test_mixed_query_and_filter_items(self) -> None:
        """同一回复中同时有查询值和过滤条件 items，各自字段不串。"""
        fn = _import_dict_to_paradigm_answer()
        raw: dict[str, Any] = {
            "paradigmList": [
                {
                    "paradigmList": [
                        {"choiceKeyword": "商机名称", "recall": ["商机名称"]},
                        {
                            "field": "code",
                            "comparison": "gt",
                            "value": "100",
                            "choiceField": "编码",
                        },
                    ]
                }
            ]
        }
        result = fn(raw)
        opts = result.selections[0].chosen_options  # type: ignore[union-attr]
        assert len(opts) == 2
        # 查询值 item
        assert opts[0].choice_keyword == "商机名称"
        assert opts[0].recall == ["商机名称"]
        assert opts[0].filter_field == ""  # 无过滤字段
        # 过滤 item
        assert opts[1].filter_field == "code"
        assert opts[1].comparison == "gt"
        assert opts[1].value == "100"

    def test_old_format_no_filter_fields_still_works(self) -> None:
        """旧格式（仅有 choiceKeyword/recall）不受影响。"""
        fn = _import_dict_to_paradigm_answer()
        raw: dict[str, Any] = {
            "paradigmList": [
                {
                    "paradigmList": [
                        {"choiceKeyword": "华东", "recall": "east_china"},
                    ]
                }
            ]
        }
        result = fn(raw)
        opt = result.selections[0].chosen_options[0]  # type: ignore[union-attr]
        assert opt.choice_keyword == "华东"
        assert opt.recall == ["east_china"]
        assert opt.filter_field == ""
        assert opt.comparison == ""


# ===========================================================================
# PART 3-B — _consume_agent_events SSE paradigm 集成测试（BUGFIX: 过滤字段不丢）
# ===========================================================================


@pytest.mark.asyncio
async def test_consume_filter_paradigm_metadata_has_filter_fields() -> None:
    """InterruptEvent 含过滤 paradigm 时，complex_ask_user metadata.paradigmList
    应包含 field/comparison/value/choiceField 等过滤字段。"""
    from datacloud_analysis.ontology_agent import InterruptEvent, ParadigmGroup, ParadigmOption  # noqa: PLC0415

    fn = _import_consume_agent_events()
    ctx = _make_ctx()

    async def _gen():  # type: ignore[no-untyped-def]
        yield InterruptEvent(
            thread_id="tid_filter",
            reason="PARADIGM_CLARIFICATION",
            prompt="请确认过滤条件",
            paradigm_list=[
                ParadigmGroup(
                    paradigm_id="3",
                    paradigm_name="过滤条件",
                    options=[
                        ParadigmOption(
                            choice_keyword="",
                            recall=[],
                            filter_field="sales_user_id",
                            comparison="eq",
                            value="韦小二",
                            choice_field="所属销售用户编码",
                            choice_comparison="eq",
                            field_recall=["所属销售用户编码"],
                            comparison_recall=["eq", "gt"],
                            value_recall=["韦小宝", "韦小二"],
                        )
                    ],
                )
            ],
        )

    await fn(_gen(), ctx, reco_task=None)

    ctx.complex_ask_user.assert_awaited_once()
    # complex_ask_user 第一个位置参数是 AskUserEvent
    event_arg = ctx.complex_ask_user.call_args[0][0]
    metadata = event_arg.metadata
    paradigm_list = metadata["paradigmList"]
    assert len(paradigm_list) == 1

    grp = paradigm_list[0]
    assert grp["paradigmId"] == "3"
    assert grp["paradigmName"] == "过滤条件"
    results = grp["paradigmResult"]
    assert len(results) == 1

    # 过滤项
    r0 = results[0]
    assert r0["field"] == "sales_user_id"
    assert r0["comparison"] == "eq"
    assert r0["value"] == "韦小二"
    assert r0["choiceField"] == "所属销售用户编码"
    assert r0["choiceComparison"] == "eq"
    assert r0["fieldRecall"] == ["所属销售用户编码"]
    assert r0["comparisonRecall"] == ["eq", "gt"]
    assert r0["valueRecall"] == ["韦小宝", "韦小二"]


@pytest.mark.asyncio
async def test_consume_mixed_paradigm_metadata_preserves_both_types() -> None:
    """InterruptEvent 含查询值 + 过滤条件时，metadata 中两种类型字段均存在。"""
    from datacloud_analysis.ontology_agent import (  # noqa: PLC0415
        InterruptEvent,
        ParadigmGroup,
        ParadigmOption,
    )

    fn = _import_consume_agent_events()
    ctx = _make_ctx()

    async def _gen():  # type: ignore[no-untyped-def]
        yield InterruptEvent(
            thread_id="tid_mixed",
            reason="PARADIGM_CLARIFICATION",
            prompt="请确认",
            paradigm_list=[
                ParadigmGroup(
                    paradigm_id="1",
                    paradigm_name="查询值",
                    options=[
                        ParadigmOption(
                            choice_keyword="商机名称",
                            recall=["商机名称"],
                            keyword="opp_name",
                            kid=1,
                            ktype="select",
                        )
                    ],
                ),
                ParadigmGroup(
                    paradigm_id="3",
                    paradigm_name="过滤条件",
                    options=[
                ParadigmOption(
                    choice_keyword="",
                    recall=[],
                    filter_field="code",
                    comparison="eq",
                    value="test",
                    choice_field="编码",
                    choice_comparison="eq",
                    field_recall=["编码"],
                    comparison_recall=["eq"],
                    value_recall=["test"],
                )
                    ],
                ),
            ],
        )

    await fn(_gen(), ctx, reco_task=None)

    event_arg = ctx.complex_ask_user.call_args[0][0]
    paradigm_list = event_arg.metadata["paradigmList"]
    assert len(paradigm_list) == 2

    # 查询值
    qv = paradigm_list[0]
    assert qv["paradigmId"] == "1"
    qv_r = qv["paradigmResult"][0]
    assert qv_r["keyword"] == "opp_name"
    assert qv_r["choiceKeyword"] == "商机名称"
    assert "field" not in qv_r  # 查询值不含过滤键

    # 过滤条件
    fc = paradigm_list[1]
    assert fc["paradigmId"] == "3"
    fc_r = fc["paradigmResult"][0]
    assert fc_r["field"] == "code"
    assert fc_r["comparison"] == "eq"
    assert fc_r["value"] == "test"
    assert fc_r["choiceField"] == "编码"


@pytest.mark.asyncio
async def test_consume_query_only_paradigm_no_filter_keys_in_metadata() -> None:
    """仅含查询值 paradigm 时，metadata 中不出现过滤键。"""
    from datacloud_analysis.ontology_agent import (  # noqa: PLC0415
        InterruptEvent,
        ParadigmGroup,
        ParadigmOption,
    )

    fn = _import_consume_agent_events()
    ctx = _make_ctx()

    async def _gen():  # type: ignore[no-untyped-def]
        yield InterruptEvent(
            thread_id="tid_query",
            reason="PARADIGM_CLARIFICATION",
            prompt="请选择字段",
            paradigm_list=[
                ParadigmGroup(
                    paradigm_id="1",
                    paradigm_name="查询值",
                    options=[
                        ParadigmOption(
                            choice_keyword="商机名称",
                            recall=["商机名称"],
                            keyword="opp_name",
                            kid=1,
                            ktype="select",
                        )
                    ],
                ),
            ],
        )

    await fn(_gen(), ctx, reco_task=None)

    event_arg = ctx.complex_ask_user.call_args[0][0]
    results = event_arg.metadata["paradigmList"][0]["paradigmResult"]
    r0 = results[0]
    assert r0["keyword"] == "opp_name"
    assert r0["choiceKeyword"] == "商机名称"
    assert "field" not in r0
    assert "comparison" not in r0
    assert "value" not in r0
