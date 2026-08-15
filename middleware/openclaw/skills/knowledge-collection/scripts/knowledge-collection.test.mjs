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
  const root = mkdtempSync(join(tmpdir(), 'kc-test-'));
  for (const dir of ['raw', 'markdown', 'sanitized/items', '.post-processing-inputs']) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  return root;
}

function writeExecutorOutputs(root) {
  writeFileSync(join(root, 'collection-result.json'), JSON.stringify({
    schemaVersion: '1.0', title: 't', source: 'public-internet', backend: 'bycli',
    url: 'https://example.com', filters: {}, items: [{
      title: 'Paper', url: 'https://arxiv.org/abs/2608.04002', author: 'x',
      publishTime: '2026-08-04T00:00:00Z', markdown: 'sanitized/items/paper.md',
      fileName: 'sanitized/items/paper.md',
    }],
  }, null, 2));
  writeFileSync(join(root, 'sanitized/items/paper.md'), '# Paper\n\ncontent\n');
  writeFileSync(join(root, 'markdown/paper.md'), '# Paper\n\ncontent\n');
}

function collectPayload(itemId = 'item-test1') {
  return {
    schemaVersion: '1.0',
    items: [{
      itemId,
      markdownPath: 'markdown/paper.md',
      sanitizedPath: 'sanitized/items/paper.md',
      canonicalItem: {
        title: 'Paper', url: 'https://arxiv.org/abs/2608.04002', author: 'x',
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

// ── 研究流 ──

await (async () => {
  const root = mkdtempSync(join(tmpdir(), 'kc-test-'));
  const r = await runCli(['init', '--session-dir', root, '--query', '数据本体论上周发展', '--depth', '2']);
  assert.equal(r.json.ok, true);
  assert.ok(existsSync(join(root, 'session.json')));
  const session0 = JSON.parse(readFileSync(join(root, 'session.json'), 'utf8'));
  assert.equal(session0.schemaVersion, '2.0');
  assert.equal(session0.task.query, '数据本体论上周发展');

  const p = await runCli(['plan', '--session-dir', root, '--initial-search', '["arxiv"]', '--combined-query', 'q1']);
  assert.equal(p.json.ok, true);

  const b = await runCli(['branch', '--session-dir', root, '--level', '1', '--query', 'arXiv 论文',
    '--learnings', '["AgentK"]', '--citations', '{"AgentK":"item-x1"}',
    '--sources', '["https://arxiv.org/abs/2608.04002"]']);
  assert.equal(b.json.ok, true);
  assert.equal(b.json.id, 'L1-B1');

  const agg = await runCli(['aggregate', '--session-dir', root]);
  assert.equal(agg.json.learnings, 1);
  assert.equal(agg.json.visitedUrls, 1);

  writeFileSync(join(root, 'report.md'), '# 报告\n');
  const rep = await runCli(['report', '--session-dir', root]);
  assert.equal(rep.json.ok, true);
  assert.ok(existsSync(join(root, 'research-tree.md')));
  const tree = readFileSync(join(root, 'research-tree.md'), 'utf8');
  assert.ok(tree.includes('## Level 1'));
  assert.ok(tree.includes('AgentK'));
  console.log('PASS research flow');
})();

// ── 采集流(collect 自动补登 + inspect + run + cleanup) ──

await (async () => {
  const root = mkdtempSync(join(tmpdir(), 'kc-test-'));
  await runCli(['init', '--session-dir', root, '--query', 'q']);
  writeExecutorOutputs(root);
  writeFileSync(join(root, '.post-processing-inputs/items.json'), JSON.stringify(collectPayload(), null, 2));

  const c = await runCli(['collect', '--session-dir', root, '--item-json-file', join(root, '.post-processing-inputs/items.json')]);
  assert.equal(c.json.ok, true);
  assert.equal(c.json.items.length, 1);
  assert.equal(c.json.items[0].materialization.status, 'materialized');

  const i = await runCli(['inspect', '--session-dir', root]);
  assert.equal(i.json.ok, true);
  assert.equal(i.json.metadata.collection.items.length, 1);

  const ev = await runCli(['export-views', '--session-dir', root]);
  assert.equal(ev.json.ok, true);
  assert.ok(existsSync(join(root, 'sanitized/metadata.json')));

  const st = await runCli(['status', '--session-dir', root]);
  assert.equal(st.json.collection.items, 1);
  assert.equal(st.json.collection.materialized, 1);
  assert.equal(st.json.task.status, 'initialized');

  writeFileSync(join(root, '.post-processing-inputs/run.json'), JSON.stringify(validRun(root), null, 2));
  const r = await runCli(['run', '--session-dir', root, '--run-json-file', join(root, '.post-processing-inputs/run.json')]);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.runId, 'run-1');

  const cl = await runCli(['cleanup', '--session-dir', root, '--run-id', 'run-1']);
  assert.equal(cl.json.ok, true);
  assert.equal(cl.json.removedSession, true);
  assert.ok(!existsSync(join(root, 'session.json')));
  console.log('PASS collection flow');
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
  const root = mkdtempSync(join(tmpdir(), 'kc-test-'));
  await runCli(['init', '--session-dir', root, '--query', 'q']);
  writeExecutorOutputs(root);
  writeFileSync(join(root, '.post-processing-inputs/items.json'), JSON.stringify(collectPayload(), null, 2));
  writeFileSync(join(root, '.knowledge-collection.lock'), JSON.stringify({
    pid: process.pid, createdAt: new Date().toISOString(), ownerId: 'x', command: 'test',
  }));
  const c = await runCli(['collect', '--session-dir', root, '--item-json-file', join(root, '.post-processing-inputs/items.json')]);
  assert.equal(c.json.ok, false);
  assert.ok(c.json.error.includes('锁'));
  console.log('PASS lock conflict');
})();

// ── 错误路径: 敏感字段拒绝持久化 ──

await (async () => {
  const root = mkdtempSync(join(tmpdir(), 'kc-test-'));
  await runCli(['init', '--session-dir', root, '--query', 'q']);
  const session = JSON.parse(readFileSync(join(root, 'session.json'), 'utf8'));
  session.collection.sourceMetadata = { token: 'secret' };
  writeFileSync(join(root, 'session.json'), JSON.stringify(session));
  const s = await runCli(['status', '--session-dir', root]);
  assert.equal(s.json.ok, false);
  assert.ok(s.json.error.includes('敏感字段'));
  console.log('PASS sensitive key rejection');
})();

console.log('ALL TESTS PASSED');
