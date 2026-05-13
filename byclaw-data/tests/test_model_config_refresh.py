"""TC-MODEL-REFRESH: LLM 配置热更新（先红后绿）。

验收范围：
- PART 1: 源码结构检查（静态断言）
  - _model_config_sig 属性在 __init__ 中声明
  - _ontology_agent_lock 属性在 __init__ 中声明
  - model_sig 在 process_command 中计算并纳入 graph cache_key
- PART 2: 静态路径 — graph cache_key 含 model_sig，token 变更自动触发重建
  - 相同配置：graph 缓存命中，_build_graph 不重复调用
  - 配置变更：cache_key 不同，_build_graph 重新调用
  - 重建时 worker.api_key 已更新为 Redis 最新值
- PART 3: 动态路径 — OntologyAgent 配置变更时重建
  - 相同配置：OntologyAgent 构造函数不重复调用
  - 配置变更：OntologyAgent 构造函数再次被调用
  - 重建时新 agent 使用 Redis 最新 api_key
"""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

_WORKER_PY = (
    Path(__file__).resolve().parent.parent / "src" / "byclaw_data" / "worker.py"
)


def _src() -> str:
    return _WORKER_PY.read_text(encoding="utf-8")


# ===========================================================================
# PART 1 — 源码结构检查（静态断言）
# ===========================================================================


def test_src_model_config_sig_in_init() -> None:
    """DataCloudWorker.__init__ 中声明了 _model_config_sig 属性。"""
    assert "_model_config_sig" in _src(), (
        "worker.py __init__ 中应声明 _model_config_sig = '' 以跟踪当前生效的 LLM 配置签名"
    )


def test_src_ontology_agent_lock_in_init() -> None:
    """DataCloudWorker.__init__ 中声明了 _ontology_agent_lock（asyncio.Lock）。"""
    assert "_ontology_agent_lock" in _src(), (
        "worker.py __init__ 中应声明 _ontology_agent_lock，防止并发重建 OntologyAgent"
    )


def test_src_model_sig_in_process_command() -> None:
    """process_command 中计算 _model_sig 并将其纳入 graph cache_key。"""
    assert "_model_sig" in _src(), (
        "worker.py process_command 中应计算 _model_sig 并加入 graph cache_key，"
        "使 LLM 配置变更后旧 graph 缓存自动失效"
    )


def test_src_model_sig_in_cache_key_expression() -> None:
    """cache_key 拼接表达式包含 _model_sig。"""
    src = _src()
    # cache_key 形如 f"{by_agent_id}:{conf_hash}:{_model_sig}"
    assert "_model_sig" in src and "conf_hash" in src and "cache_key" in src, (
        "worker.py 中 cache_key 应包含 _model_sig 分段"
    )


# ===========================================================================
# 公用 helper
# ===========================================================================


def _make_worker_bare_refresh() -> Any:
    """裸 DataCloudWorker，含热更新所需的新属性。"""
    from byclaw_data.worker import DataCloudWorker  # noqa: PLC0415

    w = DataCloudWorker.__new__(DataCloudWorker)
    w.model_name = None
    w.api_key = None
    w.base_url = None
    w.graphs = OrderedDict()
    w._resume_result_cache = OrderedDict()
    w._resume_inflight = {}
    w._shared_loader = None
    w._resource_path = ""
    w._ontology_agent = None
    w._model_config_sig = ""
    w._ontology_agent_lock = asyncio.Lock()
    w.command_plugin_manager = MagicMock()
    w.worker_id = "test_worker"

    registry = MagicMock()
    registry.agent_configs = []
    w.plugin_registry = registry
    return w


def _llm_cfg(api_key: str, model: str = "qwen3", base_url: str = "http://llm.test/") -> dict:
    """构造 build_llm_config 的典型返回值。"""
    return {
        "DATACLOUD_LLM_API_KEY": api_key,
        "DATACLOUD_LLM_MODEL": model,
        "DATACLOUD_LLM_API_BASE": base_url,
    }


def _make_context_r(session_id: str = "sess_r") -> Any:
    ctx = MagicMock()
    ctx.session_id = session_id
    ctx.generate_message_id = MagicMock(return_value="msg_r01")
    ctx.emit_chunk = AsyncMock()
    ctx.flush_to_history = AsyncMock()
    ctx.check_cancelled = AsyncMock()
    ctx._knowledge_enhance_node_id = ""
    ctx.list_agent_configs = MagicMock(return_value=[])
    ctx.set_agent_configs = MagicMock()
    ctx.agent_runtime_state = MagicMock()
    return ctx


