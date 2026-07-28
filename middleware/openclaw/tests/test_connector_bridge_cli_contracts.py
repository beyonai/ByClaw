import json
import re
import unittest
from pathlib import Path


OPENCLAW_DIR = Path(__file__).parents[1]
SMARTPAGE_SKILL = OPENCLAW_DIR / "skills" / "wecom" / "wecomcli-smartpage" / "SKILL.md"
SMARTPAGE_REFERENCE = (
    OPENCLAW_DIR
    / "skills"
    / "wecom"
    / "wecomcli-smartpage"
    / "references"
    / "smartpage-export.md"
)
DOCKERFILES = [OPENCLAW_DIR / "Dockerfile"]
FEISHU_BRIDGE = OPENCLAW_DIR / "skills" / "bycli" / "references" / "feishu-fws-bridge.md"
WECOM_BRIDGE = OPENCLAW_DIR / "skills" / "bycli" / "references" / "wecom-wecomcli-bridge.md"
BYCLI_EVALS = OPENCLAW_DIR / "skills" / "bycli" / "evals" / "evals.json"


class ConnectorBridgeCliContractsTest(unittest.TestCase):
    def test_smartpage_examples_use_wecom_cli_json_option(self):
        for path in (SMARTPAGE_SKILL, SMARTPAGE_REFERENCE):
            with self.subTest(path=path):
                content = path.read_text(encoding="utf-8")
                self.assertIn("smartpage_export_task --json", content)
                self.assertIn("smartpage_get_export_result --json", content)
                self.assertIsNone(re.search(r"smartpage_(?:export_task|get_export_result)\s+'", content))

    def test_full_openclaw_images_pin_verified_connector_versions(self):
        required = (
            "ARG OPENCLI_VERSION=2.1.13",
            "ARG OPENCLI_EXTENSION_VERSION=2.1.13",
            "ARG WECOM_CLI_VERSION=0.1.9",
            "ARG LARKSUITE_CLI_VERSION=1.0.78",
            'test "$(bycli --version)" = "${OPENCLI_VERSION}"',
            'test "$(wecom-cli --version)" = "wecom-cli ${WECOM_CLI_VERSION}"',
            'test "$(lark-cli --version)" = "lark-cli version ${LARKSUITE_CLI_VERSION}"',
            "wecom-cli doc smartpage_export_task --schema",
            "wecom-cli doc smartpage_get_export_result --schema",
            "lark-cli minutes +detail --help",
            "grep -q -- '--output-dir'",
        )

        for path in DOCKERFILES:
            with self.subTest(path=path):
                content = path.read_text(encoding="utf-8")
                for expected in required:
                    self.assertIn(expected, content)

    def test_feishu_minutes_are_materialized_as_ingest_ready_markdown(self):
        content = FEISHU_BRIDGE.read_text(encoding="utf-8")
        required = (
            "--transcript",
            '--output-dir "<runDir>/raw/minutes"',
            "read the generated transcript file",
            "markdown/transcript.md",
            "bycli_filter",
            "knowledge-ingest",
        )
        for expected in required:
            self.assertIn(expected, content)

    def test_wecom_export_content_is_materialized_as_ingest_ready_markdown(self):
        content = WECOM_BRIDGE.read_text(encoding="utf-8")
        required = (
            "smartpage_get_export_result --json",
            "content",
            "markdown/document.md",
            "bycli_filter",
            "knowledge-ingest",
        )
        for expected in required:
            self.assertIn(expected, content)

    def test_connector_evals_cover_data_return_and_ingest_handoff(self):
        evals = {
            item["id"]: item["expected_output"]
            for item in json.loads(BYCLI_EVALS.read_text(encoding="utf-8"))["evals"]
        }
        for expected in ("--json", "content", "bycli_filter", "knowledge-ingest"):
            self.assertIn(expected, evals[9])
        for expected in ("--transcript", "--output-dir", "transcript.md", "bycli_filter", "knowledge-ingest"):
            self.assertIn(expected, evals[10])


if __name__ == "__main__":
    unittest.main()
