import hashlib
import json
import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).parents[1] / "skills" / "agent-reach"
BYCLI_SKILL = Path(__file__).parents[1] / "skills" / "bycli" / "SKILL.md"
UPSTREAM_REFERENCE_HASHES = {
    "career.md": "e70badf6c860a55cc049c15cc5cef31ca0fa2a2ae9ae1f72ade24b91844c1a2f",
    "dev.md": "f6f91107557eacf1d28a023d597eb5a61353a8a6ede286c3c0a4888d274df9fe",
    "search.md": "8eabfb645505148ea32e22e372c6d5a48615fba2e2f00eb8590e07464833851b",
    "social.md": "4226d43a3c1b3d6c9ab312e86d08b93da4493cc6232ffacc308596582a0abc48",
    "video.md": "f4b58c88f877b53e259fecbedc5ac5e111dd3403afebd1f86c45027af3fe099f",
    "web.md": "2495c2e290508b5b98337db679d5b2ff30314aa5b20243c7ff44486a72c3eff2",
    "LICENSE.agent-reach.txt": "e94c131ac1c2f78cfd8f7e69da354c0ff58e4e54071697703d56856c036de402",
}
OFFICIAL_BODY_HEADING = "## Agent Reach 官方主体（v1.5.0）"
OFFICIAL_BODY_SHA256 = "465e909d6491305b2d40e443fa5c922fdf0fd6415105488e1a1389bdb24a6f39"


