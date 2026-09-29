import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createDiscoveryAuthorization } from './discovery-authorization.mjs';
import { runPublicCollect } from './public-collect.mjs';
import { runPublicDiscover } from './public-discovery.mjs';
import { verifyCandidate } from './candidate-verifier.mjs';
import { blockProbeRun, createProbeRun, pauseProbeRun, readProbeRun, reserveProbeAttempt } from './probe-state.mjs';
import { ensureSessionSkeleton, loadSession, newSession, persistSession, sessionPaths } from './session.mjs';
import { sourcePlanIdentity } from './jev/source-plan.mjs';
import { runHotDiscoveryWave } from './hot-discovery-runtime.mjs';
import { searchHotDiscovery } from '../references/online-search/references/hot_discovery/scripts/hot_discovery.mjs';

const input = { query: 'DeepSeek', fallbackQuery: 'DeepSeek architecture', requestedCount: 1,
  category: 'it', language: 'en', manualPolicy: 'pause' };
const disabled = { TYPESAFE_ENABLED: 'false' };
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'discovery-recovery-'));
  ensureSessionSkeleton(root);
  const session = newSession({ query: 'DeepSeek', sourceScope: ['public-internet'],
    materializationTarget: 'selected', requiredContentGranularity: 'full-text',
    discoveryGate: createDiscoveryAuthorization({ query: 'DeepSeek' }) });
  writeFileSync(join(root, 'session.json'), JSON.stringify(session));
  return sessionPaths(root);
}
function addCandidate(paths, id) {
  const session = loadSession(paths).session;
  const url = `https://example.com/article/${id}`;
  const candidate = { candidateId: id, canonicalUrl: url, acquisitionUrls: [url], candidateVersion: 1,
    evidenceHash: id.padEnd(64, 'a'), discoveryDisposition: 'probe', probePriority: 'normal',
    verificationRequired: true, topicRelevance: { status: 'matched' }, origin: 'public-discover' };
  session.task.discoveryGate.candidates.push(candidate);
  persistSession(paths, session);
  return candidate;
}
const unavailable = (paths, attempt) => verifyCandidate(paths, attempt, { environment: disabled,
  acquire: async () => ({ status: 'unavailable', reasonCode: 'HTTP_FAILED' }) });

for (const channel of ['online', 'hot']) {
  for (const failure of ['challenge', 'infrastructure']) {
    test(`${channel} ${failure} resume retries the unfinished channel and preserves two rounds`, async () => {
      const paths = setup();
      let blocked = false;
      const calls = [];
      const discover = async (_paths, args, context) => {
        calls.push([args.query, context.channel]);
        if (!blocked && context.channel === channel) {
          blocked = true;
          if (failure === 'infrastructure') throw Error('fixture unavailable');
          return { requiresUserAction: { kind: 'captcha', source: 'github' } };
        }
        return {};
      };
      const paused = await runPublicCollect(paths, input, { environment: disabled, discover });
      assert.equal(paused.status, failure === 'challenge' ? 'paused-user-action' : 'infrastructure-blocked');
      const before = calls.length;
      const finished = await runPublicCollect(paths, { 'run-id': paused.runId, resume: true },
        { environment: disabled, discover });
      assert.deepEqual(calls[before], [input.query, channel]);
      assert.equal(finished.status, 'failed');
      assert.deepEqual(readProbeRun(paths).discoveryRounds.map((round) => round.query), [input.query, input.fallbackQuery]);
      assert.equal(readProbeRun(paths).remainingBudgetMs <= paused.pause.remainingBudgetMs, true);
    });
  }
}

test('discovery skip retains authorized candidates, skips blocked channel, and keeps original fallback', async () => {
  const paths = setup();
  const calls = [];
  const discover = async (_paths, args, context) => {
    calls.push([args.query, context.channel]);
    if (calls.length === 1) {
      addCandidate(paths, 'retained');
      return { requiresUserAction: { kind: 'captcha', source: 'online' } };
    }
    return {};
  };
  const paused = await runPublicCollect(paths, input, { environment: disabled, discover });
  const finished = await runPublicCollect(paths, { 'run-id': paused.runId, skip: true },
    { environment: disabled, discover, verify: unavailable });
  assert.equal(finished.status, 'failed');
  assert.equal(finished.attempts.terminal, 1);
  assert.deepEqual(calls, [[input.query, 'online'], [input.query, 'hot'],
    [input.fallbackQuery, 'online'], [input.fallbackQuery, 'hot']]);
});

