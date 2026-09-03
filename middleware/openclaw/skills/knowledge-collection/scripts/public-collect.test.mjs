import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { verifyCandidate } from './candidate-verifier.mjs';
import { createDiscoveryAuthorization } from './discovery-authorization.mjs';
import { runPublicCollect } from './public-collect.mjs';
import { createProbeRun, recordProbeDiscoveryRound } from './probe-state.mjs';
import {
  ensureSessionSkeleton, loadSession, newSession, persistSession, sessionPaths,
} from './session.mjs';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'public-collect-test-'));
  ensureSessionSkeleton(root);
  const session = newSession({
    query: '采集关于 DeepSeek Harness 的文章',
    sourceScope: ['public-internet'],
    materializationTarget: 'selected',
    requiredContentGranularity: 'full-text',
    discoveryGate: createDiscoveryAuthorization({ query: '采集关于 DeepSeek Harness 的文章' }),
  });
  writeFileSync(join(root, 'session.json'), `${JSON.stringify(session, null, 2)}\n`);
  return sessionPaths(root);
}

function setupDirect() {
  const root = mkdtempSync(join(tmpdir(), 'public-collect-direct-test-'));
  ensureSessionSkeleton(root);
  const directUrl = 'https://m.example.com/article/123';
  const session = newSession({
    query: '采集并落盘这篇文章的完整全文',
    sourceScope: ['public-internet'],
    materializationTarget: 'selected',
    requiredContentGranularity: 'full-text',
    discoveryGate: createDiscoveryAuthorization({
      directUrls: [directUrl],
      query: '采集并落盘这篇文章的完整全文',
    }),
  });
  writeFileSync(join(root, 'session.json'), `${JSON.stringify(session, null, 2)}\n`);
  return { paths: sessionPaths(root), directUrl };
}

function candidate(id, priority = 'normal') {
  const url = `https://example.com/article/${id}`;
  return {
    candidateId: id,
    canonicalUrl: url,
    acquisitionUrls: [url],
    candidateVersion: 1,
    evidenceHash: id.padEnd(64, 'a').slice(0, 64),
    discoveryDisposition: 'probe',
    probePriority: priority,
    verificationRequired: true,
    topicRelevance: { status: 'matched' },
    origin: 'public-discover',
  };
}

function addCandidates(paths, candidates) {
  const session = loadSession(paths).session;
  const existing = new Set(session.task.discoveryGate.candidates.map((entry) => entry.candidateId));
  session.task.discoveryGate.candidates.push(...candidates.filter((entry) => !existing.has(entry.candidateId)));
  persistSession(paths, session);
}

function body(id) {
  return [
    `# DeepSeek Harness ${id}`,
    '',
    `第一部分介绍 DeepSeek Harness 的系统背景与目标，样本编号 ${id}。`,
    '',
    `第二部分分析 DeepSeek Harness 的任务编排和异常处理，样本编号 ${id}。`,
    '',
    `第三部分说明 DeepSeek Harness 如何保存证据与验证读取，样本编号 ${id}。`,
    '',
    `第四部分讨论 DeepSeek Harness 的正文完整性和去重，样本编号 ${id}。`,
    '',
    `第五部分总结 DeepSeek Harness 的工程落地与可观测性，样本编号 ${id}。`,
  ].join('\n');
}

const input = {
  query: 'DeepSeek Harness 文章',
  fallbackQuery: 'DeepSeek Harness 工程实践',
  requestedCount: 2,
  category: 'general',
  language: 'zh-CN',
  manualPolicy: 'pause',
};

test('probes an authorized user URL before running public discovery', async () => {
  const { paths, directUrl } = setupDirect();
  let discoveryCalls = 0;
  const result = await runPublicCollect(paths, {
    query: '文章全文',
    fallbackQuery: '公开文章全文',
    requestedCount: 1,
    category: 'general',
    language: 'zh-CN',
    manualPolicy: 'pause',
  }, {
    discover: async () => {
      discoveryCalls += 1;
      throw new Error('discovery must not run before the direct candidate');
    },
    verify: async (targetPaths, attempt) => verifyCandidate(targetPaths, attempt, {
      acquire: async () => ({
        status: 'saved', requestedUrl: directUrl, resolvedUrl: directUrl,
        title: 'Direct article', markdown: body('direct'), executor: 'fixture-web',
      }),
    }),
  });

  assert.equal(discoveryCalls, 0);
  assert.equal(result.status, 'complete');
  assert.equal(result.deliverableArticleCount, 1);
});

test('probes high priority before normal and stops at requested unique count', async () => {
  const paths = setup();
  const order = [];
  const candidates = [candidate('normal', 'normal'), candidate('high-a', 'high'), candidate('high-b', 'high')];
  const result = await runPublicCollect(paths, input, {
    discover: async () => {
      addCandidates(paths, candidates);
      return { ok: true, probeCandidateIds: candidates.map((entry) => entry.candidateId) };
    },
    verify: async (targetPaths, attempt) => {
      const id = loadSession(targetPaths).session.task.publicCollectRun.attempts
        .find((entry) => entry.attemptId === attempt.attemptId).candidateId;
      order.push(id);
      const selected = candidates.find((entry) => entry.candidateId === id);
      return verifyCandidate(targetPaths, attempt, { acquire: async () => ({
        status: 'saved', requestedUrl: selected.canonicalUrl, resolvedUrl: selected.canonicalUrl,
        title: `DeepSeek Harness ${id}`, markdown: body(id), executor: 'fixture-web',
      }) });
    },
  });

  assert.deepEqual(order, ['high-a', 'high-b']);
  assert.equal(result.status, 'complete');
  assert.equal(result.deliverableArticleCount, 2);
  assert.equal(loadSession(paths).session.collection.collection.items.length, 2);
});

