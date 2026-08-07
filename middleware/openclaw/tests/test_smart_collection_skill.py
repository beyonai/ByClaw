"""「知识智采」(smart-collection) 内置 Skill 契约测试。

smart-collection 从 knowledge-collection 完整复制而来，作为独立的编排 Skill 存在。
本测试保证：技能目录自洽（不残留旧技能名引用）、与源技能结构一致、
以及 SQL 种子在增量迁移与全新初始化脚本中同时落地。
"""

import unittest
from pathlib import Path


SKILLS_ROOT = Path(__file__).parents[1] / "skills"
SKILL_ROOT = SKILLS_ROOT / "smart-collection"
SOURCE_SKILL_ROOT = SKILLS_ROOT / "knowledge-collection"
REPO_ROOT = Path(__file__).parents[3]
INITDB_DML = REPO_ROOT / "deploy" / "middleware" / "initdb" / "04_dml.sql"
V041_DML = REPO_ROOT / "deploy" / "migrations" / "versions" / "V0.4.1" / "V0.4.1__dml.sql"

SKILL_CODE = "smart-collection"
SKILL_NAME = "知识智采"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class SmartCollectionSkillTest(unittest.TestCase):
    def test_skill_frontmatter_declares_its_own_name(self):
        skill = read(SKILL_ROOT / "SKILL.md")
        self.assertTrue(skill.startswith("---\n"), "SKILL.md 必须以 frontmatter 开头")
        self.assertIn(f"name: {SKILL_CODE}\n", skill)

    def test_interface_display_name_is_the_new_skill_name(self):
        agent_yaml = read(SKILL_ROOT / "agents" / "openai.yaml")
        self.assertIn(f'display_name: "{SKILL_NAME}"', agent_yaml)
        self.assertIn(f"Use ${SKILL_CODE} to collect these sources", agent_yaml)

    def test_no_file_still_references_the_source_skill_name(self):
        """复制体必须自洽：任何残留的 knowledge-collection 引用都会把编排权交回源技能。"""
        offenders = []
        for path in sorted(SKILL_ROOT.rglob("*")):
            if not path.is_file() or path.suffix not in {".md", ".mjs", ".yaml"}:
                continue
            if "knowledge-collection" in read(path):
                offenders.append(str(path.relative_to(SKILL_ROOT)))
        self.assertEqual([], offenders)

    def test_scripts_are_renamed_and_present(self):
        scripts = {p.name for p in (SKILL_ROOT / "scripts").iterdir() if p.is_file()}
        self.assertIn("smart-collection-ingest.mjs", scripts)
        self.assertIn("smart-collection-post-processing.mjs", scripts)
        self.assertNotIn("knowledge-collection-ingest.mjs", scripts)
        self.assertNotIn("knowledge-collection-post-processing.mjs", scripts)

    def test_directory_layout_mirrors_the_source_skill(self):
        def layout(root: Path) -> set[str]:
            return {
                str(p.relative_to(root)).replace("knowledge-collection-", "smart-collection-")
                for p in root.rglob("*")
                if p.is_file()
            }

        self.assertEqual(layout(SOURCE_SKILL_ROOT), layout(SKILL_ROOT))

    def test_source_skill_is_left_untouched(self):
        source_skill = read(SOURCE_SKILL_ROOT / "SKILL.md")
        self.assertIn("name: knowledge-collection\n", source_skill)
        self.assertNotIn(SKILL_CODE, source_skill)


class SmartCollectionSeedSqlTest(unittest.TestCase):
    """SQL 需同时存在于增量迁移与全新初始化脚本，避免两类环境行为分叉。"""

    def sql_files(self) -> list[Path]:
        return [V041_DML, INITDB_DML]

    def test_resource_seed_is_idempotent_in_both_scripts(self):
        for path in self.sql_files():
            sql = read(path)
            with self.subTest(path=path.name):
                self.assertIn(f"'{SKILL_NAME}',", sql)
                self.assertIn(f"'{SKILL_CODE}',", sql)
                self.assertIn(
                    f"SELECT 1 FROM byai.ss_resource WHERE resource_code = '{SKILL_CODE}'",
                    sql,
                )

    def test_ext_skill_and_target_content_are_seeded(self):
        for path in self.sql_files():
            sql = read(path)
            with self.subTest(path=path.name):
                self.assertIn("INSERT INTO byai.ss_res_ext_skill", sql)
                self.assertIn("'SYSTEM_BUILTIN'", sql)
                self.assertIn(f"AND r.resource_code = '{SKILL_CODE}';", sql)

    def test_seed_is_explicit_and_never_copied_from_existing_rows(self):
        migration = read(V041_DML)
        # 不复制库内既有资源的权限行，改为按内置 Skill 范式显式播种。
        self.assertNotIn("INSERT INTO byai.au_privilege_grant", migration)
        self.assertNotIn("resource_code = 'knowledge-collection'", migration)
        # 固定使用种子保留区 resource_id 26。
        self.assertIn("SELECT 26,'BYAI','SKILL','ATOM','知识智采'", migration)

    def test_bundled_skill_catalog_append_is_guarded(self):
        for path in self.sql_files():
            sql = read(path)
            with self.subTest(path=path.name):
                self.assertIn(f'"skillCode":"{SKILL_CODE}"', sql)
                self.assertIn(
                    f"""NOT LIKE '%"skillCode":"{SKILL_CODE}"%'""",
                    sql,
                )

    def test_seed_does_not_delete_or_rename_the_source_resource(self):
        migration = read(V041_DML)
        self.assertNotIn("DELETE FROM byai.ss_resource", migration)
        self.assertNotIn("UPDATE byai.ss_resource", migration)


if __name__ == "__main__":
    unittest.main()
