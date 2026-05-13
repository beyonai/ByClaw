"""TC-01 ~ TC-14: 动态 Agent 路径（openclaw 接入方案）测试。

采用先红后绿策略。
- PART 1: 源码结构检查（静态），验证关键代码骨架已存在。
- PART 2: 纯函数单元测试（_build_dynamic_mounted_objects / _build_dynamic_cache_key）。
- PART 3: _extract_shared_loader 单元测试。
- PART 4: process_command 行为测试（重度 mock 隔离外部依赖）。
"""

from __future__ import annotations

from collections import OrderedDict
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

# ---------------------------------------------------------------------------
# 源文件路径
# ---------------------------------------------------------------------------

_WORKER_PY = (
    Path(__file__).resolve().parent.parent / "src" / "byclaw_data" / "worker.py"
)


def _src() -> str:
    return _WORKER_PY.read_text(encoding="utf-8")


# ===========================================================================
# PART 1 — 源码结构检查
# ===========================================================================


def test_tc_src01_worker_py_exists() -> None:
    """worker.py 文件存在（路径正确，后续断言有意义）。"""
    assert _WORKER_PY.is_file(), f"文件不存在：{_WORKER_PY}"


def test_tc_src02_shared_loader_attr_in_init() -> None:
    """DataCloudWorker.__init__ 中声明了 _shared_loader 属性。"""
    assert "_shared_loader" in _src(), (
        "worker.py 中未找到 _shared_loader 属性，应在 __init__ 中添加"
    )


def test_tc_src03_extract_shared_loader_method_exists() -> None:
    """DataCloudWorker._extract_shared_loader 方法已定义。"""
    assert "def _extract_shared_loader" in _src(), (
        "worker.py 中未找到 _extract_shared_loader 方法"
    )


def test_tc_src04_is_dynamic_agent_flag_in_process_command() -> None:
    """process_command 中存在 _is_dynamic_agent 动态路径标志检测逻辑。"""
    assert "_is_dynamic_agent" in _src(), (
        "worker.py 中未找到 _is_dynamic_agent，动态路径检测逻辑尚未实现"
    )


def test_tc_src05_reco_task_guarded_by_dynamic_flag() -> None:
    """reco_task 创建代码被 if not _is_dynamic_agent 包裹。"""
    src = _src()
    assert "if not _is_dynamic_agent" in src, (
        "worker.py 中未找到 'if not _is_dynamic_agent'，推荐问题屏蔽逻辑尚未实现"
    )


def test_tc_src06_build_dynamic_mounted_objects_exists() -> None:
    """模块级辅助函数 _build_dynamic_mounted_objects 已定义。"""
    assert "def _build_dynamic_mounted_objects" in _src(), (
        "worker.py 中未找到 _build_dynamic_mounted_objects 函数"
    )


def test_tc_src07_build_dynamic_cache_key_exists() -> None:
    """模块级辅助函数 _build_dynamic_cache_key 已定义。"""
    assert "def _build_dynamic_cache_key" in _src(), (
        "worker.py 中未找到 _build_dynamic_cache_key 函数"
    )


def test_tc_src08_dynamic_cache_key_prefix() -> None:
    """_build_dynamic_cache_key 返回以 'dynamic:' 为前缀的键。"""
    assert '"dynamic:"' in _src() or "'dynamic:'" in _src() or "dynamic:" in _src(), (
        "worker.py 中未找到 dynamic: 前缀，动态 cache_key 格式不正确"
    )


def test_tc_src09_ensure_agent_config_not_called_on_dynamic() -> None:
    """_ensure_agent_config_loaded 调用处存在动态路径跳过逻辑（if not _is_dynamic_agent）。"""
    src = _src()
    # 要求 _is_dynamic_agent 出现在 _ensure_agent_config_loaded 调用的上下文中
    assert "_ensure_agent_config_loaded" in src and "_is_dynamic_agent" in src, (
        "worker.py 中应同时存在 _ensure_agent_config_loaded 调用和 _is_dynamic_agent 跳过逻辑"
    )


# ===========================================================================
# PART 2 — _build_dynamic_mounted_objects 单元测试
# ===========================================================================


