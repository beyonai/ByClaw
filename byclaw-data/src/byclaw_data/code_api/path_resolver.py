"""双轨路径解析器：importlib 优先，metadata.rootPath 回退。"""
from __future__ import annotations

import importlib
import logging
import os
from pathlib import Path
from typing import Dict, Optional

logger = logging.getLogger(__name__)

# 图谱文件名（不含 .json）→ Python 包名
_PACKAGE_NAME_MAP: Dict[str, str] = {
    "datacloud-analysis":  "datacloud_analysis",
    "datacloud-data":      "datacloud_data_sdk",
    "datacloud-knowledge": "datacloud_knowledge",
    "datacloud-platform":  "datacloud_platform",
    "byclaw-data":         "byclaw_data",
}


class PathResolver:
    """
    双轨路径解析器：
    - 策略1（生产）：importlib 运行时定位已安装包，自动适配任意部署路径
    - 策略2（开发）：回退到索引文件的 metadata.rootPath
    """

    def __init__(self) -> None:
        # 来自 metadata.rootPath，仅作开发回退
        self._index_roots: Dict[str, str] = {}

    def register(self, package_name: str, index_root_path: str) -> None:
        """adapter 加载图谱时调用，记录 metadata.rootPath。"""
        self._index_roots[package_name] = index_root_path

    def resolve(self, relative_path: str, package_name: str) -> Optional[str]:
        """
        将索引中的相对路径解析为当前环境的绝对路径。

        Args:
            relative_path: 标准化路径，如 "datacloud_analysis/orchestration/state.py"
            package_name:  图谱文件名（不含 .json），如 "datacloud-analysis"
        """
        # 策略1：importlib 运行时定位
        python_pkg = _PACKAGE_NAME_MAP.get(package_name)
        if python_pkg:
            result = self._resolve_via_importlib(relative_path, python_pkg)
            if result is not None:
                return result

        # 策略2：metadata.rootPath 回退
        return self._resolve_via_index_root(relative_path, package_name)

    def _resolve_via_importlib(
        self, relative_path: str, python_pkg: str
    ) -> Optional[str]:
        """
        通过 importlib 定位已安装包根目录，拼接相对路径。

        原理：
          importlib.import_module("datacloud_analysis").__file__
          → /workspace/.venv/.../datacloud_analysis/__init__.py
          → 包根目录 = /workspace/.venv/.../datacloud_analysis/

        relative_path 形如 "datacloud_analysis/orchestration/state.py"，
        去掉第一段（包名前缀）后与包根目录拼接。
        """
        try:
            pkg = importlib.import_module(python_pkg)
            pkg_root = Path(os.path.dirname(pkg.__file__))

            parts = relative_path.split("/")
            sub_path = "/".join(parts[1:]) if parts and parts[0] == python_pkg else relative_path
            if not sub_path:
                return None

            candidate = pkg_root / sub_path
            if candidate.exists():
                return str(candidate.resolve())

            # 文件不存在也返回推断路径（生产包结构差异时供展示用）
            logger.debug("[PathResolver] importlib path not found on disk: %s", candidate)
            return str(candidate.resolve())

        except ImportError:
            logger.debug(
                "[PathResolver] package not installed: %s, fallback to index root", python_pkg
            )
            return None

    def _resolve_via_index_root(
        self, relative_path: str, package_name: str
    ) -> Optional[str]:
        """回退：用 metadata.rootPath 拼接（本地开发、包未安装时）。"""
        root = self._index_roots.get(package_name)
        if not root:
            return None
        for candidate in [
            Path(root) / "src" / relative_path,  # src 布局
            Path(root) / relative_path,           # 平铺布局
        ]:
            if candidate.exists():
                return str(candidate.resolve())
        # 文件不存在也返回推断路径
        return str((Path(root) / "src" / relative_path).resolve())
