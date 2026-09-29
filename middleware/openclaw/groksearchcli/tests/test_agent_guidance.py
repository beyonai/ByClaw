from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


PROJECT_DIR = Path(__file__).resolve().parents[1]
GUIDE = PROJECT_DIR / "AGENT_SKILL_DEVELOPMENT.md"
SKILL = PROJECT_DIR / "examples" / "grok-research-agent" / "SKILL.md"
RUNNER = PROJECT_DIR / "examples" / "grok-research-agent" / "scripts" / "run.py"


class AgentGuidanceTests(unittest.TestCase):
    def test_guide_closes_baseline_agent_failure_modes(self):
        text = GUIDE.read_text(encoding="utf-8")
        for required in (
            "describe research run",
            "同一个请求",
            "shell=False",
            "returncode",
            'payload.get("ok")',
            "retryable",
            "XAI_API_KEY",
            "不要解析 `--help`",
            "不要分别调用",
        ):
            with self.subTest(required=required):
                self.assertIn(required, text)

    def test_example_skill_has_valid_frontmatter_and_single_public_entry(self):
        text = SKILL.read_text(encoding="utf-8")
        self.assertTrue(text.startswith("---\nname: grok-research-agent\n"))
        self.assertIn("description: Use when", text)
        self.assertTrue(RUNNER.is_file())
        scripts = [path for path in RUNNER.parent.glob("*") if path.is_file()]
        self.assertEqual([RUNNER], scripts)

    def test_example_runner_builds_one_research_command_and_propagates_result(self):
        sys.path.insert(0, str(RUNNER.parent))
        import run  # type: ignore[import-not-found]

        completed = subprocess.CompletedProcess(
            args=[], returncode=0, stdout='{"ok":true,"data":{"answer":"ok"}}\n', stderr=""
        )
        with patch.object(run.subprocess, "run", return_value=completed) as mocked:
            with patch.object(sys, "argv", [
                "run.py", "topic", "--from-date", "2026-09-01", "--to-date", "2026-09-16",
                "--domain", "example.com", "--handle", "example",
            ]):
                with tempfile.TemporaryFile(mode="w+") as output, patch("sys.stdout", output):
                    exit_code = run.main()
        command = mocked.call_args.args[0]
        self.assertEqual(["groksearchcli", "research", "run"], command[:3])
        self.assertEqual(1, command.count("groksearchcli"))
        self.assertIn("--allow-domain", command)
        self.assertIn("--allow-handle", command)
        self.assertFalse(mocked.call_args.kwargs["shell"])
        self.assertEqual(0, exit_code)


if __name__ == "__main__":
    unittest.main()