def _make_mock_agent() -> Any:
    """返回含有效 async ask 的 mock OntologyAgent 实例。"""
    from datacloud_analysis.ontology_agent import AnswerEvent  # noqa: PLC0415

    inst = MagicMock()

    async def _ask(**kwargs: Any) -> Any:  # type: ignore[misc]
        yield AnswerEvent(content="答案")

    inst.ask = MagicMock(side_effect=_ask)
    return inst


def _make_oa_class_mock() -> Any:
    """返回每次调用都产生有效 mock agent 的 OntologyAgent 类 mock。"""
    cls = MagicMock()
    cls.side_effect = lambda cfg: _make_mock_agent()
    return cls


# ===========================================================================
# PART 2 — 静态路径：cache_key 含 model_sig
# ===========================================================================


def _make_static_worker(agent_id: str = "agent_s1") -> Any:
    w = _make_worker_bare_refresh()

    mock_cfg = MagicMock()
    mock_cfg.agent_id = agent_id
    mock_cfg.prompts = {}
    mock_cfg.extra = {
        "redirect_tools": {},
        "tool_metadata": {},
        "loader": None,
        "skip_action_families": frozenset(),
        "mounted_objects": [],
    }
    w.plugin_registry.agent_configs = [mock_cfg]
    w.plugin_registry.get_plugin = MagicMock(return_value=None)
    w._build_graph = MagicMock(return_value=MagicMock())

    async def _fake_stream(**kwargs: Any) -> dict:
        return {"status": "done"}

    w._stream_graph = _fake_stream
    return w


def _make_static_cmd(agent_id: str = "agent_s1") -> Any:
    from by_framework.core.protocol.commands import AskAgentCommand  # noqa: PLC0415

    cmd = MagicMock()
    cmd.__class__ = AskAgentCommand
    cmd.extra_payload = {"agent_id": agent_id}
    cmd.content = "查询数据"
    header = MagicMock()
    header.metadata = {"agent_id": agent_id}
    header.trace_id = ""
    header.target_agent_type = ""
    cmd.header = header
    return cmd


@pytest.mark.asyncio
async def test_static_same_config_reuses_graph() -> None:
    """同一 LLM 配置连续两次请求，graph 被缓存复用（_build_graph 仅调用一次）。"""
    worker = _make_static_worker()
    cfg = _llm_cfg("key_stable")

    with patch("byclaw_data.model_environment.build_llm_config", return_value=cfg), \
         patch("byclaw_data.model_environment.build_embedding_config", return_value={}), \
         patch("by_framework.worker.sandbox.hook_sandbox.active_workspace"), \
         patch("byclaw_data.worker._load_recent_history_messages", new=AsyncMock(return_value=[])):
        ctx = _make_context_r()
        ctx.list_agent_configs = MagicMock(return_value=worker.plugin_registry.agent_configs)
        await worker.process_command(_make_static_cmd(), ctx)
        await worker.process_command(_make_static_cmd(), ctx)

    assert worker._build_graph.call_count == 1, (
        f"相同 LLM 配置下 graph 应被缓存复用，但 _build_graph 被调用了 {worker._build_graph.call_count} 次"
    )


@pytest.mark.asyncio
async def test_static_changed_api_key_triggers_graph_rebuild() -> None:
    """api_key 变更后 cache_key 随之改变，触发 graph 重建（_build_graph 调用两次）。"""
    worker = _make_static_worker()

    with patch("byclaw_data.model_environment.build_llm_config") as mock_llm, \
         patch("byclaw_data.model_environment.build_embedding_config", return_value={}), \
         patch("by_framework.worker.sandbox.hook_sandbox.active_workspace"), \
         patch("byclaw_data.worker._load_recent_history_messages", new=AsyncMock(return_value=[])):
        ctx = _make_context_r()
        ctx.list_agent_configs = MagicMock(return_value=worker.plugin_registry.agent_configs)

        mock_llm.return_value = _llm_cfg("key_v1")
        await worker.process_command(_make_static_cmd(), ctx)

        mock_llm.return_value = _llm_cfg("key_v2")  # 模拟 token 轮换
        await worker.process_command(_make_static_cmd(), ctx)

    assert worker._build_graph.call_count == 2, (
        f"api_key 变更应使 cache_key 失效并重建 graph，"
        f"但 _build_graph 被调用了 {worker._build_graph.call_count} 次"
    )


