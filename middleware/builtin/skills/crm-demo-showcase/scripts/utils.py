"""CRM Demo Showcase 公共工具模块。

提供路径解析、环境检查、脚本执行封装，供 Agent 和脚本共用。
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Any


def get_skill_dir() -> Path:
    """返回 skill 根目录（scripts/ 的父目录）。"""
    return Path(__file__).resolve().parent.parent


def get_venv_python() -> str:
    """返回虚拟环境 Python 解释器路径。"""
    venv_dir = os.environ.get("CRM_VENV_DIR", "/tmp/ont_env")  # noqa: S108
    return str(Path(venv_dir) / "bin" / "python")


def check_venv_ready() -> tuple[bool, str]:
    """检查 Python 虚拟环境是否就绪。

    Returns:
        (ok, msg) — ok=True 表示环境可用，msg 为描述信息。
    """
    python_bin = Path(get_venv_python())
    if not python_bin.is_file():
        return False, f"Python 虚拟环境不存在: {python_bin}，请运行 bash scripts/setup.sh"
    try:
        result = subprocess.run(
            [str(python_bin), "-c", "import by_framework; print('OK')"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        if result.returncode == 0 and "OK" in result.stdout:
            return True, f"环境就绪: {python_bin}"
        return False, f"by_framework 导入失败: {result.stderr.strip()}"
    except FileNotFoundError:
        return False, f"Python 解释器不可用: {python_bin}"
    except subprocess.TimeoutExpired:
        return False, "验证超时"


def check_env_vars(required: list[str] | None = None) -> tuple[bool, list[str]]:
    """检查必需环境变量。

    Args:
        required: 必需变量列表，默认 ["BEYOND_TOKEN", "USER_CODE"]

    Returns:
        (ok, missing) — ok=True 表示全部就绪，missing 为缺失变量列表。
    """
    if required is None:
        required = ["BEYOND_TOKEN", "USER_CODE"]
    missing = [v for v in required if not os.environ.get(v, "").strip()]
    return len(missing) == 0, missing


def run_script(script_rel_path: str, args: list[str] | None = None) -> dict[str, Any]:
    """通过虚拟环境 Python 执行 skill 脚本。

    Args:
        script_rel_path: 相对于 skill 根目录的脚本路径，如 "scripts/ontology/structured/list_mounted_resources.py"
        args: 命令行参数列表（含 JSON 字符串）

    Returns:
        {"ok": True, "stdout": "...", "stderr": "..."} 或 {"ok": False, "error": "..."}
    """
    skill_dir = get_skill_dir()
    script_path = skill_dir / script_rel_path
    python_bin = get_venv_python()

    cmd = [python_bin, str(script_path)]
    if args:
        cmd.extend(args)

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(skill_dir),
            check=False,
        )
        return {
            "ok": result.returncode == 0,
            "stdout": result.stdout.strip(),
            "stderr": result.stderr.strip(),
            "returncode": result.returncode,
        }
    except FileNotFoundError:
        return {"ok": False, "error": f"Python 解释器不可用: {python_bin}"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": f"脚本执行超时: {script_rel_path}"}
