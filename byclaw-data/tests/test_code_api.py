"""code_api 单元测试 — TDD 红阶段。

先写测试，实现文件尚不存在，所有测试将 FAIL。
"""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest


# ────────────────────────────────────────────────────────────────────────────────
# PathResolver
# ────────────────────────────────────────────────────────────────────────────────

class TestPathResolver:
    """PathResolver 双轨策略测试。"""

    def _make_resolver(self):
        from byclaw_data.code_api.path_resolver import PathResolver
        return PathResolver()

    def test_resolve_via_importlib_success(self, tmp_path):
        """importlib 能找到已安装包时，返回绝对路径。"""
        from byclaw_data.code_api.path_resolver import PathResolver

        # 模拟包根目录
        fake_pkg_root = tmp_path / "datacloud_analysis"
        fake_pkg_root.mkdir()
        fake_file = fake_pkg_root / "orchestration" / "state.py"
        fake_file.parent.mkdir(parents=True)
        fake_file.write_text("# state")

        resolver = PathResolver()

        with patch("importlib.import_module") as mock_import:
            mock_pkg = MagicMock()
            mock_pkg.__file__ = str(fake_pkg_root / "__init__.py")
            mock_import.return_value = mock_pkg

            result = resolver.resolve(
                "datacloud_analysis/orchestration/state.py",
                "datacloud-analysis",
            )

        assert result is not None
        assert "state.py" in result

    def test_resolve_fallback_to_index_root(self, tmp_path):
        """importlib ImportError 时回退到 metadata.rootPath。"""
        from byclaw_data.code_api.path_resolver import PathResolver

        fake_root = tmp_path / "datacloud-analysis"
        fake_src = fake_root / "src" / "datacloud_analysis" / "orchestration"
        fake_src.mkdir(parents=True)
        (fake_src / "state.py").write_text("# state")

        resolver = PathResolver()
        resolver.register("datacloud-analysis", str(fake_root))

        with patch("importlib.import_module", side_effect=ImportError):
            result = resolver.resolve(
                "datacloud_analysis/orchestration/state.py",
                "datacloud-analysis",
            )

        assert result is not None
        assert "state.py" in result

    def test_resolve_unknown_package_returns_none(self):
        """未注册且 importlib 也失败时返回 None。"""
        from byclaw_data.code_api.path_resolver import PathResolver

        resolver = PathResolver()
        with patch("importlib.import_module", side_effect=ImportError):
            result = resolver.resolve("some/path.py", "unknown-pkg")
        assert result is None

    def test_register_stores_index_root(self):
        """register 保存 metadata.rootPath 供回退用。"""
        from byclaw_data.code_api.path_resolver import PathResolver

        resolver = PathResolver()
        resolver.register("datacloud-analysis", "/some/root")
        assert resolver._index_roots.get("datacloud-analysis") == "/some/root"


# ────────────────────────────────────────────────────────────────────────────────
# UnderstandAnythingAdapter
# ────────────────────────────────────────────────────────────────────────────────

def _make_graph_json(nodes: list, edges: list | None = None, root_path: str = "/fake/root") -> dict:
    return {
        "metadata": {"rootPath": root_path},
        "nodes": nodes,
        "edges": edges or [],
    }


@pytest.fixture()
def graphs_dir(tmp_path):
    """临时图谱目录，含两个包的 JSON。"""
    d = tmp_path / "graphs"
    d.mkdir()

    pkg_a_graph = _make_graph_json(
        nodes=[
            {
                "id": "file:src/datacloud_analysis/orchestration/state.py",
                "type": "file",
                "filePath": "src/datacloud_analysis/orchestration/state.py",
                "summary": "LangGraph 状态定义，处理 messages 字段",
                "tags": ["state-machine", "ops_agent_trace"],
            },
            {
                "id": "func:src/datacloud_analysis/orchestration/state.py:AgentState",
                "type": "function",
                "name": "AgentState",
                "filePath": "src/datacloud_analysis/orchestration/state.py",
                "lineRange": [13, 127],
                "summary": "AgentState 类，包含 messages",
            },
        ],
        edges=[],
        root_path="/workspace/.venv/lib/python3.12/site-packages",
    )
    (d / "datacloud-analysis.json").write_text(
        json.dumps(pkg_a_graph), encoding="utf-8"
    )
    return d


