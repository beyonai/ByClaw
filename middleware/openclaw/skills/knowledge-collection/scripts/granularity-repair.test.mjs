import assert from 'node:assert/strict';
import {
  mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { deliveryCompleteForSession } from './delivery-state.mjs';
import { sessionPaths } from './session.mjs';
import { createProbeRun } from './probe-state.mjs';

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), 'knowledge-collection.mjs');

function runCli(args, env = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
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

function tempRoot() {
  return realpathSync(mkdtempSync(join(tmpdir(), 'kc-retighten-test-')));
}

async function initSession(root, {
  granularity = 'any', target = 'selected', query = 'DeepSeek 全文采集',
} = {}) {
  const sessionDir = join(root, 'internal-session');
  const init = await runCli([
    'init', '--session-dir', sessionDir, '--query', query,
    '--source-scope', '["public-internet"]',
    '--materialization-target', target,
    '--required-content-granularity', granularity,
  ]);
  assert.equal(init.code, 0, init.stderr || init.stdout);
  return sessionDir;
}

function readSession(sessionDir) {
  return JSON.parse(readFileSync(join(sessionDir, 'session.json'), 'utf8'));
}

function writeSession(sessionDir, session) {
  writeFileSync(join(sessionDir, 'session.json'), `${JSON.stringify(session, null, 2)}\n`);
}

test('retighten lifts any to full-text and records an audit entry', async () => {
  const root = tempRoot();
  try {
    const sessionDir = await initSession(root);
    const before = readSession(sessionDir);
    assert.equal(before.task.requiredContentGranularity, 'any');

    const res = await runCli([
      'retighten', '--session-dir', sessionDir, '--required-content-granularity', 'full-text',
    ]);
    assert.equal(res.code, 0, res.stderr || res.stdout);
    assert.equal(res.json.task.requiredContentGranularity, 'full-text');

    const after = readSession(sessionDir);
    assert.equal(after.task.requiredContentGranularity, 'full-text');
    assert.equal(after.task.granularityHistory.length, 1);
    assert.equal(after.task.granularityHistory[0].from, 'any');
    assert.equal(after.task.granularityHistory[0].to, 'full-text');
    assert.ok(Number.isFinite(Date.parse(after.task.granularityHistory[0].at)));

    // 只动这两个字段:其余 task 内容与 inventory 必须逐字节不变
    const strippedBefore = { ...before.task };
    const strippedAfter = { ...after.task };
    delete strippedBefore.requiredContentGranularity;
    delete strippedAfter.requiredContentGranularity;
    delete strippedAfter.granularityHistory;
    assert.deepEqual(strippedAfter, strippedBefore);
    assert.deepEqual(after.collection, before.collection);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retighten refuses to loosen full-text back to any', async () => {
  const root = tempRoot();
  try {
    const sessionDir = await initSession(root, { granularity: 'full-text' });
    const res = await runCli([
      'retighten', '--session-dir', sessionDir, '--required-content-granularity', 'any',
    ]);
    assert.equal(res.code, 1);
    assert.match(res.json.error, /RETIGHTEN_NOT_MONOTONIC/);
    assert.equal(readSession(sessionDir).task.requiredContentGranularity, 'full-text');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retighten respects the public-collect single-writer lease', async () => {
  const root = tempRoot();
  try {
    const sessionDir = await initSession(root);
    const session = readSession(sessionDir);
    session.task.activeOrchestrationRunId = 'public-collect-abc';
    writeSession(sessionDir, session);

    const res = await runCli([
      'retighten', '--session-dir', sessionDir, '--required-content-granularity', 'full-text',
    ]);
    assert.equal(res.code, 1);
    assert.match(res.json.error, /ORCHESTRATION_IN_PROGRESS/);
    assert.equal(readSession(sessionDir).task.requiredContentGranularity, 'any');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retighten refuses a session that already carries a live delivery receipt', async () => {
  const root = tempRoot();
  try {
    const sessionDir = await initSession(root);
    for (const status of ['planned', 'published', 'stale']) {
      const session = readSession(sessionDir);
      session.delivery = { schemaVersion: '1.0', status, requestedDirectory: join(root, 'out') };
      writeSession(sessionDir, session);
      const res = await runCli([
        'retighten', '--session-dir', sessionDir, '--required-content-granularity', 'full-text',
      ]);
      assert.equal(res.code, 1, `status=${status} 必须被拒绝`);
      assert.match(res.json.error, /RETIGHTEN_DELIVERY_PRESENT/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retighten refuses a candidates session instead of bricking it', async () => {
  const root = tempRoot();
  try {
    const sessionDir = await initSession(root, { target: 'candidates' });
    const before = readSession(sessionDir);
    assert.equal(deliveryCompleteForSession(before), true,
      'candidates + any 的会话在收紧前是可完成的');

    const res = await runCli([
      'retighten', '--session-dir', sessionDir, '--required-content-granularity', 'full-text',
    ]);
    assert.equal(res.code, 1);
    assert.match(res.json.error, /RETIGHTEN_TARGET_HAS_NO_BODIES/);

    const after = readSession(sessionDir);
    assert.equal(after.task.requiredContentGranularity, 'any');
    assert.equal(deliveryCompleteForSession(after), true,
      '拒绝后会话必须仍然可完成,不能被不可逆地锁死');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('tightening never turns deliveryComplete from false into true', () => {
  // delivery-state.mjs:76 分支(candidates)
  const candidates = {
    task: { materializationTarget: 'candidates', requiredContentGranularity: 'any' },
    collection: { collection: { status: 'complete', items: [] } },
  };
  assert.equal(deliveryCompleteForSession(candidates), true);
  assert.equal(deliveryCompleteForSession({
    ...candidates,
    task: { ...candidates.task, requiredContentGranularity: 'full-text' },
  }), false, 'candidates 分支只会由 true 变 false');

  // delivery-state.mjs:80-81 分支(selected,正文只有摘录)
  const excerptOnly = {
    task: { materializationTarget: 'selected', requiredContentGranularity: 'any' },
    collection: {
      collection: {
        status: 'complete',
        items: [{
          itemId: 'a',
          materialization: { status: 'materialized', contentGranularity: 'excerpt' },
        }],
      },
    },
  };
  const loose = deliveryCompleteForSession(excerptOnly);
  const tight = deliveryCompleteForSession({
    ...excerptOnly,
    task: { ...excerptOnly.task, requiredContentGranularity: 'full-text' },
  });
  assert.equal(tight === true && loose === false, false,
    '收紧不得把 false 变成 true');
  assert.equal(tight, false);
});

test('retighten reopens a public-collect run that PUBLIC_COLLECT_SESSION_INVALID had blocked', async () => {
  const root = tempRoot();
  try {
    const sessionDir = await initSession(root);

    const paths = sessionPaths(sessionDir);
    const input = Object.freeze({
      query: 'DeepSeek 全文采集',
      fallbackQuery: 'DeepSeek 全文采集 工程实践',
      requestedCount: 1,
      category: 'general',
      language: 'zh-CN',
      manualPolicy: 'pause',
    });

    // 先复现死路:selected + any 会话过不了 public-collect 的前置条件
    assert.throws(() => createProbeRun(paths, input), /PUBLIC_COLLECT_SESSION_INVALID/);

    const repaired = await runCli([
      'retighten', '--session-dir', sessionDir, '--required-content-granularity', 'full-text',
    ]);
    assert.equal(repaired.code, 0, repaired.stderr || repaired.stdout);

    // 关键断言:run 真的被创建出来了,而不只是字段变了
    const created = createProbeRun(paths, input);
    assert.match(created.runId, /^public-collect-/);
    assert.equal(created.status, 'running');
    const owned = readSession(sessionDir);
    assert.equal(owned.task.activeOrchestrationRunId, created.runId);
    assert.equal(owned.task.workflow, 'public-collect');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retighten refuses a session that already has business artifacts', async () => {
  const root = tempRoot();
  try {
    const sessionDir = await initSession(root);
    const session = readSession(sessionDir);
    // 与 probe-state.mjs 的 hasBusinessArtifacts 使用同一谓词:任一产物存在即不新鲜
    session.task.discoveryGate.runs = [{ runId: 'discover-1' }];
    writeSession(sessionDir, session);

    const res = await runCli([
      'retighten', '--session-dir', sessionDir, '--required-content-granularity', 'full-text',
    ]);
    assert.equal(res.code, 1);
    assert.match(res.json.error, /RETIGHTEN_SESSION_NOT_FRESH/);
    assert.equal(readSession(sessionDir).task.requiredContentGranularity, 'any');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a successful retighten leaves session.delivery byte-identical', async () => {
  const root = tempRoot();
  try {
    const sessionDir = await initSession(root);
    const session = readSession(sessionDir);
    // failed receipt 是唯一允许共存的形态(拒绝条件 3 只放过 failed)
    session.delivery = {
      schemaVersion: '1.0', status: 'failed', failurePhase: 'terminal',
      requestedDirectory: join(root, 'out'), actualDirectory: join(root, 'out'),
    };
    writeSession(sessionDir, session);
    const deliveryBefore = JSON.stringify(readSession(sessionDir).delivery);

    const res = await runCli([
      'retighten', '--session-dir', sessionDir, '--required-content-granularity', 'full-text',
    ]);
    assert.equal(res.code, 0, res.stderr || res.stdout);
    assert.equal(JSON.stringify(readSession(sessionDir).delivery), deliveryBefore,
      'retighten 不得调用 markDeliveryStale,也不得改动 receipt');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('command-schema and help expose retighten', async () => {
  const schema = await runCli(['command-schema']);
  assert.equal(schema.json.ok, true);
  assert.deepEqual(schema.json.commands.retighten.required,
    ['session-dir', 'required-content-granularity']);
  assert.deepEqual(schema.json.commands.retighten.properties['required-content-granularity'].enum,
    ['full-text']);

  const help = await runCli(['retighten', '--help']);
  assert.equal(help.json.command, 'retighten');
});
