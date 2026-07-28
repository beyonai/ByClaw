import json
import re
import unittest
from pathlib import Path


SKILLS_ROOT = Path(__file__).parents[1] / "skills"
SKILL_ROOT = SKILLS_ROOT / "knowledge-collection"
REPO_ROOT = Path(__file__).parents[3]
V030_DML = REPO_ROOT / "deploy" / "migrations" / "versions" / "V0.3.0" / "V0.3.0__dml.sql"
META_PROMPT_SERVICE = (
    REPO_ROOT
    / "byclaw-be"
    / "src/main/java/com/iwhalecloud/byai/manager/application/service/digitemploy/MetaPromptService.java"
)
DESCRIPTION = (
    "Use when the user asks to collect, crawl, batch-search, archive, ingest, or organize information from internet "
    "or enterprise sources, or wants existing collected files stored in a knowledge base."
)
INTERFACE = {
    "display_name": "知识采集",
    "short_description": "跨互联网与企业平台采集、归档资料，并衔接知识库入库或知识整理",
    "default_prompt": (
        "Use $knowledge-collection to collect these sources and prepare the results for my chosen post-processing action."
    ),
}
OPENAI_YAML = f'''interface:
  display_name: "{INTERFACE["display_name"]}"
  short_description: "{INTERFACE["short_description"]}"
  default_prompt: "{INTERFACE["default_prompt"]}"
'''
CHILD_SKILLS = {
    "agent-reach/SKILL.md": "agent-reach",
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




class KnowledgeCollectionSkillContractTest(unittest.TestCase):
    def test_upgrade_migration_replaces_the_bundled_skill_catalog(self):
        upgrade = V030_DML.read_text(encoding="utf-8")

        self.assertIn("OPENCLAW_BUNDLED_SKILLS", upgrade)
        self.assertIn('"skillCode":"knowledge-collection"', upgrade)
        self.assertIn('"skillCode":"agent-reach"', upgrade)
        self.assertNotIn("WITH ORDINALITY", upgrade)
        self.assertNotIn("jsonb_build_object", upgrade)
        self.assertNotIn("jsonb_agg", upgrade)
        self.assertNotIn("jsonb_array_elements", upgrade)
        self.assertNotIn("regexp_replace", upgrade)

    def test_meta_prompt_counts_catalog_entries_from_json(self):
        source = META_PROMPT_SERVICE.read_text(encoding="utf-8")

        self.assertIn("summary.setBundledSkillCount(countBundledSkills(bundledSkills));", source)
        self.assertIn("OBJECT_MAPPER.readTree(bundledSkills)", source)



    def test_upgrade_updates_runtime_skill_target_content_without_replacing_other_json_fields(self):
        upgrade = " ".join(V030_DML.read_text(encoding="utf-8").split())

        self.assertRegex(
            upgrade,
            re.compile(
                r"UPDATE byai\.ss_res_ext_skill e SET target_content = "
                r"jsonb_set\(\s*target_content::jsonb, '\{resourceCode\}', "
                r"'\"knowledge-collection\"'::jsonb, false\s*\)::text "
                r"WHERE e\.resource_id = 14 AND target_content IS NOT NULL "
                r"AND target_content::jsonb ->> 'resourceCode' = 'bycli' AND EXISTS \( "
                r"SELECT 1 FROM byai\.ss_resource r "
                r"WHERE r\.resource_id = e\.resource_id AND r\.resource_id = 14 "
                r"AND r\.resource_name = '知识采集' "
                r"AND r\.resource_code = 'knowledge-collection' \);",
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

    def test_skill_defines_collection_orchestration_contract(self):
        skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

        self.assertIn("查询 vs 采集", skill)
        self.assertIn("加载并遵循 `agent-reach` skill", skill)
        self.assertIn("加载并遵循 `bycli` skill", skill)
        self.assertIn("加载并遵循 `dws` skill", skill)
        self.assertIn("加载并遵循 `fws` skill", skill)
        self.assertIn("加载并遵循 `wecomcli` skill", skill)
        self.assertIn("来源执行器不得反向加载 `knowledge-collection`", skill)
        self.assertIn("委派采集模式优先于来源执行器的通用采集后处理规则", skill)
        self.assertIn("来源执行器只负责采集并返回结果", skill)
        self.assertIn("来源执行器不得询问 `入库 / 知识整理 / 跳过`", skill)
        self.assertEqual(1, skill.count("采集结果只选择一种后处理：入库 / 知识整理 / 跳过"))

    def test_agent_reach_backends_share_one_collection_contract(self):
        skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

        self.assertIn("Agent Reach 直接后端与 `bycli` 后端返回的结果", skill)
        self.assertIn("必须统一进入同一套 collection contract", skill)
        self.assertIn("不得按执行后端分叉产物协议", skill)

    def test_explicit_collection_intent_overrides_item_count(self):
        skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

        self.assertIn("显式采集意图优先于页面或条目数量", skill)
        self.assertIn("只有不存在显式采集意图时", skill)
        self.assertIn("单个事实、单个页面", skill)

    def test_bycli_route_is_selected_by_router_or_explicit_execution_intent(self):
        skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

        self.assertIn("`agent-reach` 选择 `bycli`", skill)
        self.assertIn("用户显式要求 byCLI、浏览器或 Adapter", skill)
        self.assertNotIn("浏览器或 adapter 返回的结果：", skill)

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
        self.assertIn(f"]({relative_path})", skill)
        self.assertTrue(bridge_path.is_file(), relative_path)

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

    def test_post_processing_defines_storage_preview_and_terminal_behavior(self):
        processing = (SKILL_ROOT / "references" / "post-processing.md").read_text(encoding="utf-8")

        for phrase in (
            "/by/.sessions/<sessionId>/<collectionRunName>/<timestamp>/",
            ".by-sessions",
            "storageFallback",
            "自动持久化",
            "最多预存 10 个正文",
            "可点击预览",
            "partial",
            "入库 / 知识整理 / 跳过",
            "互斥",
            "原始执行器",
            "补采",
            "入库确认",
            "knowledge-organizer",
            "audit_required=true",
            "用户要求保留",
            "失败或跳过时保留",
        ):
            self.assertIn(phrase, processing)

    def test_ingest_executor_is_discoverable_and_requires_an_explicit_target(self):
        relative_path = "references/knowledge-ingest.md"
        skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
        ingest_path = SKILL_ROOT / relative_path
        ingest = ingest_path.read_text(encoding="utf-8")

        self.assertIn(f"]({relative_path})", skill)
        self.assertTrue(ingest_path.is_file(), relative_path)
        for phrase in (
            "scripts/knowledge-collection-ingest.mjs",
            "list-kb",
            "normalize",
            "ingest",
            "upload-doc",
            "--collection-result-file",
            "--bycli-json-file",
            "--knowledge-base-resource-id",
            "--directory-path",
            "by-knowledge-manager",
            "不得静默选择",
            "明确提供",
            "确认目标",
            "仅入库用户选中的范围",
            "入库与知识整理互斥",
            "选择 `入库`",
            "`ingest` 与 `upload-doc` 执行前",
            "默认 `/` 也必须展示",
            "获得用户明确确认",
        ):
            self.assertIn(phrase, ingest)

        ingest_section = ingest.split("- `ingest`：", 1)[1].split("- `upload-doc`：", 1)[0]
        upload_doc_section = ingest.split("- `upload-doc`：", 1)[1]
        self.assertIn("--knowledge-base-resource-id", ingest_section)
        self.assertIn("--knowledge-base-id", ingest_section)
        self.assertIn("--knowledge-base-resource-id", upload_doc_section)
        self.assertNotIn("--knowledge-base-id", upload_doc_section)

        self.assertNotIn("token", ingest.lower())
        self.assertNotIn("cookie", ingest.lower())

    def test_bycli_is_an_executor_when_delegated_by_knowledge_collection(self):
        bycli = (SKILLS_ROOT / "bycli" / "SKILL.md").read_text(encoding="utf-8")

        for phrase in (
            "浏览器与 Adapter 执行层",
            "`knowledge-collection` 负责统一持久化、产物协议、后处理与入库或知识整理",
            "网站执行器只执行或发现、修复 Adapter",
            "不得反向加载 `knowledge-collection`",
            "是否把刚才的获取过程保存成一个专用 adapter",
        ):
            self.assertIn(phrase, bycli)

    def test_delegated_adapter_candidate_does_not_create_a_second_question(self):
        bycli = (SKILLS_ROOT / "bycli" / "SKILL.md").read_text(encoding="utf-8")
        processing = (SKILL_ROOT / "references" / "post-processing.md").read_text(encoding="utf-8")

        self.assertIn("`adapterCandidate`", bycli)
        self.assertIn("不得直接询问用户是否保存 Adapter", bycli)
        self.assertIn("直接查询所有者（根 Agent）", bycli)
        self.assertIn("`adapterCandidate`", processing)
        self.assertIn("不得追加第二个选择问题", processing)

    def test_orchestration_documents_use_named_actors(self):
        paths = (
            SKILL_ROOT / "SKILL.md",
            SKILL_ROOT / "references" / "post-processing.md",
            SKILL_ROOT / "references" / "knowledge-ingest.md",
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
        agent_reach = (SKILLS_ROOT / "agent-reach" / "SKILL.md").read_text(encoding="utf-8")
        bycli = (SKILLS_ROOT / "bycli" / "SKILL.md").read_text(encoding="utf-8")
        processing = (SKILL_ROOT / "references" / "post-processing.md").read_text(encoding="utf-8")

        self.assertIn("只有不存在显式采集意图时", knowledge)
        self.assertIn("直接查询时由根 Agent", agent_reach)
        self.assertIn("委派采集时由采集编排器", agent_reach)
        self.assertIn("委派采集模式下，不直接提问", bycli)
        self.assertEqual(1, processing.count("只询问一次：`入库 / 知识整理 / 跳过`"))

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


if __name__ == "__main__":
    unittest.main()