def _import_helpers() -> tuple[Any, Any]:
    """导入模块级辅助函数（延迟导入，避免 import 失败时阻断其他 PART）。"""
    from byclaw_data.worker import (  # type: ignore[attr-defined]
        _build_dynamic_cache_key,
        _build_dynamic_mounted_objects,
    )
    return _build_dynamic_mounted_objects, _build_dynamic_cache_key


def test_tc06_dedup_object_ids() -> None:
    """object_ids 中的重复编码被去重，仅保留首次出现。"""
    fn, _ = _import_helpers()
    result = fn(["obj_a", "obj_a", "obj_b"], [])
    assert result == ["obj_a", "obj_b"]


def test_tc06_dedup_across_object_and_view_ids() -> None:
    """object_ids 与 view_ids 跨列表去重，object_ids 中已出现的不再重复。"""
    fn, _ = _import_helpers()
    result = fn(["obj_a"], ["obj_a", "view_b"])
    assert result == ["obj_a", "view_b"]


def test_tc07_filter_non_string_elements() -> None:
    """object_ids 中的 None、整数、空字符串均被过滤。"""
    fn, _ = _import_helpers()
    result = fn(["obj_a", None, 123, "", "obj_b"], [])  # type: ignore[list-item]
    assert result == ["obj_a", "obj_b"]


def test_tc07_filter_whitespace_only_strings() -> None:
    """纯空白字符串被视为空，过滤掉。"""
    fn, _ = _import_helpers()
    result = fn(["obj_a", "   ", "obj_b"], [])
    assert result == ["obj_a", "obj_b"]


def test_tc03_object_ids_before_view_ids() -> None:
    """合并顺序：object_ids 在前，view_ids 在后。"""
    fn, _ = _import_helpers()
    result = fn(["obj_a", "obj_b"], ["view_c"])
    assert result == ["obj_a", "obj_b", "view_c"]


def test_tc01_only_object_ids() -> None:
    """仅 object_ids 有值时，mounted_objects 等于 object_ids。"""
    fn, _ = _import_helpers()
    assert fn(["ads_grid_analysis"], []) == ["ads_grid_analysis"]


def test_tc02_only_view_ids() -> None:
    """仅 view_ids 有值时，mounted_objects 等于 view_ids。"""
    fn, _ = _import_helpers()
    assert fn([], ["scene_enterprise"]) == ["scene_enterprise"]


def test_tc05_both_empty_returns_empty() -> None:
    """object_ids 与 view_ids 均为空时，返回空列表。"""
    fn, _ = _import_helpers()
    assert fn([], []) == []


# ===========================================================================
# PART 3 — _build_dynamic_cache_key 单元测试
# ===========================================================================


def test_tc14_cache_key_order_independent() -> None:
    """cache_key 与输入顺序无关（基于排序后的 mounted_objects 计算指纹）。"""
    _, key_fn = _import_helpers()
    assert key_fn(["obj_b", "obj_a"]) == key_fn(["obj_a", "obj_b"])


def test_tc14_cache_key_starts_with_dynamic() -> None:
    """cache_key 以 'dynamic:' 开头。"""
    _, key_fn = _import_helpers()
    assert key_fn(["obj_a"]).startswith("dynamic:")


def test_tc14_different_resources_different_key() -> None:
    """不同资源集合产生不同的 cache_key。"""
    _, key_fn = _import_helpers()
    assert key_fn(["obj_a"]) != key_fn(["obj_b"])


def test_tc14_same_resources_same_key() -> None:
    """相同资源集合（不论顺序）产生相同 cache_key。"""
    _, key_fn = _import_helpers()
    assert key_fn(["obj_a", "view_b"]) == key_fn(["view_b", "obj_a"])


# ===========================================================================
# PART 4 — _extract_shared_loader 单元测试
# ===========================================================================


