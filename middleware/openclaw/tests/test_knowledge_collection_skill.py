import json
import re
import unittest
from pathlib import Path


SKILLS_ROOT = Path(__file__).parents[1] / "skills"
SKILL_ROOT = SKILLS_ROOT / "knowledge-collection"
REPO_ROOT = Path(__file__).parents[3]
INITDB_DML = REPO_ROOT / "deploy" / "middleware" / "initdb" / "04_dml.sql"
V030_DML = REPO_ROOT / "deploy" / "migrations" / "versions" / "V0.3.0" / "V0.3.0__dml.sql"
V031_DML = REPO_ROOT / "deploy" / "migrations" / "versions" / "V0.3.1" / "V0.3.1__dml.sql"
V051_DML = REPO_ROOT / "deploy" / "migrations" / "versions" / "V0.5.1" / "V0.5.1__dml.sql"
META_PROMPT_SERVICE = (
    REPO_ROOT
    / "byclaw-be"
    / "src/main/java/com/iwhalecloud/byai/manager/application/service/digitemploy/MetaPromptService.java"
)
DESCRIPTION = (
    "Use when a user explicitly asks to collect, crawl, batch-search, or archive articles, documents, URLs, or "
    "files from public or enterprise sources. Produces traceable collection artifacts and validated sanitized "
    "Markdown for handoff; does not perform knowledge-base ingest, knowledge organization, or downstream actions."
)
INTERFACE = {
    "display_name": "知识采集",
    "short_description": "跨互联网与企业平台采集、归档资料，并交付规范化正文",
    "default_prompt": (
        "Use $knowledge-collection to collect these sources and return validated sanitized items for downstream agents."
    ),
}
OPENAI_YAML = f'''interface:
  display_name: "{INTERFACE["display_name"]}"
  short_description: "{INTERFACE["short_description"]}"
  default_prompt: "{INTERFACE["default_prompt"]}"
'''
CHILD_SKILLS = {
    "bycli/SKILL.md": "bycli",
    "dws/SKILL.md": "dws",
    "fws/SKILL.md": "fws",
    "wecom/SKILL.md": "wecomcli",
}


def parse_frontmatter(path):
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise AssertionError(f"{path} must start with a YAML delimiter")
    block, separator, body = text[4:].partition("\n---\n")
    if not separator:
        raise AssertionError(f"{path} must have a closing YAML delimiter")

    frontmatter = {}
    for line in block.splitlines():
        if line.startswith((" ", "\t")):
            continue
        if ":" not in line:
            raise AssertionError(f"unexpected frontmatter line in {path}: {line!r}")
        key, value = line.split(":", 1)
        if not key or key in frontmatter:
            raise AssertionError(f"duplicate or empty frontmatter key in {path}: {key!r}")
        frontmatter[key] = value.strip().strip('"')
    return text, block, body, frontmatter


def parse_interface(text):
    lines = text.splitlines()
    if not lines or lines[0] != "interface:":
        raise AssertionError("openai.yaml must contain only an interface mapping")

    interface = {}
    for line in lines[1:]:
        if not line.startswith("  ") or line.startswith("   ") or ":" not in line:
            raise AssertionError(f"unexpected interface line: {line!r}")
        key, value = line.strip().split(":", 1)
        if not key or key in interface:
            raise AssertionError(f"duplicate or empty interface key: {key!r}")
        interface[key] = json.loads(value.strip())
    return interface


def markdown_section(text, heading):
    marker = f"## {heading}\n"
    _before, separator, remainder = text.partition(marker)
    if not separator:
        raise AssertionError(f"missing Markdown section: {heading}")
    return remainder.split("\n## ", 1)[0]