class TestUnderstandAnythingAdapter:

    def _make_adapter(self, graphs_dir):
        from byclaw_data.code_api.adapter import UnderstandAnythingAdapter
        with patch("importlib.import_module", side_effect=ImportError):
            return UnderstandAnythingAdapter(graphs_dir)

    def test_loads_graphs_on_init(self, graphs_dir):
        """初始化时加载所有 JSON 图谱。"""
        adapter = self._make_adapter(graphs_dir)
        assert len(adapter.nodes_by_id) > 0

    def test_file_path_normalized(self, graphs_dir):
        """filePath 去掉 src/ 前缀，统一正斜杠。"""
        adapter = self._make_adapter(graphs_dir)
        file_nodes = adapter.nodes_by_type.get("file", [])
        assert any(
            "datacloud_analysis/orchestration/state.py" == n["filePath"]
            for n in file_nodes
        )

    def test_find_by_object_matches_tags(self, graphs_dir):
        """find_by_object 按 tags 匹配对象编码。"""
        adapter = self._make_adapter(graphs_dir)
        results = adapter.find_by_object("ops_agent_trace")
        assert len(results) >= 1
        assert any("state.py" in r["filePath"] for r in results)

    def test_find_by_object_matches_summary(self, graphs_dir):
        """find_by_object 按 summary 关键词匹配。"""
        adapter = self._make_adapter(graphs_dir)
        results = adapter.find_by_object("messages")
        assert len(results) >= 1

    def test_search_functions_by_name(self, graphs_dir):
        """search_functions 按函数名关键词搜索。"""
        adapter = self._make_adapter(graphs_dir)
        results = adapter.search_functions("AgentState")
        assert len(results) >= 1
        assert results[0]["name"] == "AgentState"
        assert results[0].get("lineRange") == [13, 127]

    def test_search_functions_by_summary(self, graphs_dir):
        """search_functions 按摘要搜索。"""
        adapter = self._make_adapter(graphs_dir)
        results = adapter.search_functions("messages")
        assert len(results) >= 1

    def test_get_dependencies_no_edges(self, graphs_dir):
        """无边时 imports/imported_by 均为空。"""
        adapter = self._make_adapter(graphs_dir)
        result = adapter.get_dependencies("datacloud_analysis/orchestration/state.py")
        assert result["imports"] == []
        assert result["imported_by"] == []

    def test_get_dependencies_with_edges(self, tmp_path):
        """有 imports 边时正确返回依赖。"""
        from byclaw_data.code_api.adapter import UnderstandAnythingAdapter

        nodes = [
            {
                "id": "file:src/a.py",
                "type": "file",
                "filePath": "src/a.py",
                "summary": "A",
                "tags": [],
            },
            {
                "id": "file:src/b.py",
                "type": "file",
                "filePath": "src/b.py",
                "summary": "B",
                "tags": [],
            },
        ]
        edges = [{"source": "file:src/a.py", "target": "file:src/b.py", "type": "imports"}]
        d = tmp_path / "g"
        d.mkdir()
        (d / "pkg.json").write_text(
            json.dumps(_make_graph_json(nodes, edges)), encoding="utf-8"
        )

        with patch("importlib.import_module", side_effect=ImportError):
            adapter = UnderstandAnythingAdapter(d)

        result = adapter.get_dependencies("a.py")  # 已去除 src/ 前缀
        assert "b.py" in result["imports"]

    def test_package_label_on_nodes(self, graphs_dir):
        """每个节点都有 package 字段。"""
        adapter = self._make_adapter(graphs_dir)
        for node in adapter.nodes_by_id.values():
            assert "package" in node

    def test_result_contains_file_path_absolute_field(self, graphs_dir):
        """find_by_object 结果含 filePathAbsolute（即使为 None）。"""
        adapter = self._make_adapter(graphs_dir)
        results = adapter.find_by_object("ops_agent_trace")
        assert "filePathAbsolute" in results[0]


# ────────────────────────────────────────────────────────────────────────────────
# routes 挂载
# ────────────────────────────────────────────────────────────────────────────────

class TestRoutesMounting:
    """_mount_code_api 路由挂载测试。"""

    def test_routes_mounted_when_index_exists(self, tmp_path, monkeypatch):
        """INDEX_PATH 存在时，路由成功挂载到 app。"""
        # 按 config.py 的路径规则建目录：{ONTOLOGY_PATH}/code_indexes/byclaw-data/graphs/
        index_dir = tmp_path / "code_indexes" / "byclaw-data" / "graphs"
        index_dir.mkdir(parents=True)
        (index_dir / "fake.json").write_text(
            json.dumps(_make_graph_json([])), encoding="utf-8"
        )

        monkeypatch.setenv("DATACLOUD_ONTOLOGY_PATH", str(tmp_path))
        monkeypatch.setenv("CODE_INDEX_TYPE", "graphs")

        from fastapi import FastAPI
        from byclaw_data.code_api import _mount_code_api  # noqa: PLC0415

        app = FastAPI()
        with patch("importlib.import_module", side_effect=ImportError):
            # 临时覆盖 config 模块中的 INDEX_PATH 为正确路径
            import byclaw_data.code_api.config as cfg
            original = cfg.INDEX_PATH
            cfg.INDEX_PATH = index_dir
            try:
                _mount_code_api(app)
            finally:
                cfg.INDEX_PATH = original

        routes = [r.path for r in app.routes]
        assert any("/code/health" in r for r in routes)
        assert any("/code/search/by_object" in r for r in routes)
        assert any("/code/search/functions" in r for r in routes)
        assert any("/code/dependencies" in r for r in routes)

    def test_routes_not_mounted_silently_when_missing(self, tmp_path, monkeypatch):
        """INDEX_PATH 不存在时不抛异常，只打日志。"""
        from fastapi import FastAPI
        from byclaw_data.code_api import _mount_code_api  # noqa: PLC0415
        import byclaw_data.code_api.config as cfg

        app = FastAPI()
        original = cfg.INDEX_PATH
        cfg.INDEX_PATH = tmp_path / "nonexistent"
        try:
            # 不应抛出异常
            _mount_code_api(app)
        finally:
            cfg.INDEX_PATH = original
