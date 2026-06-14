"""路径B：skill 自动发现相关纯函数级单元测试。

catalog 函数已迁移到 datacloud_analysis.skills.catalog（SDK）。
worker.py 只保留路径构建 (_extract_rel_skills, _build_skill_dirs)。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from byclaw_data.worker import _extract_rel_skills
from datacloud_analysis.skills.catalog import (
    _SKILL_CATALOG_CACHE,
    _SKILL_CATALOG_TTL,
    build_available_skills_xml,
    parse_skill_frontmatter,
    scan_skill_catalog,
)


# ─────────────────────────────────────────────────────────────────────────────
# 辅助
# ─────────────────────────────────────────────────────────────────────────────


def _write_skill(root: Path, name: str, description: str = "描述文本") -> Path:
    d = root / name
    d.mkdir(parents=True, exist_ok=True)
    (d / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: {description}\n---\n# body",
        encoding="utf-8",
    )
    return d


# ─────────────────────────────────────────────────────────────────────────────
# _extract_rel_skills（仍在 worker.py）
# ─────────────────────────────────────────────────────────────────────────────


class TestExtractRelSkills:
    def test_list_format(self) -> None:
        agent_list: list[Any] = [{"relSkills": ["skill-A", "skill-B"]}]
        assert _extract_rel_skills(agent_list) == {"skill-A", "skill-B"}

    def test_json_string_format(self) -> None:
        agent_list: list[Any] = [{"relSkills": json.dumps(["skill-A"])}]
        assert _extract_rel_skills(agent_list) == {"skill-A"}

    def test_empty_list(self) -> None:
        assert _extract_rel_skills([]) == set()

    def test_no_rel_skills_key(self) -> None:
        assert _extract_rel_skills([{"name": "agent"}]) == set()

    def test_rel_skills_empty_list(self) -> None:
        assert _extract_rel_skills([{"relSkills": []}]) == set()

    def test_non_dict_agent(self) -> None:
        assert _extract_rel_skills(["not-a-dict"]) == set()  # type: ignore[list-item]

    def test_whitespace_stripped(self) -> None:
        agent_list: list[Any] = [{"relSkills": [" skill-A ", " skill-B"]}]
        assert _extract_rel_skills(agent_list) == {"skill-A", "skill-B"}


# ─────────────────────────────────────────────────────────────────────────────
# parse_skill_frontmatter（SDK）
# ─────────────────────────────────────────────────────────────────────────────


class TestParseSkillFrontmatter:
    def test_inline_description(self, tmp_path: Path) -> None:
        _write_skill(tmp_path, "老鹰", "战略全局分析")
        result = parse_skill_frontmatter(tmp_path / "老鹰")
        assert result is not None
        assert result["name"] == "老鹰"
        assert "战略全局分析" in result["description"]
        assert "SKILL.md" in result["location"]

    def test_multiline_description(self, tmp_path: Path) -> None:
        d = tmp_path / "skill-x"
        d.mkdir()
        (d / "SKILL.md").write_text(
            "---\nname: skill-x\ndescription: |\n  第一行\n  第二行\n---\nbody",
            encoding="utf-8",
        )
        result = parse_skill_frontmatter(d)
        assert result is not None
        assert "第一行" in result["description"]

    def test_missing_description_returns_none(self, tmp_path: Path) -> None:
        d = tmp_path / "no-desc"
        d.mkdir()
        (d / "SKILL.md").write_text("---\nname: no-desc\n---\nbody", encoding="utf-8")
        assert parse_skill_frontmatter(d) is None

    def test_missing_name_returns_none(self, tmp_path: Path) -> None:
        d = tmp_path / "no-name"
        d.mkdir()
        (d / "SKILL.md").write_text(
            "---\ndescription: some desc\n---\nbody", encoding="utf-8"
        )
        assert parse_skill_frontmatter(d) is None

    def test_no_frontmatter_returns_none(self, tmp_path: Path) -> None:
        d = tmp_path / "bare"
        d.mkdir()
        (d / "SKILL.md").write_text("# just markdown, no frontmatter", encoding="utf-8")
        assert parse_skill_frontmatter(d) is None

    def test_missing_skill_md_returns_none(self, tmp_path: Path) -> None:
        d = tmp_path / "empty-dir"
        d.mkdir()
        assert parse_skill_frontmatter(d) is None


# ─────────────────────────────────────────────────────────────────────────────
# build_available_skills_xml（SDK）
# ─────────────────────────────────────────────────────────────────────────────


class TestBuildAvailableSkillsXml:
    def test_empty_returns_empty_string(self) -> None:
        assert build_available_skills_xml([]) == ""

    def test_single_skill_xml(self) -> None:
        skills = [{"name": "老鹰", "description": "战略分析", "location": "/skills/老鹰/SKILL.md"}]
        xml = build_available_skills_xml(skills)
        assert "<available_skills>" in xml
        assert "<name>老鹰</name>" in xml
        assert "<description>战略分析</description>" in xml
        assert "</available_skills>" in xml

    def test_multiple_skills(self) -> None:
        skills = [
            {"name": "老鹰", "description": "战略", "location": "/s/老鹰/SKILL.md"},
            {"name": "猎手", "description": "漏斗", "location": "/s/猎手/SKILL.md"},
        ]
        xml = build_available_skills_xml(skills)
        assert xml.count("<skill>") == 2


# ─────────────────────────────────────────────────────────────────────────────
# scan_skill_catalog（SDK，新签名：显式目录列表）
# ─────────────────────────────────────────────────────────────────────────────


class TestScanSkillCatalog:
    def test_rel_skills_whitelist_filters(self, tmp_path: Path) -> None:
        for name in ("skill-A", "skill-B", "skill-C"):
            _write_skill(tmp_path, name)

        _SKILL_CATALOG_CACHE.clear()
        result = scan_skill_catalog([tmp_path], rel_skills={"skill-A"})

        names = [s["name"] for s in result]
        assert "skill-A" in names
        assert "skill-B" not in names
        assert "skill-C" not in names

    def test_empty_rel_skills_no_filter(self, tmp_path: Path) -> None:
        _write_skill(tmp_path, "skill-A")
        _write_skill(tmp_path, "skill-B")

        _SKILL_CATALOG_CACHE.clear()
        result = scan_skill_catalog([tmp_path], rel_skills=set())

        names = [s["name"] for s in result]
        assert "skill-A" in names
        assert "skill-B" in names

    def test_personal_skill_overrides_agent_skill(self, tmp_path: Path) -> None:
        agent_dir = tmp_path / "agent"
        personal_dir = tmp_path / "personal"
        _write_skill(agent_dir, "老鹰", description="agent版本")
        _write_skill(personal_dir, "老鹰", description="personal版本")

        _SKILL_CATALOG_CACHE.clear()
        result = scan_skill_catalog([agent_dir, personal_dir], rel_skills=set())

        entries = {s["name"]: s for s in result}
        assert "老鹰" in entries
        assert "personal版本" in entries["老鹰"]["description"]

    def test_missing_directories_returns_empty(self, tmp_path: Path) -> None:
        _SKILL_CATALOG_CACHE.clear()
        result = scan_skill_catalog([tmp_path / "nonexistent"], rel_skills=set())
        assert result == []

    def test_invalid_skill_md_skipped(self, tmp_path: Path) -> None:
        broken = tmp_path / "broken"
        broken.mkdir()
        (broken / "SKILL.md").write_text("---\nname: broken\n---\nbody", encoding="utf-8")
        _write_skill(tmp_path, "skill-ok")

        _SKILL_CATALOG_CACHE.clear()
        result = scan_skill_catalog([tmp_path], rel_skills=set())
        names = [s["name"] for s in result]
        assert "skill-ok" in names
        assert "broken" not in names

    def test_cache_hit_within_ttl(self, tmp_path: Path) -> None:
        _write_skill(tmp_path, "skill-A")
        _SKILL_CATALOG_CACHE.clear()

        r1 = scan_skill_catalog([tmp_path], rel_skills=set())
        _write_skill(tmp_path, "skill-B")
        r2 = scan_skill_catalog([tmp_path], rel_skills=set())
        assert r1 == r2

    def test_cache_expired_rescans(self, tmp_path: Path) -> None:
        _write_skill(tmp_path, "skill-A")
        _SKILL_CATALOG_CACHE.clear()

        scan_skill_catalog([tmp_path], rel_skills=set())
        key = next(iter(_SKILL_CATALOG_CACHE))
        ts, cached = _SKILL_CATALOG_CACHE[key]
        _SKILL_CATALOG_CACHE[key] = (ts - _SKILL_CATALOG_TTL - 1, cached)

        _write_skill(tmp_path, "skill-B")
        result = scan_skill_catalog([tmp_path], rel_skills=set())
        names = [s["name"] for s in result]
        assert "skill-A" in names
        assert "skill-B" in names