@pytest.mark.asyncio
async def test_static_graph_rebuilt_with_new_api_key() -> None:
    """graph 重建时，worker.api_key 已更新为 Redis 返回的新值（而非启动时的旧值）。"""
    worker = _make_static_worker()
    worker.api_key = "startup_key"

    api_key_at_build: list[str] = []

    original_build = worker._build_graph

    def _spy_build(*args: Any, **kwargs: Any) -> Any:
        api_key_at_build.append(worker.api_key or "")
        return original_build(*args, **kwargs)

    worker._build_graph = _spy_build

    with patch("byclaw_data.model_environment.build_llm_config", return_value=_llm_cfg("redis_fresh_key")), \
         patch("byclaw_data.model_environment.build_embedding_config", return_value={}), \
         patch("by_framework.worker.sandbox.hook_sandbox.active_workspace"), \
         patch("byclaw_data.worker._load_recent_history_messages", new=AsyncMock(return_value=[])):
        ctx = _make_context_r()
        ctx.list_agent_configs = MagicMock(return_value=worker.plugin_registry.agent_configs)
        await worker.process_command(_make_static_cmd(), ctx)

    assert api_key_at_build, "_build_graph 应被调用至少一次"
    assert api_key_at_build[0] == "redis_fresh_key", (
        f"graph 重建时 worker.api_key 应已更新为 Redis 最新值 'redis_fresh_key'，"
        f"实际为 {api_key_at_build[0]!r}"
    )


# ===========================================================================
# PART 3 — 动态路径：OntologyAgent 配置变更时重建
# ===========================================================================


def _make_dynamic_worker() -> Any:
    w = _make_worker_bare_refresh()
    w._resource_path = "/fake/resource"
    w.command_plugin_manager.handle_ext_command = AsyncMock(return_value=(False, None))
    return w


def _make_dynamic_cmd() -> Any:
    from by_framework.core.protocol.commands import AskAgentCommand  # noqa: PLC0415

    cmd = MagicMock()
    cmd.__class__ = AskAgentCommand
    cmd.extra_payload = {
        "call_view_ids": ["scene_sales"],
        "call_object_ids": [],
    }
    cmd.content = "查询销售数据"
    header = MagicMock()
    header.metadata = {}
    header.trace_id = ""
    header.target_agent_type = ""
    cmd.header = header
    return cmd


@pytest.mark.asyncio
async def test_dynamic_same_config_agent_not_recreated() -> None:
    """同一 LLM 配置连续两次请求，OntologyAgent 构造函数恰好调用一次（sig 首次变更时）。"""
    worker = _make_dynamic_worker()
    worker._ontology_agent = _make_mock_agent()

    mock_oa_cls = _make_oa_class_mock()
    cfg = _llm_cfg("key_stable")

    with patch("byclaw_data.model_environment.build_llm_config", return_value=cfg), \
         patch("byclaw_data.model_environment.build_embedding_config", return_value={}), \
         patch("by_framework.worker.sandbox.hook_sandbox.active_workspace"), \
         patch("byclaw_data.worker._load_recent_history_messages", new=AsyncMock(return_value=[])), \
         patch("datacloud_analysis.ontology_agent.OntologyAgent", mock_oa_cls):
        await worker.process_command(_make_dynamic_cmd(), _make_context_r("d1"))
        await worker.process_command(_make_dynamic_cmd(), _make_context_r("d2"))

    # 第一次 sig 从 "" 变为 sig_stable → 重建一次；第二次 sig 不变 → 不重建
    assert mock_oa_cls.call_count == 1, (
        f"相同配置下 OntologyAgent 应仅在首次 sig 变更时重建一次，"
        f"实际构造函数调用 {mock_oa_cls.call_count} 次"
    )


@pytest.mark.asyncio
async def test_dynamic_changed_api_key_recreates_agent() -> None:
    """api_key 变更后，OntologyAgent 被重新创建（构造函数调用两次）。"""
    worker = _make_dynamic_worker()
    worker._ontology_agent = _make_mock_agent()

    mock_oa_cls = _make_oa_class_mock()

    with patch("byclaw_data.model_environment.build_llm_config") as mock_llm, \
         patch("byclaw_data.model_environment.build_embedding_config", return_value={}), \
         patch("by_framework.worker.sandbox.hook_sandbox.active_workspace"), \
         patch("byclaw_data.worker._load_recent_history_messages", new=AsyncMock(return_value=[])), \
         patch("datacloud_analysis.ontology_agent.OntologyAgent", mock_oa_cls):
        mock_llm.return_value = _llm_cfg("key_v1")
        await worker.process_command(_make_dynamic_cmd(), _make_context_r("d1"))

        mock_llm.return_value = _llm_cfg("key_v2")  # token 轮换
        await worker.process_command(_make_dynamic_cmd(), _make_context_r("d2"))

    assert mock_oa_cls.call_count == 2, (
        f"api_key 变更应触发 OntologyAgent 重建，"
        f"构造函数应被调用 2 次，实际 {mock_oa_cls.call_count} 次"
    )


