import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { verifyCandidate } from './candidate-verifier.mjs';
import { collectionStatus, finalizeVerifiedProbeRun } from './collection-state.mjs';
import { cmdPublish } from './publish-delivery.mjs';
import { createDiscoveryAuthorization } from './discovery-authorization.mjs';
import { createProbeRun, finishProbeRun, reserveProbeAttempt } from './probe-state.mjs';
import {
  ensureSessionSkeleton, loadSession, newSession, persistSession, sessionPaths,
} from './session.mjs';

function setup(requestedCount = 1) {
  const root = mkdtempSync(join(tmpdir(), 'candidate-verifier-test-'));
  ensureSessionSkeleton(root);
  const session = newSession({
    query: '采集关于 DeepSeek Harness 的文章',
    sourceScope: ['public-internet'],
    materializationTarget: 'selected',
    requiredContentGranularity: 'full-text',
    discoveryGate: createDiscoveryAuthorization({ query: '采集关于 DeepSeek Harness 的文章' }),
  });
  writeFileSync(join(root, 'session.json'), `${JSON.stringify(session, null, 2)}\n`);
  const paths = sessionPaths(root);
  const run = createProbeRun(paths, {
    query: 'DeepSeek Harness 文章',
    fallbackQuery: 'DeepSeek Harness 工程实践',
    requestedCount,
    category: 'general',
    language: 'zh-CN',
    manualPolicy: 'pause',
  });
  return { paths, run };
}

function addCandidate(paths, id, url) {
  const session = loadSession(paths).session;
  const candidate = {
    candidateId: id,
    canonicalUrl: url,
    acquisitionUrls: [url],
    candidateVersion: 1,
    evidenceHash: id.padEnd(64, 'a').slice(0, 64),
    discoveryDisposition: 'probe',
    probePriority: 'high',
    verificationRequired: true,
    topicRelevance: { status: 'matched' },
    origin: 'public-discover',
  };
  session.task.discoveryGate.candidates.push(candidate);
  persistSession(paths, session);
  return candidate;
}

function articleMarkdown() {
  return [
    '# DeepSeek Harness 工程实践',
    '',
    '第一部分介绍 DeepSeek Harness 的系统背景、目标和整体设计方案。',
    '',
    '第二部分分析 DeepSeek Harness 的任务编排、状态生命周期和异常处理。',
    '',
    '第三部分说明 DeepSeek Harness 如何保存证据并验证每一次外部读取。',
    '',
    '第四部分讨论 DeepSeek Harness 的正文完整性、主题校验和内容去重。',
    '',
    '第五部分总结 DeepSeek Harness 的工程落地方式以及可观测性指标。',
    '',
    '第六部分给出 DeepSeek Harness 的测试策略、恢复流程和最终验收结果。',
  ].join('\n');
}

async function promoteArticle(paths, run, id, markdown = articleMarkdown()) {
  const url = `https://example.com/article/${id}`;
  const candidate = addCandidate(paths, id, url);
  const attempt = reserveProbeAttempt(paths, run.runId, candidate);
  const result = await verifyCandidate(paths, { runId: run.runId, attemptId: attempt.attemptId }, {
    acquire: async () => ({
      status: 'saved', requestedUrl: url, resolvedUrl: url,
      title: 'DeepSeek Harness 工程实践', markdown, executor: 'fixture-web',
    }),
  });
  assert.equal(result.promotionStatus, 'promoted');
  return loadSession(paths).session.collection.collection.items.find((item) => item.itemId === result.itemId);
}

test('failed probe is terminal but never creates collection inventory', async () => {
  const { paths, run } = setup();
  const candidate = addCandidate(paths, 'candidate-failed', 'https://example.com/article/failed');
  const attempt = reserveProbeAttempt(paths, run.runId, candidate, { expectedRevision: 1 });

  const result = await verifyCandidate(paths, { runId: run.runId, attemptId: attempt.attemptId }, {
    acquire: async () => ({ status: 'unavailable', reasonCode: 'HTTP_404' }),
  });

  assert.equal(result.attemptState, 'terminal');
  assert.equal(result.acquisitionOutcome, 'unavailable');
  assert.deepEqual(loadSession(paths).session.collection.collection.items, []);
});

