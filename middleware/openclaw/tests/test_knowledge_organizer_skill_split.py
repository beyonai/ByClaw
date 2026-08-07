from pathlib import Path
import re
import unittest


SKILLS_ROOT = Path(__file__).parents[1] / "skills"
ORGANIZER_ROOT = SKILLS_ROOT / "knowledge-organizer"
PARENT = ORGANIZER_ROOT / "SKILL.md"
CHILD_COMMANDS = {
    "knowledge-organizer-init": "init",
    "knowledge-organizer-ingest": "ingest",
    "knowledge-organizer-organize": "organize",
    "knowledge-organizer-build": "build",
}


class KnowledgeOrganizerSkillSplitTests(unittest.TestCase):
    def test_each_workflow_stage_has_a_discoverable_skill_with_one_cli_command(self) -> None:
        for skill_name, command in CHILD_COMMANDS.items():
            path = ORGANIZER_ROOT / skill_name / "SKILL.md"
            self.assertTrue(path.is_file(), path)
            content = path.read_text(encoding="utf-8")
            self.assertRegex(content, re.compile(rf"^name: {re.escape(skill_name)}$", re.MULTILINE), path)
            commands = re.findall(r"knowledge_organizer\.py\s+(init|ingest|organize|build)", content)
            self.assertTrue(commands, path)
            self.assertEqual(set(commands), {command}, path)

    def test_parent_skill_routes_to_all_children_and_remains_the_orchestrator(self) -> None:
        content = PARENT.read_text(encoding="utf-8")
        for skill_name in CHILD_COMMANDS:
            self.assertIn(skill_name, content)
        self.assertIn("总编排", content)

    def test_parent_distinguishes_new_tasks_from_continuations(self) -> None:
        content = PARENT.read_text(encoding="utf-8")
        self.assertIn("只有新任务或执行 `init` 时", content)
        self.assertIn("同一任务的后续阶段必须沿用", content)
        self.assertIn("本目录规定的四个子 skill", content)
        self.assertIn("数字员工资源 ID 仅是 init 阶段的前置条件", content)

    def test_organize_resume_preserves_an_explicit_object_scope(self) -> None:
        content = (ORGANIZER_ROOT / "knowledge-organizer-organize" / "SKILL.md").read_text(encoding="utf-8")
        resume_section = content.split("中断或失败文件只能使用 CLI 恢复：", maxsplit=1)[1]
        self.assertIn("--resume", resume_section)
        self.assertIn("--object-code", resume_section)
        self.assertIn("不会自动恢复对象白名单", resume_section)


if __name__ == "__main__":
    unittest.main()
