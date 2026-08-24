from pathlib import Path
import unittest


SKILL_ROOT = Path(__file__).parents[1] / "skills" / "knowledge-organizer"


class KnowledgeOrganizerScopeTests(unittest.TestCase):
    def test_parent_delegates_operations_without_initialization(self) -> None:
        content = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

        self.assertIn("入库、导入、登记、附加", content)
        self.assertIn("`by-knowledge-manager`", content)
        self.assertIn("只执行资料入库", content)
        self.assertIn("不得追加实体发现或补全", content)
        self.assertIn("不会扩大操作范围", content)
        self.assertNotIn("`init`", content)
        self.assertNotIn("objects/ods", content)
        self.assertNotIn("objects/ads", content)

    def test_parent_requires_explicit_authorization_for_a_full_chain(self) -> None:
        content = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

        self.assertIn("完整链路", content)
        self.assertIn("同时明确要求", content)
        self.assertIn("逐项执行", content)

    def test_ingest_child_stays_focused_on_ingestion(self) -> None:
        content = (SKILL_ROOT / "knowledge-organizer-ingest" / "SKILL.md").read_text(
            encoding="utf-8"
        )

        self.assertIn("`by-knowledge-manager`", content)
        self.assertIn("`upload`", content)
        self.assertIn("检查同名冲突", content)
        self.assertNotIn("entity-discovery", content)
        self.assertNotIn("entity-enrich", content)
        self.assertNotIn("完整流程", content)

    def test_entity_children_delegate_to_matching_manager_operations(self) -> None:
        organize = (
            SKILL_ROOT / "knowledge-organizer-organize" / "SKILL.md"
        ).read_text(encoding="utf-8")
        build = (SKILL_ROOT / "knowledge-organizer-build" / "SKILL.md").read_text(
            encoding="utf-8"
        )

        self.assertIn("`entity-discovery`", organize)
        self.assertIn("不能位于 `/KnowledgeEntity/`", organize)
        self.assertNotIn("`entity-enrich`", organize)

        self.assertIn("`entity-enrich`", build)
        self.assertIn("`/KnowledgeEntity/`", build)
        self.assertNotIn("`entity-discovery`", build)

    def test_obsolete_cli_and_init_resources_are_removed(self) -> None:
        self.assertFalse((SKILL_ROOT / "knowledge-organizer-init").exists())
        self.assertFalse((SKILL_ROOT / "knowledge-organizer-update-task-status").exists())
        self.assertFalse((SKILL_ROOT / "scripts" / "knowledge_organizer.py").exists())
        self.assertFalse(
            (SKILL_ROOT / "scripts" / "test_knowledge_organizer.py").exists()
        )


if __name__ == "__main__":
    unittest.main()
