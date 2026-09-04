import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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
  const init = await runCli([
    'init', '--session-dir', root, '--query', 'q', '--mode', mode,
    '--direct-urls', '["https://arxiv.org/abs/2608.04002"]',
  ]);
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
  const tempRoot = makeSessionDir();
  const sessionsRoot = join(tempRoot, 'by', '.sessions');
  const sandboxSessionRoot = join(sessionsRoot, '20023126');
  const sandboxEnv = { KNOWLEDGE_COLLECTION_SESSIONS_ROOT: sessionsRoot };
  const workspaceDir = join(tempRoot, 'by', '.openclaw', 'workspace', 'collections', 'test');
  const absoluteOutside = await runCli([
    'init', '--session-dir', workspaceDir, '--session-root', sandboxSessionRoot, '--query', 'q',
  ], sandboxEnv);
  assert.equal(absoluteOutside.code, 0, absoluteOutside.stderr || absoluteOutside.stdout);
  assert.equal(absoluteOutside.json.sessionDir, workspaceDir);

  const untrustedRoot = join(tempRoot, 'by', '.openclaw', 'workspace');
  const untrusted = await runCli([
    'init', '--session-dir', 'collections/test',
    '--session-root', untrustedRoot, '--query', 'q',
  ], sandboxEnv);
  assert.equal(untrusted.code, 1);
  assert.match(untrusted.json.error, /Session Root 必须是/);

  const sessionDir = join(sandboxSessionRoot, 'accepted');
  const accepted = await runCli([
    'init', '--session-dir', 'accepted', '--session-root', sandboxSessionRoot, '--query', 'q',
  ], sandboxEnv);
  assert.equal(accepted.code, 0, accepted.stderr);
  assert.equal(accepted.json.ok, true);
  assert.equal(accepted.json.sessionDir, sessionDir);

  const relativeStatus = await runCli([
    'status', '--session-dir', 'accepted', '--session-root', sandboxSessionRoot,
  ], sandboxEnv);
  assert.equal(relativeStatus.code, 0, relativeStatus.stderr || relativeStatus.stdout);
  assert.equal(relativeStatus.json.ok, true);

  const researchSessionDir = join(sandboxSessionRoot, 'research-relative');
  const researchInit = await runCli([
    'init', '--session-dir', 'research-relative', '--session-root', sandboxSessionRoot,
    '--query', 'relative report', '--mode', 'research', '--depth', '1',
  ], sandboxEnv);
  assert.equal(researchInit.code, 0, researchInit.stderr || researchInit.stdout);
  const researchPlan = await runCli([
    'plan', '--session-dir', 'research-relative', '--session-root', sandboxSessionRoot,
    '--initial-search', '["fixture"]', '--channels',
    '{"builtin-routing":{"state":"used"},"searxng":{"state":"used"},"hot-discovery":{"state":"used"}}',
  ], sandboxEnv);
  assert.equal(researchPlan.code, 0, researchPlan.stderr || researchPlan.stdout);
  const researchBranch = await runCli([
    'branch', '--session-dir', 'research-relative', '--session-root', sandboxSessionRoot,
    '--level', '1', '--query', 'fixture branch', '--status', 'failed', '--reason', 'fixture source unavailable',
  ], sandboxEnv);
  assert.equal(researchBranch.code, 0, researchBranch.stderr || researchBranch.stdout);
  const relativeReportPath = join(sandboxSessionRoot, 'reports', 'relative-report.md');
  mkdirSync(join(sandboxSessionRoot, 'reports'), { recursive: true });
  writeFileSync(relativeReportPath, [
    '## 采集范围', '范围。', '## 采集成果', '成果。',
    '## 来源与追溯', '来源。', '## 覆盖缺口与局限', '局限。',
  ].join('\n'));
  const relativeReport = await runCli([
    'report', '--session-dir', 'research-relative', '--session-root', sandboxSessionRoot,
    '--report-path', 'reports/relative-report.md',
  ], sandboxEnv);
  assert.equal(relativeReport.code, 0, relativeReport.stderr || relativeReport.stdout);
  const researchSession = JSON.parse(readFileSync(join(researchSessionDir, 'session.json'), 'utf8'));
  assert.equal(researchSession.research.reportPath, relativeReportPath);

  const siblingDir = join(sessionsRoot, 'other-session', 'collections', 'wrong');
  const sibling = await runCli([
    'init', '--session-dir', siblingDir, '--session-root', sandboxSessionRoot, '--query', 'q',
  ], sandboxEnv);
  assert.equal(sibling.code, 0, sibling.stderr || sibling.stdout);
  assert.equal(sibling.json.sessionDir, siblingDir);

  const relativeEscape = await runCli([
    'init', '--session-dir', '../escaped', '--session-root', sandboxSessionRoot, '--query', 'q',
  ], sandboxEnv);
  assert.equal(relativeEscape.code, 1);
  assert.match(relativeEscape.json.error, /Session Root|越出/);

  const outside = join(tempRoot, 'outside');
  mkdirSync(outside);
  symlinkSync(outside, join(sandboxSessionRoot, 'collections'));
  const escapedDir = join(sandboxSessionRoot, 'collections', 'escaped');
  const escaped = await runCli([
    'init', '--session-dir', 'collections/escaped', '--session-root', sandboxSessionRoot, '--query', 'q',
  ], sandboxEnv);
  assert.equal(escaped.code, 1);
  assert.match(escaped.json.error, /Session Root|符号链接|越出/);
  assert.equal(existsSync(join(outside, 'collections')), false);

  const linkedRootTarget = join(tempRoot, 'linked-root-target');
  mkdirSync(linkedRootTarget);
  const linkedSessionRoot = join(sessionsRoot, 'linked-session');
  symlinkSync(linkedRootTarget, linkedSessionRoot);
  const linkedRoot = await runCli([
    'init', '--session-dir', 'collections/escaped',
    '--session-root', linkedSessionRoot, '--query', 'q',
  ], sandboxEnv);
  assert.equal(linkedRoot.code, 1);
  assert.match(linkedRoot.json.error, /普通目录且不能是符号链接/);
  assert.equal(existsSync(join(linkedRootTarget, 'collections')), false);
  rmSync(tempRoot, { recursive: true, force: true });
})();

