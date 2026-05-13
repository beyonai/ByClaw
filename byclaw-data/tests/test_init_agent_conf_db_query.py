"""单元测试：init_agent_conf.py 中 db_query 模式工具挂载逻辑。

覆盖范围：
- _ontology_load_mode()          静态方法读取环境变量
- _build_db_query_tools()        为 OBJECT/VIEW 构建 data_query_{code} 工具
- _build_single_db_query_tool()  单个工具：名称、描述、async 调用路由
- _handle_single_agent_detail()  db_query 分支：工具名、mounted_objects 为空、loader 为 None
- _handle_single_agent_detail()  ontology_query 分支：现有行为无回归
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# 被测目标
# ---------------------------------------------------------------------------
from byclaw_data.plugins.worker_plugins.init_agent_conf import (
    InitDataCloudDigitalEmployeePlugin,
)


# ---------------------------------------------------------------------------
# 辅助工厂
# ---------------------------------------------------------------------------


def _make_plugin() -> InitDataCloudDigitalEmployeePlugin:
    """构造插件实例，绕过 __init__ 中的网络 / 文件系统依赖。"""
    with patch(
        "byclaw_data.plugins.worker_plugins.init_agent_conf.normalize_runtime_environment"
    ):
        with patch(
            "byclaw_data.plugins.worker_plugins.init_agent_conf._datacloud_repo_root",
            return_value=MagicMock(
                **{
                    "__truediv__": lambda self, x: MagicMock(
                        **{"is_file.return_value": False}
                    )
                }
            ),
        ):
            return InitDataCloudDigitalEmployeePlugin()


def _make_rel(
    resource_code: str,
    resource_biz_type: str,
    resource_name: str = "",
    resource_desc: str = "",
    resource_type: str = "DB_TABLE",
) -> dict[str, Any]:
    return {
        "resourceCode": resource_code,
        "resourceBizType": resource_biz_type,
        "resourceName": resource_name or resource_code,
        "resourceDesc": resource_desc,
        "resourceType": resource_type,
    }


def _make_mock_loader(
    object_codes: list[str] | None = None,
    view_codes: list[str] | None = None,
) -> MagicMock:
    """返回一个带 get_object / get_view 的 mock OntologyLoader。"""
    loader = MagicMock()

    def _get_object(code: str) -> MagicMock:
        obj = MagicMock()
        obj.query = AsyncMock(
            return_value={"records": [], "total": 0, "object_code": code}
        )
        return obj

    def _get_view(code: str) -> MagicMock:
        view = MagicMock()
        view.query = AsyncMock(
            return_value={"records": [], "total": 0, "view_code": code}
        )
        return view

    loader.get_object.side_effect = _get_object
    loader.get_view.side_effect = _get_view
    return loader


# ===========================================================================
# 1. _ontology_load_mode
# ===========================================================================


class TestOntologyLoadMode:
    """_ontology_load_mode() 静态方法读取 ONTOLOGY_LOAD_MODE 环境变量。"""

    def test_returns_default_when_env_not_set(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("ONTOLOGY_LOAD_MODE", raising=False)
        assert (
            InitDataCloudDigitalEmployeePlugin._ontology_load_mode() == "ontology_query"
        )

    def test_returns_db_query_when_set(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("ONTOLOGY_LOAD_MODE", "db_query")
        assert InitDataCloudDigitalEmployeePlugin._ontology_load_mode() == "db_query"

    def test_returns_ontology_query_when_set(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("ONTOLOGY_LOAD_MODE", "ontology_query")
        assert (
            InitDataCloudDigitalEmployeePlugin._ontology_load_mode() == "ontology_query"
        )

    def test_strips_whitespace_and_lowercases(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("ONTOLOGY_LOAD_MODE", "  DB_QUERY  ")
        assert InitDataCloudDigitalEmployeePlugin._ontology_load_mode() == "db_query"


# ===========================================================================
# 2. _build_db_query_tools
# ===========================================================================


class TestBuildDbQueryTools:
    """_build_db_query_tools() 方法：遍历 relResourceList，构建 data_query_{code} 工具。"""

    def setup_method(self) -> None:
        self.plugin = _make_plugin()
        self.loader = _make_mock_loader()

    def test_object_resource_produces_data_query_tool(self) -> None:
        rels = [_make_rel("Order", "OBJECT")]
        tools = self.plugin._build_db_query_tools(
            agent_id="agent1",
            rel_resource_list=rels,
            loader=self.loader,
        )
        assert "data_query_Order" in tools

    def test_view_resource_produces_data_query_tool(self) -> None:
        rels = [_make_rel("SalesView", "VIEW")]
        tools = self.plugin._build_db_query_tools(
            agent_id="agent1",
            rel_resource_list=rels,
            loader=self.loader,
        )
        assert "data_query_SalesView" in tools

    def test_agent_resource_is_skipped(self) -> None:
        rels = [_make_rel("SubAgent", "AGENT")]
        tools = self.plugin._build_db_query_tools(
            agent_id="agent1",
            rel_resource_list=rels,
            loader=self.loader,
        )
        assert tools == {}

    def test_tool_resource_is_skipped(self) -> None:
        rels = [_make_rel("SomeTool", "TOOL")]
        tools = self.plugin._build_db_query_tools(
            agent_id="agent1",
            rel_resource_list=rels,
            loader=self.loader,
        )
        assert tools == {}

    def test_empty_resource_code_is_skipped(self) -> None:
        rels = [_make_rel("", "OBJECT")]
        tools = self.plugin._build_db_query_tools(
            agent_id="agent1",
            rel_resource_list=rels,
            loader=self.loader,
        )
        assert tools == {}

    def test_mixed_resources_only_object_view_included(self) -> None:
        rels = [
            _make_rel("Order", "OBJECT"),
            _make_rel("SalesView", "VIEW"),
            _make_rel("SubAgent", "AGENT"),
            _make_rel("SomeTool", "TOOL"),
        ]
        tools = self.plugin._build_db_query_tools(
            agent_id="agent1",
            rel_resource_list=rels,
            loader=self.loader,
        )
        assert set(tools.keys()) == {"data_query_Order", "data_query_SalesView"}

    def test_multiple_objects_all_produce_tools(self) -> None:
        rels = [
            _make_rel("Order", "OBJECT"),
            _make_rel("Product", "OBJECT"),
            _make_rel("Customer", "OBJECT"),
        ]
        tools = self.plugin._build_db_query_tools(
            agent_id="agent1",
            rel_resource_list=rels,
            loader=self.loader,
        )
        assert set(tools.keys()) == {
            "data_query_Order",
            "data_query_Product",
            "data_query_Customer",
        }

    def test_build_failure_on_single_tool_does_not_abort_others(self) -> None:
        """单个工具构建失败时，其他工具仍应正常构建。

        _build_single_db_query_tool 在构建阶段抛出异常，
        _build_db_query_tools 应跳过该工具，继续处理剩余资源。
        """
        original = InitDataCloudDigitalEmployeePlugin._build_single_db_query_tool

        def patched(*, resource_code: str, **kwargs: Any) -> Any:
            if resource_code == "BadObj":
                raise RuntimeError("simulated build failure")
            return original(resource_code=resource_code, **kwargs)

        rels = [
            _make_rel("BadObj", "OBJECT"),
            _make_rel("GoodObj", "OBJECT"),
        ]
        with patch.object(
            InitDataCloudDigitalEmployeePlugin,
            "_build_single_db_query_tool",
            staticmethod(patched),
        ):
            tools = self.plugin._build_db_query_tools(
                agent_id="agent1",
                rel_resource_list=rels,
                loader=self.loader,
            )
        assert "data_query_GoodObj" in tools
        assert "data_query_BadObj" not in tools


# ===========================================================================
# 3. _build_single_db_query_tool
# ===========================================================================


class TestBuildSingleDbQueryTool:
    """_build_single_db_query_tool() 方法：工具名、描述、async 调用路由。"""

    def setup_method(self) -> None:
        self.plugin = _make_plugin()
        self.loader = _make_mock_loader()

    def test_tool_name_is_data_query_prefix_for_object(self) -> None:
        tool = self.plugin._build_single_db_query_tool(
            resource_code="Order",
            resource_biz_type="OBJECT",
            resource_name="订单",
            resource_desc="订单主表",
            loader=self.loader,
        )
        assert tool.name == "data_query_Order"

    def test_tool_name_is_data_query_prefix_for_view(self) -> None:
        tool = self.plugin._build_single_db_query_tool(
            resource_code="SalesView",
            resource_biz_type="VIEW",
            resource_name="销售视图",
            resource_desc="",
            loader=self.loader,
        )
        assert tool.name == "data_query_SalesView"

    def test_tool_description_contains_resource_name(self) -> None:
        tool = self.plugin._build_single_db_query_tool(
            resource_code="Order",
            resource_biz_type="OBJECT",
            resource_name="订单",
            resource_desc="订单主表",
            loader=self.loader,
        )
        assert "订单" in tool.description

    def test_db_query_tool_exposes_query_and_context_knowledge_schema(self) -> None:
        tool = self.plugin._build_single_db_query_tool(
            resource_code="Order",
            resource_biz_type="OBJECT",
            resource_name="订单",
            resource_desc="订单主表",
            loader=self.loader,
        )
        schema = tool.args_schema.model_json_schema()
        assert "query" in schema["properties"]
        assert "contextKnowledge" in schema["properties"]
        assert "query_target" not in schema["properties"]
        assert "group_by" not in schema["properties"]
        assert "agg_function" not in schema["properties"]

    def test_object_tool_calls_obj_query(self) -> None:
        """OBJECT 类型工具调用时，应通过 obj.query(question=..., knowledge_context=...) 查询。"""
        mock_obj = MagicMock()
        mock_obj.query = AsyncMock(return_value={"records": [], "total": 0})
        loader = MagicMock()
        loader.get_object.return_value = mock_obj

        tool = self.plugin._build_single_db_query_tool(
            resource_code="Order",
            resource_biz_type="OBJECT",
            resource_name="订单",
            resource_desc="",
            loader=loader,
        )
        asyncio.run(tool.ainvoke({"query": "查询所有订单"}))
        loader.get_object.assert_called_once_with("Order")
        mock_obj.query.assert_called_once_with(
            question="查询所有订单", knowledge_context=None
        )

    def test_object_tool_passes_knowledge_context_when_provided(self) -> None:
        """contextKnowledge 非空时，应作为 knowledge_context 传入 obj.query()。"""
        mock_obj = MagicMock()
        mock_obj.query = AsyncMock(return_value={"records": [], "total": 0})
        loader = MagicMock()
        loader.get_object.return_value = mock_obj

        tool = self.plugin._build_single_db_query_tool(
            resource_code="Order",
            resource_biz_type="OBJECT",
            resource_name="订单",
            resource_desc="",
            loader=loader,
        )
        asyncio.run(
            tool.ainvoke({"query": "查询订单", "contextKnowledge": "营收 → 企业总营收"})
        )
        mock_obj.query.assert_called_once_with(
            question="查询订单", knowledge_context="营收 → 企业总营收"
        )

    def test_view_tool_calls_view_query(self) -> None:
        """VIEW 类型工具调用时，应通过 view.query(question=..., knowledge_context=...) 查询。"""
        mock_view = MagicMock()
        mock_view.query = AsyncMock(return_value={"records": [], "total": 0})
        loader = MagicMock()
        loader.get_view.return_value = mock_view

        tool = self.plugin._build_single_db_query_tool(
            resource_code="SalesView",
            resource_biz_type="VIEW",
            resource_name="销售视图",
            resource_desc="",
            loader=loader,
        )
        asyncio.run(tool.ainvoke({"query": "查销售数据"}))
        loader.get_view.assert_called_once_with("SalesView")
        mock_view.query.assert_called_once_with(
            question="查销售数据", knowledge_context=None
        )


# ===========================================================================
# 4. _handle_single_agent_detail — db_query 分支
# ===========================================================================


class TestHandleSingleAgentDetailDbQueryMode:
    """db_query 模式下 _handle_single_agent_detail 的输出校验。"""

    _AGENT_ID = "agent_db_001"
    _DETAIL_DATA = {
        "resourceId": _AGENT_ID,
        "resourceName": "测试员工",
        "resourceDesc": "系统描述",
        "corePersonaDefinition": "你是一个数据查询助手",
        "agentType": "005",
        "relResourceList": [
            {
                "resourceCode": "Order",
                "resourceBizType": "OBJECT",
                "resourceName": "订单",
                "resourceDesc": "订单表",
                "resourceType": "DB_TABLE",
            },
            {
                "resourceCode": "SalesView",
                "resourceBizType": "VIEW",
                "resourceName": "销售视图",
                "resourceDesc": "",
                "resourceType": "DB_TABLE",
            },
        ],
    }

    def setup_method(self) -> None:
        self.plugin = _make_plugin()
        self.mock_loader = _make_mock_loader()

    def _run(self, monkeypatch: pytest.MonkeyPatch) -> dict:
        """执行 _handle_single_agent_detail 并返回写入 current_map 的结果。"""
        monkeypatch.setenv("ONTOLOGY_LOAD_MODE", "db_query")

        current_map: dict = {}
        empty_tool_agent_ids: list = []

        with patch.object(
            self.plugin,
            "_build_shared_loader",
            return_value=self.mock_loader,
        ):
            # 让 ontology/delegate 动态工具不干扰（返回空）
            with patch.object(
                self.plugin,
                "_build_dynamic_tools_with_diagnostics",
                return_value=({}, {"reason_summary": []}),
            ):
                self.plugin._handle_single_agent_detail(
                    current_map=current_map,
                    agent_id=self._AGENT_ID,
                    detail_data=self._DETAIL_DATA,
                    skipped_no_tools=empty_tool_agent_ids,
                )
        return current_map

    def test_tools_named_with_data_query_prefix(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        current_map = self._run(monkeypatch)
        cfg = current_map.get(self._AGENT_ID)
        assert cfg is not None
        tool_keys = set(cfg.tools.keys())
        assert "data_query_Order" in tool_keys
        assert "data_query_SalesView" in tool_keys

    def test_no_ontology_query_tool_names_present(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """db_query 模式下不应出现 query_{code} / compute_{code} 格式工具。"""
        current_map = self._run(monkeypatch)
        cfg = current_map.get(self._AGENT_ID)
        assert cfg is not None
        for key in cfg.tools:
            assert not key.startswith("query_"), f"不应有 query_ 前缀工具: {key}"
            assert not key.startswith("compute_"), f"不应有 compute_ 前缀工具: {key}"

    def test_mounted_objects_contains_resource_codes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """db_query 模式下 mounted_objects 包含 OBJECT/VIEW 资源编码（供 OntologyToolLoader 使用）。"""
        current_map = self._run(monkeypatch)
        cfg = current_map.get(self._AGENT_ID)
        assert cfg is not None
        mounted = cfg.extra.get("mounted_objects")
        assert "Order" in mounted, f"db_query 模式 mounted_objects 应含 Order，实际: {mounted}"
        assert "SalesView" in mounted, f"db_query 模式 mounted_objects 应含 SalesView，实际: {mounted}"

    def test_loader_in_extra_is_set(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """db_query 模式下 loader 非 None，供 OntologyToolLoader 生成 OWL 原生自定义 action。"""
        current_map = self._run(monkeypatch)
        cfg = current_map.get(self._AGENT_ID)
        assert cfg is not None
        assert cfg.extra.get("loader") is not None, "db_query 模式 loader 不应为 None"

    def test_agent_config_registered_in_map(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        current_map = self._run(monkeypatch)
        assert self._AGENT_ID in current_map


# ===========================================================================
# 5. _handle_single_agent_detail — ontology_query 模式无回归
# ===========================================================================


class TestHandleSingleAgentDetailOntologyQueryMode:
    """ontology_query 模式（默认）下现有行为不被破坏。"""

    _AGENT_ID = "agent_onto_001"
    _DETAIL_DATA = {
        "resourceId": _AGENT_ID,
        "resourceName": "本体员工",
        "resourceDesc": "本体描述",
        "corePersonaDefinition": "你是本体查询助手",
        "agentType": "005",
        "relResourceList": [
            {
                "resourceCode": "Product",
                "resourceBizType": "OBJECT",
                "resourceName": "产品",
                "resourceDesc": "",
                "resourceType": "DB_TABLE",
            },
        ],
    }

    def setup_method(self) -> None:
        self.plugin = _make_plugin()
        self.mock_loader = _make_mock_loader()

    def _run(self, monkeypatch: pytest.MonkeyPatch) -> dict:
        monkeypatch.setenv("ONTOLOGY_LOAD_MODE", "ontology_query")

        current_map: dict = {}
        empty_tool_agent_ids: list = []

        with patch.object(
            self.plugin,
            "_build_shared_loader",
            return_value=self.mock_loader,
        ):
            with patch.object(
                self.plugin,
                "_build_dynamic_tools_with_diagnostics",
                return_value=({}, {"reason_summary": []}),
            ):
                self.plugin._handle_single_agent_detail(
                    current_map=current_map,
                    agent_id=self._AGENT_ID,
                    detail_data=self._DETAIL_DATA,
                    skipped_no_tools=empty_tool_agent_ids,
                )
        return current_map

    def test_mounted_objects_contains_object_codes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        current_map = self._run(monkeypatch)
        cfg = current_map.get(self._AGENT_ID)
        assert cfg is not None
        mounted = cfg.extra.get("mounted_objects")
        assert "Product" in mounted, (
            f"ontology_query 模式 mounted_objects 应含对象编码，实际: {mounted}"
        )

    def test_loader_in_extra_is_not_none(self, monkeypatch: pytest.MonkeyPatch) -> None:
        current_map = self._run(monkeypatch)
        cfg = current_map.get(self._AGENT_ID)
        assert cfg is not None
        assert cfg.extra.get("loader") is not None, (
            "ontology_query 模式 loader 不应为 None"
        )

    def test_no_data_query_prefix_tools(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """ontology_query 模式下不应挂载 data_query_ 前缀工具。"""
        current_map = self._run(monkeypatch)
        cfg = current_map.get(self._AGENT_ID)
        assert cfg is not None
        for key in cfg.tools:
            assert not key.startswith("data_query_"), (
                f"不应有 data_query_ 前缀工具: {key}"
            )

    def test_tool_metadata_contains_resource_codes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """ontology_query 模式下 tool_metadata 包含 query_ 和 data_query_ 两种键。"""
        current_map = self._run(monkeypatch)
        cfg = current_map.get(self._AGENT_ID)
        assert cfg is not None
        metadata = cfg.extra.get("tool_metadata")
        assert metadata is not None
        assert "query_Product" in metadata
        assert metadata["query_Product"]["resource_code"] == "Product"
        assert "data_query_Product" in metadata

    def test_default_mode_behaves_as_ontology_query(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """未设置 ONTOLOGY_LOAD_MODE 时，行为与 ontology_query 一致。"""
        monkeypatch.delenv("ONTOLOGY_LOAD_MODE", raising=False)

        current_map: dict = {}
        with patch.object(
            self.plugin, "_build_shared_loader", return_value=self.mock_loader
        ):
            with patch.object(
                self.plugin,
                "_build_dynamic_tools_with_diagnostics",
                return_value=({}, {"reason_summary": []}),
            ):
                self.plugin._handle_single_agent_detail(
                    current_map=current_map,
                    agent_id=self._AGENT_ID,
                    detail_data=self._DETAIL_DATA,
                    skipped_no_tools=[],
                )
        cfg = current_map.get(self._AGENT_ID)
        assert cfg is not None
        mounted = cfg.extra.get("mounted_objects")
        assert "Product" in mounted