test('ambiguous missing title is recovered from actual Markdown and recorded in the receipt', async () => {
  const { paths, run } = setup();
  const url = 'https://example.com/article/missing-title';
  const candidate = addCandidate(paths, 'missing-title', url);
  const attempt = reserveProbeAttempt(paths, run.runId, candidate, { expectedRevision: 1 });
  let calls = 0;
  const result = await verifyCandidate(paths, { runId: run.runId, attemptId: attempt.attemptId }, {
    acquire: async () => ({ status: 'saved', requestedUrl: url, resolvedUrl: url,
      title: '', markdown: articleMarkdown(), executor: 'fixture-web' }),
    callJev: async (_payload, options) => {
      calls += 1;
      assert.ok(options.remainingBudgetMs() <= 1500);
      return { ok: true, document: { model: 'fixture',
        answers: { evidence: { type: 'choice', choice: 'e0', confidence: 0.95 } } } };
    },
  });
  assert.equal(result.promotionStatus, 'promoted');
  assert.equal(calls, 1);
  const receipt = JSON.parse(readFileSync(join(paths.root,
    `raw/probes/${run.runId}/${candidate.candidateId}/${attempt.attemptId}/verification.json`), 'utf8'));
  assert.equal(receipt.semanticReview.kind, 'existing-heading');
  assert.equal(receipt.analysis.title, 'DeepSeek Harness 工程实践');
});

test('topic evidence beyond the default text window survives promotion and is revalidated', async () => {
  const { paths, run } = setup();
  const url = 'https://example.com/article/long';
  const candidate = addCandidate(paths, 'long', url);
  const attempt = reserveProbeAttempt(paths, run.runId, candidate, { expectedRevision: 1 });
  const markdown = ('This paragraph explains a general architecture with extensive technical details.\n\n').repeat(7500)
    + articleMarkdown();
  const result = await verifyCandidate(paths, { runId: run.runId, attemptId: attempt.attemptId }, {
    acquire: async () => ({ status: 'saved', requestedUrl: url, resolvedUrl: url,
      title: 'Architecture report', markdown, executor: 'fixture-web' }),
    callJev: async (payload) => ({ ok: true, document: { model: 'fixture', answers: {
      evidence: { type: 'choice', choice: Object.keys(payload.state.evidence).at(-1), confidence: 0.95 },
    } } }),
  });
  assert.equal(result.promotionStatus, 'promoted');
  const session = loadSession(paths).session;
  assert.ok(session.collection.collection.items[0].topicEvidence.start > 512 * 1024);
  const status = collectionStatus(paths);
  assert.equal(status.publicCollectRun.deliverableArticleCount, 1);
  const receiptPath = join(paths.root, `raw/probes/${run.runId}/${candidate.candidateId}/${attempt.attemptId}/verification.json`);
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  receipt.topicEvidence.start = 0;
  writeFileSync(receiptPath, JSON.stringify(receipt));
  assert.equal(collectionStatus(paths).publicCollectRun.deliverableArticleCount, 0);
});

test('complete topic-matched body is promoted with a deterministic receipt', async () => {
  const { paths, run } = setup();
  const url = 'https://example.com/article/deepseek-harness';
  const candidate = addCandidate(paths, 'candidate-success', url);
  const attempt = reserveProbeAttempt(paths, run.runId, candidate, { expectedRevision: 1 });

  const result = await verifyCandidate(paths, { runId: run.runId, attemptId: attempt.attemptId }, {
    acquire: async () => ({
      status: 'saved',
      requestedUrl: url,
      resolvedUrl: url,
      title: 'DeepSeek Harness 工程实践',
      markdown: articleMarkdown(),
      executor: 'fixture-web',
    }),
  });

  assert.equal(result.promotionStatus, 'promoted');
  assert.match(result.promotionId, new RegExp(`^${run.runId}:candidate-success:`));
  const session = loadSession(paths).session;
  assert.equal(session.collection.collection.items.length, 1);
  assert.equal(session.collection.collection.items[0].promotionId, result.promotionId);
  assert.equal(session.collection.collection.items[0].materialization.status, 'materialized');
  assert.equal(session.collection.collection.items[0].materialization.contentGranularity, 'full-text');
  assert.equal(session.task.publicCollectRun.deliverableItemIds.length, 1);

  const replay = await verifyCandidate(paths, { runId: run.runId, attemptId: attempt.attemptId }, {
    acquire: async () => { throw new Error('idempotent replay must not acquire again'); },
  });
  assert.equal(replay.promotionId, result.promotionId);
  assert.equal(replay.itemId, result.itemId);
});