await (async () => {
  const tempRoot = makeSessionDir();
  const sessionRoot = join(tempRoot, 'by', '.sessions');
  const sessionDir = join(sessionRoot, 'cloud-session');
  const env = { KNOWLEDGE_COLLECTION_SESSIONS_ROOT: join(tempRoot, 'by', '.sessions') };
  const scope = JSON.stringify({
    schemaVersion: '1.0',
    resources: [{ resourceId: 1024, directoryPath: '/docs', origin: 'user-input' }],
  });
  const init = await runCli([
    'init', '--session-dir', sessionDir, '--session-root', sessionRoot, '--query', 'cloud query',
    '--source-scope', '["cloud-knowledge"]', '--materialization-target', 'selected',
    '--required-content-granularity', 'full-text', '--cloud-discovery-scope', scope,
  ], env);
  assert.equal(init.code, 0, init.stderr || init.stdout);
  const persisted = JSON.parse(readFileSync(join(sessionDir, 'session.json'), 'utf8'));
  assert.deepEqual(persisted.task.cloudDiscoveryScope.resources, [{ resourceId: 1024, directoryPath: '/docs', origin: 'user-input' }]);
  const rejected = await runCli([
    'init', '--session-dir', join(sessionRoot, 'bad'), '--session-root', sessionRoot, '--query', 'bad',
    '--source-scope', '["public-internet"]', '--cloud-discovery-scope', scope,
  ], env);
  assert.equal(rejected.code, 1);
  assert.match(rejected.json.error, /cloud-discovery-scope|cloud-knowledge/);
  rmSync(tempRoot, { recursive: true, force: true });
  console.log('PASS cloud discovery scope persists and is source-scoped');
})();

await (async () => {
  const tempRoot = makeSessionDir();
  const sessionsRoot = join(tempRoot, 'by', '.sessions');
  const sessionRoot = join(sessionsRoot, 'session-layout');
  const sandboxEnv = { KNOWLEDGE_COLLECTION_SESSIONS_ROOT: sessionsRoot };

  const ordinaryStaging = join(sessionRoot, '.collection-runs', 'ordinary-run');
  const rejectedOrdinaryStaging = await runCli([
    'init', '--session-dir', ordinaryStaging, '--session-root', sessionRoot,
    '--query', 'ordinary collection',
  ], sandboxEnv);
  assert.equal(rejectedOrdinaryStaging.code, 1);
  assert.match(rejectedOrdinaryStaging.json.error, /delivery-requested|显式保存路径/);
  assert.equal(existsSync(ordinaryStaging), false);

  const wrongDeliveryLayout = join(sessionRoot, 'collections', 'delivery-run');
  const rejectedDeliveryLayout = await runCli([
    'init', '--session-dir', wrongDeliveryLayout, '--session-root', sessionRoot,
    '--query', 'delivery collection', '--delivery-requested', 'true',
  ], sandboxEnv);
  assert.equal(rejectedDeliveryLayout.code, 1);
  assert.match(rejectedDeliveryLayout.json.error, /\.collection-runs\/[^/]+/);
  assert.equal(existsSync(wrongDeliveryLayout), false);

  const nestedDeliveryLayout = join(sessionRoot, '.collection-runs', 'run-001', 'nested');
  const rejectedNestedDelivery = await runCli([
    'init', '--session-dir', nestedDeliveryLayout, '--session-root', sessionRoot,
    '--query', 'nested delivery collection', '--delivery-requested', 'true',
  ], sandboxEnv);
  assert.equal(rejectedNestedDelivery.code, 1);
  assert.match(rejectedNestedDelivery.json.error, /\.collection-runs\/[^/]+/);
  assert.equal(existsSync(nestedDeliveryLayout), false);

  const ordinarySession = join(sessionRoot, 'collections', 'ordinary-collection');
  const acceptedOrdinary = await runCli([
    'init', '--session-dir', ordinarySession, '--session-root', sessionRoot,
    '--query', 'ordinary collection',
  ], sandboxEnv);
  assert.equal(acceptedOrdinary.code, 0, acceptedOrdinary.stderr || acceptedOrdinary.stdout);
  assert.equal(acceptedOrdinary.json.task.deliveryRequested, false);

  const deliverySession = join(sessionRoot, '.collection-runs', 'run-001');
  const acceptedDelivery = await runCli([
    'init', '--session-dir', deliverySession, '--session-root', sessionRoot,
    '--query', 'delivery collection', '--delivery-requested', 'true',
  ], sandboxEnv);
  assert.equal(acceptedDelivery.code, 0, acceptedDelivery.stderr || acceptedDelivery.stdout);
  assert.equal(acceptedDelivery.json.task.deliveryRequested, true);

  rmSync(tempRoot, { recursive: true, force: true });
})();