class KnowledgeCollectionSkillContractTest(unittest.TestCase):
    def test_knowledge_collection_upgrade_is_isolated_in_v031(self):
        self.assertTrue(V031_DML.is_file(), "knowledge collection migration must be versioned as V0.3.1")
        v030 = V030_DML.read_text(encoding="utf-8")
        v031 = V031_DML.read_text(encoding="utf-8")

        for marker in (
            "知识采集默认绑定迁移到编排 Skill",
            '"skillCode":"knowledge-collection"',
            '"skillCode":"bycli"',
        ):
            self.assertNotIn(marker, v030)
            self.assertIn(marker, v031)

    def test_upgrade_migration_replaces_the_bundled_skill_catalog(self):
        upgrade = V031_DML.read_text(encoding="utf-8")

        self.assertIn("OPENCLAW_BUNDLED_SKILLS", upgrade)
        self.assertIn('"skillCode":"knowledge-collection"', upgrade)
        self.assertIn('"skillCode":"agent-reach"', upgrade)
        self.assertIn('"skillCode":"bycli"', upgrade)
        self.assertNotIn("WITH ORDINALITY", upgrade)
        self.assertNotIn("jsonb_build_object", upgrade)
        self.assertNotIn("jsonb_agg", upgrade)
        self.assertNotIn("jsonb_array_elements", upgrade)

    def test_bycli_has_an_independent_platform_resource(self):
        initdb = INITDB_DML.read_text(encoding="utf-8")
        upgrade = V031_DML.read_text(encoding="utf-8")

        self.assertRegex(initdb, r"VALUES\(25,'BYAI','SKILL','ATOM','byCLI'.*,'bycli',CURRENT_TIMESTAMP")
        self.assertIn("VALUES(25,'inner','SYSTEM_BUILTIN'", initdb)
        self.assertIn("resource_code IN (", initdb)
        self.assertIn("'knowledge-collection','bycli','dws'", initdb)
        self.assertIn("resource_code = 'bycli'", upgrade)
        self.assertIn("resourceCode', r.resource_code", upgrade)
        self.assertIn("r.resource_code = 'bycli'", upgrade)
        self.assertIn("FROM byai.au_privilege_grant g", upgrade)

        # 升级脚本按 resource_code / resource_name 幂等定位资源，不依赖硬编码 resource_id，
        # 新资源的 ID 由序列生成，避免与既有资源固定 ID 冲突（443fa70fe）。
        self.assertIn("nextval('byai.seq_any_table')", upgrade)
        collapsed = " ".join(upgrade.split())
        for resource_code in ("bycli", "knowledge-collection"):
            with self.subTest(resource_code=resource_code):
                self.assertIn(
                    f"SELECT resource_id FROM byai.ss_resource WHERE resource_code = '{resource_code}'",
                    collapsed,
                )
        self.assertNotRegex(upgrade, r"resource_id = (?:14|25)\b")
        self.assertNotRegex(upgrade, r"grant_obj_id = (?:14|25)\b")

    def test_meta_prompt_counts_catalog_entries_from_json(self):
        source = META_PROMPT_SERVICE.read_text(encoding="utf-8")

        self.assertIn("summary.setBundledSkillCount(countBundledSkills(bundledSkills));", source)
        self.assertIn("OBJECT_MAPPER.readTree(bundledSkills)", source)



    def test_upgrade_updates_runtime_skill_target_content_without_replacing_other_json_fields(self):
        upgrade = " ".join(V031_DML.read_text(encoding="utf-8").split())

        self.assertRegex(
            upgrade,
            re.compile(
                r"UPDATE byai\.ss_res_ext_skill e SET target_content = "
                r"jsonb_set\(\s*target_content::jsonb, '\{resourceCode\}', "
                r"'\"knowledge-collection\"'::jsonb, false\s*\)::text "
                r"FROM byai\.ss_resource r "
                r"WHERE e\.resource_id = r\.resource_id "
                r"AND r\.resource_name = '知识采集' "
                r"AND r\.resource_code = 'knowledge-collection' "
                r"AND target_content IS NOT NULL "
                r"AND target_content::jsonb ->> 'resourceCode' = 'bycli'",
                re.IGNORECASE,
            ),
        )

    def test_skill_has_exact_minimal_frontmatter(self):
        _, block, body, frontmatter = parse_frontmatter(SKILL_ROOT / "SKILL.md")

        self.assertEqual(f"name: knowledge-collection\ndescription: {DESCRIPTION}", block)
        self.assertTrue(body.startswith("\n# Knowledge Collection\n"))
        self.assertEqual({"name", "description"}, set(frontmatter))
        self.assertEqual("knowledge-collection", frontmatter["name"])
        self.assertEqual(DESCRIPTION, frontmatter["description"])

    def test_skill_defines_collection_only_orchestration_contract(self):
        skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

        for phrase in (
            "Create or load a session before discovery",
            "Delegate retrieval to the selected source executor",
            "Register only actual artifacts through `collect`",
            "Use `status` before delivery",
            "采集完成后停止",
            "`sanitized/items/*.md`",
            "不得调用 `by-knowledge-manager`",
            "不得调用 `knowledge-organizer`",
            "不得询问 `入库 / 知识整理 / 跳过`",
        ):
            self.assertIn(phrase, skill)

        for forbidden in (
            "[knowledge-ingest.md]",
            "[post-processing.md]",
            "record the per-item result with `run`",
            "call `report` before cleanup",
        ):
            self.assertNotIn(forbidden, skill)

    def test_agent_reach_backends_share_one_collection_contract(self):
        skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

        self.assertIn("it never bypasses source executors with direct HTTP clients", skill)
        self.assertIn(
            "Do not use `web_fetch`, `curl`, `wget`, `requests`, or another direct HTTP client to bypass it",
            skill,
        )
        self.assertIn("Preserve provenance", skill)
        self.assertIn("HTTP(S) duplicates", skill)

    def test_explicit_collection_intent_overrides_item_count(self):
        skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

        self.assertIn("explicitly asks to collect", skill)
        self.assertIn("A normal question, a single fact lookup, opening one page, or login is not collection work", skill)

    def test_owned_weixin_backend_collection_routes_directly_to_bycli(self):
        routing = (SKILL_ROOT / "references" / "agent-reach.md").read_text(encoding="utf-8")
        bycli = (SKILLS_ROOT / "bycli" / "SKILL.md").read_text(encoding="utf-8")
        weixin = (SKILLS_ROOT / "bycli" / "references" / "weixin.md").read_text(encoding="utf-8")

        for phrase in (
            "`published`",
            "`download-publish-data`",
        ):
            self.assertIn(phrase, f"{routing}\n{bycli}\n{weixin}")

    def test_skill_has_exact_openclaw_ui_metadata(self):
        metadata_text = (SKILL_ROOT / "agents" / "openai.yaml").read_text(encoding="utf-8")
        interface = parse_interface(metadata_text)

        self.assertEqual(OPENAI_YAML, metadata_text)
        self.assertEqual(INTERFACE, interface)
        self.assertGreaterEqual(len(interface["short_description"]), 25)
        self.assertLessEqual(len(interface["short_description"]), 64)

    def test_current_reference_links_resolve(self):
        skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

        reference_links = re.findall(r"\]\((references/[^)]+\.md)\)", skill)
        self.assertGreaterEqual(len(reference_links), 4)
        for relative_path in reference_links:
            self.assertIn(f"]({relative_path})", skill)
            self.assertTrue((SKILL_ROOT / relative_path).is_file(), relative_path)

    def test_dingtalk_dws_bridge_delegates_backend_and_uses_canonical_artifacts(self):
        relative_path = "references/sources/dingtalk-dws.md"
        bridge_path = SKILL_ROOT / relative_path
        bridge = bridge_path.read_text(encoding="utf-8")
        skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

        for phrase in (
            "加载并遵循 `dws` skill",
            "collection-result.json",
            "sanitized/metadata.json",
            "固定 schema 字段",
            "不得添加额外顶层字段",
            "sourceProduct",
            "指定的 metadata 文件",
            "AI 听记",
            "不得通过 byCLI 或浏览器降级",
            "认证完全遵循 `dws` skill",
        ):
            self.assertIn(phrase, bridge)
        self.assertNotIn("bycli remains the single collection entry", bridge)
        self.assertIn("](references/sources/)", skill)
        self.assertTrue(bridge_path.is_file(), relative_path)

    def test_agent_reach_enterprise_collection_routes_to_source_bridges(self):
        collection_skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
        agent_reach = (SKILL_ROOT / "references" / "agent-reach.md").read_text(encoding="utf-8")

        self.assertIn("企业来源", agent_reach)
        self.assertIn("采集编排器 `knowledge-collection`", agent_reach)
        self.assertIn("不得作为公共互联网任务交给 `bycli`", agent_reach)

        bridges = {
            "references/sources/wecom-wecomcli.md": "`wecomcli` skill",
            "references/sources/feishu-fws.md": "`fws` skill",
        }
        for relative_path, child_skill in bridges.items():
            with self.subTest(relative_path=relative_path):
                bridge = (SKILL_ROOT / relative_path).read_text(encoding="utf-8")
                self.assertIn("](references/sources/)", collection_skill)
                self.assertIn("委派采集模式", bridge)
                self.assertIn(child_skill, bridge)
                self.assertIn("`knowledge-collection` 负责", bridge)
                self.assertIn("浏览器、curl、直接 HTTP/API", bridge)

    def test_source_bridges_write_nested_partial_status_only(self):
        for relative_path in (
            "references/sources/dingtalk-dws.md",
            "references/sources/feishu-fws.md",
            "references/sources/wecom-wecomcli.md",
        ):
            with self.subTest(relative_path=relative_path):
                bridge = (SKILL_ROOT / relative_path).read_text(encoding="utf-8")
                self.assertIn("`collection.status: partial`", bridge)
                self.assertIn("`sourceMetadata`", bridge)
                self.assertNotIn("`partial: true`", bridge)

    def test_child_skill_routes_resolve_to_expected_frontmatter_names(self):
        for relative_path, expected_name in CHILD_SKILLS.items():
            with self.subTest(relative_path=relative_path):
                path = SKILLS_ROOT / relative_path
                self.assertTrue(path.is_file(), relative_path)
                _, _, _, frontmatter = parse_frontmatter(path)
                self.assertEqual(expected_name, frontmatter["name"])

    def test_collection_contract_defines_canonical_artifacts_and_legacy_reads(self):
        contract = (SKILL_ROOT / "references" / "collection-contract.md").read_text(encoding="utf-8")
        match = re.search(r"```json\n(.*?)\n```", contract, flags=re.DOTALL)
        self.assertIsNotNone(match)
        result = json.loads(match.group(1))

        self.assertEqual(
            {"schemaVersion", "title", "source", "backend", "url", "filters", "items"}, set(result)
        )
        self.assertEqual(
            {"title", "url", "author", "publishTime", "markdown", "fileName"}, set(result["items"][0])
        )
        for phrase in (
            "collection-result.json",
            "items[].fileName",
            "相对路径",
            "必须存在",
            "collection_filters",
            "仅记录用户明确指定的筛选条件",
            "raw/",
            "sanitized",
            "metadata.json",
            "token",
            "Cookie",
            "secrets",
            "Legacy read compatibility",
            "bycli-output.json",
            "--bycli-json-file",
            "bycli_filter",
            "只读兼容",
            "新写入不得使用旧格式",
            "完整文章清单",
            "已物化正文",
            "允许为空数组",
            "sourceSkill",
            "rawArtifacts",
            "materialization",
            "安全降级为 `pending`",
        ):
            self.assertIn(phrase, contract)

    def test_collection_contract_distinguishes_source_backend_and_routing_provenance(self):
        contract = (SKILL_ROOT / "references" / "collection-contract.md").read_text(encoding="utf-8")
        match = re.search(r"```json\n(.*?)\n```", contract, flags=re.DOTALL)
        self.assertIsNotNone(match)
        result = json.loads(match.group(1))

        self.assertEqual("public-internet", result["source"])
        self.assertEqual("bycli", result["backend"])
        self.assertIn("`source` 表示逻辑来源", contract)
        self.assertIn("`backend` 表示最终取得内容的执行器", contract)
        self.assertIn("router、diagnosticBackend、effectiveBackend", contract)
        self.assertIn("metadata.json", contract)
        self.assertIn("不得写入 `collection-result.json` 顶层", contract)

    def test_collection_only_delivery_boundary(self):
        skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
        delivery = (SKILL_ROOT / "references" / "delivery.md").read_text(encoding="utf-8")
        manifest = json.loads((SKILL_ROOT / "references" / "manifest.json").read_text(encoding="utf-8"))

        for phrase in (
            "采集完成后停止",
            "`sanitized/items/*.md`",
            "下游 Agent",
            "不得调用 `by-knowledge-manager`",
            "不得调用 `knowledge-organizer`",
            "不得询问 `入库 / 知识整理 / 跳过`",
        ):
            self.assertIn(phrase, f"{skill}\n{delivery}")

        indexed_paths = {
            item["path"] for key in ("skills", "references") for item in manifest.get(key, [])
        }
        self.assertIn("delivery.md", indexed_paths)
        self.assertNotIn("post-processing.md", indexed_paths)
        self.assertNotIn("knowledge-ingest.md", indexed_paths)
        self.assertFalse((SKILL_ROOT / "references" / "post-processing.md").exists())
        self.assertFalse((SKILL_ROOT / "references" / "knowledge-ingest.md").exists())

    def test_skill_main_entry_stops_after_delivery(self):
        skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

        for phrase in (
            "`init`",
            "`collect`",
            "`status`",
            "采集完成后停止",
            "下游 Agent",
        ):
            self.assertIn(phrase, skill)

    def test_v051_updates_installed_collection_descriptions(self):
        self.assertTrue(V051_DML.is_file())
        upgrade = V051_DML.read_text(encoding="utf-8")
        self.assertIn("SET search_path TO byai", upgrade)
        self.assertIn("resource_code = 'knowledge-collection'", upgrade)
        self.assertIn("规范化正文交付", upgrade)
        self.assertIn("validated sanitized-content handoff", upgrade)
        self.assertNotIn("知识库入库或知识整理", upgrade)

    def test_bycli_is_an_executor_when_delegated_by_knowledge_collection(self):
        bycli = (SKILLS_ROOT / "bycli" / "SKILL.md").read_text(encoding="utf-8")

        for phrase in (
            "浏览器与 Adapter 执行层",
            "`knowledge-collection` 只负责统一持久化、产物协议与采集交付",
            "任何下游处理由根 Agent 另行委派",
            "网站执行器只执行或发现、修复 Adapter",
            "不得反向加载 `knowledge-collection`",
            "是否把刚才的获取过程保存成一个专用 adapter",
        ):
            self.assertIn(phrase, bycli)

    def test_delegated_adapter_candidate_does_not_create_a_second_question(self):
        bycli = (SKILLS_ROOT / "bycli" / "SKILL.md").read_text(encoding="utf-8")
        delivery = (SKILL_ROOT / "references" / "delivery.md").read_text(encoding="utf-8")

        self.assertIn("`adapterCandidate`", bycli)
        self.assertIn("不得直接询问用户是否保存 Adapter", bycli)
        self.assertIn("直接查询所有者（根 Agent）", bycli)
        self.assertIn("`adapterCandidate`", delivery)
        self.assertIn("非阻塞建议", delivery)

    def test_orchestration_documents_use_named_actors(self):
        paths = (
            SKILL_ROOT / "SKILL.md",
            SKILL_ROOT / "references" / "delivery.md",
            SKILL_ROOT / "references" / "agent-reach.md",
            SKILL_ROOT / "references" / "sources" / "dingtalk-dws.md",
        )
        combined = "\n".join(path.read_text(encoding="utf-8") for path in paths)

        for phrase in (
            "采集编排器 `knowledge-collection`",
            "路由器 `agent-reach`",
            "网站执行器 `bycli`",
            "来源执行器",
        ):
            self.assertIn(phrase, combined)
        for ambiguous in ("父 Skill", "子 Skill", "调用方"):
            self.assertNotIn(ambiguous, combined)

    def test_cross_skill_direct_query_and_explicit_collection_have_distinct_owners(self):
        knowledge = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
        agent_reach = (SKILL_ROOT / "references" / "agent-reach.md").read_text(encoding="utf-8")
        bycli = (SKILLS_ROOT / "bycli" / "SKILL.md").read_text(encoding="utf-8")
        delivery = (SKILL_ROOT / "references" / "delivery.md").read_text(encoding="utf-8")

        self.assertIn("explicit collection outcome", knowledge)
        self.assertIn("直接查询", agent_reach)
        self.assertIn("采集编排器", agent_reach)
        self.assertIn("委派采集模式下，不直接提问", bycli)
        self.assertIn("采集完成后停止", delivery)

    def test_bycli_no_longer_owns_collection_orchestration(self):
        bycli = (SKILLS_ROOT / "bycli" / "SKILL.md").read_text(encoding="utf-8")

        for phrase in (
            "入库 / 知识整理 / 跳过",
            "bycli-output.json",
            "bycli_filter",
            "knowledge-ingest.md",
            "bycli-markdown-ingest.mjs",
            "knowledge-organizer",
            "dingtalk-dws-" + "bridge.md",
            "采集产物落盘约定",
            "采集产物保留策略",
        ):
            self.assertNotIn(phrase, bycli)

    def test_bycli_uses_flat_weixin_executor_reference(self):
        bycli_root = SKILLS_ROOT / "bycli"
        bycli = (bycli_root / "SKILL.md").read_text(encoding="utf-8")
        weixin_path = bycli_root / "references" / "weixin.md"

        self.assertIn("](./references/weixin.md)", bycli)
        self.assertTrue(weixin_path.is_file())
        self.assertFalse((bycli_root / "references" / "weixin" / "SKILL.md").exists())
        self.assertFalse((bycli_root / "references" / "knowledge-ingest.md").exists())

    def test_weixin_reference_keeps_executor_and_security_rules_only(self):
        weixin = (SKILLS_ROOT / "bycli" / "references" / "weixin.md").read_text(encoding="utf-8")

        for phrase in (
            "--site-session persistent --keep-tab true",
            "AUTH_REQUIRED",
            "环境异常",
            "exactly once",
            "Never request credential values in chat",
            "Never echo, inspect, serialize, retain, or return token, Cookie, fingerprint",
            "完整文章索引",
            "正文",
            "fileName",
            "可点击预览",
            "必须串行执行",
            "精确 URL + `--date`",
            "Chrome 下载事件",
        ):
            self.assertIn(phrase, weixin)
        for phrase in (
            "bycli-output.json",
            "最多预存 10",
            "入库 / 知识整理 / 跳过",
            "retention",
            "cleanup",
            "加载 `knowledge-collection`",
        ):
            self.assertNotIn(phrase, weixin)

    def test_weixin_reference_closes_executor_terminal_states(self):
        weixin = (SKILLS_ROOT / "bycli" / "references" / "weixin.md").read_text(encoding="utf-8")
        discovery = markdown_section(weixin, "Official-account and article discovery")
        fallback = markdown_section(weixin, "Adapter-owned Sogou fallback identity")
        terminal = markdown_section(weixin, "Terminal-state precedence")
        downloads = markdown_section(weixin, "Published-data spreadsheet downloads")
        login = markdown_section(weixin, "Login and verification gate")

        self.assertIn("@sovovs/bycli` 2.1.35", weixin)
        self.assertIn("Explicit account identity or account-history intent starts with `accounts`", discovery)
        self.assertIn("Article-title or topic intent starts with `sougousearch`", discovery)
        self.assertIn("reinterpret it as topic intent", discovery)
        self.assertIn(
            "When a bare phrase has no explicit account-history or article-title/topic cue, ask one clarification question",
            discovery,
        )

        for phrase in (
            "nickname-scoped public results, not `fakeid`-proven account history",
            "omit `--name` and keep the command backend-only",
            "ask for the exact nickname before offering public fallback",
            "must not be merged",
            "Only an exact nickname from one unique `accounts` result",
            "whose `fakeid` equals the selected `fakeid`",
            "A user-supplied nickname beside a direct `fakeid` is not identity proof",
        ):
            self.assertIn(phrase, fallback)

        for phrase in (
            "Valid `EMPTY_RESULT`",
            "Do not enter AutoFix",
            "`status: partial` or `status: failed`",
            "do not retry automatically",
            "Top-level `TIMEOUT` with no terminal item row",
            "explicit user approval",
            "final command result after any eligible adapter-owned fallback",
            "from `download-publish-data`",
            "login `TIMEOUT` / exit code 75",
            "already determined not to be a login or verification timeout",
            "absent, unverified, mismatched, or ambiguous",
            "diagnostic retry budget has already been consumed",
            "diagnostic retry budget is unused",
            "login-gate rerun has already been consumed",
            "single post-confirmation login-gate rerun",
            "`RATE_LIMITED`",
            "legacy `COMMAND_EXEC`",
            "`freq control` or `rate limited`",
            "Do not run a trace rerun",
            "do not enter AutoFix",
            "changing `--limit` or `--max-pages`",
            "same command invocation",
            "`ret=200013` alone is not sufficient",
        ):
            self.assertIn(phrase, terminal)
        self.assertLess(
            terminal.index("login `TIMEOUT` / exit code 75"),
            terminal.index("Top-level `TIMEOUT`"),
        )
        self.assertLess(
            terminal.index("Public fallback is requested"),
            terminal.index("Valid `EMPTY_RESULT`"),
        )
        self.assertLess(
            terminal.index("`status: partial` or `status: failed`"),
            terminal.index("Top-level `TIMEOUT`"),
        )
        self.assertLess(
            terminal.index("diagnostic retry budget has already been consumed"),
            terminal.index("diagnostic retry budget is unused"),
        )
        self.assertLess(
            terminal.index("diagnostic retry budget has already been consumed"),
            terminal.index("login `TIMEOUT` / exit code 75"),
        )
        self.assertLess(
            terminal.index("login-gate rerun has already been consumed"),
            terminal.index("login `TIMEOUT` / exit code 75"),
        )
        self.assertLess(
            terminal.index("`RATE_LIMITED`"),
            terminal.index("Another typed byCLI failure"),
        )

        self.assertIn("no terminal item row or artifact metadata", downloads)
        self.assertIn("rerun exactly once with `--trace retain-on-failure`", downloads)
        self.assertIn("at most once per original command", downloads)
        self.assertIn("consumes that command's retry budget", downloads)
        self.assertIn("including another top-level `TIMEOUT`, is terminal", downloads)
        self.assertIn("Backend-only examples omit `--name`", weixin)
        self.assertIn(
            "Only after `accounts` proves one unique nickname-to-`fakeid` binding",
            weixin,
        )
        self.assertIn("Verified for byCLI 2.1.35", login)
        self.assertNotIn("2.1.35 and later", login)
        self.assertIn("`create-draft` session failures return `AUTH_REQUIRED`", login)
        self.assertIn(
            "An authentication outcome from an already-consumed diagnostic rerun follows terminal priority 1",
            login,
        )

    def test_weixin_reference_documents_resolved_download_urls_and_dual_publish_artifacts(self):
        weixin = (SKILLS_ROOT / "bycli" / "references" / "weixin.md").read_text(encoding="utf-8")

        for phrase in (
            "`source_url`",
            "`resolved_url`",
            "搜狗 `/link`",
            "无效 URL 会返回参数或执行错误",
            "`markdownSize`",
            "`dataSize`",
            "`status: downloaded`",
            "`status: partial`",
            "`status: failed`",
            "`freq control`",
            "不是认证失败",
            "不得立即重试",
            "`/wxamp/`",
            "Mini Program",
            "Official Account",
            "Success statuses are `draft saved`",
            "title substrings are not matches",
            "readable, non-empty regular-file validation",
            "oversized values return `ARGUMENT` before mode dispatch",
            "cover-confirmation failure returns `COMMAND_EXEC`",
        ):
            self.assertIn(phrase, weixin)

    def test_candidate_article_requires_user_confirmation_before_download(self):
        weixin = (SKILLS_ROOT / "bycli" / "references" / "weixin.md").read_text(encoding="utf-8")

        self.assertIn("必须先询问用户确认", weixin)
        self.assertIn("未确认不得下载", weixin)
        self.assertNotIn("status: invalid URL", weixin)
        self.assertNotIn("save attempted, check browser to confirm", weixin)


if __name__ == "__main__":
    unittest.main()
