import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), 'knowledge-collection.mjs');
const enterpriseScriptPath = resolve(dirname(scriptPath), 'enterprise-collection.mjs');
const routerScriptPath = resolve(dirname(scriptPath), 'command-router.mjs');
const platformDelegatePath = resolve(dirname(scriptPath), 'platform-delegate.mjs');
const siteCrawlSkillPath = resolve(dirname(scriptPath), '../references/site-crawl/SKILL.md');

function runCli(args, env = {}, executable = scriptPath) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [executable, ...args], {
      env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      let json;
      try { json = JSON.parse(stdout); } catch { json = undefined; }
      resolveRun({ code, stdout, stderr, json });
    });
  });
}

function makeSessionDir() {
  return mkdtempSync(join(tmpdir(), 'kc-test-'));
}

function writeExecutorOutputs(root, { title = 'Paper', url = 'https://arxiv.org/abs/2608.04002' } = {}) {
  mkdirSync(join(root, 'markdown'), { recursive: true });
  mkdirSync(join(root, 'sanitized/items'), { recursive: true });
  mkdirSync(join(root, '.collection-inputs'), { recursive: true });
  writeFileSync(join(root, 'collection-result.json'), JSON.stringify({
    schemaVersion: '1.0', title: 't', source: 'public-internet', backend: 'bycli',
    url: 'https://example.com', filters: {}, items: [{
      title, url, author: 'x',
      publishTime: '2026-08-04T00:00:00Z', markdown: 'sanitized/items/paper.md',
      fileName: 'sanitized/items/paper.md',
    }],
  }, null, 2));
  writeFileSync(join(root, 'sanitized/items/paper.md'), '# Paper\n\ncontent\n');
  writeFileSync(join(root, 'markdown/paper.md'), '# Paper\n\ncontent\n');
}

function collectPayload(itemId = 'item-test1', url = 'https://arxiv.org/abs/2608.04002') {
  return {
    schemaVersion: '1.0',
    items: [{
      itemId,
      markdownPath: 'markdown/paper.md',
      sanitizedPath: 'sanitized/items/paper.md',
      canonicalItem: {
        title: 'Paper', url, author: 'x',
        publishTime: '2026-08-04T00:00:00Z',
        markdown: 'sanitized/items/paper.md', fileName: 'sanitized/items/paper.md',
      },
    }],
  };
}

async function setupCollectedSession({ mode = 'collection' } = {}) {
  const root = makeSessionDir();
  const init = await runCli(['init', '--session-dir', root, '--query', 'q', '--mode', mode]);
  assert.equal(init.json.ok, true);
  writeExecutorOutputs(root);
  const payloadPath = join(root, '.collection-inputs/items.json');
  writeFileSync(payloadPath, JSON.stringify(collectPayload(), null, 2));
  const collect = await runCli(['collect', '--session-dir', root, '--item-json-file', payloadPath]);
  assert.equal(collect.json.ok, true);
  return { root, payloadPath, itemId: collect.json.items[0].itemId };
}

// ── CLI 帮助与平台委派 ──