await (async () => {
  assert.equal(existsSync(routerScriptPath), true, 'local command routing must live outside the CLI entrypoint');
  assert.equal(existsSync(platformDelegatePath), true, 'platform command delegation must live outside the CLI entrypoint');
  const h = await runCli(['help']);
  assert.equal(h.json.ok, true);
  assert.equal(h.json.version, '3.0.0');
  assert.match(h.json.buildId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(h.json.buildIdSource, 'content-fingerprint');
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
  assert.match(publicDiscoverHelp.json.args['--requested-count'], /可用文章候选不足.*hot-discovery/);
  assert.match(publicDiscoverHelp.json.args['--timeout'], /online-search 与 hot-discovery/);

  const publicCollectHelp = await runCli(['public-collect', '--help']);
  assert.equal(publicCollectHelp.code, 0);
  assert.match(publicCollectHelp.json.title, /指定数量/);
  assert.match(publicCollectHelp.json.args['--fallback-query'], /第二轮/);
  assert.match(publicCollectHelp.json.args['--resume'], /--skip/);

  const wechatMaterializeHelp = await runCli(['materialize-wechat', '--help']);
  assert.equal(wechatMaterializeHelp.code, 0);
  assert.equal(wechatMaterializeHelp.json.command, 'materialize-wechat');
  assert.match(wechatMaterializeHelp.json.args['--executor-result-file'], /raw\/.*JSON/);

  const arxivMaterializeHelp = await runCli(['materialize-arxiv', '--help']);
  assert.equal(arxivMaterializeHelp.code, 0);
  assert.equal(arxivMaterializeHelp.json.command, 'materialize-arxiv');
  assert.match(arxivMaterializeHelp.json.args['--fulltext-file'], /raw\/.*Markdown/);

  const publishHelp = await runCli(['publish', '--help']);
  assert.equal(publishHelp.code, 0);
  assert.equal(publishHelp.json.command, 'publish');
  assert.match(publishHelp.json.args['--delivery-dir'], /用户/);

  const schema = await runCli(['command-schema']);
  assert.equal(schema.code, 0, schema.stderr);
  assert.equal(schema.json.schemaVersion, '1.0');
  assert.equal(schema.json.buildId, h.json.buildId);

  const injectedVersion = await runCli(['version'], {
    KNOWLEDGE_COLLECTION_BUILD_ID: 'commit:cc7ca601f',
  });
  assert.equal(injectedVersion.code, 0, injectedVersion.stderr);
  assert.equal(injectedVersion.json.buildId, 'commit:cc7ca601f');
  assert.equal(injectedVersion.json.buildIdSource, 'environment');
  assert.deepEqual(schema.json.commands.init.required, ['session-dir', 'query']);
  assert.equal(schema.json.commands.init.properties['session-dir'].format, 'sandbox-path');
  assert.equal(schema.json.commands.init.properties['session-root'].format, 'absolute-path');
  assert.equal(schema.json.commands.init.properties['source-scope'].type, 'array');
  assert.deepEqual(schema.json.commands.init.properties['source-scope'].items.enum, [
    'public-internet', 'dingtalk', 'feishu', 'wecom', 'ima', 'cloud-knowledge',
  ]);
  assert.deepEqual(schema.json.commands.init.properties['source-scope'].default, ['public-internet', 'cloud-knowledge']);
  assert.equal(schema.json.commands.init.properties['cloud-discovery-scope'].type, 'object');
  assert.deepEqual(schema.json.commands.init.properties['materialization-target'].enum, ['candidates', 'selected', 'all']);
  assert.equal(schema.json.commands.init.properties['materialization-target'].default, 'selected');
  assert.deepEqual(schema.json.commands.init.properties.workflow.enum, ['public-collect']);
  assert.equal(schema.json.commands.init.properties['delivery-requested'].type, 'boolean');
  assert.equal(schema.json.commands.init.properties['delivery-requested'].default, false);
  assert.deepEqual(schema.json.commands.plan.required, ['session-dir', 'initial-search', 'channels']);
  assert.equal(schema.json.commands.plan.properties['session-root'].format, 'absolute-path');
  assert.equal(schema.json.commands.plan.properties['initial-search'].type, 'array');
  assert.equal(schema.json.commands.plan.properties.channels.type, 'object');
  assert.equal(schema.json.commands.branch.properties.level.type, 'integer');
  assert.equal(schema.json.commands.branch.properties.level.minimum, 1);
  assert.equal(schema.json.commands.branch.properties.status.default, 'done');
  assert.equal(schema.json.commands.report.properties['report-path'].format, 'sandbox-path');
  assert.equal(schema.json.commands.status.properties['session-root'].format, 'absolute-path');
  assert.equal(schema.json.commands.collect.properties['item-json-file'].format, 'collection-input-file');
  assert.deepEqual(schema.json.commands.publish.required, ['session-dir']);
  assert.deepEqual(schema.json.commands.publish.oneOf, [
    { required: ['delivery-handle'] },
    { required: ['delivery-dir'] },
  ]);
  // --delivery-dir 不得标为 deprecated:企业 search-all 聚合会话与旧版本会话没有 handle,
  // 它是这些会话唯一的交付形式,标弃用会与 references/delivery.md 的硬要求矛盾。
  assert.equal(schema.json.commands.publish.properties['delivery-dir'].deprecated, undefined);
  assert.equal(schema.json.commands.publish.properties['delivery-handle'].type, 'string');
  assert.equal(schema.json.commands['public-collect'].properties['requested-count'].maximum, 20);
  assert.equal(schema.json.commands['public-collect'].oneOf.length, 3);
  assert.equal(schema.json.commands.publish.properties['session-dir'].format, 'sandbox-path');
  assert.equal(schema.json.commands.publish.properties['delivery-dir'].format, 'sandbox-path');
  assert.equal(schema.json.commands.publish.properties['session-root'].format, 'absolute-path');
  assert.equal(schema.json.commands['crawl-seed'].properties['max-pages'].type, 'integer');
  assert.equal(schema.json.commands['crawl-seed'].properties.depth.default, 1);
  assert.deepEqual(schema.json.commands['public-discover'].required, ['session-dir', 'query']);
  assert.equal(schema.json.commands['public-discover'].properties.category.default, 'general');
  assert.equal(schema.json.commands['public-discover'].properties['requested-count'].type, 'integer');
  assert.equal(schema.json.commands['public-discover'].properties['requested-count'].minimum, 1);
  assert.deepEqual(schema.json.commands['materialize-wechat'].required, [
    'session-dir', 'executor-result-file', 'item-id',
  ]);
  assert.equal(
    schema.json.commands['materialize-wechat'].properties['item-id'].pattern,
    '^[a-z0-9][a-z0-9_-]{0,63}$',
  );
  assert.deepEqual(schema.json.commands['materialize-arxiv'].required, [
    'session-dir', 'metadata-file', 'fulltext-file', 'source-url', 'acquisition-url', 'item-id',
  ]);
  assert.equal(
    schema.json.commands['materialize-arxiv'].properties['item-id'].pattern,
    '^[a-z0-9][a-z0-9_-]{0,63}$',
  );
  assert.deepEqual(schema.json.commands['acquire-web'].required, [
    'session-dir', 'item-id', 'source-url',
  ]);
  assert.equal(schema.json.commands['acquire-web'].properties['source-url'].format, 'http-url');
  assert.equal(
    schema.json.commands['acquire-web'].properties['item-id'].pattern,
    '^[a-z0-9][a-z0-9_-]{0,63}$',
  );
  assert.deepEqual(schema.json.commands['materialize-web'].required, [
    'session-dir', 'item-id', 'executor-result-file',
  ]);
  assert.equal(
    schema.json.commands['materialize-web'].properties['item-id'].pattern,
    '^[a-z0-9][a-z0-9_-]{0,63}$',
  );
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
  assert.notEqual(missingPublicDiscoverSession.stdout.trim(), '{}');
  assert.equal(missingPublicDiscoverSession.code, 1);
  assert.equal(missingPublicDiscoverSession.json.ok, false);
  assert.match(missingPublicDiscoverSession.json.error, /采集会话目录不存在/);

  const asyncDiscoveryRoot = makeSessionDir();
  const asyncDiscoveryInit = await runCli([
    'init', '--session-dir', asyncDiscoveryRoot, '--query', 'async discovery',
    '--source-scope', '["public-internet"]', '--materialization-target', 'candidates',
  ]);
  assert.equal(asyncDiscoveryInit.code, 0, asyncDiscoveryInit.stderr);
  const fixtureBinDir = join(asyncDiscoveryRoot, 'fixture-bin');
  const fixtureSearxng = join(fixtureBinDir, 'searxng-cli');
  mkdirSync(fixtureBinDir);
  writeFileSync(fixtureSearxng, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  query: 'async discovery',
  results: [{
    url: 'https://example.com/news/async-discovery-report',
    title: 'Async discovery 深度报道',
    engine: 'fixture',
  }],
}));
`);
  chmodSync(fixtureSearxng, 0o700);
  const asyncDiscovery = await runCli([
    'public-discover', '--session-dir', asyncDiscoveryRoot, '--query', 'async discovery',
    '--requested-count', '1',
  ], { PATH: `${fixtureBinDir}:${process.env.PATH}` });
  assert.notEqual(asyncDiscovery.stdout.trim(), '{}');
  assert.equal(asyncDiscovery.code, 0, asyncDiscovery.stderr);
  assert.equal(asyncDiscovery.json.ok, true);
  assert.equal(asyncDiscovery.json.action, 'public-discover');
  rmSync(asyncDiscoveryRoot, { recursive: true, force: true });

  const wechatRoot = makeSessionDir();
  const wechatInit = await runCli([
    'init', '--session-dir', wechatRoot, '--query', 'WeChat materializer CLI',
    '--source-scope', '["public-internet"]', '--materialization-target', 'selected',
    '--direct-urls', '["https://weixin.sogou.com/link?url=cli-fixture"]',
  ]);
  assert.equal(wechatInit.code, 0, wechatInit.stderr);
  const rawWechatDir = join(wechatRoot, 'raw/bycli/weixin/cli-fixture');
  mkdirSync(rawWechatDir, { recursive: true });
  const rawWechatMarkdown = join(rawWechatDir, 'index.md');
  writeFileSync(rawWechatMarkdown, [
    '# CLI 微信文章', '', '测试作者', '',
    '第一段正文。', '', '第二段正文。', '', '第三段正文。', '',
    '第四段正文。', '', '第五段正文。', '', '第六段正文。', '',
    '注：作者声明。', '', '相关阅读', '',
    '[推荐](https://mp.weixin.qq.com/s/related)', '', '赞赏', '',
  ].join('\n'));
  const rawWechatResult = join(rawWechatDir, 'download-result.json');
  writeFileSync(rawWechatResult, JSON.stringify({
    status: 'downloaded',
    saved: 'raw/bycli/weixin/cli-fixture/index.md',
    size: statSync(rawWechatMarkdown).size,
    title: 'CLI 微信文章',
    author: '测试作者',
    publish_time: '2026-08-31T00:00:00Z',
    source_url: 'https://weixin.sogou.com/link?url=cli-fixture',
    resolved_url: 'https://mp.weixin.qq.com/s/cli-fixture',
  }));
  const materializedWechat = await runCli([
    'materialize-wechat', '--session-dir', wechatRoot,
    '--executor-result-file', rawWechatResult, '--item-id', 'cli-fixture',
  ]);
  assert.equal(materializedWechat.code, 0, materializedWechat.stderr || materializedWechat.stdout);
  assert.equal(materializedWechat.json.materialization.contentGranularity, 'full-text');
  const collectedWechat = await runCli([
    'collect', '--session-dir', wechatRoot,
    '--item-json-file', materializedWechat.json.collectPayloadPath,
  ]);
  assert.equal(collectedWechat.code, 0, collectedWechat.stderr || collectedWechat.stdout);
  const wechatStatus = await runCli(['status', '--session-dir', wechatRoot]);
  assert.equal(wechatStatus.json.collection.deliveryComplete, true);
  assert.equal(wechatStatus.json.collection.contentGranularity['full-text'], 1);
  rmSync(wechatRoot, { recursive: true, force: true });

  const siteCrawlFrontmatter = readFileSync(siteCrawlSkillPath, 'utf8').split('---')[1];
  assert.match(siteCrawlFrontmatter, /Do not use for one known URL/);

  const enterpriseSchema = await runCli(['command-schema'], {}, enterpriseScriptPath);
  assert.equal(enterpriseSchema.code, 0, enterpriseSchema.stderr);
  assert.equal(enterpriseSchema.json.commands['search-all'].additionalProperties, false);
  assert.deepEqual(enterpriseSchema.json.commands['search-all'].properties.sources.default, ['dingtalk', 'feishu', 'wecom', 'ima']);
  assert.ok(enterpriseSchema.json.commands.search.required.includes('parent-session-dir'));
  assert.ok(enterpriseSchema.json.commands.resource.required.includes('parent-session-dir'));
  assert.equal(enterpriseSchema.json.commands.search.properties['parent-session-dir'].format, 'sandbox-path');
  assert.equal(enterpriseSchema.json.commands.search.properties['output-dir'].format, 'sandbox-path');
  assert.equal(enterpriseSchema.json.commands['search-all'].properties['output-root'].format, 'sandbox-path');
  assert.equal(enterpriseSchema.json.commands.materialize.properties['session-dir'].format, 'sandbox-path');

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

await (async () => {
  const validRoot = makeSessionDir();
  const valid = await runCli([
    'init', '--session-dir', validRoot, '--query', '采集这篇文章',
    '--workflow', 'public-collect', '--source-scope', '["public-internet"]',
    '--materialization-target', 'selected', '--required-content-granularity', 'full-text',
    '--direct-urls', '["https://example.com/article/1"]',
  ]);
  assert.equal(valid.code, 0, valid.stderr || valid.stdout);
  assert.equal(valid.json.task.workflow, 'public-collect');

  const parent = makeSessionDir();
  const seededCollection = join(parent, 'seeded-collection.json');
  const seededMetadata = join(parent, 'seeded-metadata.json');
  writeFileSync(seededCollection, '{}\n');
  writeFileSync(seededMetadata, '{}\n');
  const invalidCases = [
    ['mode', ['--mode', 'research', '--source-scope', '["public-internet"]',
      '--materialization-target', 'selected', '--required-content-granularity', 'full-text']],
    ['scope', ['--source-scope', '["public-internet","dingtalk"]',
      '--materialization-target', 'selected', '--required-content-granularity', 'full-text']],
    ['target', ['--source-scope', '["public-internet"]',
      '--materialization-target', 'candidates', '--required-content-granularity', 'full-text']],
    ['granularity', ['--source-scope', '["public-internet"]',
      '--materialization-target', 'selected', '--required-content-granularity', 'any']],
    ['seeded-collection', ['--source-scope', '["public-internet"]',
      '--materialization-target', 'selected', '--required-content-granularity', 'full-text',
      '--collection-result-input-file', seededCollection]],
    ['seeded-metadata', ['--source-scope', '["public-internet"]',
      '--materialization-target', 'selected', '--required-content-granularity', 'full-text',
      '--metadata-input-file', seededMetadata]],
  ];
  for (const [name, extra] of invalidCases) {
    const target = join(parent, name);
    const rejected = await runCli([
      'init', '--session-dir', target, '--query', '采集这篇文章',
      '--workflow', 'public-collect', ...extra,
    ]);
    assert.equal(rejected.code, 1, `${name}: ${rejected.stderr || rejected.stdout}`);
    assert.match(rejected.json.error, /public-collect/);
    assert.equal(existsSync(target), false, `${name} must fail before creating the session skeleton`);
  }
  rmSync(validRoot, { recursive: true, force: true });
  rmSync(parent, { recursive: true, force: true });
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
  assert.deepEqual(defaultScope.json.task.sourceScope, ['public-internet', 'cloud-knowledge']);
  assert.equal(defaultScope.json.task.materializationTarget, 'selected');
  assert.equal(defaultScope.json.task.requiredContentGranularity, 'any');
  assert.equal(defaultScope.json.task.discoveryGate.attemptCount, 0);
  assert.equal(defaultScope.json.task.discoveryGate.schemaVersion, '2.0');
  assert.deepEqual(defaultScope.json.task.discoveryGate.observations, []);
  assert.equal(defaultScope.json.task.discoveryGate.topicContract.required, false);
  assert.equal(defaultScope.json.task.discoveryGate.topicContract.normalizedSubject, '公开资料');
  assert.deepEqual(defaultScope.json.task.discoveryGate.candidates, []);

  const directUrl = 'https://example.com/user-selected-article';
  const directScope = await runCli([
    'init', '--session-dir', makeSessionDir(), '--query', '采集指定链接',
    '--direct-urls', JSON.stringify([directUrl]),
  ]);
  assert.equal(directScope.json.task.discoveryGate.candidates.length, 1);
  assert.equal(directScope.json.task.discoveryGate.candidates[0].origin, 'user-provided');
  assert.equal(directScope.json.task.discoveryGate.candidates[0].canonicalUrl, directUrl);
  assert.equal(directScope.json.task.discoveryGate.candidates[0].topicRelevance.status, 'not-required');

  const explicitScope = await runCli([
    'init', '--session-dir', makeSessionDir(), '--query', '团队方案',
    '--source-scope', '["public-internet","feishu"]',
    '--materialization-target', 'all',
    '--required-content-granularity', 'full-text',
  ]);
  assert.deepEqual(explicitScope.json.task.sourceScope, ['public-internet', 'feishu']);
  assert.equal(explicitScope.json.task.materializationTarget, 'all');
  assert.equal(explicitScope.json.task.requiredContentGranularity, 'full-text');

  const invalidGranularity = await runCli([
    'init', '--session-dir', makeSessionDir(), '--query', '无效粒度',
    '--required-content-granularity', 'excerpt',
  ]);
  assert.equal(invalidGranularity.code, 1);
  assert.match(invalidGranularity.json.error, /required-content-granularity/);
  console.log('PASS source scope and materialization target');
})();

await (async () => {
  const root = makeSessionDir();
  const metadataPath = join(tmpdir(), `kc-weixin-selected-${process.pid}-${Date.now()}.json`);
  const urls = [
    'https://mp.weixin.qq.com/s/article-1',
    'https://mp.weixin.qq.com/s/article-2',
    'https://mp.weixin.qq.com/s/article-3',
    'https://mp.weixin.qq.com/s/article-4',
  ];
  writeFileSync(metadataPath, JSON.stringify({
    schemaVersion: '1.0',
    storage: { fallback: false },
    collection: {
      status: 'partial',
      items: urls.map((sourceUrl, index) => ({
        itemId: `weixin-selected-${index + 1}`,
        title: `Selected Weixin article ${index + 1}`,
        sourceUrl,
        sourceItemId: null,
        sourceSkill: 'bycli',
        backend: 'weixin',
        collectionFilters: {},
        rawArtifacts: [],
        materialization: {
          status: 'pending', markdownPath: null, sanitizedPath: null,
          pendingArtifactCleanup: [], reason: 'awaiting-acquisition',
          contentGranularity: 'unknown',
        },
      })),
    },
  }, null, 2));
  try {
    const initialized = await runCli([
      'init', '--session-dir', root, '--query', 'selected Weixin articles',
      '--materialization-target', 'selected', '--metadata-input-file', metadataPath,
    ]);
    assert.equal(initialized.code, 0, initialized.stderr || initialized.stdout);
    assert.equal(existsSync(join(root, 'session.json')), true);

    const status = await runCli(['status', '--session-dir', root]);
    assert.equal(status.code, 0, status.stderr || status.stdout);
    assert.equal(status.json.collection.sourceRecords, 4);
    assert.equal(status.json.collection.materialized, 0);
    assert.equal(status.json.collection.pending, 4);
    assert.equal(status.json.collection.failed, 0);
    assert.equal(status.json.collection.deliveryComplete, false);
    assert.deepEqual(status.json.downstreamInput.files, []);
  } finally {
    rmSync(metadataPath, { force: true });
    rmSync(root, { recursive: true, force: true });
  }
  console.log('PASS selected inventory remains reportable before Weixin acquisition');
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
  const r = await runCli([
    'init', '--session-dir', root, '--query', '数据本体论上周发展',
    '--mode', 'research', '--depth', '2', '--deadline-minutes', '60',
    '--direct-urls', '["https://arxiv.org/abs/2608.04002"]',
  ]);
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

  const externalReportRoot = makeSessionDir();
  const externalReportPath = join(externalReportRoot, 'report.md');
  writeFileSync(externalReportPath, [
    '# 报告', '## 采集范围', '公开互联网', '## 采集成果', '1 篇正文',
    '## 来源与追溯', 'arXiv', '## 覆盖缺口与局限', '无数据局限',
  ].join('\n'));
  const rep2 = await runCli([
    'report', '--session-dir', root, '--report-path', externalReportPath,
    '--stop-reason', '时间预算用尽,仅完成第一层',
  ]);
  assert.equal(rep2.json.ok, true);
  assert.equal(rep2.json.reportPath, externalReportPath);
  assert.equal(rep2.json.deliverySummary.materialized, 1);
  assert.equal(rep2.json.deliverySummary.uniqueContentGroups, 1);
  assert.equal(rep2.json.deliverySummary.deliveryComplete, true);
  const tree = readFileSync(join(root, 'research-tree.md'), 'utf8');
  assert.ok(tree.includes('## Level 1'));
  assert.ok(tree.includes('AgentK'));
  assert.ok(tree.includes('item-x1'));
  assert.ok(tree.includes('时间预算用尽'));
  rmSync(externalReportRoot, { recursive: true, force: true });
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
  assert.equal(existsSync(join(root, 'session.json')), false, 'legacy status 不得写入迁移状态');
  console.log('PASS legacy read compatibility without persistence');
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

// ── init --delivery-dir: 绑定交付目标并以 handle 引用 ──

await (async () => {
  const tempRoot = makeSessionDir();
  const sessionsRoot = join(tempRoot, 'by', '.sessions');
  const sessionRoot = join(sessionsRoot, 'session-delivery-bind');
  const sandboxEnv = { KNOWLEDGE_COLLECTION_SESSIONS_ROOT: sessionsRoot };
  const staging = () => join(sessionRoot, '.collection-runs', `run-${Math.random().toString(36).slice(2, 8)}`);

  // 绝对交付路径:持久化 requestedDirectory + handle,但 stdout 只暴露 handle
  const deliveryDir = join(tempRoot, '00-collections');
  const sessionDir = staging();
  const bound = await runCli([
    'init', '--session-dir', sessionDir, '--session-root', sessionRoot,
    '--query', 'deepseek 采集', '--delivery-requested', 'true',
    '--delivery-dir', deliveryDir,
  ], sandboxEnv);
  assert.equal(bound.code, 0, bound.stderr || bound.stdout);
  assert.equal(bound.json.task.deliveryTarget.bound, true);
  assert.match(bound.json.task.deliveryTarget.handle, /^delivery-[0-9a-f]{8}$/);
  assert.equal(bound.json.task.deliveryTarget.requestedDirectory, undefined);
  assert.equal(bound.stdout.includes(deliveryDir), false, 'init stdout 不得包含交付路径');
  const persisted = JSON.parse(readFileSync(join(sessionDir, 'session.json'), 'utf8'));
  assert.equal(persisted.task.deliveryTarget.requestedDirectory, deliveryDir);
  assert.equal(persisted.task.deliveryTarget.handle, bound.json.task.deliveryTarget.handle);

  // status 同样只暴露 handle
  const status = await runCli(['status', '--session-dir', sessionDir], sandboxEnv);
  assert.equal(status.code, 0, status.stderr || status.stdout);
  assert.equal(status.json.task.deliveryTarget.bound, true);
  assert.equal(status.json.task.deliveryTarget.requestedDirectory, undefined);
  assert.equal(status.stdout.includes(deliveryDir), false, 'status stdout 不得包含交付路径');

  // 交付目标不存在也不被创建,init 不对其做任何 stat
  assert.equal(existsSync(deliveryDir), false, 'init 不得创建交付目录');

  // 交付目标的父目录不可读时 init 仍成功(证明未发生 syscall)
  const sealedParent = join(tempRoot, 'sealed');
  mkdirSync(sealedParent, { recursive: true });
  chmodSync(sealedParent, 0o000);
  try {
    const sealed = await runCli([
      'init', '--session-dir', staging(), '--session-root', sessionRoot,
      '--query', 'sealed parent', '--delivery-requested', 'true',
      '--delivery-dir', join(sealedParent, 'target'),
    ], sandboxEnv);
    assert.equal(sealed.code, 0, sealed.stderr || sealed.stdout);
  } finally {
    chmodSync(sealedParent, 0o755);
  }

  // --delivery-dir 必须与 --delivery-requested true 同时出现
  const missingIntent = await runCli([
    'init', '--session-dir', join(sessionRoot, 'collections', 'no-intent'),
    '--session-root', sessionRoot, '--query', 'no intent',
    '--delivery-dir', join(tempRoot, 'elsewhere'),
  ], sandboxEnv);
  assert.equal(missingIntent.code, 1);
  assert.match(missingIntent.json.error, /--delivery-requested/);

  // 相对交付路径缺少 --session-root 时拒绝
  const relativeWithoutRoot = await runCli([
    'init', '--session-dir', join(tempRoot, 'loose-session'),
    '--query', 'relative without root',
    '--delivery-requested', 'true', '--delivery-dir', '00-collections',
  ], sandboxEnv);
  assert.equal(relativeWithoutRoot.code, 1);
  assert.match(relativeWithoutRoot.json.error, /Session Root/);

  // 交付路径位于采集会话目录内时拒绝
  const insideSession = staging();
  const rejectedInside = await runCli([
    'init', '--session-dir', insideSession, '--session-root', sessionRoot,
    '--query', 'inside session', '--delivery-requested', 'true',
    '--delivery-dir', join(insideSession, 'out'),
  ], sandboxEnv);
  assert.equal(rejectedInside.code, 1);
  assert.match(rejectedInside.json.error, /内部采集会话目录/);

  // 交付路径解析为文件系统根目录时拒绝
  const rejectedRoot = await runCli([
    'init', '--session-dir', staging(), '--session-root', sessionRoot,
    '--query', 'fs root', '--delivery-requested', 'true', '--delivery-dir', '/',
  ], sandboxEnv);
  assert.equal(rejectedRoot.code, 1);
  assert.match(rejectedRoot.json.error, /文件系统根目录/);

  rmSync(tempRoot, { recursive: true, force: true });
  console.log('PASS init binds delivery target and redacts the path');
})();

// ── init --delivery-dir: 存储串必须与 publish 解析结果逐字节一致 ──

await (async () => {
  const tempRoot = makeSessionDir();
  const sessionsRoot = join(tempRoot, 'by', '.sessions');
  const envSessionRoot = join(sessionsRoot, 'env-wins');
  const argSessionRoot = join(sessionsRoot, 'arg-loses');
  mkdirSync(envSessionRoot, { recursive: true });
  mkdirSync(argSessionRoot, { recursive: true });

  // 环境变量优先于 --session-root,init 必须沿用同一优先级
  const envEnv = {
    KNOWLEDGE_COLLECTION_SESSIONS_ROOT: sessionsRoot,
    KNOWLEDGE_COLLECTION_SESSION_ROOT: envSessionRoot,
  };
  for (const [label, raw] of [
    ['plain', '00-collections'],
    ['trailing-slash', '00-collections/'],
    ['dot-prefixed', './00-collections'],
  ]) {
    const sessionDir = join(envSessionRoot, '.collection-runs', `run-${label}`);
    const res = await runCli([
      'init', '--session-dir', sessionDir, '--session-root', argSessionRoot,
      '--query', `identity ${label}`, '--delivery-requested', 'true',
      '--delivery-dir', raw,
    ], envEnv);
    assert.equal(res.code, 0, res.stderr || res.stdout);
    const stored = JSON.parse(readFileSync(join(sessionDir, 'session.json'), 'utf8'))
      .task.deliveryTarget.requestedDirectory;
    assert.equal(stored, join(envSessionRoot, '00-collections'),
      `${label} 必须基于环境变量指定的 Session Root 解析,且规范化为无尾斜杠绝对路径`);
  }

  rmSync(tempRoot, { recursive: true, force: true });
  console.log('PASS init stores the same string publish would resolve');
})();

// ── command-schema 暴露 init --delivery-dir ──

await (async () => {
  const schema = await runCli(['command-schema']);
  assert.equal(schema.json.ok, true);
  assert.equal(schema.json.commands.init.properties['delivery-dir'].type, 'string');
  console.log('PASS command-schema exposes init --delivery-dir');
})();

// ── Task 4: init 阶段的 advisory warnings ──

// 回归护栏:--workflow public-collect + 显式 any 必须仍然抛错,且抛在建目录之前。
// 设计曾提出把它默默改成 full-text,已在评审中撤回(§2.3):那会覆盖调用方明确写下的参数。
await (async () => {
  const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'kc-pc-any-')));
  const sessionDir = join(tempRoot, 'session');
  const res = await runCli([
    'init', '--session-dir', sessionDir, '--query', '采集一篇关于 DeepSeek Harness 的文章',
    '--source-scope', '["public-internet"]', '--materialization-target', 'selected',
    '--required-content-granularity', 'any', '--workflow', 'public-collect',
  ]);
  assert.equal(res.code, 1);
  assert.match(res.json.error, /public-collect workflow 要求/);
  assert.equal(existsSync(sessionDir), false, '抛错必须发生在创建 session 目录之前');
  rmSync(tempRoot, { recursive: true, force: true });
  console.log('PASS public-collect + any still throws before creating anything');
})();

// selected + --delivery-requested true 且没有 --workflow:成功,并提示 public-collect
await (async () => {
  const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'kc-warn-wf-')));
  const sessionRoot = join(tempRoot, 'by', '.sessions', '20037048');
  const sessionDir = join(sessionRoot, '.collection-runs', 'run-001');
  const res = await runCli([
    'init', '--session-dir', sessionDir, '--query', '采集一篇关于 DeepSeek Harness 的文章',
    '--source-scope', '["public-internet"]', '--materialization-target', 'selected',
    '--delivery-requested', 'true', '--session-root', sessionRoot,
  ], { KNOWLEDGE_COLLECTION_SESSIONS_ROOT: join(tempRoot, 'by', '.sessions') });
  assert.equal(res.code, 0, res.stderr || res.stdout);
  assert.ok(
    res.json.warnings.some((w) => /public-collect/.test(w)),
    `期望出现 public-collect 提示,实际: ${JSON.stringify(res.json.warnings)}`,
  );
  assert.ok(
    res.json.warnings.some((w) => /retighten.*required-content-granularity full-text/.test(w)),
    `warning 必须给出可执行的 retighten 修复路径,实际: ${JSON.stringify(res.json.warnings)}`,
  );

  // 带上 --workflow 后不应再提示
  const explicit = join(sessionRoot, '.collection-runs', 'run-002');
  const withWorkflow = await runCli([
    'init', '--session-dir', explicit, '--query', '采集一篇关于 DeepSeek Harness 的文章',
    '--source-scope', '["public-internet"]', '--materialization-target', 'selected',
    '--required-content-granularity', 'full-text', '--delivery-requested', 'true',
    '--session-root', sessionRoot, '--workflow', 'public-collect',
  ], { KNOWLEDGE_COLLECTION_SESSIONS_ROOT: join(tempRoot, 'by', '.sessions') });
  assert.equal(withWorkflow.code, 0, withWorkflow.stderr || withWorkflow.stdout);
  assert.equal(
    (withWorkflow.json.warnings || []).some((w) => /public-collect/.test(w)),
    false,
    '显式给出 --workflow 时不应再提示',
  );
  rmSync(tempRoot, { recursive: true, force: true });
  console.log('PASS init warns when selected + delivery-requested omits --workflow');
})();

// --delivery-requested true 缺 --delivery-dir:只警告未绑定,不拒绝(回退形式必须继续可用)
await (async () => {
  const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'kc-warn-unbound-')));
  const sessionRoot = join(tempRoot, 'by', '.sessions', '20037048');
  const env = { KNOWLEDGE_COLLECTION_SESSIONS_ROOT: join(tempRoot, 'by', '.sessions') };
  const baseArgs = (dir) => [
    'init', '--session-dir', dir, '--query', '采集一篇关于 DeepSeek Harness 的文章',
    '--source-scope', '["public-internet"]', '--workflow', 'public-collect',
    '--materialization-target', 'selected', '--required-content-granularity', 'full-text',
    '--delivery-requested', 'true', '--session-root', sessionRoot,
  ];

  const unbound = await runCli(baseArgs(join(sessionRoot, '.collection-runs', 'run-001')), env);
  assert.equal(unbound.code, 0, unbound.stderr || unbound.stdout);
  assert.equal(unbound.json.task.deliveryRequested, true);
  assert.equal(unbound.json.task.deliveryTarget, undefined, '未给路径就不该有 handle');
  assert.ok(
    unbound.json.warnings.some((w) => /未提供 `?--delivery-dir/.test(w) && /handle/.test(w)),
    `期望提示未绑定交付目标,实际: ${JSON.stringify(unbound.json.warnings)}`,
  );

  // 给了 --delivery-dir 就不该再提示
  const bound = await runCli([
    ...baseArgs(join(sessionRoot, '.collection-runs', 'run-002')),
    '--delivery-dir', join(tempRoot, 'out'),
  ], env);
  assert.equal(bound.code, 0, bound.stderr || bound.stdout);
  assert.equal(bound.json.task.deliveryTarget.bound, true);
  assert.equal(
    (bound.json.warnings || []).some((w) => /--delivery-dir/.test(w)),
    false,
    '已绑定交付目标时不应再提示',
  );

  // 不要求交付的会话不应被这条 advisory 波及
  const noDelivery = await runCli([
    'init', '--session-dir', join(tempRoot, 'plain'), '--query', 'plain collection',
    '--source-scope', '["public-internet"]',
  ], env);
  assert.equal(noDelivery.code, 0, noDelivery.stderr || noDelivery.stdout);
  assert.deepEqual(noDelivery.json.warnings, []);

  rmSync(tempRoot, { recursive: true, force: true });
  console.log('PASS init warns when delivery-requested omits --delivery-dir');
})();

