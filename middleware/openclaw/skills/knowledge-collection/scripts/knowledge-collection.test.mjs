import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), 'knowledge-collection.mjs');

function runCli(args) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [scriptPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
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
  mkdirSync(join(root, '.post-processing-inputs'), { recursive: true });
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

function validRun(sessionDir) {
  const session = JSON.parse(readFileSync(join(sessionDir, 'session.json'), 'utf8'));
  const itemId = session.collection.collection.items[0].itemId;
  return {
    schemaVersion: '1.0',
    runId: 'run-1',
    operation: 'ingest',
    target: { kind: 'knowledge-base', id: 'kb-1', path: '/kb' },
    selection: { mode: 'all', itemIds: [itemId], discardUnselected: false, discardUnselectedConfirmed: false },
    status: 'success',
    sessionStatus: 'success',
    globalStage: { name: null, required: false, status: 'not-required', reason: null },
    items: [{ itemId, status: 'success', stage: 'build-submitted', reason: null, downstreamRef: null, cleanupStatus: 'not-started', cleanedArtifacts: [] }],
  };
}

async function setupCollectedSession({ mode = 'collection' } = {}) {
  const root = makeSessionDir();
  const init = await runCli(['init', '--session-dir', root, '--query', 'q', '--mode', mode]);
  assert.equal(init.json.ok, true);
  writeExecutorOutputs(root);
  const payloadPath = join(root, '.post-processing-inputs/items.json');
  writeFileSync(payloadPath, JSON.stringify(collectPayload(), null, 2));
  const collect = await runCli(['collect', '--session-dir', root, '--item-json-file', payloadPath]);
  assert.equal(collect.json.ok, true);
  return { root, payloadPath, itemId: collect.json.items[0].itemId };
}

// ── CLI 帮助与平台委派 ──

await (async () => {
  const h = await runCli(['help']);
  assert.equal(h.json.ok, true);
  assert.ok(h.json.commandsByGroup.research.some((item) => item.name === 'init'));

  const ih = await runCli(['init', '--help']);
  assert.equal(ih.json.ok, true);
  assert.equal(ih.json.command, 'init');
  assert.ok(ih.json.example.includes('--session-dir'));

  const kb = await runCli(['list-kb', '--help']);
  assert.equal(kb.code, 0);
  assert.equal(kb.json.name, 'knowledge-collection-ingest');
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

// ── 研究流(含 source/citation 防编造校验) ──

await (async () => {
  const root = makeSessionDir();
  const r = await runCli(['init', '--session-dir', root, '--query', '数据本体论上周发展', '--mode', 'research', '--depth', '2', '--deadline-minutes', '60']);
  assert.equal(r.json.ok, true);
  assert.ok(r.json.task.startedAt);
  writeExecutorOutputs(root);
  const payloadPath = join(root, '.post-processing-inputs/items.json');
  writeFileSync(payloadPath, JSON.stringify(collectPayload('item-x1'), null, 2));
  const c = await runCli(['collect', '--session-dir', root, '--item-json-file', payloadPath]);
  assert.equal(c.json.ok, true);
  assert.ok(!existsSync(payloadPath), 'collect 成功后应删除输入 payload');

  const p = await runCli(['plan', '--session-dir', root, '--initial-search', '["arxiv"]', '--combined-query', 'q1']);
  assert.equal(p.json.ok, true);

  const b = await runCli(['branch', '--session-dir', root, '--level', '1', '--query', 'arXiv 论文',
    '--research-goal', '找窗口内论文', '--learnings', '["AgentK"]',
    '--citations', '{"AgentK":"item-x1"}',
    '--sources', '["https://arxiv.org/abs/2608.04002"]',
    '--search-queries', '[{"query":"arxiv ontology","skill":"online_search","engine":"arxiv","resultCount":3,"status":"success"}]']);
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
  const rep2 = await runCli(['report', '--session-dir', root, '--stop-reason', '时间预算用尽,仅完成第一层']);
  assert.equal(rep2.json.ok, true);
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

// ── 采集流: 成功删除 payload、run 摘要、collection 模式清理 ──

await (async () => {
  const { root } = await setupCollectedSession({ mode: 'collection' });
  const runPath = join(root, '.post-processing-inputs/run.json');
  writeFileSync(runPath, JSON.stringify(validRun(root), null, 2));
  const r = await runCli(['run', '--session-dir', root, '--run-json-file', runPath]);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.runId, 'run-1');
  assert.ok(r.json.summary, 'run 默认返回摘要');
  assert.ok(!existsSync(runPath), 'run 成功后应删除输入 payload');

  const cl = await runCli(['cleanup', '--session-dir', root, '--run-id', 'run-1']);
  assert.equal(cl.json.ok, true);
  assert.equal(cl.json.removedSession, true);
  assert.ok(!existsSync(join(root, 'session.json')));
  console.log('PASS collection flow and payload cleanup');
})();

// ── 研究模式未 report 时 cleanup 保留会话 ──

await (async () => {
  const { root } = await setupCollectedSession({ mode: 'research' });
  const runPath = join(root, '.post-processing-inputs/run.json');
  writeFileSync(runPath, JSON.stringify(validRun(root), null, 2));
  await runCli(['run', '--session-dir', root, '--run-json-file', runPath]);
  const cl = await runCli(['cleanup', '--session-dir', root, '--run-id', 'run-1']);
  assert.equal(cl.json.ok, true);
  assert.equal(cl.json.retention, true);
  assert.equal(cl.json.reason, 'research-report-pending');
  assert.ok(existsSync(join(root, 'session.json')));
  console.log('PASS research-mode cleanup gate');
})();

// ── inspect 默认只读,drain-pending 显式清理 ──

await (async () => {
  const { root } = await setupCollectedSession({ mode: 'collection' });
  writeFileSync(join(root, 'markdown/old.md'), '# old\n');
  const session = JSON.parse(readFileSync(join(root, 'session.json'), 'utf8'));
  session.collection.collection.items[0].materialization.pendingArtifactCleanup = ['markdown/old.md'];
  writeFileSync(join(root, 'session.json'), JSON.stringify(session, null, 2));

  const readOnly = await runCli(['inspect', '--session-dir', root]);
  assert.equal(readOnly.json.ok, true);
  assert.ok(existsSync(join(root, 'markdown/old.md')), 'inspect 默认不得删除文件');

  const drain = await runCli(['inspect', '--session-dir', root, '--drain-pending']);
  assert.equal(drain.json.ok, true);
  assert.ok(!existsSync(join(root, 'markdown/old.md')), '--drain-pending 才清理待删文件');
  console.log('PASS inspect read-only default');
})();

// ── init 敏感字段拒绝 ──

await (async () => {
  const root = makeSessionDir();
  const meta = join(tmpdir(), `kc-meta-${process.pid}.json`);
  writeFileSync(meta, JSON.stringify({
    schemaVersion: '1.0', storage: { fallback: false },
    collection: { status: 'complete', items: [] },
    retention: { auditRequired: false, userRequested: false },
    postProcessing: { runs: [] },
    sourceMetadata: { api_token: 'secret' },
  }));
  const r = await runCli(['init', '--session-dir', root, '--query', 'q', '--metadata-input-file', meta]);
  assert.equal(r.code, 1);
  assert.ok(r.json.error.includes('敏感字段'));
  console.log('PASS sensitive init input rejected');
})();

// ── 部分清理只删除成功项,保留未选项与 raw/ ──

await (async () => {
  const root = makeSessionDir();
  await runCli(['init', '--session-dir', root, '--query', 'q', '--mode', 'collection']);
  mkdirSync(join(root, 'markdown'), { recursive: true });
  mkdirSync(join(root, 'sanitized/items'), { recursive: true });
  mkdirSync(join(root, '.post-processing-inputs'), { recursive: true });
  const cr = {
    schemaVersion: '1.0', title: 't', source: 'public-internet', backend: 'bycli',
    url: 'https://e.com', filters: {}, items: [
      { title: 'A', url: 'https://e.com/a', author: '', publishTime: '', markdown: 'sanitized/items/a.md', fileName: 'sanitized/items/a.md' },
      { title: 'B', url: 'https://e.com/b', author: '', publishTime: '', markdown: 'sanitized/items/b.md', fileName: 'sanitized/items/b.md' },
    ],
  };
  writeFileSync(join(root, 'collection-result.json'), JSON.stringify(cr));
  for (const name of ['a', 'b']) {
    writeFileSync(join(root, 'markdown', `${name}.md`), `# ${name}`);
    writeFileSync(join(root, 'sanitized/items', `${name}.md`), `# ${name}`);
  }
  const payload = {
    schemaVersion: '1.0',
    items: [
      { itemId: 'item-a', markdownPath: 'markdown/a.md', sanitizedPath: 'sanitized/items/a.md', canonicalItem: cr.items[0] },
      { itemId: 'item-b', markdownPath: 'markdown/b.md', sanitizedPath: 'sanitized/items/b.md', canonicalItem: cr.items[1] },
    ],
  };
  const payloadPath = join(root, '.post-processing-inputs/items.json');
  writeFileSync(payloadPath, JSON.stringify(payload));
  const c = await runCli(['collect', '--session-dir', root, '--item-json-file', payloadPath]);
  assert.equal(c.json.ok, true);

  const runPayload = {
    schemaVersion: '1.0', runId: 'run-partial', operation: 'external',
    target: { kind: 'external', id: 'task-1' },
    selection: { mode: 'items', itemIds: ['item-a'], discardUnselected: false, discardUnselectedConfirmed: false },
    status: 'success', sessionStatus: 'partial',
    globalStage: { name: null, required: false, status: 'not-required', reason: null },
    items: [{ itemId: 'item-a', status: 'success', stage: 'completed', reason: null, downstreamRef: null, cleanupStatus: 'not-started', cleanedArtifacts: [] }],
  };
  const runPath = join(root, '.post-processing-inputs/run.json');
  writeFileSync(runPath, JSON.stringify(runPayload));
  const r = await runCli(['run', '--session-dir', root, '--run-json-file', runPath]);
  assert.equal(r.json.ok, true);

  const dry = await runCli(['cleanup', '--session-dir', root, '--run-id', 'run-partial', '--dry-run']);
  assert.equal(dry.json.ok, true);
  assert.equal(dry.json.plan.action, 'partial-cleanup');
  assert.ok(existsSync(join(root, 'markdown/a.md')), 'dry-run 不得删除文件');

  const cl = await runCli(['cleanup', '--session-dir', root, '--run-id', 'run-partial']);
  assert.equal(cl.json.ok, true);
  assert.equal(cl.json.removedSession, false);
  assert.ok(!existsSync(join(root, 'markdown/a.md')));
  assert.ok(!existsSync(join(root, 'sanitized/items/a.md')));
  assert.ok(existsSync(join(root, 'markdown/b.md')));
  assert.ok(existsSync(join(root, 'sanitized/items/b.md')));
  const status = await runCli(['status', '--session-dir', root]);
  assert.equal(status.json.ok, true);
  assert.equal(status.json.collection.materialized, 1);
  console.log('PASS partial cleanup');
})();

// ── 旧会话迁移 ──

await (async () => {
  const root = makeSessionDir();
  writeExecutorOutputs(root);
  writeFileSync(join(root, 'sanitized/metadata.json'), JSON.stringify({
    partial: true, storageFallback: false, audit_required: false,
  }));
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
  const payloadPath = join(root, '.post-processing-inputs/items2.json');
  writeFileSync(payloadPath, JSON.stringify(collectPayload('item-2'), null, 2));
  const c = await runCli(['collect', '--session-dir', root, '--item-json-file', payloadPath]);
  assert.equal(c.json.ok, false);
  assert.ok(c.json.error.includes('锁'));
  console.log('PASS lock conflict');
})();

console.log('ALL TESTS PASSED');