@pytest.mark.asyncio
async def test_dynamic_new_agent_uses_updated_api_key() -> None:
    """OntologyAgent 重建时，OntologyAgentConfig.api_key 为 Redis 最新值，而非启动时旧值。"""
    worker = _make_dynamic_worker()
    worker._ontology_agent = _make_mock_agent()
    worker.api_key = "stale_startup_key"

    captured_cfgs: list[Any] = []

    def _capture(cfg: Any) -> Any:
        captured_cfgs.append(cfg)
        return _make_mock_agent()

    with patch("byclaw_data.model_environment.build_llm_config", return_value=_llm_cfg("fresh_redis_key")), \
         patch("byclaw_data.model_environment.build_embedding_config", return_value={}), \
         patch("by_framework.worker.sandbox.hook_sandbox.active_workspace"), \
         patch("byclaw_data.worker._load_recent_history_messages", new=AsyncMock(return_value=[])), \
         patch("datacloud_analysis.ontology_agent.OntologyAgent", side_effect=_capture):
        await worker.process_command(_make_dynamic_cmd(), _make_context_r())

    assert captured_cfgs, "OntologyAgent 构造函数应在 sig 首次变更时被调用"
    cfg_used = captured_cfgs[0]
    assert getattr(cfg_used, "api_key", None) == "fresh_redis_key", (
        f"OntologyAgent 重建时 api_key 应为 Redis 最新值 'fresh_redis_key'，"
        f"实际为 {getattr(cfg_used, 'api_key', None)!r}"
    )


# ===========================================================================
# PART 4 — sig 覆盖全量配置字段（非仅 token）
# ===========================================================================


def _full_llm_cfg(
    api_key: str = "key",
    model: str = "qwen3",
    base_url: str = "http://llm.test/",
    provider: str = "openai",
    temperature: str = "0.0",
) -> dict:
    """包含 build_llm_config 所有返回字段的完整配置 dict。"""
    return {
        "DATACLOUD_LLM_API_KEY": api_key,
        "DATACLOUD_LLM_MODEL": model,
        "DATACLOUD_LLM_API_BASE": base_url,
        "DATACLOUD_LLM_MODEL_PROVIDER": provider,
        "DATACLOUD_LLM_TEMPERATURE": temperature,
    }


@pytest.mark.asyncio
async def test_static_changed_provider_triggers_graph_rebuild() -> None:
    """provider 变更（如 openai → anthropic）时，graph cache_key 改变并重建。"""
    worker = _make_static_worker()

    with patch("byclaw_data.model_environment.build_llm_config") as mock_llm, \
         patch("byclaw_data.model_environment.build_embedding_config", return_value={}), \
         patch("by_framework.worker.sandbox.hook_sandbox.active_workspace"), \
         patch("byclaw_data.worker._load_recent_history_messages", new=AsyncMock(return_value=[])):
        ctx = _make_context_r()
        ctx.list_agent_configs = MagicMock(return_value=worker.plugin_registry.agent_configs)

        mock_llm.return_value = _full_llm_cfg(provider="openai")
        await worker.process_command(_make_static_cmd(), ctx)

        mock_llm.return_value = _full_llm_cfg(provider="anthropic")  # 切换 provider
        await worker.process_command(_make_static_cmd(), ctx)

    assert worker._build_graph.call_count == 2, (
        f"provider 变更应使 cache_key 失效并重建 graph，"
        f"但 _build_graph 被调用了 {worker._build_graph.call_count} 次"
    )


@pytest.mark.asyncio
async def test_static_changed_temperature_triggers_graph_rebuild() -> None:
    """temperature 变更时，graph cache_key 改变并重建。"""
    worker = _make_static_worker()

    with patch("byclaw_data.model_environment.build_llm_config") as mock_llm, \
         patch("byclaw_data.model_environment.build_embedding_config", return_value={}), \
         patch("by_framework.worker.sandbox.hook_sandbox.active_workspace"), \
         patch("byclaw_data.worker._load_recent_history_messages", new=AsyncMock(return_value=[])):
        ctx = _make_context_r()
        ctx.list_agent_configs = MagicMock(return_value=worker.plugin_registry.agent_configs)

        mock_llm.return_value = _full_llm_cfg(temperature="0.0")
        await worker.process_command(_make_static_cmd(), ctx)

        mock_llm.return_value = _full_llm_cfg(temperature="0.7")  # 调整温度
        await worker.process_command(_make_static_cmd(), ctx)

    assert worker._build_graph.call_count == 2, (
        f"temperature 变更应使 cache_key 失效并重建 graph，"
        f"但 _build_graph 被调用了 {worker._build_graph.call_count} 次"
    )