await (async () => {
  assert.equal(existsSync(routerScriptPath), true, 'local command routing must live outside the CLI entrypoint');
  assert.equal(existsSync(platformDelegatePath), true, 'platform command delegation must live outside the CLI entrypoint');
  const h = await runCli(['help']);
  assert.equal(h.json.ok, true);
  assert.equal(h.json.version, '3.0.0');
  assert.ok(h.json.commandsByGroup.research.some((item) => item.name === 'init'));
  const rootEnterprise = h.json.commandsByGroup.platform.find((item) => item.name === 'enterprise');
  assert.match(rootEnterprise.title, /resume-resource/);

  const ih = await runCli(['init', '--help']);
  assert.equal(ih.json.ok, true);
  assert.equal(ih.json.command, 'init');
  assert.ok(ih.json.example.includes('--session-dir'));

  const publicDiscoverHelp = await runCli(['public-discover', '--help']);
  assert.equal(publicDiscoverHelp.json.ok, true);
  assert.equal(publicDiscoverHelp.json.command, 'public-discover');
  assert.match(publicDiscoverHelp.json.args['--category'], /general/);
  assert.match(publicDiscoverHelp.json.args['--requested-count'], /明确指定/);

  const schema = await runCli(['command-schema']);
  assert.equal(schema.code, 0, schema.stderr);
  assert.equal(schema.json.schemaVersion, '1.0');
  assert.deepEqual(schema.json.commands.init.required, ['session-dir', 'query']);
  assert.equal(schema.json.commands.init.properties['source-scope'].type, 'array');
  assert.deepEqual(schema.json.commands.init.properties['source-scope'].items.enum, [
    'public-internet', 'dingtalk', 'feishu', 'wecom', 'ima',
  ]);
  assert.deepEqual(schema.json.commands.init.properties['source-scope'].default, ['public-internet']);
  assert.deepEqual(schema.json.commands.init.properties['materialization-target'].enum, ['candidates', 'selected', 'all']);
  assert.equal(schema.json.commands.init.properties['materialization-target'].default, 'selected');
  assert.deepEqual(schema.json.commands.plan.required, ['session-dir', 'initial-search', 'channels']);
  assert.equal(schema.json.commands.plan.properties['initial-search'].type, 'array');
  assert.equal(schema.json.commands.plan.properties.channels.type, 'object');
  assert.equal(schema.json.commands.branch.properties.level.type, 'integer');
  assert.equal(schema.json.commands.branch.properties.level.minimum, 1);
  assert.equal(schema.json.commands.branch.properties.status.default, 'done');
  assert.equal(schema.json.commands.collect.properties['item-json-file'].format, 'collection-input-file');
  assert.equal(schema.json.commands['crawl-seed'].properties['max-pages'].type, 'integer');
  assert.equal(schema.json.commands['crawl-seed'].properties.depth.default, 1);
  assert.deepEqual(schema.json.commands['public-discover'].required, ['session-dir', 'query']);
  assert.equal(schema.json.commands['public-discover'].properties.category.default, 'general');
  assert.equal(schema.json.commands['public-discover'].properties['requested-count'].type, 'integer');
  assert.equal(schema.json.commands['public-discover'].properties['requested-count'].minimum, 1);
  for (const [name, contract] of Object.entries(schema.json.commands)) {
    if (contract.type !== 'delegated-command') {
      assert.equal(contract.schemaComplete, true, `${name} schema must be explicit`);
    }
  }
  assert.ok(schema.json.commands.report.required.includes('session-dir'));
  assert.equal(schema.json.commands.enterprise.type, 'delegated-command');
  assert.equal(schema.json.commands.enterprise.delegatedTo.schemaCommand, 'node scripts/enterprise-collection.mjs command-schema');

  const removedCommands = [
    'list-kb', 'normalize', 'ingest', 'store', 'upload-doc', 'upload-images', 'upload-resource',
    'run', 'cleanup', 'set-retention', 'rewrite-image-links',
  ];
  for (const command of removedCommands) {
    assert.equal(schema.json.commands[command], undefined, `${command} must not be advertised`);
    const removedHelp = await runCli([command, '--help']);
    assert.equal(removedHelp.code, 1, `${command} --help must fail`);
    assert.equal(removedHelp.json.ok, false);
    assert.match(removedHelp.json.error, /未知命令/);
  }
  assert.deepEqual(h.json.legacyAliases, {
    'init-session': 'init',
    'mark-materialized': 'collect',
  });
  for (const removedScript of [
    'ingest.mjs',
    'knowledge-collection-ingest.test.mjs',
    'knowledge-collection-post-processing.mjs',
  ]) {
    assert.equal(existsSync(resolve(dirname(scriptPath), removedScript)), false, `${removedScript} must be deleted`);
  }

  const missingPublicDiscoverSession = await runCli([
    'public-discover', '--session-dir', '/does-not-exist', '--query', 'q',
  ]);
  assert.equal(missingPublicDiscoverSession.code, 1);
  assert.match(missingPublicDiscoverSession.json.error, /采集会话目录不存在/);

  const siteCrawlFrontmatter = readFileSync(siteCrawlSkillPath, 'utf8').split('---')[1];
  assert.match(siteCrawlFrontmatter, /Do not use for one known URL/);

  const enterpriseSchema = await runCli(['command-schema'], {}, enterpriseScriptPath);
  assert.equal(enterpriseSchema.code, 0, enterpriseSchema.stderr);
  assert.equal(enterpriseSchema.json.commands['search-all'].additionalProperties, false);
  assert.deepEqual(enterpriseSchema.json.commands['search-all'].properties.sources.default, ['dingtalk', 'feishu', 'wecom', 'ima']);
  assert.ok(enterpriseSchema.json.commands.search.required.includes('parent-session-dir'));
  assert.ok(enterpriseSchema.json.commands.resource.required.includes('parent-session-dir'));

  const enterprise = await runCli(['enterprise', '--help']);
  assert.equal(enterprise.code, 0);
  assert.equal(enterprise.json.name, 'knowledge-collection-enterprise');
  assert.match(enterprise.json.usage, /enterprise (search|resource)/);
  assert.match(enterprise.json.defaults, /limit 50/);
  assert.match(enterprise.json.defaults, /concurrency 4/);
  assert.match(enterprise.json.defaults, /search-all defaults: sources dingtalk,feishu,wecom,ima/);
  assert.match(enterprise.json.defaults, /search-all defaults:.*metadata-only true/);
  assert.match(enterprise.json.commands.searchAll, /\[--sources dingtalk,feishu,wecom,ima\]/);

  const enterpriseSearchHelp = await runCli(['enterprise', 'search', '--help']);
  assert.equal(enterpriseSearchHelp.code, 0, enterpriseSearchHelp.stderr);
  assert.equal(enterpriseSearchHelp.json.name, 'knowledge-collection-enterprise');

  const enterpriseParent = makeSessionDir();
  const enterpriseParentInit = await runCli([
    'init', '--session-dir', enterpriseParent, '--query', 'enterprise routing',
    '--source-scope', '["dingtalk","feishu"]', '--materialization-target', 'candidates',
  ]);
  assert.equal(enterpriseParentInit.code, 0, enterpriseParentInit.stderr);
  const unsupported = await runCli([
    'enterprise', 'resource', '--parent-session-dir', enterpriseParent,
    '--source', 'dingtalk', '--url', 'https://example.com/document', '--output-dir', '/tmp/kc-enterprise-route',
  ]);
  assert.equal(unsupported.code, 0, unsupported.stderr);
  assert.equal(unsupported.json.status, 'unsupported_capability');
  assert.equal(unsupported.json.continuable, true);

  const fixtureRoot = mkdtempSync(join(tmpdir(), 'kc-enterprise-feishu-'));
  const fixtureBin = join(fixtureRoot, 'lark-cli');
  const outputDir = join(fixtureRoot, 'output');
  writeFileSync(fixtureBin, `#!/usr/bin/env node
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const args = process.argv.slice(2);
const outputDir = args[args.indexOf('--output-dir') + 1];
if (args[0] !== 'minutes' || args[1] !== '+detail' || args[args.indexOf('--minute-tokens') + 1] !== 'minute-1') process.exit(2);
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'transcript.md'), '# Transcript\\n\\nCLI regression.\\n');
console.log(JSON.stringify({ ok: true }));
`);
  chmodSync(fixtureBin, 0o700);
  try {
    const feishu = await runCli([
      'enterprise', 'resource', '--parent-session-dir', enterpriseParent,
      '--source', 'feishu', '--url', 'https://example.feishu.cn/minutes/minute-1',
      '--minute-token', 'minute-1', '--output-dir', outputDir,
    ], { LARK_CLI_BIN: fixtureBin, LARK_HOME: join(fixtureRoot, 'lark-home') });
    assert.equal(feishu.code, 0, feishu.stderr);
    assert.equal(feishu.json.status, 'complete');
    assert.match(readFileSync(join(outputDir, 'sanitized/items/transcript.md'), 'utf8'), /CLI regression/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
  console.log('PASS cli help and platform dispatch');
})();

// ── 参数校验与未知参数拒绝 ──

await (async () => {
  let root = makeSessionDir();
  let r = await runCli(['init', '--session-dir', root, '--query', 'q', '--breadth', 'abc']);
  assert.equal(r.code, 1);
  assert.ok(r.json.error.includes('--breadth'));

  root = makeSessionDir();
  r = await runCli(['init', '--session-dir', root, '--query', 'q', '--depth', '-1']);
  assert.equal(r.code, 1);
  assert.ok(r.json.error.includes('--depth'));

  root = makeSessionDir();
  r = await runCli(['init', '--session-dir', root, '--query', 'q', '--bogus', 'x']);
  assert.equal(r.code, 1);
  assert.ok(r.json.error.includes('--bogus'));

  root = makeSessionDir();
  r = await runCli(['init', `--session-dir=${root}`, '--query=q', '--mode', 'collection']);
  assert.equal(r.json.ok, true);
  console.log('PASS arg validation and key=value');
})();

// ── 采集范围与正文交付目标 ──

await (async () => {
  const defaultScope = await runCli(['init', '--session-dir', makeSessionDir(), '--query', '公开资料']);
  assert.deepEqual(defaultScope.json.task.sourceScope, ['public-internet']);
  assert.equal(defaultScope.json.task.materializationTarget, 'selected');

  const explicitScope = await runCli([
    'init', '--session-dir', makeSessionDir(), '--query', '团队方案',
    '--source-scope', '["public-internet","feishu"]',
    '--materialization-target', 'all',
  ]);
  assert.deepEqual(explicitScope.json.task.sourceScope, ['public-internet', 'feishu']);
  assert.equal(explicitScope.json.task.materializationTarget, 'all');
  console.log('PASS source scope and materialization target');
})();

// ── 站点爬取报告模板必须满足统一 report 契约 ──

await (async () => {
  const template = readFileSync(siteCrawlSkillPath, 'utf8');
  for (const heading of ['采集范围', '采集成果', '来源与追溯', '覆盖缺口与局限']) {
    assert.match(template, new RegExp(`^## ${heading}`, 'm'));
  }
  console.log('PASS site crawl report template contract');
})();

// ── 研究流(含 source/citation 防编造校验) ──

await (async () => {
  const root = makeSessionDir();
  const r = await runCli(['init', '--session-dir', root, '--query', '数据本体论上周发展', '--mode', 'research', '--depth', '2', '--deadline-minutes', '60']);
  assert.equal(r.json.ok, true);
  assert.ok(r.json.task.startedAt);
  writeExecutorOutputs(root);
  const payloadPath = join(root, '.collection-inputs/items.json');
  writeFileSync(payloadPath, JSON.stringify(collectPayload('item-x1'), null, 2));
  const c = await runCli(['collect', '--session-dir', root, '--item-json-file', payloadPath]);
  assert.equal(c.json.ok, true);
  assert.ok(!existsSync(payloadPath), 'collect 成功后应删除输入 payload');

  // plan 必须为三个发现通道逐个表态：漏传、漏通道、缺 reason、reason 笼统均须拒收。
  const noChannels = await runCli(['plan', '--session-dir', root, '--initial-search', '["arxiv"]', '--combined-query', 'q1']);
  assert.equal(noChannels.json.ok, false, '未传 --channels 应拒收');
  assert.match(noChannels.json.error, /--channels/);

  const partial = await runCli(['plan', '--session-dir', root, '--initial-search', '["arxiv"]',
    '--channels', '{"builtin-routing":{"state":"used"},"searxng":{"state":"used"}}']);
  assert.equal(partial.json.ok, false, '漏掉 hot-discovery 应拒收');
  assert.match(partial.json.error, /hot-discovery/);

  const noReason = await runCli(['plan', '--session-dir', root, '--initial-search', '["arxiv"]',
    '--channels', '{"builtin-routing":{"state":"used"},"searxng":{"state":"used"},"hot-discovery":{"state":"unavailable"}}']);
  assert.equal(noReason.json.ok, false, 'state 非 used 且缺 reason 应拒收');

  const vague = await runCli(['plan', '--session-dir', root, '--initial-search', '["arxiv"]',
    '--channels', '{"builtin-routing":{"state":"used"},"searxng":{"state":"used"},"hot-discovery":{"state":"unavailable","reason":"跳过"}}']);
  assert.equal(vague.json.ok, false, 'reason 笼统应拒收');

  const p = await runCli(['plan', '--session-dir', root, '--initial-search', '["arxiv"]', '--combined-query', 'q1',
    '--channels', '{"builtin-routing":{"state":"used"},"searxng":{"state":"used"},'
      + '"hot-discovery":{"state":"unavailable","reason":"bycli 适配器在测试环境未就绪"}}']);
  assert.equal(p.json.ok, true);
  assert.equal(p.json.channels['hot-discovery'].state, 'unavailable');

  const b = await runCli(['branch', '--session-dir', root, '--level', '1', '--query', 'arXiv 论文',
    '--research-goal', '找窗口内论文', '--learnings', '["AgentK"]',
    '--citations', '{"AgentK":"item-x1"}',
    '--sources', '["https://arxiv.org/abs/2608.04002"]',
    '--search-queries', '[{"query":"arxiv ontology","skill":"online-search","engine":"arxiv","resultCount":3,"status":"success"}]']);
  assert.equal(b.json.ok, true);
  assert.equal(b.json.id, 'L1-B1');

  const bad = await runCli(['branch', '--session-dir', root, '--level', '2', '--query', 'x',
    '--research-goal', 'y', '--learnings', '["fake"]', '--citations', '{"fake":"not-registered"}',
    '--sources', '["https://not-collected.example.com"]']);
  assert.equal(bad.code, 1);
  assert.ok(bad.json.error.includes('未登记'));

  const agg = await runCli(['aggregate', '--session-dir', root]);
  assert.equal(agg.json.ok, true);
  assert.equal(agg.json.learnings, 1);

  writeFileSync(join(root, 'report.md'), '# 报告\n');
  const rep = await runCli(['report', '--session-dir', root]);
  assert.equal(rep.code, 1, 'depth=2 未到层级时 report 必须要求 stop-reason');
  const incomplete = await runCli(['report', '--session-dir', root, '--stop-reason', '时间预算用尽,仅完成第一层']);
  assert.equal(incomplete.code, 1);
  assert.match(incomplete.json.error, /缺少必填章节/);

  writeFileSync(join(root, 'report.md'), [
    '# 报告', '## 采集范围', '公开互联网', '## 采集成果', '1 篇正文',
    '## 来源与追溯', 'arXiv', '## 覆盖缺口与局限', '无数据局限',
  ].join('\n'));
  const rep2 = await runCli(['report', '--session-dir', root, '--stop-reason', '时间预算用尽,仅完成第一层']);
  assert.equal(rep2.json.ok, true);
  assert.equal(rep2.json.deliverySummary.materialized, 1);
  assert.equal(rep2.json.deliverySummary.uniqueContentGroups, 1);
  assert.equal(rep2.json.deliverySummary.deliveryComplete, true);
  const tree = readFileSync(join(root, 'research-tree.md'), 'utf8');
  assert.ok(tree.includes('## Level 1'));
  assert.ok(tree.includes('AgentK'));
  assert.ok(tree.includes('item-x1'));
  assert.ok(tree.includes('时间预算用尽'));
  console.log('PASS research flow with anti-fabrication gates');
})();

// ── 零分支 report 拒绝 ──

await (async () => {
  const root = makeSessionDir();
  await runCli(['init', '--session-dir', root, '--query', 'q']);
  writeFileSync(join(root, 'report.md'), '# report\n');
  const rep = await runCli(['report', '--session-dir', root]);
  assert.equal(rep.code, 1);
  assert.ok(rep.json.error.includes('零分支'));
  console.log('PASS zero-branch report rejected');
})();

// ── inspect 只读 ──

await (async () => {
  const { root } = await setupCollectedSession({ mode: 'collection' });
  writeFileSync(join(root, 'markdown/old.md'), '# old\n');
  const session = JSON.parse(readFileSync(join(root, 'session.json'), 'utf8'));
  session.collection.collection.items[0].materialization.pendingArtifactCleanup = ['markdown/old.md'];
  writeFileSync(join(root, 'session.json'), JSON.stringify(session, null, 2));

  const readOnly = await runCli(['inspect', '--session-dir', root]);
  assert.equal(readOnly.json.ok, true);
  assert.ok(existsSync(join(root, 'markdown/old.md')), 'inspect 默认不得删除文件');

  const sessionAfter = JSON.parse(readFileSync(join(root, 'session.json'), 'utf8'));
  assert.deepEqual(sessionAfter.collection.collection.items[0].materialization.pendingArtifactCleanup, ['markdown/old.md']);
  console.log('PASS inspect read-only default');
})();

// ── init 敏感字段拒绝 ──

await (async () => {
  const root = makeSessionDir();
  const meta = join(tmpdir(), `kc-meta-${process.pid}.json`);
  writeFileSync(meta, JSON.stringify({
    schemaVersion: '1.0', storage: { fallback: false },
    collection: { status: 'complete', items: [] },
    sourceMetadata: { api_token: 'secret' },
  }));
  const r = await runCli(['init', '--session-dir', root, '--query', 'q', '--metadata-input-file', meta]);
  assert.equal(r.code, 1);
  assert.ok(r.json.error.includes('敏感字段'));
  console.log('PASS sensitive init input rejected');
})();

// ── 旧会话迁移 ──

await (async () => {
  const root = makeSessionDir();
  writeExecutorOutputs(root);
  writeFileSync(join(root, 'sanitized/metadata.json'), JSON.stringify({
    partial: true, storageFallback: false, audit_required: false,
  }));
  const inspected = await runCli(['inspect', '--session-dir', root]);
  assert.equal(inspected.json.ok, true);
  assert.equal(existsSync(join(root, 'session.json')), false, 'legacy inspect 不得写入迁移状态');
  const s = await runCli(['status', '--session-dir', root]);
  assert.equal(s.json.ok, true);
  assert.equal(s.json.collection.items, 1);
  const session = JSON.parse(readFileSync(join(root, 'session.json'), 'utf8'));
  assert.equal(session.schemaVersion, '2.0');
  assert.equal(session.collection.collection.items.length, 1);
  console.log('PASS legacy migration');
})();

// ── 错误路径: 锁冲突 ──

await (async () => {
  const { root } = await setupCollectedSession({ mode: 'collection' });
  writeFileSync(join(root, '.knowledge-collection.lock'), JSON.stringify({
    pid: process.pid, createdAt: new Date().toISOString(), ownerId: 'x', command: 'test',
  }));
  const payloadPath = join(root, '.collection-inputs/items2.json');
  writeFileSync(payloadPath, JSON.stringify(collectPayload('item-2'), null, 2));
  const c = await runCli(['collect', '--session-dir', root, '--item-json-file', payloadPath]);
  assert.equal(c.json.ok, false);
  assert.ok(c.json.error.includes('锁'));
  console.log('PASS lock conflict');
})();

console.log('ALL TESTS PASSED');
