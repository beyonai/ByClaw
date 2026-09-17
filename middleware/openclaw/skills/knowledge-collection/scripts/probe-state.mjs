import crypto from 'node:crypto';

import {
  loadSession,
  persistSession,
  withSessionLock,
} from './session.mjs';
import { summarizePromotedDelivery } from './delivery-state.mjs';
import { assertDiscoveryQueryMatches } from './topic-relevance.mjs';

export const PROBE_RUN_SCHEMA_VERSION = '1.0';
const TERMINAL_RUN_STATUSES = new Set(['complete', 'partial', 'failed']);
const RESUMABLE_RUN_STATUSES = new Set(['paused-user-action', 'infrastructure-blocked']);
const ACQUISITION_OUTCOMES = new Set(['saved', 'unavailable', 'unsupported', 'skipped']);
const PAGE_VERIFICATIONS = new Set(['verified-article', 'verified-non-article', 'not-evaluated']);
const TOPIC_STATUSES = new Set(['matched', 'not-required', 'unmatched', 'unknown', 'not-evaluated']);
const PROMOTION_STATUSES = new Set(['not-eligible', 'eligible', 'promoted', 'duplicate']);
const FAILURE_DIAGNOSTIC_STAGES = new Set(['resolved-url-authorization', 'extract-url-continuity']);
const FAILURE_DIAGNOSTIC_KINDS = new Set([
  'redirect-not-authorized', 'resolved-url-unavailable', 'extract-url-changed',
]);
const PUBLIC_COLLECT_BLOCKED_EXTERNAL_COMMANDS = new Set([
  'public-discover', 'acquire-web', 'materialize-web', 'materialize-wechat',
  'materialize-arxiv', 'collect', 'crawl-seed', 'crawl-next', 'crawl-mark',
]);

function inputValue(input) {
  const requestedCount = Number(input?.requestedCount);
  if (!Number.isSafeInteger(requestedCount) || requestedCount < 1 || requestedCount > 20) {
    throw new Error('PUBLIC_COLLECT_INPUT_INVALID: requestedCount 必须是 1..20 的整数');
  }
  const requiredText = (value, label) => {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`PUBLIC_COLLECT_INPUT_INVALID: ${label} 必须是非空字符串`);
    }
    return value.trim();
  };
  const manualPolicy = input?.manualPolicy || 'pause';
  if (!['pause', 'fail'].includes(manualPolicy)) {
    throw new Error('PUBLIC_COLLECT_INPUT_INVALID: manualPolicy 必须是 pause|fail');
  }
  return {
    query: requiredText(input?.query, 'query'),
    fallbackQuery: requiredText(input?.fallbackQuery, 'fallbackQuery'),
    requestedCount,
    category: String(input?.category || 'general'),
    language: String(input?.language || 'zh-CN'),
    manualPolicy,
  };
}