class AgentReachSkillContractTest(unittest.TestCase):
    def test_skill_routes_diagnosis_and_browser_backends_for_byclaw(self):
        skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

        self.assertIn("name: agent-reach", skill)
        self.assertIn("byclaw-capability-doctor", skill)
        self.assertIn("bycli", skill)
        self.assertIn("/v1/browser/recover", skill)
        self.assertIn("不得启动 Chrome", skill)
        self.assertIn("正常冷状态", skill)
        self.assertIn("不得用 `bycli doctor` 替代", skill)
        self.assertIn("Do not install OpenCLI", skill)
        self.assertIn("Do not create an `opencli` alias", skill)
        self.assertNotIn("npm install -g @jackwener/opencli", skill)

    def test_byclaw_override_executes_only_the_effective_backend(self):
        skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
        override, separator, _ = skill.partition(OFFICIAL_BODY_HEADING)

        self.assertEqual(OFFICIAL_BODY_HEADING, separator)
        self.assertIn("diagnosticBackend", override)
        self.assertIn("effectiveBackend", override)
        self.assertIn("`activeBackend` 是 `effectiveBackend` 的兼容别名", override)
        self.assertIn("只执行 `effectiveBackend`", override)
        self.assertIn("不得直接执行 `diagnosticBackend`", override)
        self.assertIn("Jina Reader 和 OpenCLI 均映射为 `bycli`", override)
        self.assertIn("候选 `backends` 包含 Jina Reader 或 OpenCLI", override)
        self.assertIn("以 `providers.bycli.status` 判断执行就绪度", override)

    def test_byclaw_override_names_every_actor_and_result_owner(self):
        skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
        override, _, _ = skill.partition(OFFICIAL_BODY_HEADING)

        for phrase in (
            "路由器：`agent-reach`",
            "网站执行器：`bycli`",
            "采集编排器：`knowledge-collection`",
            "直接查询所有者：根 Agent",
        ):
            self.assertIn(phrase, override)
        self.assertNotIn("调用方", override)
        self.assertNotIn("子级", override)

    def test_frontmatter_does_not_advertise_an_undefined_stocks_route(self):
        skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
        frontmatter = skill.split("---", 2)[1]

        self.assertNotIn("stocks", frontmatter)

    def test_skill_documents_enterprise_cli_probe_boundaries(self):
        skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

        self.assertIn("WeCom 仅检查 `wecom-cli --version`", skill)
        self.assertIn("Lark 额外检查 `lark-cli auth status`", skill)
        self.assertIn("DWS 检查 `dws auth status --format json`", skill)
        self.assertIn("不得输出企业身份原始内容", skill)
        self.assertIn("不参与 `overallStatus`", skill)
        self.assertNotIn("聚合诊断中的 `not_checked`", skill)

    def test_skill_hands_enterprise_business_intents_to_dedicated_skills(self):
        skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

        self.assertIn("飞书/Lark", skill)
        self.assertIn("加载并遵循 `fws` skill", skill)
        self.assertIn("企业微信/WeCom", skill)
        self.assertIn("加载并遵循 `wecomcli` skill", skill)
        self.assertIn("钉钉/DingTalk", skill)
        self.assertIn("加载并遵循 `dws` skill", skill)
        self.assertIn("provider 状态仅用于被动诊断", skill)
        self.assertIn("不能替代业务 Skill", skill)

    def test_skill_uses_official_v1_5_0_body_with_prioritized_byclaw_overrides(self):
        skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

        override_heading = "## ByClaw 覆盖规则（最高优先级）"
        upstream_heading = "## Agent Reach 官方主体（v1.5.0）"
        self.assertIn("f65526cbaaad3879473acc1ba6dbefd195caf2be", skill)
        self.assertIn(override_heading, skill)
        self.assertIn(upstream_heading, skill)
        self.assertLess(skill.index(override_heading), skill.index(upstream_heading))
        self.assertIn("13 平台、多后端", skill)
        self.assertIn("全网调研类任务", skill)
        self.assertIn("## 路由表", skill)
        self.assertIn("## 零配置快速命令", skill)
        self.assertIn("官方主体及其 references 与覆盖规则冲突时，以本节为准", skill)

    def test_knowledge_collection_delegation_keeps_agent_reach_acquisition_only(self):
        skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

        for phrase in (
            "当采集编排器 `knowledge-collection` 发起委派时",
            "路由器 `agent-reach` 只负责渠道与后端选择、按需委派网站执行器 `bycli`",
            "并将采集结果返回采集编排器",
            "采集编排器负责统一持久化、产物协议、后处理、入库或知识整理",
            "路由器与网站执行器不得询问 `入库 / 知识整理 / 跳过`",
            "不得执行通用落盘、入库或知识整理",
            "不得规定统一产物目录、文件名或保留策略",
            "不得反向加载 `knowledge-collection`",
        ):
            self.assertIn(phrase, skill)

    def test_byclaw_override_routes_every_jina_reader_path_to_bycli(self):
        skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
        override, separator, _ = skill.partition(OFFICIAL_BODY_HEADING)

        self.assertEqual(OFFICIAL_BODY_HEADING, separator)
        for phrase in (
            "禁止使用 Jina Reader",
            "`r.jina.ai`",
            "加载并遵循 `bycli` skill",
            "`bycli list -f json`",
            "`bycli web read --url <URL>`",
            "官方 `references/web.md` 的通用网页读取",
            "`references/career.md` 的 LinkedIn fallback",
            "不得回退到 Jina Reader、Web Reader MCP、`curl`、`wget`、`requests` 或原站直连",
        ):
            self.assertIn(phrase, override)

    def test_byclaw_override_supersedes_upstream_workspace_rules_for_delegated_collection(self):
        skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

        override_heading = "## ByClaw 覆盖规则（最高优先级）"
        upstream_heading = "## Agent Reach 官方主体（v1.5.0）"
        delegated_override = "此时本覆盖规则取代官方 `/tmp/` 工作区规则"
        browser_execution_rule = (
            "遵守其浏览器生命周期、授权、执行与验证规则，并把结果返回当前任务所有者"
        )
        caller_ownership = "委派采集时由采集编排器负责统一持久化、产物协议、后处理与入库或知识整理"

        self.assertIn(delegated_override, skill)
        self.assertIn(browser_execution_rule, skill)
        self.assertIn(caller_ownership, skill)
        self.assertLess(skill.index(override_heading), skill.index(delegated_override))
        self.assertLess(skill.index(delegated_override), skill.index(upstream_heading))
        self.assertNotIn("采集落盘和清理规则", skill[: skill.index(upstream_heading)])
        self.assertNotIn("byCLI 任务的文件存放规则优先", skill[: skill.index(upstream_heading)])

    def test_official_v1_5_0_references_are_vendored_verbatim(self):
        reference_root = SKILL_ROOT / "references"

        for filename, expected_hash in UPSTREAM_REFERENCE_HASHES.items():
            with self.subTest(filename=filename):
                content = (reference_root / filename).read_bytes()
                self.assertEqual(expected_hash, hashlib.sha256(content).hexdigest())

    def test_official_v1_5_0_body_is_vendored_verbatim(self):
        skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
        boundary = f"{OFFICIAL_BODY_HEADING}\n"

        self.assertEqual(1, skill.count(boundary))
        _, separator, official_body = skill.partition(boundary)
        self.assertEqual(boundary, separator)
        self.assertTrue(official_body.startswith("\n13 平台、多后端"))
        actual_hash = hashlib.sha256(official_body.encode("utf-8")).hexdigest()
        self.assertEqual(OFFICIAL_BODY_SHA256, actual_hash)

    def test_skill_has_openclaw_ui_metadata(self):
        metadata = (SKILL_ROOT / "agents" / "openai.yaml").read_text(encoding="utf-8")

        self.assertIn("display_name:", metadata)
        self.assertIn("short_description:", metadata)
        self.assertIn("default_prompt:", metadata)
        self.assertIn("$agent-reach", metadata)

    def test_bycli_skill_is_the_single_entry_for_web_and_collection_tasks(self):
        skill = BYCLI_SKILL.read_text(encoding="utf-8")

        self.assertIn("本 skill 是唯一入口", skill)
        self.assertIn("网页读取、搜索、采集、抓取、网站操作和打开 URL", skill)
        self.assertIn("入库 / 知识整理 / 跳过", skill)
        self.assertIn("bycli list -f json", skill)
        self.assertIn("connector bridge", skill)
        self.assertIn("使用 dws bridge", skill)

    def test_bycli_is_presented_as_browser_driver_and_collection_orchestrator(self):
        skill = BYCLI_SKILL.read_text(encoding="utf-8")
        metadata = (BYCLI_SKILL.parent / "agents" / "openai.yaml").read_text(encoding="utf-8")
        frontmatter = skill.split("---", 2)[1]

        self.assertIn("web search, scraping, crawling, structured data collection", frontmatter)
        self.assertIn("## 采集成功后的收尾", skill)
        self.assertIn("### 自动落盘", skill)
        self.assertIn("所有采集原始产物放入会话专属目录", skill)
        self.assertIn('display_name: "byCLI 浏览器驱动与采集"', metadata)
        self.assertIn('short_description: "驱动浏览器采集数据、修复失败的 adapter、编写新 adapter"', metadata)
        self.assertIn('default_prompt: "用 bycli 帮我采集这个网站的数据"', metadata)

    def test_bycli_documents_collection_retention_and_browser_cleanup(self):
        skill = BYCLI_SKILL.read_text(encoding="utf-8")

        for phrase in (
            "清理遵循“只清理当前任务创建或独占拥有的资源”原则",
            "当前任务创建或独占拥有的 TAB",
            "bycli browser <session> close",
            "bycli daemon stop",
            "openclaw browser --browser-profile openclaw stop",
            "入库成功且用户未要求保留时可由 knowledge-ingest 清理",
            "session 结束不主动清理",
        ):
            self.assertIn(phrase, skill)

    def test_bycli_recovers_a_stopped_browser_with_start_chrome_script(self):
        skill = BYCLI_SKILL.read_text(encoding="utf-8")
        cold_start = skill.split("### 1. 冷启动和桥接检查", 1)[1].split("### 2. TAB 分流", 1)[0]

        expected_steps = (
            "openclaw browser --browser-profile openclaw status",
            "status 明确显示浏览器未运行",
            "if test -x /usr/local/bin/start-chrome.sh; then",
            "/usr/local/bin/start-chrome.sh",
            "openclaw browser --browser-profile openclaw start",
            "bycli doctor",
            "bycli daemon status",
        )
        for step in expected_steps:
            self.assertIn(step, cold_start)
        positions = [cold_start.index(step) for step in expected_steps]
        self.assertEqual(positions, sorted(positions))
        self.assertIn("否则执行 `openclaw browser --browser-profile openclaw start`", cold_start)
        self.assertIn("openclaw browser --browser-profile openclaw stop", skill)

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
        self.assertIn("openclaw browser --browser-profile openclaw status", expected[5])
        self.assertIn("/usr/local/bin/start-chrome.sh", expected[5])
        self.assertIn("不得代填或提交凭据", expected[8])
        self.assertIn("可点击链接", expected[12])
        self.assertIn("不得调用 get url、state、tab list", expected[13])
        self.assertIn("不需要", expected[14])
        self.assertIn("/usr/local/bin/start-chrome.sh 存在且可执行", expected[15])
        self.assertIn("openclaw browser --browser-profile openclaw start", expected[15])


if __name__ == "__main__":
    unittest.main()
