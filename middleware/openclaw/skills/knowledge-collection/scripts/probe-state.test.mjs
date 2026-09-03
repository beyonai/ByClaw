import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createDiscoveryAuthorization } from './discovery-authorization.mjs';
import { executeLocalCommand } from './command-router.mjs';
import {
  ensureSessionSkeleton,
  loadSession,
  newSession,
  persistSession,
  sessionPaths,
} from './session.mjs';
import {
  assertExternalSessionWriteAllowed,
  blockProbeRun,
  commitProbeAttempt,
  createProbeRun,
  finishProbeRun,
  pauseProbeRun,
  readProbeRun,
  reserveProbeAttempt,
  resumeProbeRun,
  setProbeDiscoveryReservation,
  summarizeProbeRun,
  updateProbeBudget,
} from './probe-state.mjs';

function initializedSession() {
  const root = mkdtempSync(join(tmpdir(), 'probe-state-test-'));
  ensureSessionSkeleton(root);
  const session = newSession({
    query: '采集一篇关于 DeepSeek Harness 的文章',
    sourceScope: ['public-internet'],
    materializationTarget: 'selected',
    requiredContentGranularity: 'full-text',
    discoveryGate: createDiscoveryAuthorization({
      query: '采集一篇关于 DeepSeek Harness 的文章',
    }),
  });
  writeFileSync(join(root, 'session.json'), `${JSON.stringify(session, null, 2)}\n`);
  const paths = sessionPaths(root);
  return { paths };
}

const input = Object.freeze({
  query: 'DeepSeek Harness 文章',
  fallbackQuery: 'DeepSeek Harness 工程实践',
  requestedCount: 1,
  category: 'general',
  language: 'zh-CN',
  manualPolicy: 'pause',
});

test('creates one fresh-session run and owns all external writes', () => {
  const { paths } = initializedSession();
  const created = createProbeRun(paths, input);

  assert.match(created.runId, /^public-collect-/);
  assert.equal(created.status, 'running');
  assert.equal(created.stateRevision, 1);
  assert.equal(loadSession(paths).session.task.requestedItemCount, 1);
  assert.throws(
    () => assertExternalSessionWriteAllowed(paths, 'collect'),
    /ORCHESTRATION_IN_PROGRESS/,
  );
  assert.throws(
    () => executeLocalCommand('collect', {
      'session-dir': paths.root,
      'item-json-file': join(paths.root, '.collection-inputs', 'missing.json'),
    }),
    /ORCHESTRATION_IN_PROGRESS/,
  );
  assert.doesNotThrow(() => assertExternalSessionWriteAllowed(paths, 'status'));
  assert.throws(
    () => createProbeRun(paths, { ...input, requestedCount: 2 }),
    /ORCHESTRATION_INPUT_CONFLICT/,
  );
});

test('rejects a non-fresh session without leaving an owner', () => {
  const { paths } = initializedSession();
  const session = loadSession(paths).session;
  session.collection.collection.items.push({ itemId: 'old-item' });
  persistSession(paths, session);

  assert.throws(() => createProbeRun(paths, input), /SESSION_NOT_FRESH/);
  const stored = loadSession(paths).session;
  assert.equal(stored.task.activeOrchestrationRunId, undefined);
  assert.equal(stored.task.publicCollectRun, undefined);
});

