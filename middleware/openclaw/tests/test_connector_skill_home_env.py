import re
import unittest
from pathlib import Path


SKILLS_ROOT = Path(__file__).parents[1] / "skills"


class ConnectorSkillHomeEnvironmentContractTest(unittest.TestCase):
    def test_each_connector_maps_namespaced_home_only_for_cli_process(self):
        contracts = {
            "dws/SKILL.md": ("dws", "DWS_HOME"),
            "fws/SKILL.md": ("lark-cli", "LARK_HOME"),
            "wecom/SKILL.md": ("wecom-cli", "WECOM_HOME"),
        }

        for relative_path, (command, variable_name) in contracts.items():
            with self.subTest(skill=relative_path):
                skill = (SKILLS_ROOT / relative_path).read_text(encoding="utf-8")
                self.assertIn("连接器运行时 HOME 隔离（最高优先级）", skill)
                # Additional CLI-specific variables may accompany the isolated HOME.
                self.assertRegex(skill, re.escape(f'HOME="${variable_name}"')
                                 + r'(?:\s+(?!HOME=)[A-Z_][A-Z0-9_]*="[^"\n]*")*\s+'
                                 + re.escape(command) + r'\b')
                self.assertIn(variable_name, skill)
                self.assertIn("父 Skill、子 Skill、scripts 和 references", skill)
                self.assertRegex(skill, r"不得修改(?: OpenClaw |运行时)全局 `HOME`")
                self.assertIn(f'不得执行 `export HOME="${variable_name}"`', skill)


if __name__ == "__main__":
    unittest.main()
