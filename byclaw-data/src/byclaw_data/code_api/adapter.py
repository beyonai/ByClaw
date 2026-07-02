"""Understand-Anything 图谱适配器：加载多包图谱，构建索引，提供查询接口。"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Dict, List, Optional

from byclaw_data.code_api.path_resolver import PathResolver

logger = logging.getLogger(__name__)


class UnderstandAnythingAdapter:
    """支持多包的 Understand-Anything 图谱适配器。"""

    def __init__(self, graphs_dir: Path) -> None:
        self.graphs_dir = graphs_dir
        self.resolver = PathResolver()
        self.nodes_by_id:     Dict[str, Dict] = {}
        self.nodes_by_type:   Dict[str, List[Dict]] = {}
        self.edges_by_source: Dict[str, List[Dict]] = {}
        self.edges_by_target: Dict[str, List[Dict]] = {}
        self._load_all()

    # ── 加载 ──────────────────────────────────────────────────────────────────

    def _load_all(self) -> None:
        if not self.graphs_dir.exists():
            raise FileNotFoundError(f"[code_api] graphs dir not found: {self.graphs_dir}")
        for json_file in sorted(self.graphs_dir.glob("*.json")):
            self._load_one(json_file, json_file.stem)
            logger.info("[code_api] loaded %s", json_file.stem)

    def _load_one(self, path: Path, pkg: str) -> None:
        graph = json.loads(path.read_text(encoding="utf-8"))

        # 将 metadata.rootPath 注册为开发回退路径
        root = (graph.get("metadata") or {}).get("rootPath", "")
        if root:
            self.resolver.register(pkg, root)

        for node in graph.get("nodes", []):
            node["package"] = pkg

            # 标准化相对路径：去掉 src/ 前缀，统一正斜杠
            fp: str = node.get("filePath", "")
            if fp.startswith("src/"):
                fp = fp[4:]
            node["filePath"] = fp.replace("\\", "/")

            # 解析绝对路径（双轨策略）
            abs_p = self.resolver.resolve(node["filePath"], pkg)
            node["filePathAbsolute"] = abs_p  # 可能为 None

            # 建索引
            self.nodes_by_id[node["id"]] = node
            self.nodes_by_type.setdefault(node["type"], []).append(node)

        for edge in graph.get("edges", []):
            self.edges_by_source.setdefault(edge["source"], []).append(edge)
            self.edges_by_target.setdefault(edge["target"], []).append(edge)

    # ── 查询接口 ──────────────────────────────────────────────────────────────

    def find_by_object(self, object_code: str) -> List[Dict]:
        """按业务对象编码查找相关代码文件（匹配 tags 或 summary）。"""
        kw = object_code.lower()
        return [
            {
                "package": n["package"],
                "filePath": n["filePath"],
                "filePathAbsolute": n.get("filePathAbsolute"),
                "summary": n.get("summary"),
                "tags": n.get("tags", []),
            }
            for n in self.nodes_by_type.get("file", [])
            if kw in n.get("summary", "").lower()
            or object_code in n.get("tags", [])
        ]

    def search_functions(self, keyword: str) -> List[Dict]:
        """按关键词搜索函数/类（匹配 name 或 summary）。"""
        kw = keyword.lower()
        results: List[Dict] = []
        for node_type in ("function", "class"):
            for n in self.nodes_by_type.get(node_type, []):
                if (
                    kw in n.get("summary", "").lower()
                    or kw in n.get("name", "").lower()
                ):
                    results.append(
                        {
                            "package": n["package"],
                            "name": n.get("name"),
                            "filePath": n.get("filePath"),
                            "filePathAbsolute": n.get("filePathAbsolute"),
                            "lineRange": n.get("lineRange"),
                            "summary": n.get("summary"),
                        }
                    )
        return results

    def get_dependencies(self, file_path: str) -> Dict:
        """查询文件的依赖关系（imports / imported_by）。"""
        node: Optional[Dict] = next(
            (n for n in self.nodes_by_type.get("file", []) if n.get("filePath") == file_path),
            None,
        )
        if not node:
            return {"filePath": file_path, "filePathAbsolute": None, "imports": [], "imported_by": []}

        nid = node["id"]
        imports = [
            self.nodes_by_id[e["target"]].get("filePath")
            for e in self.edges_by_source.get(nid, [])
            if e.get("type") == "imports" and e["target"] in self.nodes_by_id
        ]
        imported_by = [
            self.nodes_by_id[e["source"]].get("filePath")
            for e in self.edges_by_target.get(nid, [])
            if e.get("type") == "imports" and e["source"] in self.nodes_by_id
        ]
        return {
            "filePath": file_path,
            "filePathAbsolute": node.get("filePathAbsolute"),
            "imports": imports,
            "imported_by": imported_by,
        }