test('continues after duplicate and uses fallback query in the second bounded round', async () => {
  const paths = setup();
  const calls = [];
  const first = candidate('first', 'high');
  const mirror = candidate('mirror', 'high');
  const fallback = candidate('fallback', 'normal');
  const result = await runPublicCollect(paths, input, {
    discover: async (_paths, args, context) => {
      calls.push([args.query, context.channel]);
      if (args.query === input.query && context.channel === 'online') addCandidates(paths, [first, mirror]);
      if (args.query === input.fallbackQuery && context.channel === 'online') addCandidates(paths, [fallback]);
      return { ok: true };
    },
    verify: async (targetPaths, attempt) => {
      const id = loadSession(targetPaths).session.task.publicCollectRun.attempts
        .find((entry) => entry.attemptId === attempt.attemptId).candidateId;
      const selected = [first, mirror, fallback].find((entry) => entry.candidateId === id);
      const markdown = id === 'mirror' ? body('first') : body(id);
      return verifyCandidate(targetPaths, attempt, { acquire: async () => ({
        status: 'saved', requestedUrl: selected.canonicalUrl, resolvedUrl: selected.canonicalUrl,
        title: `DeepSeek Harness ${id}`, markdown, executor: 'fixture-web',
      }) });
    },
  });

  assert.deepEqual(calls, [
    [input.query, 'online'],
    [input.query, 'hot'],
    [input.fallbackQuery, 'online'],
  ]);
  assert.equal(result.status, 'complete');
  assert.equal(result.attempts.total, 3);
  assert.equal(loadSession(paths).session.collection.collection.items.length, 2);
});

test('resume of a running crash residue with no acquiring attempt finalizes safely', async () => {
  const paths = setup();
  const run = createProbeRun(paths, { ...input, requestedCount: 1 });
  recordProbeDiscoveryRound(paths, run.runId, { query: input.query, status: 'complete', candidateCount: 0 });
  recordProbeDiscoveryRound(paths, run.runId, {
    query: input.fallbackQuery, status: 'complete', candidateCount: 0,
  });
  const result = await runPublicCollect(paths, { 'run-id': run.runId, resume: true });
  assert.equal(result.status, 'failed');
  assert.equal(loadSession(paths).session.task.activeOrchestrationRunId, undefined);
});

test('same-input terminal replay is idempotent', async () => {
  const paths = setup();
  const one = { ...input, requestedCount: 1 };
  const selected = candidate('only', 'high');
  const options = {
    discover: async () => { addCandidates(paths, [selected]); return { ok: true }; },
    verify: async (targetPaths, attempt) => verifyCandidate(targetPaths, attempt, {
      acquire: async () => ({
        status: 'saved', requestedUrl: selected.canonicalUrl, resolvedUrl: selected.canonicalUrl,
        title: 'DeepSeek Harness only', markdown: body('only'), executor: 'fixture-web',
      }),
    }),
  };
  const first = await runPublicCollect(paths, one, options);
  const replay = await runPublicCollect(paths, one, options);
  assert.equal(replay.runId, first.runId);
  assert.equal(replay.status, 'complete');
  assert.equal(loadSession(paths).session.collection.collection.items.length, 1);
});

test('unexpected verifier failure pauses infrastructure state and resume retries the same attempt', async () => {
  const paths = setup();
  const one = { ...input, requestedCount: 1 };
  const selected = candidate('retry', 'high');
  const paused = await runPublicCollect(paths, one, {
    discover: async () => { addCandidates(paths, [selected]); return { ok: true }; },
    verify: async () => { throw new Error('fixture executor crash'); },
  });
  assert.equal(paused.status, 'infrastructure-blocked');
  assert.equal(paused.attempts.blocked, 1);

  const resumed = await runPublicCollect(paths, {
    'run-id': paused.runId,
    resume: true,
  }, {
    discover: async () => { throw new Error('resume must retry before another discovery'); },
    verify: async (targetPaths, attempt) => verifyCandidate(targetPaths, attempt, {
      acquire: async () => ({
        status: 'saved', requestedUrl: selected.canonicalUrl, resolvedUrl: selected.canonicalUrl,
        title: 'DeepSeek Harness retry', markdown: body('retry'), executor: 'fixture-web',
      }),
    }),
  });
  assert.equal(resumed.status, 'complete');
  assert.equal(resumed.deliverableArticleCount, 1);
});

test('skip cleans a paused verifier-owned browser session before terminalizing the attempt', async () => {
  const paths = setup();
  const one = { ...input, requestedCount: 1 };
  const selected = candidate('challenge', 'high');
  const paused = await runPublicCollect(paths, one, {
    discover: async () => { addCandidates(paths, [selected]); return { ok: true }; },
    verify: async (targetPaths, attempt) => verifyCandidate(targetPaths, attempt, {
      acquire: async () => ({
        status: 'requires-user-action', reasonCode: 'AUTH_OR_CHALLENGE',
        browserSession: 'kc-probe-fixture-skip',
      }),
    }),
  });
  const cleaned = [];
  const finished = await runPublicCollect(paths, { 'run-id': paused.runId, skip: true }, {
    cleanup: async (sessionId) => { cleaned.push(sessionId); },
    discover: async () => ({ ok: true }),
  });
  assert.deepEqual(cleaned, ['kc-probe-fixture-skip']);
  assert.equal(finished.status, 'failed');
  assert.deepEqual(loadSession(paths).session.task.publicCollectRun.ownedSessionCleanupPending, []);
});
