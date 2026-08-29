import json
import re
import unittest
from pathlib import Path


ROUTING_REFERENCE = (
    Path(__file__).parents[1]
    / "skills"
    / "knowledge-collection"
    / "references"
    / "agent-reach.md"
)
BYCLI_SKILL = Path(__file__).parents[1] / "skills" / "bycli" / "SKILL.md"


class ByReachSkillContractTest(unittest.TestCase):
    def test_agent_reach_is_the_embedded_public_internet_router(self):
        routing = ROUTING_REFERENCE.read_text(encoding="utf-8")

        self.assertIn("# 公共互联网来源路由（原 By-Reach 路由器）", routing)
        self.assertIn("内置公共互联网路由器 `agent-reach`", routing)
        self.assertIn("by-reach doctor --json", routing)
        self.assertIn("~/.by-reach/", routing)

    def test_webpages_use_bycli_before_any_acquisition(self):
        skill = ROUTING_REFERENCE.read_text(encoding="utf-8")
        plain_skill = skill.replace("**", "")

        for phrase in (
            "任何网站、网页或 URL",
            "必须无条件加载 `bycli` skill",
            "`bycli web read --url <URL> --stdout`",
            "byCLI 无法完成时必须停止并报告",
            "不得回退到其他网页获取工具",
        ):
            self.assertIn(phrase, plain_skill)
        self.assertNotRegex(skill, re.compile(r"(?i)jina|web reader|opencli"))

    def test_platform_channels_keep_only_approved_executor_and_bycli_fallback_paths(self):
        skill = ROUTING_REFERENCE.read_text(encoding="utf-8")

        for phrase in (
            "`twitter-cli`",
            "`rdt-cli`",
            "`bili-cli`",
            "`yt-dlp`",
            "`gh` CLI",
            "`feedparser`",
            "`exa.web_search_exa`",
            "才允许一次 byCLI 兜底",
        ):
            self.assertIn(phrase, skill)

    def test_bycli_skill_names_the_embedded_knowledge_collection_router(self):
        skill = BYCLI_SKILL.read_text(encoding="utf-8")

        self.assertIn("## 路由边界", skill)
        self.assertIn("`knowledge-collection` 的内置路由层", skill)
        self.assertIn("路由层必须无条件选择并加载 `bycli` skill", skill)
        self.assertNotIn("路由器 `agent-reach`（By-Reach）", skill)

    def test_bycli_routing_guidance_never_teaches_direct_http_bypasses(self):
        """Only adapter implementation code may use its own managed HTTP client.

        The agent-facing Skill and reconnaissance guidance must never suggest that an
        agent execute curl/wget/node HTTP itself.  ``bycli browser eval`` is allowed:
        it runs in the browser context owned by byCLI, rather than bypassing it.
        ``adapter-template.md`` is deliberately excluded because it documents the
        implementation of adapters that byCLI itself executes.
        """
        implementation_docs = {"adapter-template.md"}
        markdown_files = sorted(
            path
            for path in BYCLI_SKILL.parent.rglob("*.md")
            if path.name not in implementation_docs
        )
        guidance = "\n".join(path.read_text(encoding="utf-8") for path in markdown_files)

        self.assertGreater(len(markdown_files), 1)
        self.assertNotRegex(guidance, re.compile(r"(?mi)^\s*(?:[$#]\s*)?(?:curl|wget|httpie)\b"))
        self.assertNotRegex(
            guidance,
            re.compile(r"(?mi)^\s*(?:[$#]\s*)?(?:node|python(?:3)?|ruby|php)\b[^\n]*(?:fetch\s*\(|requests\.|https?://)"),
        )
        self.assertNotRegex(guidance, re.compile(r"(?i)\b(?:bare|裸)\s*(?:node|Node)\s*fetch\b"))
        self.assertNotRegex(guidance, re.compile(r"(?i)\bnode(?:-side|\s*端|\s*原生)?\s*(?:fetch|http)\b"))

    def test_bycli_cleanup_is_limited_to_resources_owned_by_the_current_task(self):
        skill = BYCLI_SKILL.read_text(encoding="utf-8")

        for phrase in (
            "仅清理当前任务创建或独占拥有的资源",
            "任务开始前已经运行",
            "不得停止预先存在或共享的 daemon 与 Chromium",
            "adapter 自行管理其 TAB",
            "接管用户已打开的 TAB",
        ):
            self.assertIn(phrase, skill)

    def test_bycli_named_adapter_sessions_are_capability_gated_and_separate_from_raw_browser(self):
        skill = BYCLI_SKILL.read_text(encoding="utf-8")
        browser = (BYCLI_SKILL.parent / "references" / "browser.md").read_text(encoding="utf-8")

        for phrase in (
            "`--adapter-session`",
            "Adapter session",
            "workflow-specific reference",
            "structured help",
            "legacy shared mode",
        ):
            self.assertIn(phrase, skill)
        for phrase in (
            "raw browser surface",
            "Adapter surface",
            "`--adapter-session`",
            "cannot inspect",
        ):
            self.assertIn(phrase, browser)

    def test_bycli_uses_one_profile_explicit_openclaw_browser_command(self):
        skill = BYCLI_SKILL.read_text(encoding="utf-8")

        self.assertNotIn("`openclaw browser start`", skill)
        self.assertNotIn("`openclaw browser stop`", skill)
        self.assertIn("`openclaw browser --browser-profile openclaw start`", skill)
        self.assertIn("`openclaw browser --browser-profile openclaw stop`", skill)

    def test_bycli_bridge_recovery_does_not_mistake_a_profile_name_for_user_chrome(self):
        skill = BYCLI_SKILL.read_text(encoding="utf-8")

        for phrase in (
            "不得直接 STOP、不得提示用户打开桌面 Chrome",
            "错误信息中的 profile 名称",
            "OpenClaw 托管 Chromium",
            "只有完成冷启动复检和一次 daemon restart 后",
        ):
            self.assertIn(phrase, skill)

    def test_bycli_groups_priority_and_stop_rules_without_relaxing_ownership(self):
        skill = BYCLI_SKILL.read_text(encoding="utf-8")

        for phrase in (
            "## 规则优先级",
            "用户明确的当前操作范围和安全边界",
            "STOP / 认证 / 浏览器生命周期规则",
            "## 认证、人工验证与 STOP",
            "不得调用 `state`、`tab list`、`get url`",
            "不得跳转、bind、重试、AutoFix 或重跑 trace",
            "只使用已经返回的结果",
            "不得执行 `pkill`、kill-all 或停止共享进程",
        ):
            self.assertIn(phrase, skill)

    def test_bycli_evals_cover_status_discovery_and_safe_login_boundaries(self):
        evals = json.loads((BYCLI_SKILL.parent / "evals" / "evals.json").read_text(encoding="utf-8"))
        expected = {item["id"]: item["expected_output"] for item in evals["evals"]}

        self.assertIn("bycli daemon status", expected[4])
        self.assertLess(expected[4].index("bycli doctor"), expected[4].index("bycli daemon status"))
        self.assertIn("bycli list -f json", expected[5])
        self.assertIn("bycli web read --url", expected[5])
        self.assertIn("不存在 web/read", expected[5])
        self.assertIn("openclaw browser --browser-profile openclaw start", expected[5])
        self.assertIn("不得代填或提交凭据", expected[8])
        self.assertIn("可点击链接", expected[12])
        self.assertIn("不得调用 get url、state、tab list", expected[13])
        self.assertIn("不需要", expected[14])
        self.assertIn("/usr/local/bin/start-chrome.sh 存在且可执行", expected[15])
        self.assertIn("openclaw browser --browser-profile openclaw start", expected[15])
        self.assertIn("serial fallback", expected[19])
        self.assertIn("maxParallel: 3", expected[20])
        self.assertIn("fourth", expected[20])
        self.assertIn("batch-scoped", expected[20])
        self.assertIn("mixed", expected[21])
        self.assertIn("authentication", expected[22])
        self.assertIn("queued", expected[22])


if __name__ == "__main__":
    unittest.main()