test('invalid discovery skip leaves pause, ownership, and budget unchanged', async () => {
  for (const pauseShape of ['no-reservation', 'missing-attempt-id', 'missing-pause']) {
    const paths = setup();
    const run = createProbeRun(paths, input);
    blockProbeRun(paths, run.runId, { remainingBudgetMs: 1234 });
    const malformed = loadSession(paths).session;
    if (pauseShape === 'missing-attempt-id') delete malformed.task.publicCollectRun.pause.attemptId;
    if (pauseShape === 'missing-pause') malformed.task.publicCollectRun.pause = null;
    persistSession(paths, malformed);
    const before = loadSession(paths).session;
    await assert.rejects(runPublicCollect(paths, { 'run-id': run.runId, skip: true }), /DISCOVERY|ATTEMPT/);
    assert.deepEqual(loadSession(paths).session, before);
  }
});

test('probe skip cleanup failure charges elapsed time and retry retains remaining budget', async () => {
  const paths = setup();
  const run = createProbeRun(paths, input);
  const attempt = reserveProbeAttempt(paths, run.runId, addCandidate(paths, 'cleanup'));
  pauseProbeRun(paths, run.runId, { attemptId: attempt.attemptId, remainingBudgetMs: 10000,
    ownedSession: { sessionId: 'owned-cleanup' } });
  let clock = 0;
  const paused = await runPublicCollect(paths, { 'run-id': run.runId, skip: true }, {
    environment: disabled, now: () => clock, cleanup: async () => { clock += 250; throw Error('cleanup failed'); },
  });
  assert.equal(paused.status, 'infrastructure-blocked');
  assert.equal(readProbeRun(paths).remainingBudgetMs, 9750);
  const finished = await runPublicCollect(paths, { 'run-id': run.runId, skip: true }, {
    environment: disabled, now: () => clock, cleanup: async (id) => { assert.equal(id, 'owned-cleanup'); clock += 100; },
    discover: async () => ({}),
  });
  assert.equal(finished.status, 'failed');
  assert.equal(readProbeRun(paths).remainingBudgetMs, 9650);
  assert.equal(readProbeRun(paths).attempts[0].acquisitionOutcome, 'skipped');
  assert.deepEqual(readProbeRun(paths).ownedSessionCleanupPending, []);
});

function hotFixture(sources, { failure = 'challenge', now, onInvoke = () => {}, browserSources = [] } = {}) {
  const calls = [];
  let challenge = true;
  const declarations = { adapters: sources.map((site) => ({ site, cmd: 'search', tier: 1,
    dimensions: ['general', 'it'], urlColumn: 'url', titleColumn: 'title', metricColumns: [] })) };
  const bycli = {
    loadRuntime: async () => ({ version: 'v1', catalog: new Map(sources.map((site) => [`${site}/search`, {
      browser: browserSources.includes(site), columns: ['url', 'title'], args: [{ name: 'limit' }],
    }])) }),
    ensureBridge: async () => ({ ok: true }),
    invoke: async (_bin, args, timeoutMs) => {
      const site = args[0];
      calls.push(site);
      onInvoke(site, timeoutMs);
      if (challenge && site === sources[1]) {
        if (failure === 'infrastructure') throw Error('fixture transport disconnected');
        return { code: 1, stdout: '', stderr: 'code: CAPTCHA\n' };
      }
      return { code: 0, stdout: JSON.stringify([{ url: `https://example.com/article/${site}`, title: `DeepSeek ${site}` }]) };
    },
  };
  const runner = async (spec) => {
    const argv = Object.fromEntries(Array.from({ length: (spec.args.length - 2) / 2 }, (_, index) => [
      spec.args[2 + index * 2].slice(2), spec.args[3 + index * 2],
    ]));
    return { code: 0, stdout: JSON.stringify(await searchHotDiscovery(argv, { declarations, bycli, now, executableIdentity: 'fixture' })) };
  };
  return { calls, runner, resolve: () => { challenge = false; } };
}

