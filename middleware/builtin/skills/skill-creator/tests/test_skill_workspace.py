#!/usr/bin/env python3
import tempfile
import unittest
from pathlib import Path
import sys
import types
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
if "yaml" not in sys.modules:
    sys.modules["yaml"] = types.SimpleNamespace(
        safe_load=lambda text: {
            key.strip(): value.strip()
            for line in text.splitlines()
            if ":" in line
            for key, value in [line.split(":", 1)]
        },
        YAMLError=ValueError,
    )
import skill_workspace
from skill_workspace import copy_skill_for_edit, fixed_skills_root, validate_output_root
from quick_validate import validate_skill


class SkillWorkspaceTests(unittest.TestCase):
    def test_skill_text_mentioning_a_cli_does_not_require_resource_mate(self):
        with tempfile.TemporaryDirectory() as directory:
            skill = Path(directory) / "documentation-only-skill"
            skill.mkdir()
            (skill / "SKILL.md").write_text(
                "---\nname: documentation-only-skill\ndescription: Explain callcli.\n---\ncallcli is documented here.",
                encoding="utf-8",
            )

            self.assertEqual(validate_skill(skill), (True, "Skill is valid!"))

    def test_script_calling_callcli_requires_a_matching_resource_mate_entry(self):
        with tempfile.TemporaryDirectory() as directory:
            skill = Path(directory) / "callcli-skill"
            scripts = skill / "scripts"
            scripts.mkdir(parents=True)
            (skill / "SKILL.md").write_text(
                "---\nname: callcli-skill\ndescription: Invoke a platform capability.\n---\n",
                encoding="utf-8",
            )
            (scripts / "run.py").write_text('subprocess.run(["callcli", "invoke"])', encoding="utf-8")

            valid, message = validate_skill(skill)

            self.assertFalse(valid)
            self.assertIn("references/resourceMate.json", message)

    def test_resource_mate_declares_each_resource_client_used_by_scripts(self):
        with tempfile.TemporaryDirectory() as directory:
            skill = Path(directory) / "combined-cli-skill"
            references = skill / "references"
            references.mkdir(parents=True)
            (skill / "SKILL.md").write_text(
                "---\nname: combined-cli-skill\ndescription: Use platform resources.\n---\n",
                encoding="utf-8",
            )
            scripts = skill / "scripts"
            scripts.mkdir()
            (scripts / "run.py").write_text('subprocess.run(["callcli"]); subprocess.run(["kbcli"])', encoding="utf-8")
            (references / "resourceMate.json").write_text(
                '{"resources":[{"resourceId":"2001","resourceType":"TOOL"},{"resourceId":"3001","resourceType":"KNOWLEDGE_BASE"}]}',
                encoding="utf-8",
            )

            self.assertEqual(validate_skill(skill), (True, "Skill is valid!"))

    def test_scripts_using_knowledge_base_and_toolset_require_resource_mate(self):
        with tempfile.TemporaryDirectory() as directory:
            skill = Path(directory) / "resource-backed-skill"
            scripts = skill / "scripts"
            scripts.mkdir(parents=True)
            (skill / "SKILL.md").write_text(
                "---\nname: resource-backed-skill\ndescription: Use resources.\n---\n",
                encoding="utf-8",
            )
            (scripts / "run.py").write_text(
                'subprocess.run(["kdcli", "search"]); toolset.invoke("default"); knowledge_base.search("kb")',
                encoding="utf-8",
            )

            valid, message = validate_skill(skill)

            self.assertFalse(valid)
            self.assertIn("references/resourceMate.json", message)

    def test_fixed_workspace_uses_the_current_byclaw_agent_id(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict("os.environ", {"DSH_BYCLAW_AGENT_ID": "10004452", "BYCLAW_AGENT_ID": "10004452"}, clear=False):
                with patch.object(skill_workspace, "WORKSPACE_ROOT", Path(directory)):
                    expected = (Path(directory) / "workspace-baiying-agent-10004452/skills").resolve()
                    self.assertEqual(fixed_skills_root(), expected)
                    self.assertEqual(validate_output_root(expected), expected)
                    self.assertTrue(expected.is_dir())

    def test_model_supplied_agent_id_cannot_override_trusted_identity(self):
        with patch.dict("os.environ", {"DSH_BYCLAW_AGENT_ID": "11197678", "BYCLAW_AGENT_ID": "20044197"}, clear=False):
            with self.assertRaisesRegex(ValueError, "does not match trusted"):
                fixed_skills_root()

    def test_init_output_must_be_the_fixed_skills_root(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                validate_output_root(Path(directory))

    def test_external_skill_is_copied_into_workspace_before_editing(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "external"
            workspace_root = Path(directory) / "workspace"
            target_root = workspace_root / "workspace-baiying-agent-10004452" / "skills"
            source.mkdir()
            (source / "SKILL.md").write_text("---\nname: demo\ndescription: Demo\n---\n", encoding="utf-8")

            with patch.dict("os.environ", {"DSH_BYCLAW_AGENT_ID": "10004452", "BYCLAW_AGENT_ID": "10004452"}, clear=False):
                with patch.object(skill_workspace, "WORKSPACE_ROOT", workspace_root):
                    target = copy_skill_for_edit(source, "demo", target_root=target_root)

            self.assertEqual(target, target_root.resolve() / "demo")
            self.assertTrue((target / "SKILL.md").is_file())
            self.assertFalse((target / "SKILL.md").samefile(source / "SKILL.md"))


if __name__ == "__main__":
    unittest.main()