test('candidate verification accepts a resolved URL that only adds a trailing slash', async () => {
  const { paths, run } = setup();
  const url = 'https://example.com/article/deepseek-harness-slash';
  const candidate = addCandidate(paths, 'candidate-trailing-slash', url);
  const attempt = reserveProbeAttempt(paths, run.runId, candidate, { expectedRevision: 1 });

  const result = await verifyCandidate(paths, { runId: run.runId, attemptId: attempt.attemptId }, {
    acquire: async () => ({
      status: 'saved',
      requestedUrl: url,
      resolvedUrl: `${url}/`,
      title: 'DeepSeek Harness 工程实践',
      markdown: articleMarkdown(),
      executor: 'fixture-web',
    }),
  });

  assert.equal(result.promotionStatus, 'promoted');
  assert.equal(loadSession(paths).session.collection.collection.items.length, 1);
});

test('candidate verification accepts an acquired same-site URL with a changed host and path', async () => {
  const { paths, run } = setup();
  const url = 'https://m.example.com/article/deepseek-harness';
  const resolvedUrl = 'https://www.example.com/news/deepseek-harness?from=mobile';
  const candidate = addCandidate(paths, 'candidate-same-site', url);
  const attempt = reserveProbeAttempt(paths, run.runId, candidate, { expectedRevision: 1 });

  const result = await verifyCandidate(paths, { runId: run.runId, attemptId: attempt.attemptId }, {
    acquire: async () => ({
      status: 'saved',
      requestedUrl: url,
      resolvedUrl,
      title: 'DeepSeek Harness 工程实践',
      markdown: articleMarkdown(),
      executor: 'fixture-web',
    }),
  });

  assert.equal(result.promotionStatus, 'promoted');
  assert.equal(loadSession(paths).session.collection.collection.items.length, 1);
});

test('WeChat candidates use dedicated sanitization before promotion', async () => {
  const { paths, run } = setup();
  const url = 'https://mp.weixin.qq.com/s/deepseek-harness-fixture';
  const selected = addCandidate(paths, 'candidate-wechat', url);
  const attempt = reserveProbeAttempt(paths, run.runId, selected, { expectedRevision: 1 });
  const result = await verifyCandidate(paths, { runId: run.runId, attemptId: attempt.attemptId }, {
    acquire: async () => ({
      status: 'saved', requestedUrl: url, resolvedUrl: url,
      title: 'DeepSeek Harness 微信工程实践', markdown: `${articleMarkdown()}\n\n赞赏\n`,
      executor: 'fixture-wechat',
    }),
  });
  assert.equal(result.promotionStatus, 'promoted');
  const item = loadSession(paths).session.collection.collection.items[0];
  assert.equal(item.sourceUrl, url);
});

test('Sogou WeChat candidates retain trusted cross-site authorization through evidence registration', async () => {
  const { paths, run } = setup();
  const requestedUrl = 'https://weixin.sogou.com/link?url=deepseek-harness-fixture';
  const resolvedUrl = 'https://mp.weixin.qq.com/s/deepseek-harness-fixture';
  const selected = addCandidate(paths, 'candidate-sogou-wechat', requestedUrl);
  const attempt = reserveProbeAttempt(paths, run.runId, selected, { expectedRevision: 1 });

  const result = await verifyCandidate(paths, { runId: run.runId, attemptId: attempt.attemptId }, {
    acquire: async () => ({
      status: 'saved', requestedUrl, resolvedUrl,
      title: 'DeepSeek Harness 微信工程实践', markdown: `${articleMarkdown()}\n\n赞赏\n`,
      executor: 'fixture-wechat',
    }),
  });

  assert.equal(result.promotionStatus, 'promoted');
  const session = loadSession(paths).session;
  assert.equal(session.collection.collection.items[0].sourceUrl, requestedUrl);
  assert.equal(session.task.acquisitionEvidence[0].resolvedUrl, resolvedUrl);
});