def _make_worker_bare() -> Any:
    """不调用 GatewayWorker.__init__ 的裸 DataCloudWorker 实例。"""
    import asyncio  # noqa: PLC0415

    from byclaw_data.worker import DataCloudWorker  # noqa: PLC0415

    w = DataCloudWorker.__new__(DataCloudWorker)
    w.model_name = None
    w.api_key = None
    w.base_url = None
    w.graphs = OrderedDict()
    w._resume_result_cache = OrderedDict()
    w._resume_inflight = {}
    w._shared_loader = None
    w._resource_path = "/fake/resource"
    w._ontology_agent = None
    w._model_config_sig = ""
    w._ontology_agent_lock = asyncio.Lock()
    w.command_plugin_manager = MagicMock()
    w.worker_id = "test_worker"

    registry = MagicMock()
    registry.agent_configs = []
    w.plugin_registry = registry
    return w


def _make_mock_agent_config(loader: Any) -> Any:
    cfg = MagicMock()
    cfg.extra = {"loader": loader}
    cfg.agent_id = "mock_agent"
    return cfg


def test_tc11_extract_shared_loader_from_agent_config() -> None:
    """_extract_shared_loader 从第一个含 loader 的 AgentConfig 取 loader。"""
    worker = _make_worker_bare()
    mock_loader = MagicMock()
    worker.plugin_registry.agent_configs = [_make_mock_agent_config(mock_loader)]

    result = worker._extract_shared_loader()
    assert result is mock_loader


def test_tc11_extract_shared_loader_skips_none_loader() -> None:
    """AgentConfig.extra['loader'] 为 None 时跳过，取第二个。"""
    worker = _make_worker_bare()
    real_loader = MagicMock()
    worker.plugin_registry.agent_configs = [
        _make_mock_agent_config(None),
        _make_mock_agent_config(real_loader),
    ]
    assert worker._extract_shared_loader() is real_loader


def test_tc11_extract_shared_loader_falls_back_to_self_shared_loader() -> None:
    """AgentConfig 中无 loader 时，返回 self._shared_loader（二级降级）。"""
    worker = _make_worker_bare()
    fallback = MagicMock()
    worker._shared_loader = fallback
    worker.plugin_registry.agent_configs = [_make_mock_agent_config(None)]

    assert worker._extract_shared_loader() is fallback


def test_tc12_extract_shared_loader_returns_none_gracefully() -> None:
    """三级均不可用时返回 None，不抛出异常。"""
    worker = _make_worker_bare()
    worker._shared_loader = None
    worker.plugin_registry.agent_configs = []

    result = worker._extract_shared_loader()
    assert result is None


def test_tc11_extract_shared_loader_no_plugin_registry() -> None:
    """plugin_registry 为 None 时，仅走 self._shared_loader 降级，不崩溃。"""
    worker = _make_worker_bare()
    worker.plugin_registry = None
    saved = MagicMock()
    worker._shared_loader = saved

    assert worker._extract_shared_loader() is saved


# ===========================================================================
# PART 5 — process_command 行为测试（重度 mock）
# ===========================================================================


def _make_ask_command(header_metadata: dict[str, Any], content: str = "查询企业数据") -> Any:
    """构造最小化 AskAgentCommand stub，满足 isinstance 检查。"""
    from by_framework.core.protocol.commands import AskAgentCommand  # noqa: PLC0415

    cmd = MagicMock()
    cmd.__class__ = AskAgentCommand  # isinstance(cmd, AskAgentCommand) → True
    cmd.extra_payload = {}
    cmd.content = content
    header = MagicMock()
    header.metadata = header_metadata
    header.trace_id = ""
    header.target_agent_type = ""
    header.user_code = ""
    header.user_name = ""
    cmd.header = header
    return cmd


def _make_context(session_id: str = "sess_test") -> Any:
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


def _make_async_mock_graph(answer: str = "") -> Any:
    """返回带有可 await 的 aget_state 和可异步迭代 astream_events 的 mock graph。"""
    graph = MagicMock()

    async def _astream_events(*_a: Any, **_k: Any) -> None:  # type: ignore[misc]
        # 空异步生成器：驱动动态路径执行完毕，不产生任何事件
        while False:  # noqa: RET504
            yield  # pragma: no cover

    graph.astream_events = _astream_events
    snapshot = MagicMock()
    snapshot.values = {"react_final": {"answer": answer}}
    snapshot.interrupts = []
    graph.aget_state = AsyncMock(return_value=snapshot)
    return graph


