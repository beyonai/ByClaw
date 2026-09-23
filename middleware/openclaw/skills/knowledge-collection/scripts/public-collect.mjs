import { verifyCandidate } from './candidate-verifier.mjs';
import { withJevRun } from './jev/run-context.mjs';
import { selectFeedbackQuery } from './jev/source-plan.mjs';
import { finalizeVerifiedProbeRun, registerArxivAcquisitionVariant } from './collection-state.mjs';
import { summarizePromotedDelivery } from './delivery-state.mjs';
import {
  createProbeRun,
  claimInterruptedProbeRun,
  blockProbeRun,
  commitProbeAttempt,
  pauseProbeRun,
  readProbeRun,
  recordProbeDiscoveryRound,
  reserveProbeAttempt,
  resumeProbeRun,
  setProbeDiscoveryReservation,
  summarizeProbeRun,
  updateProbeBudget,
} from './probe-state.mjs';
import { finalizePublicDiscoveryRound, runPublicDiscover } from './public-discovery.mjs';
import { loadSession, persistSession, withSessionLock } from './session.mjs';
import { cleanupProbeSession } from './web-acquirer.mjs';
import { rankCandidates } from './jev/candidate-ranker.mjs';
import { collectionFeedback, schedulingEvidence, collectedPublicCandidates } from './jev/delivery-policy.mjs';
import { researchEvidenceContext } from './jev/research-evidence.mjs';

const MAX_DISCOVERY_ROUNDS = 2;

function resultFor(paths) {
  const session = loadSession(paths, { persistMigration: false }).session;
  const summary = summarizeProbeRun(session);
  return {
    ok: true,
    action: 'public-collect',
    runId: summary.runId,
    status: summary.persistedStatus,
    effectiveStatus: summary.effectiveStatus,
    requestedItemCount: summary.requestedItemCount,
    deliverableArticleCount: summary.deliverableArticleCount,
    remainingCount: summary.remainingCount,
    attempts: summary.attempts,
    terminalReason: session.task.publicCollectRun.terminalReason || null,
    pause: session.task.publicCollectRun.pause || null,
  };
}

function unattemptedCandidates(session, run) {
  const attempted = new Set(run.attempts.map((attempt) => attempt.candidateId));
  const observations = new Map((session.task.discoveryGate.observations || [])
    .map((observation) => [observation.observationId, observation]));
  const rank = (candidate) => Math.min(...(candidate.observationIds || [])
    .map((id) => Number(observations.get(id)?.rank)).filter(Number.isFinite), Number.MAX_SAFE_INTEGER);
  return (session.task.discoveryGate.candidates || [])
    .filter((candidate) => candidate.discoveryDisposition === 'probe'
      && !attempted.has(candidate.candidateId))
    .sort((left, right) => {
      const priority = { high: 0, normal: 1 };
      return (priority[left.probePriority] ?? 2) - (priority[right.probePriority] ?? 2)
        || rank(left) - rank(right)
        || left.canonicalUrl.localeCompare(right.canonicalUrl);
    });
}

function discoveryArgs(run, query, poolTarget) {
  return {
    query,
    category: run.input.category,
    language: run.input.language,
    'requested-count': String(run.requestedCount),
    'max-results': String(poolTarget),
  };
}