test('arXiv candidates prefer an authorized HTML representation and require paper structure', async () => {
  const { paths, run } = setup();
  const sourceUrl = 'https://arxiv.org/pdf/2501.12948';
  const acquisitionUrl = 'https://arxiv.org/html/2501.12948v2';
  const selected = addCandidate(paths, 'candidate-arxiv', sourceUrl);
  const session = loadSession(paths).session;
  session.task.discoveryGate.candidates[0].acquisitionUrls.push(acquisitionUrl);
  persistSession(paths, session);
  selected.acquisitionUrls.push(acquisitionUrl);
  const attempt = reserveProbeAttempt(paths, run.runId, selected, { expectedRevision: 1 });
  const section = 'DeepSeek Harness architecture, verification, experiments, and engineering evidence. '.repeat(20);
  const paper = [
    '# DeepSeek Harness', '## Abstract', section, '## Introduction', section,
    '## Architecture', section, '## Experiments', section, '## Discussion', section,
    '## References', section,
  ].join('\n\n');
  let requested;
  const result = await verifyCandidate(paths, { runId: run.runId, attemptId: attempt.attemptId }, {
    acquire: async (candidate) => {
      [requested] = candidate.acquisitionUrls;
      return {
        status: 'saved', requestedUrl: acquisitionUrl, resolvedUrl: acquisitionUrl,
        title: 'DeepSeek Harness paper', markdown: paper, executor: 'fixture-arxiv',
      };
    },
  });
  assert.equal(requested, acquisitionUrl);
  assert.equal(result.promotionStatus, 'promoted');
});

test('same normalized body from a second URL is recorded as duplicate without another item', async () => {
  const { paths, run } = setup(2);
  const first = addCandidate(paths, 'candidate-first', 'https://example.com/article/first');
  const second = addCandidate(paths, 'candidate-second', 'https://mirror.example.com/article/second');

  const firstAttempt = reserveProbeAttempt(paths, run.runId, first, { expectedRevision: 1 });
  await verifyCandidate(paths, { runId: run.runId, attemptId: firstAttempt.attemptId }, {
    acquire: async () => ({
      status: 'saved', requestedUrl: first.canonicalUrl, resolvedUrl: first.canonicalUrl,
      title: 'DeepSeek Harness 工程实践', markdown: articleMarkdown(), executor: 'fixture-web',
    }),
  });
  const revision = loadSession(paths).session.task.publicCollectRun.stateRevision;
  const secondAttempt = reserveProbeAttempt(paths, run.runId, second, { expectedRevision: revision });
  const duplicate = await verifyCandidate(paths, {
    runId: run.runId, attemptId: secondAttempt.attemptId,
  }, {
    acquire: async () => ({
      status: 'saved', requestedUrl: second.canonicalUrl, resolvedUrl: second.canonicalUrl,
      title: 'DeepSeek Harness 工程实践', markdown: articleMarkdown(), executor: 'fixture-web',
    }),
  });

  assert.equal(duplicate.promotionStatus, 'duplicate');
  const session = loadSession(paths).session;
  assert.equal(session.collection.collection.items.length, 1);
  assert.equal(session.task.publicCollectRun.deliverableItemIds.length, 1);
});

test('challenge pause persists verifier-owned browser cleanup state', async () => {
  const { paths, run } = setup();
  const selected = addCandidate(paths, 'candidate-challenge', 'https://example.com/article/challenge');
  const attempt = reserveProbeAttempt(paths, run.runId, selected, { expectedRevision: 1 });
  const result = await verifyCandidate(paths, { runId: run.runId, attemptId: attempt.attemptId }, {
    acquire: async () => ({
      status: 'requires-user-action',
      reasonCode: 'AUTH_OR_CHALLENGE',
      browserSession: 'kc-probe-fixture-challenge',
    }),
  });
  assert.equal(result.attemptState, 'paused-user-action');
  const persisted = loadSession(paths).session.task.publicCollectRun;
  assert.equal(persisted.pause.ownedSession.sessionId, 'kc-probe-fixture-challenge');
  assert.equal(persisted.ownedSessionCleanupPending.length, 1);
});