@pytest.fixture()
def worker_with_mocks() -> Any:
    worker = _make_worker_bare()
    # command_plugin_manager.handle_ext_command 返回 (False, None)
    worker.command_plugin_manager.handle_ext_command = AsyncMock(
        return_value=(False, None)
    )
    return worker


def _patch_process_command_external_deps(worker: Any) -> list[Any]:
    """返回 patch 上下文管理器列表，供 pytest 使用。"""
    import unittest.mock as mock_module  # noqa: PLC0415

    patches = [
        mock_module.patch("byclaw_data.model_environment.build_llm_config", return_value={}),
        mock_module.patch("byclaw_data.model_environment.build_embedding_config", return_value={}),
        mock_module.patch(
            "by_framework.worker.sandbox.hook_sandbox.active_workspace"
        ),
        mock_module.patch(
            "byclaw_data.worker._load_recent_history_messages",
            new=AsyncMock(return_value=[]),
        ),
    ]
    return patches


def _make_ask_command_dyn(
    call_object_ids: list[str] | None = None,
    call_view_ids: list[str] | None = None,
    content: str = "查询企业数据",
) -> Any:
    """正确使用 extra_payload.call_object_ids / call_view_ids 的 AskAgentCommand stub。"""
    from by_framework.core.protocol.commands import AskAgentCommand  # noqa: PLC0415

    cmd = MagicMock()
    cmd.__class__ = AskAgentCommand
    cmd.extra_payload = {
        "call_object_ids": call_object_ids or [],
        "call_view_ids": call_view_ids or [],
    }
    cmd.content = content
    header = MagicMock()
    header.metadata = {}
    header.trace_id = ""
    header.target_agent_type = ""
    cmd.header = header
    return cmd


def _make_mock_ontology_agent(answer: str = "答案") -> Any:
    """返回 mock OntologyAgent（ask 产生 AnswerEvent）。"""
    from datacloud_analysis.ontology_agent import AnswerEvent  # noqa: PLC0415

    agent = MagicMock()

    async def _fake_ask(**kwargs: Any) -> Any:  # type: ignore[misc]
        yield AnswerEvent(content=answer)

    agent.ask = MagicMock(side_effect=_fake_ask)
    agent.resume = MagicMock(side_effect=_fake_ask)
    return agent


@pytest.mark.asyncio
async def test_tc01_process_command_dynamic_object_ids_calls_ontology_agent(
    worker_with_mocks: Any,
) -> None:
    """TC-01 (T5): call_object_ids 非空时，动态路径调用 OntologyAgent.ask，不调用 _build_graph。"""
    import contextlib  # noqa: PLC0415

    worker = worker_with_mocks
    worker._build_graph = MagicMock()
    worker._ontology_agent = _make_mock_ontology_agent()

    cmd = _make_ask_command_dyn(call_object_ids=["ads_grid_analysis"])
    ctx = _make_context()

    with contextlib.ExitStack() as stack:
        for p in _patch_process_command_external_deps(worker):
            stack.enter_context(p)
        await worker.process_command(cmd, ctx)

    worker._ontology_agent.ask.assert_called_once()
    worker._build_graph.assert_not_called()


@pytest.mark.asyncio
async def test_tc02_process_command_dynamic_view_ids_only(
    worker_with_mocks: Any,
) -> None:
    """TC-02 (T5): 仅 call_view_ids 非空时，OntologyAgent.ask 以 view_codes 被调用。"""
    import contextlib  # noqa: PLC0415

    worker = worker_with_mocks
    worker._ontology_agent = _make_mock_ontology_agent()

    cmd = _make_ask_command_dyn(call_view_ids=["scene_enterprise"])
    ctx = _make_context()

    with contextlib.ExitStack() as stack:
        for p in _patch_process_command_external_deps(worker):
            stack.enter_context(p)
        await worker.process_command(cmd, ctx)

    worker._ontology_agent.ask.assert_called_once()
    call_kwargs = worker._ontology_agent.ask.call_args.kwargs
    assert "scene_enterprise" in call_kwargs.get("view_codes", [])


