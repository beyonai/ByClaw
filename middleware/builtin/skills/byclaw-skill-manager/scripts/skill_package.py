#!/usr/bin/env python3
"""
Skill 打包工具

功能:
1. 验证 Skill 目录结构（SKILL.md 必须存在）
2. 打包为 ZIP（排除 __pycache__, *.pyc, .DS_Store 等）
3. 返回 ZIP 路径
"""

import os
import sys
import zipfile
from pathlib import Path
from typing import Optional


class SkillPackageError(Exception):
    """Skill 打包错误"""
    pass


def validate_skill_directory(skill_dir: str) -> bool:
    """
    验证 Skill 目录结构

    Args:
        skill_dir: Skill 源目录

    Returns:
        True if valid

    Raises:
        SkillPackageError: 如果验证失败
    """
    skill_dir = Path(skill_dir)

    if not skill_dir.exists():
        raise SkillPackageError(f"目录不存在: {skill_dir}")

    if not skill_dir.is_dir():
        raise SkillPackageError(f"不是目录: {skill_dir}")

    skill_md = skill_dir / 'SKILL.md'
    if not skill_md.exists():
        raise SkillPackageError(
            f"SKILL.md not found in {skill_dir}\n"
            f"Skill 必须包含 SKILL.md 文件"
        )

    return True


def package_skill(skill_dir: str, output_path: Optional[str] = None) -> str:
    """
    打包 Skill 为 ZIP

    Args:
        skill_dir: Skill 源目录
        output_path: 输出 ZIP 路径（可选，默认为 <skill-name>.zip）

    Returns:
        ZIP 文件路径

    Raises:
        SkillPackageError: 如果打包失败
    """
    skill_dir = Path(skill_dir).resolve()

    # 验证目录
    validate_skill_directory(skill_dir)

    # 确定输出路径
    if not output_path:
        skill_name = skill_dir.name
        output_path = f"{skill_name}.zip"

    output_path = Path(output_path).resolve()

    # 排除规则
    exclude_dirs = {'__pycache__', '.git', '.svn', '.hg', 'node_modules', '.venv', 'venv'}
    exclude_files = {'.DS_Store', 'Thumbs.db', '.gitignore', '.gitkeep'}
    exclude_extensions = {'.pyc', '.pyo', '.pyd', '.so', '.dylib', '.dll'}

    def should_exclude(path: Path) -> bool:
        """判断是否应该排除该路径"""
        # 排除隐藏文件（除了已在 Skill 中的）
        if path.name.startswith('.') and path.name not in {'.gitkeep'}:
            return True

        # 排除特定目录
        if path.is_dir() and path.name in exclude_dirs:
            return True

        # 排除特定文件
        if path.name in exclude_files:
            return True

        # 排除特定扩展名
        if path.suffix in exclude_extensions:
            return True

        return False

    # 打包
    try:
        with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for root, dirs, files in os.walk(skill_dir):
                root_path = Path(root)

                # 过滤目录（修改 dirs 会影响 os.walk 的递归）
                dirs[:] = [d for d in dirs if not should_exclude(root_path / d)]

                for file in files:
                    file_path = root_path / file

                    # 跳过排除的文件
                    if should_exclude(file_path):
                        continue

                    # 计算相对路径
                    arcname = file_path.relative_to(skill_dir)

                    # 添加到 ZIP
                    zipf.write(file_path, arcname)

        # 验证 ZIP 文件
        if not output_path.exists():
            raise SkillPackageError(f"打包失败: {output_path}")

        # 获取文件大小
        size_mb = output_path.stat().st_size / (1024 * 1024)

        return str(output_path), size_mb

    except Exception as e:
        if output_path.exists():
            output_path.unlink()
        raise SkillPackageError(f"打包失败: {e}")


def main():
    """命令行入口"""
    if len(sys.argv) < 2:
        print("Usage: skill_package.py <skill-dir> [output.zip]")
        print("\nExample:")
        print("  skill_package.py ./my-skill")
        print("  skill_package.py ./my-skill my-skill-v1.0.zip")
        sys.exit(1)

    skill_dir = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None

    try:
        zip_path, size_mb = package_skill(skill_dir, output_path)
        print(f"✅ 打包成功: {zip_path} ({size_mb:.2f} MB)")
    except SkillPackageError as e:
        print(f"❌ 打包失败: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