test('reserves snapshots with revision CAS and pause does not advance cursor', () => {
  const { paths } = initializedSession();
  const run = createProbeRun(paths, input);
  const session = loadSession(paths).session;
  const candidate = {
    candidateId: 'candidate-1',
    canonicalUrl: 'https://example.com/commonDetail/759632',
    acquisitionUrls: ['https://example.com/commonDetail/759632'],
    candidateVersion: 1,
    evidenceHash: 'a'.repeat(64),
    discoveryDisposition: 'probe',
    probePriority: 'high',
    verificationRequired: true,
    topicRelevance: { status: 'matched' },
  };
  session.task.discoveryGate.candidates.push(candidate);
  persistSession(paths, session);

  const attempt = reserveProbeAttempt(paths, run.runId, candidate, { expectedRevision: 1 });
  assert.equal(attempt.attemptState, 'acquiring');
  assert.throws(
    () => reserveProbeAttempt(paths, run.runId, candidate, { expectedRevision: 1 }),
    /ORCHESTRATION_REVISION_CONFLICT/,
  );

  const paused = pauseProbeRun(paths, run.runId, {
    attemptId: attempt.attemptId,
    reasonCode: 'REQUIRES_USER_ACTION',
    remainingBudgetMs: 1234,
  });
  assert.equal(paused.status, 'paused-user-action');
  assert.equal(paused.cursor, 0);
  assert.equal(paused.attempts[0].attemptState, 'paused-user-action');
  const resumed = resumeProbeRun(paths, run.runId);
  assert.equal(resumed.status, 'running');
  assert.equal(resumed.attempts[0].attemptState, 'acquiring');

  const completed = commitProbeAttempt(paths, run.runId, attempt.attemptId, {
    acquisitionOutcome: 'unavailable',
    pageVerification: 'not-evaluated',
    verifiedTopicStatus: 'not-evaluated',
    promotionStatus: 'not-eligible',
    reasonCode: 'HTTP_404',
  });
  assert.equal(completed.attemptState, 'terminal');
  assert.equal(readProbeRun(paths, run.runId).cursor, 1);
});

test('terminal same-input replay is idempotent and cleanup releases the owner', () => {
  const { paths } = initializedSession();
  const run = createProbeRun(paths, input);
  const finished = finishProbeRun(paths, run.runId, 'failed');
  assert.equal(finished.status, 'failed');
  assert.doesNotThrow(() => assertExternalSessionWriteAllowed(paths, 'collect'));

  const replay = createProbeRun(paths, input);
  assert.equal(replay.runId, run.runId);
  assert.equal(replay.status, 'failed');
  assert.deepEqual(summarizeProbeRun(loadSession(paths).session), {
    runId: run.runId,
    persistedStatus: 'failed',
    effectiveStatus: 'failed',
    requestedItemCount: 1,
    deliverableArticleCount: 0,
    remainingCount: 1,
    attempts: { total: 0, terminal: 0, paused: 0, blocked: 0 },
  });
});

test('remaining orchestration budget is persisted and can only decrease', () => {
  const { paths } = initializedSession();
  const run = createProbeRun(paths, input);
  const reduced = updateProbeBudget(paths, run.runId, run.totalBudgetMs - 1234);
  assert.equal(reduced.remainingBudgetMs, run.totalBudgetMs - 1234);
  const unchanged = updateProbeBudget(paths, run.runId, run.totalBudgetMs);
  assert.equal(unchanged.remainingBudgetMs, reduced.remainingBudgetMs);
});

test('blocked collection status exposes the effective state and resumable discovery reservation', () => {
  const { paths } = initializedSession();
  const run = createProbeRun(paths, input);
  setProbeDiscoveryReservation(paths, run.runId, {
    query: input.query,
    channel: 'hot',
    phase: 'reserved',
  });
  blockProbeRun(paths, run.runId, {
    reasonCode: 'DISCOVERY_INFRASTRUCTURE_FAILED',
    remainingBudgetMs: 0,
  });

  const stored = loadSession(paths).session;
  stored.task.discoveryGate.runs.push({
    runId: 'discovery-1',
    query: input.query,
    category: input.category,
    status: 'running',
  });
  persistSession(paths, stored);

  const summary = summarizeProbeRun(loadSession(paths).session);
  assert.equal(summary.effectiveStatus, 'infrastructure-blocked');
  assert.deepEqual(summary.discoveryReservation, {
    round: 1,
    query: input.query,
    channel: 'hot',
    phase: 'reserved',
  });

  const status = executeLocalCommand('status', { 'session-dir': paths.root });
  assert.equal(status.collection.operationalStatus, 'infrastructure-blocked');
  assert.equal(status.task.discoveryGate.runs[0].status, 'running');
});