function inputHash(input) {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function activeRun(session) {
  return session?.task?.publicCollectRun || null;
}

/**
 * public-collect 的「新鲜度」判定。retighten 必须复用本函数而非重新实现：
 * 只有两者用同一谓词，retighten 才能保证「报告成功」等价于「public-collect 真的能开跑」。
 */
export function hasBusinessArtifacts(session) {
  const gate = session?.task?.discoveryGate;
  const inventory = session?.collection?.collection?.items;
  return Boolean(
    (Array.isArray(gate?.runs) && gate.runs.length > 0)
    || (Array.isArray(gate?.observations) && gate.observations.length > 0)
    || (Array.isArray(inventory) && inventory.length > 0)
    || (Array.isArray(session?.crawl?.entries) && session.crawl.entries.length > 0)
    || session?.task?.publicCollectRun,
  );
}

function requireOwnedRun(session, runId) {
  const run = activeRun(session);
  if (!run || run.runId !== runId) {
    throw new Error(`ORCHESTRATION_RUN_NOT_FOUND: ${runId}`);
  }
  if (session.task.activeOrchestrationRunId !== runId
    || session.task.orchestrationEpoch !== run.orchestrationEpoch) {
    throw new Error(`ORCHESTRATION_OWNER_MISMATCH: ${runId}`);
  }
  return run;
}

function requireRevision(run, expectedRevision) {
  if (expectedRevision !== undefined && Number(expectedRevision) !== run.stateRevision) {
    throw new Error(`ORCHESTRATION_REVISION_CONFLICT: expected=${expectedRevision} actual=${run.stateRevision}`);
  }
}

function advanceRevision(session, run) {
  run.stateRevision += 1;
  session.task.stateRevision = run.stateRevision;
  run.updatedAt = new Date().toISOString();
}

function copyRun(run) {
  return JSON.parse(JSON.stringify(run));
}

export function createProbeRun(paths, rawInput) {
  const input = inputValue(rawInput);
  const hash = inputHash(input);
  return withSessionLock(paths, 'public-collect-create', () => {
    const session = loadSession(paths, { persistMigration: false }).session;
    const existing = activeRun(session);
    if (existing) {
      if (existing.inputHash === hash && TERMINAL_RUN_STATUSES.has(existing.status)) {
        return copyRun(existing);
      }
      if (existing.inputHash !== hash) {
        throw new Error('ORCHESTRATION_INPUT_CONFLICT: 同一 session 的 public-collect 输入不可变');
      }
      throw new Error(`ORCHESTRATION_IN_PROGRESS: run=${existing.runId}`);
    }
    if (session?.task?.discoveryGate?.schemaVersion !== '2.0') {
      throw new Error('DISCOVERY_RELEVANCE_MIGRATION_REQUIRED: public-collect 只接受 schema 2.0 session');
    }
    if (session.task.materializationTarget !== 'selected'
      || session.task.requiredContentGranularity !== 'full-text') {
      throw new Error('PUBLIC_COLLECT_SESSION_INVALID: 必须使用 selected + full-text 会话');
    }
    assertDiscoveryQueryMatches(session.task.discoveryGate.topicContract, input.query);
    assertDiscoveryQueryMatches(session.task.discoveryGate.topicContract, input.fallbackQuery);
    if (hasBusinessArtifacts(session)) {
      throw new Error('SESSION_NOT_FRESH: public-collect 需要无既有业务产物的新 session');
    }
    if (session.task.activeOrchestrationRunId) {
      throw new Error(`ORCHESTRATION_IN_PROGRESS: run=${session.task.activeOrchestrationRunId}`);
    }
    session.task.workflow = 'public-collect';
    const now = new Date().toISOString();
    const runId = `public-collect-${crypto.randomUUID()}`;
    const orchestrationEpoch = crypto.randomUUID();
    const totalBudgetMs = Math.min(180_000 + input.requestedCount * 90_000, 600_000);
    const run = {
      schemaVersion: PROBE_RUN_SCHEMA_VERSION,
      runId,
      orchestrationEpoch,
      actionLease: { pid: process.pid, leaseId: crypto.randomUUID(), acquiredAt: now },
      input,
      inputHash: hash,
      requestedCount: input.requestedCount,
      totalBudgetMs,
      remainingBudgetMs: totalBudgetMs,
      status: 'running',
      stateRevision: 1,
      queue: [],
      cursor: 0,
      attempts: [],
      discoveryRounds: [],
      discoveryReservation: null,
      attemptedNormalizedUrls: [],
      deliverableItemIds: [],
      duplicateGroups: [],
      ownedSessionCleanupPending: [],
      startedAt: now,
      updatedAt: now,
      finishedAt: null,
      pause: null,
    };
    session.task.requestedItemCount = input.requestedCount;
    session.task.activeOrchestrationRunId = runId;
    session.task.orchestrationEpoch = orchestrationEpoch;
    session.task.stateRevision = 1;
    session.task.publicCollectRun = run;
    persistSession(paths, session);
    return copyRun(run);
  });
}

export function readProbeRun(paths, runId) {
  const session = loadSession(paths, { persistMigration: false }).session;
  const run = activeRun(session);
  if (!run || (runId && run.runId !== runId)) {
    throw new Error(`ORCHESTRATION_RUN_NOT_FOUND: ${runId || 'current'}`);
  }
  return copyRun(run);
}

function persistedCandidate(session, snapshot) {
  const candidate = session?.task?.discoveryGate?.candidates?.find(
    (entry) => entry.candidateId === snapshot?.candidateId,
  );
  if (!candidate || candidate.discoveryDisposition !== 'probe') {
    throw new Error(`PROBE_CANDIDATE_NOT_AUTHORIZED: ${snapshot?.candidateId || 'missing'}`);
  }
  if (candidate.candidateVersion !== snapshot.candidateVersion
    || candidate.evidenceHash !== snapshot.evidenceHash) {
    throw new Error(`PROBE_CANDIDATE_SNAPSHOT_CONFLICT: ${snapshot.candidateId}`);
  }
  return candidate;
}

function candidateSnapshot(candidate) {
  return {
    candidateId: candidate.candidateId,
    canonicalUrl: candidate.canonicalUrl,
    acquisitionUrls: [...candidate.acquisitionUrls],
    candidateVersion: candidate.candidateVersion,
    evidenceHash: candidate.evidenceHash,
    discoveryDisposition: candidate.discoveryDisposition,
    probePriority: candidate.probePriority,
    verificationRequired: true,
    topicRelevance: candidate.topicRelevance,
  };
}

export function reserveProbeAttempt(paths, runId, snapshot, { expectedRevision } = {}) {
  return withSessionLock(paths, 'public-collect-probe-reserve', () => {
    const session = loadSession(paths, { persistMigration: false }).session;
    const run = requireOwnedRun(session, runId);
    requireRevision(run, expectedRevision);
    if (run.status !== 'running') {
      throw new Error(`ORCHESTRATION_NOT_RUNNING: status=${run.status}`);
    }
    const candidate = persistedCandidate(session, snapshot);
    if (run.attempts.some((attempt) => attempt.candidateId === candidate.candidateId
      && attempt.attemptState !== 'interrupted')) {
      throw new Error(`PROBE_ALREADY_RESERVED: ${candidate.candidateId}`);
    }
    const attempt = {
      attemptId: `probe-${run.attempts.length + 1}`,
      candidateId: candidate.candidateId,
      snapshot: candidateSnapshot(candidate),
      attemptState: 'acquiring',
      acquisitionOutcome: null,
      pageVerification: 'not-evaluated',
      verifiedTopicStatus: 'not-evaluated',
      promotionStatus: 'not-eligible',
      reasonCode: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    run.attempts.push(attempt);
    if (!run.queue.includes(candidate.candidateId)) run.queue.push(candidate.candidateId);
    advanceRevision(session, run);
    persistSession(paths, session);
    return JSON.parse(JSON.stringify(attempt));
  });
}

export function recordProbeDiscoveryRound(paths, runId, round) {
  return withSessionLock(paths, 'public-collect-discovery-round', () => {
    const session = loadSession(paths, { persistMigration: false }).session;
    const run = requireOwnedRun(session, runId);
    if (run.status !== 'running') throw new Error(`ORCHESTRATION_NOT_RUNNING: status=${run.status}`);
    if (run.discoveryRounds.length >= 2) throw new Error('ORCHESTRATION_DISCOVERY_LIMIT_REACHED');
    run.discoveryRounds.push({
      round: run.discoveryRounds.length + 1,
      query: String(round?.query || ''),
      status: round?.status === 'failed' ? 'failed' : 'complete',
      candidateCount: Math.max(0, Number(round?.candidateCount) || 0),
      ...(round?.reasonCode ? { reasonCode: String(round.reasonCode) } : {}),
      finishedAt: new Date().toISOString(),
    });
    run.discoveryReservation = null;
    advanceRevision(session, run);
    persistSession(paths, session);
    return copyRun(run);
  });
}

export function setProbeDiscoveryReservation(paths, runId, { query, channel, phase = 'reserved' }) {
  if (!['online', 'hot'].includes(channel)) {
    throw new Error(`ORCHESTRATION_DISCOVERY_CHANNEL_INVALID: ${channel}`);
  }
  if (!['reserved', 'complete'].includes(phase)) {
    throw new Error(`ORCHESTRATION_DISCOVERY_PHASE_INVALID: ${phase}`);
  }
  return withSessionLock(paths, 'public-collect-discovery-reservation', () => {
    const session = loadSession(paths, { persistMigration: false }).session;
    const run = requireOwnedRun(session, runId);
    if (run.status !== 'running') throw new Error(`ORCHESTRATION_NOT_RUNNING: status=${run.status}`);
    const expectedRound = run.discoveryRounds.length + 1;
    if (run.discoveryReservation
      && (run.discoveryReservation.round !== expectedRound
        || run.discoveryReservation.query !== String(query))) {
      throw new Error('ORCHESTRATION_DISCOVERY_RESERVATION_CONFLICT');
    }
    run.discoveryReservation = {
      round: expectedRound,
      query: String(query),
      channel,
      phase,
      reservedAt: run.discoveryReservation?.reservedAt || new Date().toISOString(),
      ...(phase === 'complete' ? { completedAt: new Date().toISOString() } : {}),
    };
    advanceRevision(session, run);
    persistSession(paths, session);
    return copyRun(run);
  });
}

export function updateProbeBudget(paths, runId, remainingBudgetMs) {
  return withSessionLock(paths, 'public-collect-budget', () => {
    const session = loadSession(paths, { persistMigration: false }).session;
    const run = requireOwnedRun(session, runId);
    const next = Math.max(0, Math.min(run.remainingBudgetMs, Number(remainingBudgetMs) || 0));
    if (next === run.remainingBudgetMs) return copyRun(run);
    run.remainingBudgetMs = next;
    advanceRevision(session, run);
    persistSession(paths, session);
    return copyRun(run);
  });
}

export function pauseProbeRun(paths, runId, pause) {
  return withSessionLock(paths, 'public-collect-pause', () => {
    const session = loadSession(paths, { persistMigration: false }).session;
    const run = requireOwnedRun(session, runId);
    const attempt = run.attempts.find((entry) => entry.attemptId === pause?.attemptId);
    if (!attempt || attempt.attemptState === 'terminal') {
      throw new Error(`PROBE_ATTEMPT_NOT_ACTIVE: ${pause?.attemptId || 'missing'}`);
    }
    run.status = pause?.status === 'infrastructure-blocked'
      ? 'infrastructure-blocked' : 'paused-user-action';
    attempt.attemptState = run.status;
    run.pause = {
      attemptId: attempt.attemptId,
      reasonCode: String(pause?.reasonCode || 'REQUIRES_USER_ACTION'),
      remainingBudgetMs: Math.max(0, Number(pause?.remainingBudgetMs) || 0),
      pausedAt: new Date().toISOString(),
      ...(pause?.ownedSession?.sessionId ? {
        ownedSession: {
          kind: 'browser',
          sessionId: String(pause.ownedSession.sessionId),
        },
      } : {}),
    };
    run.remainingBudgetMs = run.pause.remainingBudgetMs;
    if (pause?.ownedSession?.sessionId) {
      run.ownedSessionCleanupPending = [
        ...(run.ownedSessionCleanupPending || []).filter(
          (entry) => entry?.attemptId !== attempt.attemptId,
        ),
        {
          attemptId: attempt.attemptId,
          kind: 'browser',
          sessionId: String(pause.ownedSession.sessionId),
        },
      ];
    }
    advanceRevision(session, run);
    persistSession(paths, session);
    return copyRun(run);
  });
}

export function blockProbeRun(paths, runId, block) {
  return withSessionLock(paths, 'public-collect-block', () => {
    const session = loadSession(paths, { persistMigration: false }).session;
    const run = requireOwnedRun(session, runId);
    run.status = block?.status === 'paused-user-action'
      ? 'paused-user-action' : 'infrastructure-blocked';
    run.pause = {
      attemptId: null,
      reasonCode: String(block?.reasonCode || 'INFRASTRUCTURE_BLOCKED'),
      remainingBudgetMs: Math.max(0, Number(block?.remainingBudgetMs) || 0),
      pausedAt: new Date().toISOString(),
    };
    run.remainingBudgetMs = run.pause.remainingBudgetMs;
    advanceRevision(session, run);
    persistSession(paths, session);
    return copyRun(run);
  });
}

export function resumeProbeRun(paths, runId) {
  return withSessionLock(paths, 'public-collect-resume', () => {
    const session = loadSession(paths, { persistMigration: false }).session;
    const run = requireOwnedRun(session, runId);
    if (!RESUMABLE_RUN_STATUSES.has(run.status)) {
      throw new Error(`ORCHESTRATION_NOT_RESUMABLE: status=${run.status}`);
    }
    const attempt = run.attempts.find((entry) => entry.attemptId === run.pause?.attemptId);
    if (attempt) attempt.attemptState = 'acquiring';
    run.status = 'running';
    run.pause = null;
    run.actionLease = { pid: process.pid, leaseId: crypto.randomUUID(), acquiredAt: new Date().toISOString() };
    advanceRevision(session, run);
    persistSession(paths, session);
    return copyRun(run);
  });
}

export function claimInterruptedProbeRun(paths, runId) {
  return withSessionLock(paths, 'public-collect-claim-interrupted', () => {
    const session = loadSession(paths, { persistMigration: false }).session;
    const run = requireOwnedRun(session, runId);
    if (run.status !== 'running') throw new Error(`ORCHESTRATION_NOT_RUNNING: status=${run.status}`);
    const leasePid = Number(run.actionLease?.pid);
    if (Number.isSafeInteger(leasePid) && leasePid > 0 && leasePid !== process.pid) {
      try {
        process.kill(leasePid, 0);
        throw new Error(`ORCHESTRATION_ACTION_LEASE_ACTIVE: pid=${leasePid}`);
      } catch (error) {
        if (error?.code !== 'ESRCH') throw error;
      }
    }
    run.actionLease = { pid: process.pid, leaseId: crypto.randomUUID(), acquiredAt: new Date().toISOString() };
    advanceRevision(session, run);
    persistSession(paths, session);
    return copyRun(run);
  });
}

function validateAttemptResult(result) {
  if (!ACQUISITION_OUTCOMES.has(result?.acquisitionOutcome)
    || !PAGE_VERIFICATIONS.has(result?.pageVerification)
    || !TOPIC_STATUSES.has(result?.verifiedTopicStatus)
    || !PROMOTION_STATUSES.has(result?.promotionStatus)
    || typeof result?.reasonCode !== 'string' || !result.reasonCode) {
    throw new Error('PROBE_RESULT_INVALID: terminal probe result 不完整');
  }
  const diagnostic = result.failureDiagnostic;
  if (diagnostic !== undefined && (
    !diagnostic || typeof diagnostic !== 'object' || Array.isArray(diagnostic)
    || !FAILURE_DIAGNOSTIC_STAGES.has(diagnostic.stage)
    || !FAILURE_DIAGNOSTIC_KINDS.has(diagnostic.mismatchKind)
    || typeof diagnostic.requestedUrl !== 'string' || diagnostic.requestedUrl.length > 2_000
    || (diagnostic.resolvedUrl !== null
      && (typeof diagnostic.resolvedUrl !== 'string' || diagnostic.resolvedUrl.length > 2_000))
  )) {
    throw new Error('PROBE_RESULT_INVALID: failureDiagnostic 无效');
  }
}

export function commitProbeAttempt(paths, runId, attemptId, result) {
  validateAttemptResult(result);
  return withSessionLock(paths, 'public-collect-probe-commit', () => {
    const session = loadSession(paths, { persistMigration: false }).session;
    const run = requireOwnedRun(session, runId);
    const attempt = run.attempts.find((entry) => entry.attemptId === attemptId);
    if (!attempt) throw new Error(`PROBE_ATTEMPT_NOT_FOUND: ${attemptId}`);
    if (attempt.attemptState === 'terminal') return JSON.parse(JSON.stringify(attempt));
    Object.assign(attempt, result, {
      attemptState: 'terminal',
      finishedAt: new Date().toISOString(),
    });
    run.ownedSessionCleanupPending = (run.ownedSessionCleanupPending || [])
      .filter((entry) => entry?.attemptId !== attemptId);
    run.cursor += 1;
    run.pause = null;
    run.status = 'running';
    advanceRevision(session, run);
    persistSession(paths, session);
    return JSON.parse(JSON.stringify(attempt));
  });
}

export function finishProbeRun(paths, runId, status, detail = {}) {
  if (!TERMINAL_RUN_STATUSES.has(status)) {
    throw new Error(`ORCHESTRATION_TERMINAL_STATUS_INVALID: ${status}`);
  }
  return withSessionLock(paths, 'public-collect-finish', () => {
    const session = loadSession(paths, { persistMigration: false }).session;
    const run = requireOwnedRun(session, runId);
    if (run.ownedSessionCleanupPending.length > 0) {
      throw new Error('ORCHESTRATION_CLEANUP_PENDING: 仍有命令自有 session/TAB 未清理');
    }
    run.status = status;
    run.finishedAt = new Date().toISOString();
    run.terminalReason = String(detail.reasonCode || (status === 'complete' ? 'REQUESTED_COUNT_REACHED' : 'CANDIDATES_EXHAUSTED'));
    run.pause = null;
    advanceRevision(session, run);
    delete session.task.activeOrchestrationRunId;
    delete session.task.orchestrationEpoch;
    persistSession(paths, session);
    return copyRun(run);
  });
}

export function assertExternalSessionWriteAllowed(paths, command) {
  const session = loadSession(paths, { persistMigration: false }).session;
  assertSessionWorkflowAllowsCommand(session, command);
  if (['status', 'inspect', 'crawl-status'].includes(command)) return;
  if (session.task?.activeOrchestrationRunId) {
    throw new Error(`ORCHESTRATION_IN_PROGRESS: run=${session.task.activeOrchestrationRunId}`);
  }
}

export function assertSessionWorkflowAllowsCommand(session, command) {
  if (session?.task?.workflow === 'public-collect'
    && PUBLIC_COLLECT_BLOCKED_EXTERNAL_COMMANDS.has(command)) {
    throw new Error(`SESSION_OWNED_BY_PUBLIC_COLLECT: command=${command}`);
  }
}

export function summarizeProbeRun(session) {
  const run = activeRun(session);
  if (!run) return null;
  const delivery = summarizePromotedDelivery(session);
  const attempts = Array.isArray(run.attempts) ? run.attempts : [];
  const reservation = run.discoveryReservation;
  return {
    runId: run.runId,
    persistedStatus: run.status,
    effectiveStatus: run.status === 'complete' && delivery.remainingCount > 0
      ? 'invalidated' : run.status,
    requestedItemCount: delivery.requestedItemCount,
    deliverableArticleCount: delivery.deliverableArticleCount,
    remainingCount: delivery.remainingCount,
    attempts: {
      total: attempts.length,
      terminal: attempts.filter((attempt) => attempt.attemptState === 'terminal').length,
      paused: attempts.filter((attempt) => attempt.attemptState === 'paused-user-action').length,
      blocked: attempts.filter((attempt) => attempt.attemptState === 'infrastructure-blocked').length,
    },
    ...(reservation ? {
      discoveryReservation: {
        round: reservation.round,
        query: reservation.query,
        channel: reservation.channel,
        phase: reservation.phase,
      },
    } : {}),
  };
}