test('unavailable acquisition persists structured redirect authorization diagnostics', async () => {
  const { paths, run } = setup();
  const requestedUrl = 'https://example.com/article/authorized';
  const resolvedUrl = 'https://example.com/article/other';
  const selected = addCandidate(paths, 'candidate-redirect-diagnostic', requestedUrl);
  const attempt = reserveProbeAttempt(paths, run.runId, selected, { expectedRevision: 1 });
  const result = await verifyCandidate(paths, { runId: run.runId, attemptId: attempt.attemptId }, {
    acquire: async () => ({
      status: 'unavailable',
      reasonCode: 'SOURCE_NOT_AUTHORIZED_BY_DISCOVERY',
      failureDiagnostic: {
        stage: 'resolved-url-authorization',
        mismatchKind: 'redirect-not-authorized',
        requestedUrl,
        resolvedUrl,
      },
    }),
  });

  assert.deepEqual(result.failureDiagnostic, {
    stage: 'resolved-url-authorization',
    mismatchKind: 'redirect-not-authorized',
    requestedUrl,
    resolvedUrl,
  });
  const persisted = loadSession(paths).session.task.publicCollectRun.attempts[0];
  assert.deepEqual(persisted.failureDiagnostic, result.failureDiagnostic);
});

test('saved unauthorized acquisition redacts sensitive resolved URL values', async () => {
  const { paths, run } = setup();
  const selected = addCandidate(paths, 'candidate-sensitive-redirect', 'https://example.com/article/authorized');
  const attempt = reserveProbeAttempt(paths, run.runId, selected, { expectedRevision: 1 });
  await assert.rejects(verifyCandidate(paths, {
    runId: run.runId, attemptId: attempt.attemptId,
  }, {
    acquire: async () => ({
      status: 'saved',
      requestedUrl: selected.canonicalUrl,
      resolvedUrl: 'https://evil.example.net/login?token=super-secret',
      title: 'redirect',
      markdown: articleMarkdown(),
      executor: 'fixture-web',
    }),
  }), (error) => {
    assert.match(error.message, /PROBE_ACQUISITION_URL_NOT_AUTHORIZED/);
    assert.equal(error.message.includes('super-secret'), false);
    assert.match(error.message, /REDACTED/);
    return true;
  });
});

test('damaged verification receipt invalidates requested-count delivery', async () => {
  const { paths, run } = setup();
  const url = 'https://example.com/article/damaged';
  const selected = addCandidate(paths, 'candidate-damaged', url);
  const attempt = reserveProbeAttempt(paths, run.runId, selected, { expectedRevision: 1 });
  await verifyCandidate(paths, { runId: run.runId, attemptId: attempt.attemptId }, {
    acquire: async () => ({
      status: 'saved', requestedUrl: url, resolvedUrl: url,
      title: 'DeepSeek Harness damaged', markdown: articleMarkdown(), executor: 'fixture-web',
    }),
  });
  finishProbeRun(paths, run.runId, 'complete');
  const item = loadSession(paths).session.collection.collection.items[0];
  unlinkSync(join(paths.root, item.verificationReceipt));
  const status = collectionStatus(paths);
  assert.equal(status.deliveryComplete, false);
  assert.equal(status.publicCollectRun.effectiveStatus, 'invalidated');
  assert.equal(status.publicCollectRun.deliverableArticleCount, 0);
});

test('read-only status excludes a topic-matched body changed after promotion and publish rejects it', async () => {
  const { paths, run } = setup();
  const item = await promoteArticle(paths, run, 'candidate-topic-matched-change');
  finishProbeRun(paths, run.runId, 'complete');
  const bodyPath = join(paths.root, item.materialization.sanitizedPath);
  writeFileSync(bodyPath, `${articleMarkdown()}\n\nDeepSeek Harness 的新增章节继续讨论工程实践。\n`);
  const sessionPath = join(paths.root, 'session.json');
  const sessionBytes = readFileSync(sessionPath);

  const status = collectionStatus(paths);
  assert.equal(status.deliveryComplete, false);
  assert.equal(status.publicCollectRun.effectiveStatus, 'invalidated');
  assert.equal(status.publicCollectRun.deliverableArticleCount, 0);
  assert.deepEqual(status.downstreamInput.files, []);
  assert.ok(status.warnings.some((warning) => /哈希|指纹/.test(warning)));
  assert.deepEqual(readFileSync(sessionPath), sessionBytes);

  const destination = join(realpathSync(paths.root), '..', 'candidate-topic-matched-delivery');
  assert.throws(() => cmdPublish(paths, { 'delivery-dir': destination }), /deliveryComplete/);
  assert.equal(existsSync(destination), false);
});

