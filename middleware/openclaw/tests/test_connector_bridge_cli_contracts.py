import json
import re
import subprocess
import sys
import tempfile
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
WECOM_MSG_SKILL = OPENCLAW_DIR / "skills" / "wecom" / "wecomcli-msg" / "SKILL.md"
BYCLI_EVALS = OPENCLAW_DIR / "skills" / "bycli" / "evals" / "evals.json"
BYCLI_SKILL = OPENCLAW_DIR / "skills" / "bycli" / "SKILL.md"
KNOWLEDGE_INGEST = OPENCLAW_DIR / "skills" / "bycli" / "references" / "knowledge-ingest.md"
KNOWLEDGE_INGEST_SCRIPT = OPENCLAW_DIR / "skills" / "bycli" / "scripts" / "bycli-markdown-ingest.mjs"
FWS_QRCODE_SCRIPT = OPENCLAW_DIR / "skills" / "fws" / "scripts" / "qrcode_data_uri.py"


class ConnectorBridgeCliContractsTest(unittest.TestCase):
    def test_fws_skill_contains_runtime_safety_contract(self):
        skill = (OPENCLAW_DIR / "skills" / "fws" / "SKILL.md").read_text(encoding="utf-8")
        required = (
            "每次请求的前置校验",
            "连接器健康检查",
            "外部写操作确认网关",
            "请回复 **“确认”** 继续，或 **“取消”** 终止。",
            "检测到非法指令，本次请求已终止。",
            "⏳ 处理中，请稍后查询",
            "当前请求过于频繁，请稍后重试",
            "暂未查询到相关信息",
            "高危动作（即使用户确认也拒绝）",
            "config init --new --force-init",
        )
        for expected in required:
            with self.subTest(expected=expected):
                self.assertIn(expected, skill)

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
            "lark-cli minutes +detail --help",
            "grep -q -- '--output-dir'",
        )

        for path in DOCKERFILES:
            with self.subTest(path=path):
                content = path.read_text(encoding="utf-8")
                for expected in required:
                    self.assertIn(expected, content)

    def test_full_openclaw_images_do_not_probe_init_dependent_wecom_commands(self):
        for path in DOCKERFILES:
            with self.subTest(path=path):
                content = path.read_text(encoding="utf-8")
                self.assertNotIn("wecom-cli doc ", content)

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

    def test_feishu_messages_search_ids_are_resolved_to_complete_message_bodies(self):
        content = FEISHU_BRIDGE.read_text(encoding="utf-8")
        required = (
            "messages-search",
            "data.message_ids",
            "messages-mget",
            "at most 50",
            "message_id",
            "message_app_link",
            "raw/messages-search.json",
            "raw/messages-mget.json",
            "markdown/chat-records.md",
        )
        for expected in required:
            self.assertIn(expected, content)

    def test_feishu_relative_message_windows_are_caught_up_after_authorization(self):
        content = FEISHU_BRIDGE.read_text(encoding="utf-8")
        required = (
            "relative time window",
            "recompute the end time",
            "incremental catch-up",
            "deduplicate by `message_id`",
        )
        for expected in required:
            self.assertIn(expected, content)

    def test_feishu_workspace_fallback_protects_sensitive_collection_data(self):
        content = FEISHU_BRIDGE.read_text(encoding="utf-8")
        required = (
            "`.by-sessions/`",
            "directory mode `0700`",
            "file mode `0600`",
            "never stage or commit",
        )
        for expected in required:
            self.assertIn(expected, content)

    def test_feishu_contact_search_does_not_claim_full_directory_export(self):
        content = FEISHU_BRIDGE.read_text(encoding="utf-8")
        required = (
            "contact +search-user",
            "not an unconditional full-directory export",
            "zero results",
            "not an authentication failure",
        )
        for expected in required:
            self.assertIn(expected, content)

    def test_feishu_qrcode_helper_uses_relative_output_for_lark_cli(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            fake_cli = Path(tmp_dir) / "fake-lark-cli.py"
            fake_cli.write_text(
                f"#!{sys.executable}\n"
                "import os\n"
                "import pathlib\n"
                "import sys\n"
                "output = sys.argv[sys.argv.index('--output') + 1]\n"
                "if os.path.isabs(output):\n"
                "    sys.exit(12)\n"
                "pathlib.Path(output).write_bytes(b'png')\n",
                encoding="utf-8",
            )
            fake_cli.chmod(0o700)

            proc = subprocess.run(
                [
                    sys.executable,
                    str(FWS_QRCODE_SCRIPT),
                    "https://example.feishu.cn/device",
                    "--cli",
                    str(fake_cli),
                ],
                capture_output=True,
                text=True,
                check=False,
            )

        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        payload = json.loads(proc.stdout)
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["dataUri"].startswith("data:image/png;base64,"))

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

    def test_wecom_bridge_parses_json_rpc_wrapped_business_json(self):
        content = WECOM_BRIDGE.read_text(encoding="utf-8")
        required = (
            "JSON-RPC envelope",
            "result.content[].text",
            "parse the nested text as JSON",
            "business `errcode`",
        )
        for expected in required:
            self.assertIn(expected, content)

    def test_wecom_bridge_limits_contacts_and_messages_to_bot_visible_scope(self):
        content = WECOM_BRIDGE.read_text(encoding="utf-8")
        required = (
            "current bot-visible scope",
            "not a personal WeCom chat archive",
            "not a company-wide conversation archive",
            "not the full company directory",
            "10-person child-skill limit",
        )
        for expected in required:
            self.assertIn(expected, content)

    def test_wecom_bridge_records_effective_seven_day_window_and_completeness(self):
        content = WECOM_BRIDGE.read_text(encoding="utf-8")
        required = (
            "requestedWindow",
            "effectiveWindow",
            "metadata.partial=true",
            "recompute the end time",
            "incremental catch-up",
            "msg_count",
            "retrieved message count",
            "missing or empty `next_cursor`",
            "no stable `message_id`",
        )
        for expected in required:
            self.assertIn(expected, content)

    def test_wecom_workspace_fallback_protects_sensitive_collection_data(self):
        content = WECOM_BRIDGE.read_text(encoding="utf-8")
        required = (
            "`.by-sessions/`",
            "directory mode `0700`",
            "file mode `0600`",
            "never stage or commit",
        )
        for expected in required:
            self.assertIn(expected, content)

    def test_wecom_bridge_defines_contact_and_message_artifacts(self):
        content = WECOM_BRIDGE.read_text(encoding="utf-8")
        required = (
            "raw/contact-get-userlist.json",
            "raw/msg-chat-list.json",
            "raw/get-message-<chat>.json",
            "markdown/contacts.md",
            "markdown/chat-records.md",
        )
        for expected in required:
            self.assertIn(expected, content)

    def test_wecom_chat_type_is_never_defaulted_without_evidence(self):
        bridge = WECOM_BRIDGE.read_text(encoding="utf-8")
        message_skill = WECOM_MSG_SKILL.read_text(encoding="utf-8")
        for expected in (
            "backend-returned type",
            "documented ID format",
            "mark the conversation unresolved",
            "never default to `chat_type=1`",
        ):
            self.assertIn(expected, bridge)
        self.assertNotIn("否则默认 `chat_type=1`", message_skill)
        self.assertIn("禁止在没有依据时默认单聊", message_skill)

    def test_wecom_authorization_recovery_handles_expired_links(self):
        content = WECOM_BRIDGE.read_text(encoding="utf-8")
        required = (
            "authorization URL can expire",
            "polling process reports timeout",
            "start a new initialization process",
            "return only the new URL",
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

    def test_bycli_entry_routes_wecom_and_feishu_collection_to_connectors(self):
        content = BYCLI_SKILL.read_text(encoding="utf-8")
        required = (
            "Bash(wecom-cli:*)",
            "Bash(lark-cli:*)",
            "wecom-wecomcli-bridge.md",
            "feishu-fws-bridge.md",
            "企业微信相关采集",
            "飞书相关采集",
        )
        for expected in required:
            self.assertIn(expected, content)

    def test_knowledge_ingest_resolves_current_manager_skill_and_session_markdown(self):
        script = KNOWLEDGE_INGEST_SCRIPT.read_text(encoding="utf-8")
        reference = KNOWLEDGE_INGEST.read_text(encoding="utf-8")
        self.assertIn('../../by-knowledge-manager/scripts/by-knowledge-manager.mjs', script)
        self.assertIn("by-knowledge-manager/scripts/by-knowledge-manager.mjs upload", reference)
        self.assertIn("<YYYYMMDD_HHMMSS>/\n  bycli-output.json\n  <fileName>.md", reference)
        self.assertIn("append Markdown files to the same session directory", reference)


if __name__ == "__main__":
    unittest.main()