function prepareCandidate(paths, candidate) {
  let canonical;
  try {
    canonical = new URL(candidate.canonicalUrl);
  } catch {
    return candidate;
  }
  if (canonical.hostname !== 'arxiv.org'
    || candidate.acquisitionUrls.some((url) => /^https:\/\/arxiv\.org\/html\//iu.test(url))) {
    return candidate;
  }
  const match = /^\/(?:abs|pdf)\/(.+?)(?:\.pdf)?\/?$/iu.exec(canonical.pathname);
  if (!match) return candidate;
  return registerArxivAcquisitionVariant(paths, {
    sourceUrl: candidate.canonicalUrl,
    acquisitionUrl: `https://arxiv.org/html/${match[1]}`,
  });
}

export function runPublicCollect(paths, rawInput, options = {}) {
  return withJevRun(() => runPublicCollectInContext(paths, rawInput, options));
}

async function runPublicCollectInContext(paths, rawInput, options = {}) {
  const now = options.now || Date.now;
  const startedAt = now();
  const requestedRunId = rawInput?.runId || rawInput?.['run-id'];
  const resumeRequested = rawInput?.resume === true || rawInput?.resume === 'true';
  const skipRequested = rawInput?.skip === true || rawInput?.skip === 'true';
  const continuation = Boolean(requestedRunId || resumeRequested || skipRequested);
  if (continuation && (!requestedRunId || resumeRequested === skipRequested)) {
    throw new Error('PUBLIC_COLLECT_INPUT_INVALID: 恢复形式必须提供 --run-id，并且 --resume/--skip 二选一');
  }
  if (continuation && (rawInput?.query || rawInput?.fallbackQuery || rawInput?.['fallback-query']
    || rawInput?.requestedCount || rawInput?.['requested-count'])) {
    throw new Error('PUBLIC_COLLECT_INPUT_INVALID: 新运行参数不能与恢复形式混用');
  }
  const normalizedInput = continuation ? null : {
    query: rawInput?.query,
    fallbackQuery: rawInput?.fallbackQuery || rawInput?.['fallback-query'],
    requestedCount: Number(rawInput?.requestedCount ?? rawInput?.['requested-count']),
    category: rawInput?.category,
    language: rawInput?.language,
    manualPolicy: rawInput?.manualPolicy || rawInput?.['manual-policy'],
  };
  let run;
  let invocationBudgetMs;
  const remainingBudgetMs = () => Math.max(0, invocationBudgetMs - Math.max(0, now() - startedAt));
  if (continuation) {
    run = readProbeRun(paths, requestedRunId);
    invocationBudgetMs = Number(run.remainingBudgetMs);
    if (!['paused-user-action', 'infrastructure-blocked'].includes(run.status)
      && !(resumeRequested && run.status === 'running')) {
      throw new Error(`ORCHESTRATION_NOT_RESUMABLE: status=${run.status}`);
    }
    if (skipRequested && run.pause?.attemptId !== null) {
      const pausedAttemptId = run.pause?.attemptId;
      run = resumeProbeRun(paths, run.runId, { skip: true });
      const attempt = run.attempts.find((entry) => entry.attemptId === pausedAttemptId);
      if (!attempt) throw new Error('PROBE_ATTEMPT_NOT_ACTIVE: paused attempt missing');
      const owned = run.ownedSessionCleanupPending?.find(
        (entry) => entry?.attemptId === attempt.attemptId,
      );
      if (owned?.kind === 'browser') {
        const cleanup = options.cleanup || cleanupProbeSession;
        try {
          await cleanup(owned.sessionId, { runProcess: options.runProcess });
        } catch {
          pauseProbeRun(paths, run.runId, {
            attemptId: attempt.attemptId,
            status: 'infrastructure-blocked',
            reasonCode: 'PROBE_BROWSER_CLEANUP_FAILED',
            ownedSession: owned,
            remainingBudgetMs: remainingBudgetMs(),
          });
          return resultFor(paths);
        }
      }
      commitProbeAttempt(paths, run.runId, attempt.attemptId, {
        acquisitionOutcome: 'skipped',
        pageVerification: 'not-evaluated',
        verifiedTopicStatus: 'not-evaluated',
        promotionStatus: 'not-eligible',
        reasonCode: 'USER_SKIPPED',
      });
      run = readProbeRun(paths, run.runId);
    } else if (run.status !== 'running') {
      run = resumeProbeRun(paths, run.runId, { skip: skipRequested });
    } else {
      run = claimInterruptedProbeRun(paths, run.runId);
    }
  } else {
    run = createProbeRun(paths, normalizedInput);
    invocationBudgetMs = Number(run.remainingBudgetMs);
  }
  if (['complete', 'partial', 'failed'].includes(run.status)) return resultFor(paths);
  if (!continuation && ['paused-user-action', 'infrastructure-blocked'].includes(run.status)) {
    run = resumeProbeRun(paths, run.runId);
  }
  if (!Number.isFinite(invocationBudgetMs)) invocationBudgetMs = Math.min(180_000 + run.requestedCount * 90_000, 600_000);
  const poolTarget = Math.min(Math.max(run.requestedCount * 3, 5), 50);
  const maxProbes = Math.min(poolTarget * 2, 100);
  const discover = options.discover || ((targetPaths, args, context) => runPublicDiscover(
    targetPaths,
    { ...args, timeout: String(Math.max(1, Math.ceil(context.remainingBudgetMs / 1_000))) },
    { orchestrationRunId: context.runId, channelMode: context.channel, remainingBudgetMs,
      environment: options.environment || process.env },
  ));
  const managedDiscoveryGate = !options.discover;
  const verify = options.verify || ((targetPaths, attempt, context) => verifyCandidate(
    targetPaths, attempt, { remainingBudgetMs: context.remainingBudgetMs, environment: options.environment || process.env },
  ));
  let lastFailure = null;
  let lastFeedbackCount = 0;
  let scheduledIds = [];
  const chooseCandidate = async (session, currentRun, available) => {
    const feedback = collectionFeedback(session, currentRun);
    const failedTail = feedback.slice(-2);
    const finishedCount = currentRun.attempts.filter((attempt) => attempt.finishedAt).length;
    if (available.length > 1 && finishedCount >= lastFeedbackCount + 2
      && failedTail.length === 2 && failedTail.every((row) => !row.delivered)) {
      lastFeedbackCount = finishedCount;
      const deadline = now() + Math.min(2000, remainingBudgetMs() / 20);
      const ranked = await (options.rankCandidates || rankCandidates)(session.task.query,
        schedulingEvidence(session, available), {
          optimizeDelivery: true, feedback, collectedCandidates: collectedPublicCandidates(session),
          evidenceContext: researchEvidenceContext(session, options.environment || process.env),
          environment: options.environment || process.env,
          remainingBudgetMs: () => Math.max(0, Math.min(deadline - now(), remainingBudgetMs())),
        });
      scheduledIds = ranked.diagnostic.status === 'used' ? ranked.candidates.map((candidate) => candidate.candidateId) : [];
      withSessionLock(paths, 'public-collect-scheduling', () => {
        const current = loadSession(paths, { persistMigration: false }).session;
        if (current.task.publicCollectRun?.runId !== currentRun.runId) return;
        current.task.publicCollectRun.scheduling = { ...ranked.diagnostic, afterAttemptCount: finishedCount,
          candidateIds: scheduledIds.slice(0, 100) };
        persistSession(paths, current);
      });
    }
    // Authorization/priority are owned by the existing state machine; only reorder peers.
    return available.find((candidate) => candidate.origin === 'user-provided')
      || scheduledIds.map((id) => available.find((candidate) => candidate.candidateId === id
        && candidate.probePriority === available[0]?.probePriority)).find(Boolean)
      || available[0];
  };
  const executeVerification = async (attemptId) => {
    try {
      return await verify(paths, { runId: run.runId, attemptId }, {
        remainingBudgetMs: remainingBudgetMs(),
      });
    } catch (error) {
      pauseProbeRun(paths, run.runId, {
        attemptId,
        status: 'infrastructure-blocked',
        reasonCode: 'VERIFIER_INFRASTRUCTURE_FAILED',
        remainingBudgetMs: remainingBudgetMs(),
      });
      return { attemptState: 'infrastructure-blocked' };
    } finally {
      updateProbeBudget(paths, run.runId, remainingBudgetMs());
    }
  };

  const resumedAttempt = run.attempts.find((attempt) => attempt.attemptState === 'acquiring');
  if (resumedAttempt) {
    const resumedCandidate = loadSession(paths, { persistMigration: false }).session
      .task.discoveryGate.candidates.find((candidate) => candidate.candidateId === resumedAttempt.candidateId);
    if (resumedCandidate) prepareCandidate(paths, resumedCandidate);
    const outcome = await executeVerification(resumedAttempt.attemptId);
    if (['paused-user-action', 'infrastructure-blocked'].includes(outcome?.attemptState)) {
      return resultFor(paths);
    }
  }

  if (!continuation) {
    while (true) {
      run = readProbeRun(paths, run.runId);
      const session = loadSession(paths, { persistMigration: false }).session;
      const deliveryNow = summarizePromotedDelivery(session);
      if (deliveryNow.remainingCount === 0) break;
      if (run.attempts.length >= maxProbes || remainingBudgetMs() <= 0) {
        lastFailure = 'TOTAL_BUDGET_EXHAUSTED';
        break;
      }
      const direct = unattemptedCandidates(session, run)
        .find((candidate) => candidate.origin === 'user-provided');
      if (!direct) break;
      const next = prepareCandidate(paths, direct);
      const attempt = reserveProbeAttempt(paths, run.runId, next, {
        expectedRevision: readProbeRun(paths, run.runId).stateRevision,
      });
      const outcome = await executeVerification(attempt.attemptId);
      if (['paused-user-action', 'infrastructure-blocked'].includes(outcome?.attemptState)) {
        return resultFor(paths);
      }
      if (outcome?.reasonCode === 'REQUIRES_USER_ACTION_UNATTENDED') {
        lastFailure = outcome.reasonCode;
        break;
      }
    }
  }

  while (readProbeRun(paths, run.runId).discoveryRounds.length < MAX_DISCOVERY_ROUNDS) {
    run = readProbeRun(paths, run.runId);
    const delivery = summarizePromotedDelivery(loadSession(paths).session);
    if (delivery.remainingCount === 0) break;
    if (run.attempts.length >= maxProbes || remainingBudgetMs() <= 0) {
      lastFailure = 'TOTAL_BUDGET_EXHAUSTED';
      break;
    }
    const roundIndex = run.discoveryRounds.length;
    let query = run.discoveryReservation?.query || (roundIndex === 0 ? run.input.query : run.input.fallbackQuery);
    if (roundIndex > 0 && !run.discoveryReservation) {
      const current = loadSession(paths, { persistMigration: false }).session;
      const selected = await selectFeedbackQuery({ query: run.input.query, fallbackQuery: run.input.fallbackQuery,
        subject: current.task.discoveryGate.topicContract?.normalizedSubject,
        feedback: collectionFeedback(current, run) }, { environment: options.environment || process.env,
        callJev: options.callJev, remainingBudgetMs });
      query = selected.query;
    }
    let channel = run.discoveryReservation?.channel || 'online';
    let roundCandidateCount = 0;
    while (channel) {
      let nextHotWave = Boolean(channel === 'hot' && readProbeRun(paths, run.runId).hotSourcePlan?.nextWave);
      const channelAlreadyComplete = readProbeRun(paths, run.runId).discoveryReservation?.channel === channel
        && readProbeRun(paths, run.runId).discoveryReservation?.phase === 'complete';
      if (!channelAlreadyComplete) {
        setProbeDiscoveryReservation(paths, run.runId, { query, channel, phase: 'reserved' });
        try {
          const discovery = await discover(paths, discoveryArgs(run, query, poolTarget), {
            runId: run.runId, round: roundIndex + 1, poolTarget, channel,
            remainingBudgetMs: remainingBudgetMs(),
          });
          nextHotWave = discovery?.nextHotWave === true;
          updateProbeBudget(paths, run.runId, remainingBudgetMs());
          if (discovery?.requiresUserAction) {
            blockProbeRun(paths, run.runId, {
              status: 'paused-user-action', reasonCode: 'DISCOVERY_REQUIRES_USER_ACTION',
              remainingBudgetMs: remainingBudgetMs(),
            });
            return { ...resultFor(paths), requiresUserAction: discovery.requiresUserAction };
          }
          if (discovery?.infrastructureBlocked) {
            blockProbeRun(paths, run.runId, {
              reasonCode: 'DISCOVERY_INFRASTRUCTURE_FAILED', remainingBudgetMs: remainingBudgetMs(),
            });
            return resultFor(paths);
          }
          setProbeDiscoveryReservation(paths, run.runId, { query, channel, phase: 'complete' });
        } catch (error) {
          lastFailure = 'DISCOVERY_INFRASTRUCTURE_FAILED';
          blockProbeRun(paths, run.runId, {
            reasonCode: lastFailure,
            remainingBudgetMs: remainingBudgetMs(),
          });
          return resultFor(paths);
        }
      }

      while (true) {
        run = readProbeRun(paths, run.runId);
        const session = loadSession(paths, { persistMigration: false }).session;
        const deliveryNow = summarizePromotedDelivery(session);
        if (deliveryNow.remainingCount === 0) break;
        if (run.attempts.length >= maxProbes || remainingBudgetMs() <= 0) {
          lastFailure = 'TOTAL_BUDGET_EXHAUSTED';
          break;
        }
        const available = unattemptedCandidates(session, run);
        roundCandidateCount = Math.max(roundCandidateCount, available.length);
        const discovered = await chooseCandidate(session, run, available);
        if (remainingBudgetMs() <= 0) {
          lastFailure = 'TOTAL_BUDGET_EXHAUSTED';
          break;
        }
        const next = discovered ? prepareCandidate(paths, discovered) : null;
        if (!next) break;
        const attempt = reserveProbeAttempt(paths, run.runId, next, {
          expectedRevision: readProbeRun(paths, run.runId).stateRevision,
        });
        const outcome = await executeVerification(attempt.attemptId);
        if (['paused-user-action', 'infrastructure-blocked'].includes(outcome?.attemptState)) {
          return resultFor(paths);
        }
        if (outcome?.reasonCode === 'REQUIRES_USER_ACTION_UNATTENDED') {
          lastFailure = outcome.reasonCode;
          break;
        }
      }
      const afterChannel = summarizePromotedDelivery(loadSession(paths).session);
      if (afterChannel.remainingCount === 0 || lastFailure) channel = null;
      else if (channel === 'online') channel = 'hot';
      else if (nextHotWave) channel = 'hot';
      else channel = null;
      if (channel) setProbeDiscoveryReservation(paths, run.runId, { query, channel, phase: 'reserved' });
    }
    if (managedDiscoveryGate) {
      finalizePublicDiscoveryRound(paths, {
        orchestrationRunId: run.runId, query, category: run.input.category,
      });
    }
    recordProbeDiscoveryRound(paths, run.runId, {
      query, status: 'complete', candidateCount: roundCandidateCount,
    });
    if (lastFailure === 'TOTAL_BUDGET_EXHAUSTED') break;
    if (lastFailure === 'REQUIRES_USER_ACTION_UNATTENDED') break;
  }

  const finalDelivery = summarizePromotedDelivery(loadSession(paths).session);
  const status = finalDelivery.remainingCount === 0
    ? 'complete' : (finalDelivery.deliverableArticleCount > 0 ? 'partial' : 'failed');
  finalizeVerifiedProbeRun(paths, run.runId, status, {
    reasonCode: finalDelivery.remainingCount === 0
      ? 'REQUESTED_COUNT_REACHED' : (lastFailure || 'CANDIDATES_EXHAUSTED'),
  });
  return resultFor(paths);
}