test('missing or corrupt receipt excludes only its promoted body from downstream handoff', async () => {
  for (const damage of ['missing', 'corrupt']) {
    const { paths, run } = setup(2);
    const invalid = await promoteArticle(paths, run, `candidate-${damage}`);
    const valid = await promoteArticle(paths, run, `candidate-valid-${damage}`,
      `${articleMarkdown()}\n\n另一个候选提供不同的 DeepSeek Harness 工程部署实例。\n`);
    finishProbeRun(paths, run.runId, 'complete');
    const invalidPath = join(realpathSync(paths.root), invalid.materialization.sanitizedPath);
    const validPath = join(realpathSync(paths.root), valid.materialization.sanitizedPath);
    const receiptPath = join(paths.root, invalid.verificationReceipt);
    if (damage === 'missing') unlinkSync(receiptPath);
    else writeFileSync(receiptPath, '{corrupt receipt');
    const sessionPath = join(paths.root, 'session.json');
    const sessionBytes = readFileSync(sessionPath);

    const status = collectionStatus(paths);
    assert.equal(status.deliveryComplete, false);
    assert.equal(status.publicCollectRun.effectiveStatus, 'invalidated');
    assert.equal(status.publicCollectRun.deliverableArticleCount, 1);
    assert.deepEqual(status.downstreamInput.files, [validPath]);
    assert.equal(status.downstreamInput.files.includes(invalidPath), false);
    assert.deepEqual(readFileSync(sessionPath), sessionBytes);
  }
});

test('mixed inventory retains ordinary Markdown while excluding a damaged probe item', async () => {
  const { paths, run } = setup(2);
  const damaged = await promoteArticle(paths, run, 'candidate-mixed-damaged');
  const valid = await promoteArticle(paths, run, 'candidate-mixed-valid',
    `${articleMarkdown()}\n\n第二篇 DeepSeek Harness 文章描述不同的工程部署实例。\n`);
  finishProbeRun(paths, run.runId, 'complete');

  const ordinaryPath = 'sanitized/items/ordinary-cloud.md';
  writeFileSync(join(paths.root, 'markdown/ordinary-cloud.md'), '# Ordinary cloud article\n\nContent.\n');
  writeFileSync(join(paths.root, ordinaryPath), '# Ordinary cloud article\n\nContent.\n');
  const session = loadSession(paths).session;
  session.task.sourceScope.push('cloud-knowledge');
  session.collection.collection.items.push({
    itemId: 'ordinary-cloud',
    title: 'Ordinary cloud article',
    sourceUrl: 'cloud-knowledge://article/ordinary-cloud',
    sourceItemId: 'ordinary-cloud',
    sourceSkill: 'project-cloud-knowledge',
    backend: 'cloud-knowledge',
    collectionFilters: {},
    rawArtifacts: [],
    duplicateGroupKey: 'ordinary-cloud',
    duplicateOf: null,
    media: { coverStatus: 'not-present', coverCount: 0, materializedCoverCount: 0 },
    materialization: {
      status: 'materialized', markdownPath: 'markdown/ordinary-cloud.md',
      sanitizedPath: ordinaryPath, pendingArtifactCleanup: [], reason: null,
      contentGranularity: 'full-text',
    },
  });
  persistSession(paths, session);
  const canonical = JSON.parse(readFileSync(paths.collectionResult, 'utf8'));
  canonical.items.push({
    title: 'Ordinary cloud article', url: 'cloud-knowledge://article/ordinary-cloud',
    author: '', publishTime: '', markdown: ordinaryPath, fileName: ordinaryPath,
  });
  writeFileSync(paths.collectionResult, JSON.stringify(canonical));
  unlinkSync(join(paths.root, damaged.verificationReceipt));

  const status = collectionStatus(paths);
  assert.equal(status.deliveryComplete, false);
  assert.equal(status.publicCollectRun.effectiveStatus, 'invalidated');
  assert.deepEqual(status.downstreamInput.files, [
    join(realpathSync(paths.root), valid.materialization.sanitizedPath),
    join(realpathSync(paths.root), ordinaryPath),
  ]);

  const damagedSession = loadSession(paths).session;
  const damagedItem = damagedSession.collection.collection.items.find((item) => item.itemId === damaged.itemId);
  delete damagedItem.verificationReceipt;
  delete damagedItem.promotionId;
  persistSession(paths, damagedSession);
  assert.deepEqual(collectionStatus(paths).downstreamInput.files, status.downstreamInput.files);
});