for (const recovery of ['resume', 'skip']) {
  test(`real hot checkpoint ${recovery} preserves completed source and continues the same wave`, async () => {
    const paths = setup();
    const fixture = hotFixture(['a', 'b', 'c']);
    const args = { query: 'DeepSeek', dimensions: 'general', sources: 'a,b,c', limit: '1',
      'minimum-attempts': '3',
      'state-dir': paths.inputDir, 'run-id': 'fixture-run', 'wave-id': 'fixture-wave' };
    const spec = { args: ['runner', 'search', ...Object.entries(args).flatMap(([key, value]) => [`--${key}`, value])] };
    const first = JSON.parse((await runHotDiscoveryWave(spec, fixture.runner)).stdout);
    assert.equal(first.requiresUserAction?.source, 'b');
    fixture.resolve();
    const second = JSON.parse((await runHotDiscoveryWave(spec, fixture.runner, { recovery })).stdout);
    assert.equal(second.requiresUserAction, undefined);
    assert.equal(second.status, 'complete');
    if (recovery === 'resume') assert.equal(second.warnings.some((value) => value.startsWith('insufficient-profile-coverage')), false);
    assert.deepEqual(fixture.calls, recovery === 'resume' ? ['a', 'b', 'b', 'c'] : ['a', 'b', 'c']);
    assert.deepEqual(second.candidates.map((row) => row.title), recovery === 'resume'
      ? ['DeepSeek a', 'DeepSeek b', 'DeepSeek c'] : ['DeepSeek a', 'DeepSeek c']);
    const replay = JSON.parse((await runHotDiscoveryWave(spec, async () => assert.fail('complete wave must replay'), { recovery })).stdout);
    assert.equal(replay.replayedFromCheckpoint, true);
  });
}

for (const planned of [false, true]) {
  for (const recovery of ['resume', 'skip']) {
    for (const failure of ['challenge', 'infrastructure']) {
    test(`public hot ${planned ? 'planned' : 'legacy'} ${failure} ${recovery} retains checkpoint identity and authorized candidates`, async () => {
      const paths = setup();
      const fixture = hotFixture(['baidu', 'hackernews', 'stackoverflow'], { failure });
      const waves = [];
      let continuing = false;
      const discover = (target, args, context) => runPublicDiscover(target, { ...args, sources: 'baidu,hackernews,stackoverflow' }, {
        environment: planned && !continuing ? {} : disabled, orchestrationRunId: context.runId, channelMode: context.channel,
        remainingBudgetMs: () => context.remainingBudgetMs,
        runOnlineSearch: async () => ({ ok: true, document: { query: args.query, results: [] } }),
        ...(planned ? { planSourceWaves: async (planInput) => ({ identity: sourcePlanIdentity(planInput),
          waves: [['baidu', 'hackernews', 'stackoverflow']], diagnostic: { status: 'used' } }) } : {}),
        runProcess: async (spec) => {
          waves.push(spec.args[spec.args.indexOf('--wave-id') + 1]);
          return fixture.runner(spec);
        },
      });
      const paused = await runPublicCollect(paths, input, { environment: disabled, discover, verify: unavailable });
      assert.equal(paused.status, failure === 'challenge' ? 'paused-user-action' : 'infrastructure-blocked');
      const firstRun = readProbeRun(paths);
      if (planned) assert.equal(firstRun.hotSourcePlan.cursor, 0);
      fixture.resolve();
      continuing = true;
      const finished = await runPublicCollect(paths, { 'run-id': paused.runId, [recovery]: true },
        { environment: disabled, discover, verify: unavailable });
      assert.equal(finished.status, 'failed');
      assert.equal(waves[1], waves[0]);
      if (planned) assert.deepEqual(readProbeRun(paths).hotSourcePlan.waveIds, firstRun.hotSourcePlan.waveIds);
      assert.deepEqual(fixture.calls.slice(0, recovery === 'resume' ? 4 : 3), recovery === 'resume'
        ? ['baidu', 'hackernews', 'hackernews', 'stackoverflow'] : ['baidu', 'hackernews', 'stackoverflow']);
      assert.equal(readProbeRun(paths).discoveryRounds.length, 2);
      assert.equal(loadSession(paths).session.task.discoveryGate.attemptCount, 2);
      assert.equal(loadSession(paths).session.task.discoveryGate.candidates.some((row) => row.canonicalUrl.endsWith('/baidu')), true);
    });
    }
  }
}

