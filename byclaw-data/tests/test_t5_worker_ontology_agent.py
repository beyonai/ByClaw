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
    assert "async def _consume_agent_events" in src or "def _consume_agent_events" in src


def test_t5_src_dynamic_path_uses_ontology_agent() -> None:
    """动态路径中调用 `_ontology_agent.ask` 或 `.resume`。"""
    src = _src()
    assert "_ontology_agent.ask" in src or "_ontology_agent.resume" in src


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
    assert options[0].recall == "east_china"


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
    reasoning_calls = [c for c in calls if c.kwargs.get("event_type") == EventType.REASONING_LOG_START.value]
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
    reasoning_calls = [c for c in calls if c.kwargs.get("event_type") == EventType.REASONING_LOG_START.value]
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
    from datacloud_analysis.ontology_agent import InterruptEvent, ParadigmGroup, ParadigmOption  # noqa: PLC0415

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
        m.patch("byclaw_data.model_environment.build_llm_config"),
        m.patch("byclaw_data.model_environment.build_embedding_config"),
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
    worker.command_plugin_manager.handle_ext_command = AsyncMock(return_value=(False, None))
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
    assert result.get("status") == "done"


@pytest.mark.asyncio
async def test_t5_dynamic_path_no_reco_task() -> None:
    """动态路径（call_object_ids 非空）不触发推荐问题插件。"""
    import contextlib  # noqa: PLC0415

    from datacloud_analysis.ontology_agent import AnswerEvent  # noqa: PLC0415

    worker = _make_worker_bare_t5()
    worker.command_plugin_manager.handle_ext_command = AsyncMock(return_value=(False, None))

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
        side_effect=lambda pid: reco_plugin if pid == "datacloud_recommended_questions" else None
    )

    cmd = _make_ask_command_t5(call_object_ids=["by_order"])
    ctx = _make_context_t5()

    with contextlib.ExitStack() as stack:
        for p in _patch_external():
            stack.enter_context(p)
        await worker.process_command(cmd, ctx)

    gen_fn.assert_not_called()