test('missing promoted Markdown invalidates a completed requested-count run', async () => {
  const { paths, run } = setup();
  const url = 'https://example.com/article/missing-body';
  const selected = addCandidate(paths, 'candidate-missing-body', url);
  const attempt = reserveProbeAttempt(paths, run.runId, selected, { expectedRevision: 1 });
  await verifyCandidate(paths, { runId: run.runId, attemptId: attempt.attemptId }, {
    acquire: async () => ({
      status: 'saved', requestedUrl: url, resolvedUrl: url,
      title: 'DeepSeek Harness missing body', markdown: articleMarkdown(), executor: 'fixture-web',
    }),
  });
  finishProbeRun(paths, run.runId, 'complete');
  const item = loadSession(paths).session.collection.collection.items[0];
  unlinkSync(join(paths.root, item.materialization.sanitizedPath));
  const status = collectionStatus(paths);
  assert.equal(status.deliveryComplete, false);
  assert.equal(status.publicCollectRun.effectiveStatus, 'invalidated');
  assert.equal(status.publicCollectRun.deliverableArticleCount, 0);
  assert.deepEqual(status.downstreamInput.files, []);
});

test('finalization rejects a readable body changed after promotion', async () => {
  const { paths, run } = setup();
  const url = 'https://example.com/article/replaced-body';
  const selected = addCandidate(paths, 'candidate-replaced-body', url);
  const attempt = reserveProbeAttempt(paths, run.runId, selected, { expectedRevision: 1 });
  await verifyCandidate(paths, { runId: run.runId, attemptId: attempt.attemptId }, {
    acquire: async () => ({
      status: 'saved', requestedUrl: url, resolvedUrl: url,
      title: 'DeepSeek Harness original', markdown: articleMarkdown(), executor: 'fixture-web',
    }),
  });
  const item = loadSession(paths).session.collection.collection.items[0];
  writeFileSync(join(paths.root, item.materialization.sanitizedPath), [
    '# Different article', '', 'A completely different long paragraph.'.repeat(10), '',
    'Another unrelated substantive paragraph.'.repeat(10), '',
    'Third unrelated substantive paragraph.'.repeat(10), '',
    'Fourth unrelated substantive paragraph.'.repeat(10), '',
    'Fifth unrelated substantive paragraph.'.repeat(10),
  ].join('\n'));
  assert.throws(
    () => finalizeVerifiedProbeRun(paths, run.runId, 'complete'),
    /哈希|指纹|主题|RECONCILIATION/,
  );
  assert.equal(loadSession(paths).session.task.activeOrchestrationRunId, run.runId);
});

test('resume reuses durable acquired evidence after a pre-promotion crash', async () => {
  const { paths, run } = setup();
  const url = 'https://example.com/article/crash-recovery';
  const selected = addCandidate(paths, 'candidate-crash-recovery', url);
  const attempt = reserveProbeAttempt(paths, run.runId, selected, { expectedRevision: 1 });
  let acquisitions = 0;
  await assert.rejects(verifyCandidate(paths, { runId: run.runId, attemptId: attempt.attemptId }, {
    acquire: async () => {
      acquisitions += 1;
      return {
        status: 'saved', requestedUrl: url, resolvedUrl: url,
        title: 'DeepSeek Harness crash recovery', markdown: articleMarkdown(), executor: 'fixture-web',
      };
    },
    afterPublishArtifacts: async () => { throw new Error('fixture kill point'); },
  }), /fixture kill point/);
  const recovered = await verifyCandidate(paths, { runId: run.runId, attemptId: attempt.attemptId }, {
    acquire: async () => { throw new Error('resume must not reacquire changed remote content'); },
  });
  assert.equal(acquisitions, 1);
  assert.equal(recovered.promotionStatus, 'promoted');
  const item = loadSession(paths).session.collection.collection.items[0];
  const manifest = JSON.parse(readFileSync(join(paths.root,
    item.rawArtifacts.find((artifact) => artifact.endsWith('promotion-manifest.json'))), 'utf8'));
  assert.equal(manifest.phase, 'committed');
});