@pytest.mark.asyncio
async def test_tc08_process_command_dynamic_calls_ask_per_request(
    worker_with_mocks: Any,
) -> None:
    """TC-08 (T5): 两次动态请求各自调用 OntologyAgent.ask，图缓存由 OntologyAgent 内部管理。"""
    import contextlib  # noqa: PLC0415

    worker = worker_with_mocks
    worker._ontology_agent = _make_mock_ontology_agent()
    worker._build_graph = MagicMock()

    cmd1 = _make_ask_command_dyn(call_object_ids=["obj_a"])
    cmd2 = _make_ask_command_dyn(call_object_ids=["obj_a"])
    ctx = _make_context()

    with contextlib.ExitStack() as stack:
        for p in _patch_process_command_external_deps(worker):
            stack.enter_context(p)
        await worker.process_command(cmd1, ctx)
        await worker.process_command(cmd2, ctx)

    assert worker._ontology_agent.ask.call_count == 2
    worker._build_graph.assert_not_called()


@pytest.mark.asyncio
async def test_tc09_process_command_dynamic_no_reco_task(
    worker_with_mocks: Any,
) -> None:
    """TC-09: 动态路径下，推荐问题插件不被调用（动态路径直接 return，不走 _stream_graph）。"""
    import contextlib  # noqa: PLC0415

    worker = worker_with_mocks
    worker._ontology_agent = _make_mock_ontology_agent()

    reco_plugin = MagicMock()
    reco_plugin.manifest.enabled = True
    gen_fn = AsyncMock(return_value=["推荐问题1"])
    reco_plugin.generate_recommended_questions = gen_fn
    worker.plugin_registry.get_plugin = MagicMock(
        side_effect=lambda pid: reco_plugin if pid == "datacloud_recommended_questions" else None
    )

    cmd = _make_ask_command_dyn(call_object_ids=["obj_a"])
    ctx = _make_context()

    with contextlib.ExitStack() as stack:
        for p in _patch_process_command_external_deps(worker):
            stack.enter_context(p)
        await worker.process_command(cmd, ctx)

    gen_fn.assert_not_called()


@pytest.mark.asyncio
async def test_tc10_process_command_static_reco_task_created(
    worker_with_mocks: Any,
) -> None:
    """TC-10: 静态路径下，reco_task 不为 None（推荐问题插件被触发）。"""
    worker = worker_with_mocks

    mock_cfg = MagicMock()
    mock_cfg.agent_id = "static_agent"
    mock_cfg.prompts = {"system_prompt": "test"}
    mock_cfg.extra = {
        "redirect_tools": {},
        "tool_metadata": {},
        "loader": None,
        "skip_action_families": frozenset(),
        "mounted_objects": [],
        "_loaded_by_plugin": "datacloud_init_agent_conf",
    }
    worker.plugin_registry.agent_configs = [mock_cfg]
    worker._build_graph = MagicMock(return_value=MagicMock())

    reco_plugin = MagicMock()
    reco_plugin.manifest.enabled = True
    gen_fn = AsyncMock(return_value=["推荐问题1"])
    reco_plugin.generate_recommended_questions = gen_fn
    worker.plugin_registry.get_plugin = MagicMock(
        side_effect=lambda pid: reco_plugin if pid == "datacloud_recommended_questions" else None
    )

    captured_reco_task: list[Any] = []

    async def _capture_stream_graph(**kwargs: Any) -> dict:
        captured_reco_task.append(kwargs.get("reco_task"))
        return {"status": "done"}

    worker._stream_graph = _capture_stream_graph

    cmd = _make_ask_command({"agent_id": "static_agent"})
    ctx = _make_context()

    patches = _patch_process_command_external_deps(worker)
    import contextlib  # noqa: PLC0415

    with contextlib.ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        ctx.list_agent_configs = MagicMock(return_value=[mock_cfg])
        await worker.process_command(cmd, ctx)

    assert captured_reco_task, "_stream_graph 未被调用"
    assert captured_reco_task[0] is not None, (
        "静态路径下 reco_task 应已创建（推荐问题插件应被触发）"
    )
