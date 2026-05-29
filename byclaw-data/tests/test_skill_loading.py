"""Skill 加载与占位符替换的纯函数级单元测试。

覆盖验收用例：
  用例1  prompt 类 skill 正常激活（占位符替换）
  用例2  占位符对应 tool 未挂载时追加 warning
  用例3  resource_list 无 SKILL 条目时返回 None
  用例4  SKILL.md 文件不存在时静默跳过
  用例5  多个 SKILL 条目合并
  用例6  compute 占位符替换
  用例7  action 占位符替换
  用例8  大小写、空白边界处理
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from byclaw_data.worker import (
    _extract_skill_resource_ids,
    _load_skills,
    _replace_skill_placeholders,
)


# ─────────────────────────────────────────────────────────────────────────────
# _extract_skill_resource_ids
# ─────────────────────────────────────────────────────────────────────────────


class TestExtractSkillResourceIds:
    def test_empty_list(self) -> None:
        assert _extract_skill_resource_ids([]) == []

    def test_single_skill(self) -> None:
        rl: list[Any] = [
            {
                "resourceType": "SKILL",
                "resourceId": "/.openclaw/workspace-baiying-agent-10000289/skills/老鹰-战略全局分析",
                "resourceCode": None,
            }
        ]
        assert _extract_skill_resource_ids(rl) == [
            "/.openclaw/workspace-baiying-agent-10000289/skills/老鹰-战略全局分析"
        ]

    def test_non_skill_types_ignored(self) -> None:
        rl: list[Any] = [
            {"resourceType": "OBJECT", "resouceCode": "by_project"},
            {"resourceType": "VIEW", "resouceCode": "scene_crm"},
            {"resourceType": "DIG_EMPLOYEE", "resourceId": "10000289"},
            {
                "resourceType": "SKILL",
                "resourceId": "/.openclaw/skills/老鹰",
                "resourceCode": None,
            },
        ]
        assert _extract_skill_resource_ids(rl) == ["/.openclaw/skills/老鹰"]

    def test_multiple_skills(self) -> None:
        rl: list[Any] = [
            {"resourceType": "SKILL", "resourceId": "/.openclaw/skills/老鹰"},
            {"resourceType": "SKILL", "resourceId": "/.openclaw/skills/猎手"},
        ]
        assert _extract_skill_resource_ids(rl) == [
            "/.openclaw/skills/老鹰",
            "/.openclaw/skills/猎手",
        ]

    def test_case_insensitive_resource_type(self) -> None:
        rl: list[Any] = [
            {"resourceType": "skill", "resourceId": "/.openclaw/skills/老鹰"},
            {"resourceType": "Skill", "resourceId": "/.openclaw/skills/猎手"},
        ]
        assert _extract_skill_resource_ids(rl) == [
            "/.openclaw/skills/老鹰",
            "/.openclaw/skills/猎手",
        ]

    def test_empty_resource_id_skipped(self) -> None:
        rl: list[Any] = [
            {"resourceType": "SKILL", "resourceId": ""},
            {"resourceType": "SKILL", "resourceId": "  "},
            {"resourceType": "SKILL", "resourceId": "/.openclaw/skills/老鹰"},
        ]
        assert _extract_skill_resource_ids(rl) == ["/.openclaw/skills/老鹰"]

    def test_non_dict_items_skipped(self) -> None:
        rl: list[Any] = [
            "not-a-dict",
            None,
            {"resourceType": "SKILL", "resourceId": "/.openclaw/skills/老鹰"},
        ]
        assert _extract_skill_resource_ids(rl) == ["/.openclaw/skills/老鹰"]


# ─────────────────────────────────────────────────────────────────────────────
# _replace_skill_placeholders
# ─────────────────────────────────────────────────────────────────────────────


class TestReplaceSkillPlaceholders:
    TOOLS: dict[str, Any] = {
        "query_scene_crm_comprehensive_analysis": object(),
        "compute_scene_crm_comprehensive_analysis": object(),
        "create_project_by_project": object(),
    }

    def test_query_placeholder_replaced(self) -> None:
        content = "调用 {{query:scene_crm_comprehensive_analysis}}"
        result, warnings = _replace_skill_placeholders(content, self.TOOLS)
        assert result == "调用 query_scene_crm_comprehensive_analysis"
        assert warnings == []

    def test_compute_placeholder_replaced(self) -> None:
        content = "调用 {{compute:scene_crm_comprehensive_analysis}}"
        result, warnings = _replace_skill_placeholders(content, self.TOOLS)
        assert result == "调用 compute_scene_crm_comprehensive_analysis"
        assert warnings == []

    def test_action_placeholder_replaced(self) -> None:
        content = "调用 {{action:by_project:create_project}}"
        result, warnings = _replace_skill_placeholders(content, self.TOOLS)
        assert result == "调用 create_project_by_project"
        assert warnings == []

    def test_unknown_tool_keeps_placeholder_and_adds_warning(self) -> None:
        content = "调用 {{query:nonexistent_view}}"
        result, warnings = _replace_skill_placeholders(content, self.TOOLS)
        assert "{{query:nonexistent_view}}" in result
        assert len(warnings) == 1
        assert "query_nonexistent_view" in warnings[0]
        assert "未挂载" in warnings[0]

    def test_multiple_placeholders_in_one_content(self) -> None:
        content = (
            "第1步：{{query:scene_crm_comprehensive_analysis}}\n"
            "第2步：{{compute:scene_crm_comprehensive_analysis}}"
        )
        result, warnings = _replace_skill_placeholders(content, self.TOOLS)
        assert "query_scene_crm_comprehensive_analysis" in result
        assert "compute_scene_crm_comprehensive_analysis" in result
        assert warnings == []

    def test_no_placeholders_unchanged(self) -> None:
        content = "这是一段没有占位符的文本"
        result, warnings = _replace_skill_placeholders(content, self.TOOLS)
        assert result == content
        assert warnings == []

    def test_mixed_known_and_unknown(self) -> None:
        content = "{{query:scene_crm_comprehensive_analysis}} 和 {{query:missing}}"
        result, warnings = _replace_skill_placeholders(content, self.TOOLS)
        assert "query_scene_crm_comprehensive_analysis" in result
        assert "{{query:missing}}" in result
        assert len(warnings) == 1


# ─────────────────────────────────────────────────────────────────────────────
# _load_skills
# ─────────────────────────────────────────────────────────────────────────────


class TestLoadSkills:
    TOOLS: dict[str, Any] = {
        "query_scene_crm_comprehensive_analysis": object(),
        "compute_scene_crm_comprehensive_analysis": object(),
    }

    def test_no_skill_in_resource_list_returns_none(self) -> None:
        rl: list[Any] = [
            {"resourceType": "OBJECT", "resouceCode": "by_project"},
        ]
        result = _load_skills(rl, "0027024630", self.TOOLS)
        assert result is None

    def test_skill_md_not_found_returns_none(self, tmp_path: Path) -> None:
        rl: list[Any] = [
            {
                "resourceType": "SKILL",
                "resourceId": "/.openclaw/skills/老鹰",
            }
        ]
        with patch.dict(os.environ, {"FILE_STORAGE_MINIO_MOUNT_PATH": str(tmp_path)}):
            result = _load_skills(rl, "0027024630", self.TOOLS)
        assert result is None

    def test_skill_md_loaded_and_placeholder_replaced(self, tmp_path: Path) -> None:
        skill_dir = (
            tmp_path
            / "byclaw-0027024630"
            / "by"
            / ".openclaw"
            / "skills"
            / "老鹰"
        )
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            "调用 {{query:scene_crm_comprehensive_analysis}}", encoding="utf-8"
        )

        rl: list[Any] = [
            {
                "resourceType": "SKILL",
                "resourceId": "/.openclaw/skills/老鹰",
            }
        ]
        with patch.dict(os.environ, {"FILE_STORAGE_MINIO_MOUNT_PATH": str(tmp_path)}):
            result = _load_skills(rl, "0027024630", self.TOOLS)

        assert result is not None
        task_prompt, skill_ws = result
        assert "query_scene_crm_comprehensive_analysis" in task_prompt
        assert "老鹰" in skill_ws

    def test_warning_appended_for_missing_tool(self, tmp_path: Path) -> None:
        skill_dir = (
            tmp_path / "byclaw-0027024630" / "by" / ".openclaw" / "skills" / "老鹰"
        )
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            "调用 {{query:nonexistent}}", encoding="utf-8"
        )

        rl: list[Any] = [{"resourceType": "SKILL", "resourceId": "/.openclaw/skills/老鹰"}]
        with patch.dict(os.environ, {"FILE_STORAGE_MINIO_MOUNT_PATH": str(tmp_path)}):
            result = _load_skills(rl, "0027024630", self.TOOLS)

        assert result is not None
        task_prompt, _ = result
        assert "⚠️" in task_prompt
        assert "query_nonexistent" in task_prompt

    def test_multiple_skills_merged(self, tmp_path: Path) -> None:
        for name in ("老鹰", "猎手"):
            skill_dir = (
                tmp_path / "byclaw-0027024630" / "by" / ".openclaw" / "skills" / name
            )
            skill_dir.mkdir(parents=True)
            (skill_dir / "SKILL.md").write_text(f"# {name}", encoding="utf-8")

        rl: list[Any] = [
            {"resourceType": "SKILL", "resourceId": "/.openclaw/skills/老鹰"},
            {"resourceType": "SKILL", "resourceId": "/.openclaw/skills/猎手"},
        ]
        with patch.dict(os.environ, {"FILE_STORAGE_MINIO_MOUNT_PATH": str(tmp_path)}):
            result = _load_skills(rl, "0027024630", self.TOOLS)

        assert result is not None
        task_prompt, skill_ws = result
        assert "老鹰" in task_prompt
        assert "猎手" in task_prompt
        assert "老鹰" in skill_ws  # first skill path

    def test_default_minio_path_used_when_env_not_set(self, tmp_path: Path) -> None:
        """无 FILE_STORAGE_MINIO_MOUNT_PATH 时不抛异常，文件不存在则返回 None。"""
        rl: list[Any] = [{"resourceType": "SKILL", "resourceId": "/.openclaw/skills/老鹰"}]
        env = {k: v for k, v in os.environ.items() if k != "FILE_STORAGE_MINIO_MOUNT_PATH"}
        with patch.dict(os.environ, env, clear=True):
            result = _load_skills(rl, "0027024630", self.TOOLS)
        assert result is None