test('a resumed hot checkpoint spends only its original remaining wave budget', async () => {
  const paths = setup();
  let clock = 0;
  const timeouts = [];
  const fixture = hotFixture(['a', 'b', 'c'], { now: () => clock,
    onInvoke: (_site, timeoutMs) => { timeouts.push(timeoutMs); clock += 1000; } });
  const args = { query: 'DeepSeek', dimensions: 'general', sources: 'a,b,c', limit: '1',
    'total-budget-ms': '10000', 'state-dir': paths.inputDir, 'run-id': 'budget-run', 'wave-id': 'budget-wave' };
  const spec = { args: ['runner', 'search', ...Object.entries(args).flatMap(([key, value]) => [`--${key}`, value])] };
  await runHotDiscoveryWave(spec, fixture.runner);
  clock += 100000; // Human pause time does not consume the active collection budget.
  fixture.resolve();
  await runHotDiscoveryWave(spec, fixture.runner, { recovery: 'resume' });
  assert.deepEqual(timeouts, [9750, 8750, 7750, 6750]);
});

test('real online discovery challenge resumes the same gate without consuming an extra round', async () => {
  const paths = setup();
  const queries = [];
  const discover = (target, args, context) => runPublicDiscover(target, args, {
    environment: disabled, orchestrationRunId: context.runId, channelMode: context.channel,
    runOnlineSearch: async () => {
      queries.push(args.query);
      return { ok: true, document: { query: args.query, results: [], ...(queries.length === 1
        ? { requiresUserAction: { kind: 'captcha', source: 'online' } } : {}) } };
    },
    runProcess: async () => ({ code: 0, stdout: JSON.stringify({ candidates: [] }) }),
  });
  const paused = await runPublicCollect(paths, input, { environment: disabled, discover });
  assert.equal(paused.status, 'paused-user-action');
  const finished = await runPublicCollect(paths, { 'run-id': paused.runId, resume: true }, { environment: disabled, discover });
  assert.equal(finished.status, 'failed');
  assert.deepEqual(queries, [input.query, input.query, input.fallbackQuery]);
  assert.equal(loadSession(paths).session.task.discoveryGate.attemptCount, 2);
});

for (const failure of ['challenge', 'infrastructure']) {
  for (const changedJev of ['disabled', 'unavailable', 'different']) {
    test(`real online effective request survives ${failure} with Jev ${changedJev}`, async () => {
      const paths = setup();
      const requests = [];
      let continuing = false;
      let jevCalls = 0;
      const discover = (target, args, context) => runPublicDiscover(target, args, {
        environment: context.channel === 'hot' || (continuing && changedJev === 'disabled') ? disabled : {},
        orchestrationRunId: context.runId, channelMode: context.channel,
        runProcess: async () => ({ code: 0, stdout: JSON.stringify({ candidates: [] }) }),
        callJev: async ({ questions }) => {
          jevCalls++;
          if (continuing && changedJev === 'unavailable') throw Error('offline Jev unavailable');
          const choices = { query: continuing ? 'q0' : 'q1', category: 'c0', timeRange: 't0', source: continuing ? 's0' : 's1' };
          return { ok: true, document: { answers: Object.fromEntries(Object.keys(questions).map((field) => [field,
            { type: 'choice', choice: choices[field], confidence: 0.99 }])) } };
        },
        runOnlineSearch: async (request) => {
          const persisted = readProbeRun(paths).onlineDiscoveryExecution;
          assert.equal(persisted?.effective.query, request.query);
          assert.equal(persisted?.effective.source, request.source || 'automatic');
          requests.push({ ...request });
          if (!continuing) {
            if (failure === 'infrastructure') throw Error('offline transport unavailable');
            return { ok: true, document: { query: request.query, results: [],
              requiresUserAction: { kind: 'captcha', source: 'github' } } };
          }
          return { ok: true, document: { query: request.query, results: [] } };
        },
      });
      const paused = await runPublicCollect(paths, { ...input, query: 'DeepSeek architecture', fallbackQuery: 'DeepSeek inference' },
        { environment: disabled, discover });
      assert.equal(paused.status, failure === 'challenge' ? 'paused-user-action' : 'infrastructure-blocked');
      assert.equal(requests[0].query, 'DeepSeek');
      assert.equal(requests[0].source, 'github');
      assert.equal(jevCalls, 1);
      continuing = true;
      const finished = await runPublicCollect(paths, { 'run-id': paused.runId, resume: true }, { environment: disabled, discover });
      assert.equal(finished.status, 'failed');
      assert.deepEqual(requests[1], requests[0]);
      assert.equal(requests[2].query, 'DeepSeek inference');
      assert.equal(requests[2].source, undefined);
      assert.equal(requests.length, 3);
      assert.equal(jevCalls, changedJev === 'disabled' ? 1 : 2);
      assert.equal(loadSession(paths).session.task.discoveryGate.attemptCount, 2);
      assert.deepEqual(readProbeRun(paths).discoveryRounds.map((round) => round.query), ['DeepSeek architecture', 'DeepSeek inference']);
      assert.equal(readProbeRun(paths).remainingBudgetMs <= paused.pause.remainingBudgetMs, true);
    });
  }
}

