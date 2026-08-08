from pathlib import Path
import unittest


SKILL_ROOT = Path(__file__).parents[1] / "skills" / "knowledge-organizer"


class KnowledgeOrganizerScopeTests(unittest.TestCase):
    def test_parent_limits_ingest_requests_to_init_and_ingest(self) -> None:
        content = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

        self.assertIn("入库、导入、登记、附加", content)
        self.assertIn("只执行 `ingest`", content)
        self.assertIn("不得追加 `organize` 或 `build`", content)
        self.assertIn("后台任务", content)
        self.assertIn("不会扩大操作范围", content)

    def test_parent_requires_explicit_authorization_for_a_full_chain(self) -> None:
        content = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

        self.assertIn("完整链路", content)
        self.assertIn("同时明确要求", content)
        self.assertIn("逐项执行", content)

    def test_ingest_child_stays_focused_on_ingestion(self) -> None:
        content = (SKILL_ROOT / "knowledge-organizer-ingest" / "SKILL.md").read_text(
            encoding="utf-8"
        )

        self.assertIn("逐个独立处理文件", content)
        self.assertIn("只读取初始化结果 `objects/ods/`", content)
        self.assertNotIn("`organize`", content)
        self.assertNotIn("`build`", content)
        self.assertNotIn("完整流程", content)
        self.assertNotIn("主 Skill", content)

    def test_background_init_never_falls_back_to_agent_scope(self) -> None:
        content = (SKILL_ROOT / "knowledge-organizer-init" / "SKILL.md").read_text(
            encoding="utf-8"
        )

        self.assertIn("不得改传 `--digital-employee-resource-id`", content)
        self.assertIn("停止并汇报", content)


if __name__ == "__main__":
    unittest.main()
