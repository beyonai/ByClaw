import unittest
from pathlib import Path


FWS = Path(__file__).resolve().parents[1] / "builtin" / "skills" / "fws"
AUTH_GUIDES = (
    "SKILL.md",
    "references/global-reference.md",
    "references/error-codes.md",
)


class FwsRuntimeContractTest(unittest.TestCase):
    def test_app_setup_uses_isolated_cli_configuration_without_a_runtime_binding(self):
        for relative_path in AUTH_GUIDES:
            with self.subTest(guide=relative_path):
                guide = (FWS / relative_path).read_text(encoding="utf-8")
                self.assertIn("LARK_HOME", guide)
                self.assertIn("lark-cli config show", guide)
                self.assertIn("lark-cli config init --new --force-init", guide)
                self.assertLess(guide.index("lark-cli config show"),
                                guide.index("lark-cli config init --new --force-init"))
                self.assertRegex(guide, r"已有.{0,40}配置.{0,40}复用|已有.{0,40}应用.{0,40}复用")
                self.assertNotIn("lark-cli config bind --source openclaw", guide)
                self.assertNotRegex(guide, r"(?:必须|需要|仍需|还应|后续把).{0,80}(?:写入|同步进).{0,40}(?:OpenClaw|channels\.feishu)")
                self.assertNotRegex(guide, r"(?:通过|只能通过) OpenClaw `exec`")

    def test_helper_paths_are_relative_to_the_loaded_skill_instead_of_the_workspace(self):
        skill = (FWS / "SKILL.md").read_text(encoding="utf-8")
        self.assertRegex(skill, r"已加载.{0,20}(?:SKILL\.md|Skill).{0,20}目录")
        self.assertNotIn("node skills/fws/scripts/connector-auth-sync.mjs", skill)
        self.assertIn("node scripts/connector-auth-sync.mjs", skill)
        self.assertIn("保持当前执行工作目录", skill)
        self.assertNotIn("以 OpenClaw 工作目录为根", skill)

    def test_home_is_bound_only_for_cli_children_and_never_falls_back(self):
        skill = (FWS / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn('HOME="$LARK_HOME" lark-cli', skill)
        self.assertIn('HOME="$LARK_HOME" python3', skill)
        self.assertIn('不得执行 `export HOME="$LARK_HOME"`', skill)
        self.assertRegex(skill, r"`LARK_HOME` 缺失或为空时必须停止.*不得回退到默认 HOME")

    def test_login_config_error_does_not_reset_an_application_with_metadata(self):
        for relative_path in AUTH_GUIDES:
            with self.subTest(guide=relative_path):
                guide = (FWS / relative_path).read_text(encoding="utf-8")
                self.assertIn("应用元数据", guide)
                self.assertIn("密钥引用", guide)
                self.assertRegex(guide, r"`auth login`.{0,30}`not_configured`.{0,160}不得重新初始化")
                self.assertRegex(guide, r"`config show` 本身明确返回 `not_configured`.{0,60}没有既有应用元数据")

    def test_configuration_checks_keep_the_same_workspace_and_runtime_environment(self):
        for relative_path in AUTH_GUIDES:
            with self.subTest(guide=relative_path):
                guide = (FWS / relative_path).read_text(encoding="utf-8")
                self.assertIn("同一 CLI workspace", guide)
                self.assertIn("同一运行时环境", guide)
                self.assertRegex(guide, r"不得清空.{0,30}环境信号")

    def test_profile_and_invalid_config_errors_cannot_trigger_initialization(self):
        for relative_path in AUTH_GUIDES:
            with self.subTest(guide=relative_path):
                guide = (FWS / relative_path).read_text(encoding="utf-8")
                self.assertIn("error.type=config", guide)
                self.assertIn("error.subtype=not_configured", guide)
                self.assertIn("没有 `error.field`", guide)
                self.assertIn("错误消息明确表示缺少应用配置", guide)
                for selector in ("--profile", "LARKSUITE_CLI_PROFILE", "currentApp"):
                    self.assertIn(f"`{selector}`", guide)
                self.assertIn("先修正既有 profile 选择并保留配置", guide)
                self.assertRegex(guide, r"无活动 profile.{0,80}`invalid_config`.{0,80}未知错误消息.{0,80}不得初始化")

    def test_user_authorization_stays_split_and_verified_in_every_guide(self):
        for relative_path in AUTH_GUIDES:
            with self.subTest(guide=relative_path):
                guide = (FWS / relative_path).read_text(encoding="utf-8")
                self.assertIn("--no-wait --json", guide)
                self.assertIn("--device-code", guide)
                self.assertIn("auth status --json --verify", guide)
                self.assertRegex(guide, r"(?:禁止|不要)在同一轮.{0,60}(?:--device-code|阻塞轮询)")
                self.assertIn("qrcode_data_uri.py", guide)
                self.assertIn("markdownImage", guide)
                self.assertIn("[点击打开飞书授权]", guide)


if __name__ == "__main__":
    unittest.main()