test('online continuation rejects invalid effective parameters and changed request identity before dispatch', async () => {
  for (const change of ['query', 'category', 'language', 'timeRange', 'source', 'identity', 'page', 'topic']) {
    const paths = setup();
    let continuing = false;
    let dispatched = 0;
    const errors = [];
    const discover = async (target, args, context) => {
      try {
        return await runPublicDiscover(target, { ...args, ...(continuing && change === 'page' ? { pageno: '2' } : {}) }, {
          environment: disabled, orchestrationRunId: context.runId, channelMode: context.channel,
          runOnlineSearch: async (request) => {
            dispatched++;
            return { ok: true, document: { query: request.query, results: [],
              requiresUserAction: { kind: 'captcha', source: 'online' } } };
          },
        });
      } catch (error) { errors.push(error); throw error; }
    };
    const paused = await runPublicCollect(paths, input, { environment: disabled, discover });
    assert.equal(paused.status, 'paused-user-action');
    const current = loadSession(paths).session;
    const execution = current.task.publicCollectRun.onlineDiscoveryExecution;
    assert.ok(execution, 'effective request must be durable before provider dispatch');
    if (change === 'identity') execution.identity = 'unrelated-request';
    else if (change === 'topic') current.task.discoveryGate.topicContract.normalizedSubject = 'unrelated topic';
    else if (change !== 'page') execution.effective[change] = 'outside-authorized-options';
    persistSession(paths, current);
    continuing = true;
    const resumed = await runPublicCollect(paths, { 'run-id': paused.runId, resume: true }, { environment: disabled, discover });
    assert.equal(resumed.status, 'infrastructure-blocked');
    assert.equal(dispatched, 1, change);
    assert.match(errors[0]?.message || '', /ONLINE_DISCOVERY_EXECUTION_INVALID/, change);
    assert.equal(readProbeRun(paths).discoveryRounds.length, 0);
  }
});

test('exhausted hot recovery preserves completed source snapshots without launching new work', async () => {
  const paths = setup();
  let clock = 0;
  const fixture = hotFixture(['a', 'b', 'c'], { now: () => clock, onInvoke: () => { clock += 1000; } });
  const args = { query: 'DeepSeek', dimensions: 'general', sources: 'a,b,c', limit: '1',
    'total-budget-ms': '2000', 'state-dir': paths.inputDir, 'run-id': 'exhausted-run', 'wave-id': 'exhausted-wave' };
  const spec = { args: ['runner', 'search', ...Object.entries(args).flatMap(([key, value]) => [`--${key}`, value])] };
  await runHotDiscoveryWave(spec, fixture.runner);
  fixture.resolve();
  const recovered = JSON.parse((await runHotDiscoveryWave(spec, fixture.runner, { recovery: 'resume' })).stdout);
  assert.deepEqual(fixture.calls, ['a', 'b']);
  assert.equal(recovered.stopReason, 'budget_exhausted');
  assert.equal(recovered.adapterStats.a.status, 'ok');
  assert.equal(recovered.candidates.length, 1);
});

