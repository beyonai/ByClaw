from pathlib import Path
import unittest


SKILL_ROOT = Path(__file__).parents[1] / "skills" / "knowledge-organizer"
MANAGER_ROOT = Path(__file__).parents[1] / "skills" / "project-cloud-knowledge"


class KnowledgeOrganizerScopeTests(unittest.TestCase):
    def test_parent_delegates_operations_without_initialization(self) -> None:
        content = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

        self.assertIn("入库、导入、登记、附加", content)
        self.assertIn("`project-cloud-knowledge`", content)
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

    def test_project_cloud_entity_operations_require_costed_user_choice(self) -> None:
        parent = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
        entity = (
            MANAGER_ROOT / "project-cloud-knowledge-entity" / "SKILL.md"
        ).read_text(encoding="utf-8")

        self.assertIn("项目云盘授权与成本提示", parent)
        self.assertNotIn("../project-cloud-knowledge", parent)
        self.assertIn("项目云盘支持实体发现和实体补全", entity)
        self.assertIn("不得主动触发", entity)
        self.assertIn("高 Token 消耗、高耗时", entity)
        self.assertIn("用户未明确选择前", entity)
        self.assertIn("任务完成后会推送通知到钉钉", entity)

    def test_ingest_child_stays_focused_on_ingestion(self) -> None:
        content = (SKILL_ROOT / "knowledge-organizer-ingest" / "SKILL.md").read_text(
            encoding="utf-8"
        )

        self.assertIn("`project-cloud-knowledge`", content)
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
        self.assertIn("`--directory-path`", organize)
        self.assertIn("递归处理该目录及其子目录", organize)
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
