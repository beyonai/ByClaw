import importlib.util
import json
import unittest
from pathlib import Path


OPENCLAW_ROOT = Path(__file__).parents[1]
MODULE_PATH = OPENCLAW_ROOT / "byclaw_capability_doctor.py"
SPEC = importlib.util.spec_from_file_location("byclaw_capability_doctor", MODULE_PATH)
doctor = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(doctor)


class ByReachMigrationTest(unittest.TestCase):
    def test_production_image_pins_and_verifies_by_reach_v2(self):
        dockerfile = (OPENCLAW_ROOT / "Dockerfile").read_text(encoding="utf-8")

        self.assertIn("ARG BY_REACH_VERSION=2.0.0b1", dockerfile)
        self.assertIn(
            "ARG BY_REACH_COMMIT=9d4cc902195c180767d283787b980438f80871ad",
            dockerfile,
        )
        self.assertIn(
            "ARG BY_REACH_SHA256=d4b3404ffdbf1247a07c45f85d21a645463cb9968673bbb3cfa048a21d37cb35",
            dockerfile,
        )
        self.assertIn("sovovs/By-Reach/archive/${BY_REACH_COMMIT}.tar.gz", dockerfile)
        self.assertIn('echo "${BY_REACH_SHA256}  /tmp/by-reach.tar.gz" | sha256sum -c -', dockerfile)
        self.assertIn("-c /tmp/by-reach/constraints.txt", dockerfile)
        self.assertIn("by-reach --version | grep -q \"${BY_REACH_VERSION}\"", dockerfile)
        self.assertNotIn("AGENT_REACH_", dockerfile)
        self.assertNotIn("Agent-Reach/archive", dockerfile)
        self.assertNotIn("agent-reach --version", dockerfile)

    def test_by_reach_doctor_is_invoked_and_exposes_schema_v2_provider(self):
        commands = []
        payload = {
            "web": {
                "status": "ok",
                "tier": 0,
                "name": "Any webpage",
                "message": "byCLI web read",
                "backends": ["bycli"],
                "active_backend": "bycli",
            },
            "twitter": {
                "status": "ok",
                "tier": 1,
                "backends": ["twitter-cli", "bycli"],
                "active_backend": "twitter-cli",
            },
        }

        def run_command(argv, timeout):
            commands.append(argv)
            return doctor.CommandResult(0, json.dumps(payload), "")

        result = doctor.check_by_reach(run_command, 1.0)
        report = doctor.build_report(
            result,
            {"status": "ready"},
            {"status": "installed"},
            {"status": "ready"},
            {"status": "ready"},
        )

        self.assertEqual([["by-reach", "doctor", "--json"]], commands)
        self.assertEqual("bycli", result["channels"]["web"]["diagnosticBackend"])
        self.assertEqual("bycli", result["channels"]["web"]["effectiveBackend"])
        self.assertEqual("bycli", result["channels"]["web"]["activeBackend"])
        self.assertEqual("twitter-cli", result["channels"]["twitter"]["diagnosticBackend"])
        self.assertEqual("twitter-cli", result["channels"]["twitter"]["effectiveBackend"])
        self.assertEqual(2, report["schemaVersion"])
        self.assertIn("byReach", report["providers"])
        self.assertNotIn("agentReach", report["providers"])

    def test_vendored_router_keeps_technical_id_but_uses_by_reach_product_surface(self):
        skill_root = OPENCLAW_ROOT / "skills" / "agent-reach"
        skill = (skill_root / "SKILL.md").read_text(encoding="utf-8")
        metadata = (skill_root / "agents" / "openai.yaml").read_text(encoding="utf-8")

        self.assertIn("name: agent-reach", skill)
        self.assertIn("# By-Reach", skill)
        self.assertIn("by-reach doctor --json", skill)
        self.assertIn("~/.by-reach/", skill)
        self.assertIn("`bycli web read --url <URL> --stdout`", skill)
        self.assertIn("twitter-cli", skill)
        self.assertIn("`bycli twitter search`", skill)
        self.assertIn("display_name: \"By-Reach\"", metadata)
        self.assertIn("$agent-reach", metadata)
        self.assertNotIn("Jina Reader", skill)
        self.assertNotIn("Web Reader MCP", skill)
        self.assertNotIn("OpenCLI", skill)


if __name__ == "__main__":
    unittest.main()