// 相似兄弟目录名只警告,不拒绝(§2.4:deepseek 与 deepseek-articles 可能是两个真任务)
await (async () => {
  const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'kc-warn-sib-')));
  const baseArgs = (dir) => [
    'init', '--session-dir', dir, '--query', '采集一篇关于 DeepSeek Harness 的文章',
    '--source-scope', '["public-internet"]', '--materialization-target', 'selected',
  ];
  const first = await runCli(baseArgs(join(tempRoot, 'deepseek')));
  assert.equal(first.code, 0, first.stderr || first.stdout);
  assert.equal(
    (first.json.warnings || []).some((w) => /deepseek/.test(w)),
    false,
    '第一个会话没有兄弟,不应有相似提示',
  );

  for (const suffix of ['-v2', '-fulltext', '-articles']) {
    const dir = join(tempRoot, `deepseek${suffix}`);
    const res = await runCli(baseArgs(dir));
    assert.equal(res.code, 0, `${suffix} 必须成功而不是被拒绝: ${res.stderr || res.stdout}`);
    assert.equal(existsSync(join(dir, 'session.json')), true, `${suffix} 会话必须真的建起来`);
    assert.ok(
      (res.json.warnings || []).some((w) => /deepseek/.test(w)),
      `${suffix} 期望出现相似兄弟提示,实际: ${JSON.stringify(res.json.warnings)}`,
    );
  }

  // 无关名字不应触发
  const unrelated = join(tempRoot, 'qwen-benchmark');
  const res = await runCli(baseArgs(unrelated));
  assert.equal(res.code, 0, res.stderr || res.stdout);
  assert.equal(
    (res.json.warnings || []).some((w) => /相似/.test(w)),
    false,
    '无关目录名不应触发相似提示',
  );
  rmSync(tempRoot, { recursive: true, force: true });
  console.log('PASS similar sibling directory names warn but never reject');
})();

console.log('ALL TESTS PASSED');