test('infrastructure skip identifies the interrupted source when execution differs from declaration order', async () => {
  const paths = setup();
  const fixture = hotFixture(['a', 'b', 'c'], { failure: 'infrastructure', browserSources: ['a'] });
  const args = { query: 'DeepSeek', dimensions: 'general', limit: '1',
    'state-dir': paths.inputDir, 'run-id': 'order-run', 'wave-id': 'order-wave' };
  const spec = { args: ['runner', 'search', ...Object.entries(args).flatMap(([key, value]) => [`--${key}`, value])] };
  await runHotDiscoveryWave(spec, fixture.runner);
  fixture.resolve();
  const recovered = JSON.parse((await runHotDiscoveryWave(spec, fixture.runner, { recovery: 'skip' })).stdout);
  assert.deepEqual(fixture.calls, ['b', 'c', 'a']);
  assert.equal(recovered.adapterStats.b.status, 'user_skipped');
  assert.equal(recovered.candidates.length, 2);
});

for (const profile of [false, true]) {
  for (const recovery of ['resume', 'skip']) {
    test(`persisted ${profile ? 'profile' : 'generic'} legacy ${recovery} ignores newly valid source advice`, async () => {
      const paths = setup();
      if (profile) {
        const session = loadSession(paths).session;
        session.task.query = '采集关于 DeepSeek 的文章';
        persistSession(paths, session);
      }
      const request = { ...input, ...(profile ? { category: 'general', language: 'zh-CN' } : {}) };
      const sources = profile ? ['36kr', 'weixin', 'sogou', 'baidu', 'bing'] : ['baidu', 'hackernews', 'stackoverflow'];
      let clock = 0;
      const timeouts = [];
      const fixture = hotFixture(sources, { now: () => clock,
        onInvoke: (_source, timeoutMs) => { timeouts.push(timeoutMs); clock += 1000; } });
      const waves = [];
      const documents = [];
      let sourcePlans = 0;
      let queryPlans = 0;
      const discover = async (target, args, context) => {
        if (context.round > 1) return {}; // The regression concerns continuation of the original round.
        return runPublicDiscover(target, { ...args, sources: sources.join(','), timeout: '10' }, {
          environment: {}, orchestrationRunId: context.runId, channelMode: context.channel,
          budgetNow: () => 0, now: () => clock,
          runOnlineSearch: async () => ({ ok: true, document: { query: args.query, results: [] } }),
          planDiscovery: async (planning) => {
            queryPlans++;
            return { effective: { query: planning.query, category: planning.category, language: planning.language,
              timeRange: planning.timeRange, source: 'automatic' }, jev: { status: 'fallback' } };
          },
          planSourceWaves: async (planning) => {
            sourcePlans++;
            return { identity: sourcePlanIdentity(planning),
              waves: sourcePlans === 1 ? [] : [sources.slice(0, 3), ...(profile ? [sources.slice(3)] : [])],
              diagnostic: { status: 'used' } };
          },
          runProcess: async (spec) => {
            waves.push(spec.args[spec.args.indexOf('--wave-id') + 1]);
            const result = await fixture.runner(spec);
            documents.push(JSON.parse(result.stdout));
            return result;
          },
        });
      };
      const paused = await runPublicCollect(paths, request, { environment: disabled, now: () => clock, discover, verify: unavailable });
      assert.equal(paused.status, 'paused-user-action');
      assert.equal(sourcePlans, 1);
      assert.equal(readProbeRun(paths).hotSourcePlan, undefined);
      const queryPlansBefore = queryPlans;
      fixture.resolve();
      clock += 100000;
      const finished = await runPublicCollect(paths, { 'run-id': paused.runId, [recovery]: true },
        { environment: disabled, now: () => clock, discover, verify: unavailable });
      assert.equal(finished.status, 'failed');
      assert.equal(sourcePlans, 1);
      assert.equal(queryPlans, queryPlansBefore);
      assert.equal(waves[1], waves[0]);
      assert.deepEqual(fixture.calls, [sources[0], sources[1], ...(recovery === 'resume' ? [sources[1]] : []), ...sources.slice(2)]);
      assert.equal(documents[1].adapterStats[sources[0]].status, 'ok');
      assert.equal(documents[1].adapterStats[sources[1]].status, recovery === 'resume' ? 'ok' : 'user_skipped');
      assert.equal(documents[1].candidates.some((row) => row.url.endsWith(`/${sources[0]}`)), true);
      assert.deepEqual(timeouts.slice(0, 3), [7250, 6250, 5250]);
      assert.equal(readProbeRun(paths).discoveryRounds.length, 2);
    });
  }
}
