import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ensureSessionSkeleton, loadSession, newSession, sessionPaths } from './session.mjs';
import { createDiscoveryAuthorization } from './discovery-authorization.mjs';
import {
  createProbeRun, recordProbeDiscoveryRound, setProbeDiscoveryReservation,
} from './probe-state.mjs';
import * as publicDiscovery from './public-discovery.mjs';
import { planSourceWaves } from './jev/source-plan.mjs';
import { safeCallJev } from './jev/safe-call.mjs';
import { currentJevRun, withJevRun } from './jev/run-context.mjs';
import { runHotDiscoveryWave } from './hot-discovery-runtime.mjs';
import { createHotRuntimeState, hotRequestIdentity } from '../references/online-search/references/hot_discovery/scripts/hot_runtime_state.mjs';

const { runPublicDiscover } = publicDiscovery;

test('invalid source plan uses the exact generic legacy command without a source subset', async () => {
  for (const response of [{ waves: [['invented']], diagnostic: { status: 'used' } },
    { waves: null, diagnostic: { status: 'fallback', code: 'JEV_SELECTION_INVALID_OR_UNCERTAIN' } }]) {
    const { paths } = makeInitializedSession(['public-internet'], 'DeepSeek');
    let calls = 0;
    const result = await runPublicDiscover(paths, { query: 'DeepSeek', category: 'it', 'requested-count': '1' }, {
      environment: {}, channelMode: 'hot', planSourceWaves: async () => response,
      runProcess: async (spec) => {
        calls++;
        assert.equal(spec.args.includes('--sources'), false);
        assert.equal(spec.args[spec.args.indexOf('--query') + 1], 'DeepSeek');
        return { code: 0, stdout: JSON.stringify({ candidates: [] }) };
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.nextHotWave, false);
  }
});

test('exhaustive public discovery bypasses optional source plans', async () => {
  const { paths } = makeInitializedSession(['public-internet'], 'DeepSeek');
  const session = loadSession(paths).session;
  session.task.materializationTarget = 'all';
  writeFileSync(join(paths.root, 'session.json'), JSON.stringify(session));
  let called = false;
  await runPublicDiscover(paths, { query: 'DeepSeek', 'requested-count': '1' }, {
    environment: {}, channelMode: 'hot', planSourceWaves: async () => { called = true; },
    runProcess: async () => ({ code: 0, stdout: JSON.stringify({ candidates: [] }) }),
  });
  assert.equal(called, false);
});

test('a persisted hot wave checkpoint is consumed before re-dispatching its completed sources', async () => {
  const { paths } = makeInitializedSession(['public-internet'], 'DeepSeek');
  const directory = paths.inputDir;
  const args = { query: 'DeepSeek', dimensions: 'it', tiers: '1', limit: '1', sources: 'github',
    'state-dir': directory, 'run-id': 'run', 'wave-id': 'wave' };
  const state = await createHotRuntimeState({ directory, runId: 'run', waveId: 'wave', requestIdentity: hotRequestIdentity(args) });
  await state.saveCheckpoint({ channel: 'hot_discovery', query: 'DeepSeek', status: 'complete', candidates: [], adapterStats: { github: { status: 'ok_empty' } } });
  let calls = 0;
  const result = await runHotDiscoveryWave({ args: ['runner', 'search', ...Object.entries(args).flatMap(([key, value]) => [`--${key}`, value])] },
    async () => { calls++; return { code: 1 }; });
  assert.equal(calls, 0);
  assert.equal(JSON.parse(result.stdout).adapterStats.github.status, 'ok_empty');
});

test('validated generic plan checkpoints disjoint source waves under one discovery round', async () => {
  const { paths } = makeInitializedSession(['public-internet'], 'DeepSeek');
  const session = loadSession(paths).session;
  session.task.materializationTarget = 'selected';
  session.task.requiredContentGranularity = 'full-text';
  writeFileSync(join(paths.root, 'session.json'), JSON.stringify(session));
  const run = createProbeRun(paths, { query: 'DeepSeek', fallbackQuery: 'DeepSeek architecture', requestedCount: 1,
    category: 'it', language: 'en', manualPolicy: 'pause' });
  const args = { query: 'DeepSeek', category: 'it', language: 'en', 'requested-count': '1' };
  const seen = [];
  let plans = 0;
  const options = { environment: {}, orchestrationRunId: run.runId, channelMode: 'hot',
    runProcess: async (spec) => {
      const index = spec.args.indexOf('--sources');
      assert.ok(index >= 0);
      seen.push(spec.args[index + 1].split(','));
      return { code: 0, stdout: JSON.stringify({ candidates: [], adapterStats: {}, status: 'complete' }) };
    },
  };
  // Valid plans must use bounded complete permutations, so let the real planner split it.
  options.planSourceWaves = async (input, opts) => {
    plans++;
    return planSourceWaves(input, { ...opts, environment: {}, callJev: async () => ({ ok: true,
      document: { answers: { plan: { type: 'choice', choice: 'p1', confidence: 0.95 } } } }) });
  };
  let result;
  do {
    setProbeDiscoveryReservation(paths, run.runId, { query: args.query, channel: 'hot' });
    result = await runPublicDiscover(paths, args, options);
  } while (result.nextHotWave);
  assert.equal(plans, 1);
  assert.ok(seen.length > 1);
  assert.ok(seen.every((wave) => wave.length <= 3));
  assert.equal(new Set(seen.flat()).size, seen.flat().length);
  assert.equal(loadSession(paths).session.task.discoveryGate.attemptCount, 1);
});

test('resumed source waves retain their cursor and IDs without fresh query or source inference', async () => {
  for (const resume of ['changed-answer', 'inference-failure', 'disabled', 'model-change']) {
    const { paths } = makeInitializedSession(['public-internet'], '采集一篇关于米哈游的文章');
    const session = loadSession(paths).session;
    session.task.materializationTarget = 'selected';
    session.task.requiredContentGranularity = 'full-text';
    writeFileSync(join(paths.root, 'session.json'), JSON.stringify(session));
    const run = createProbeRun(paths, { query: '米哈游 报道', fallbackQuery: '米哈游 实践', requestedCount: 1,
      category: 'general', language: 'zh-CN', manualPolicy: 'pause' });
    const args = { query: '米哈游 报道', category: 'general', language: 'zh-CN', 'requested-count': '1' };
    const waves = [];
    let queryPlans = 0;
    let sourcePlans = 0;
    const base = { orchestrationRunId: run.runId, channelMode: 'hot', environment: {},
      planDiscovery: async (input) => {
        queryPlans++;
        return { effective: { ...input, source: 'automatic', hotSource: queryPlans === 1 ? 'bing' : 'weixin' },
          jev: { status: 'used' } };
      },
      planSourceWaves: async (input, options) => {
        sourcePlans++;
        return planSourceWaves(input, { ...options, environment: {}, callJev: async () => ({ ok: true,
          document: { answers: { plan: { type: 'choice', choice: 'p0', confidence: 0.95 } } } }) });
      },
      runProcess: async (spec) => {
        const value = (flag) => spec.args[spec.args.indexOf(flag) + 1];
        waves.push({ sources: value('--sources'), waveId: value('--wave-id') });
        return { code: 0, stdout: JSON.stringify({ candidates: [], status: 'complete' }) };
      },
    };
    setProbeDiscoveryReservation(paths, run.runId, { query: args.query, channel: 'hot' });
    const first = await runPublicDiscover(paths, args, base);
    assert.equal(first.nextHotWave, true);
    const admitted = loadSession(paths).session.task.publicCollectRun.hotSourcePlan;
    assert.equal(admitted.cursor, 1);
    assert.equal(waves[0].waveId, admitted.waveIds[0]);
    setProbeDiscoveryReservation(paths, run.runId, { query: args.query, channel: 'hot' });
    const options = { ...base, environment: resume === 'disabled' ? { TYPESAFE_ENABLED: 'false' }
      : resume === 'model-change' ? { TYPESAFE_MODEL: 'jev-other' } : {},
      planDiscovery: resume === 'inference-failure'
        ? async () => { throw Error('inference unavailable'); } : base.planDiscovery };
    await runPublicDiscover(paths, args, options);
    assert.equal(queryPlans, 1, resume);
    assert.equal(sourcePlans, 1, resume);
    assert.deepEqual(waves.map((wave) => wave.sources.split(',')), admitted.waves);
    assert.equal(waves[1].waveId, admitted.waveIds[1]);
  }
});

test('science query planning admits every science and general source and resumes its exact waves', async () => {
  const { paths } = makeInitializedSession(['public-internet'], 'DeepSeek paper');
  const session = loadSession(paths).session;
  session.task.materializationTarget = 'selected';
  session.task.requiredContentGranularity = 'full-text';
  writeFileSync(join(paths.root, 'session.json'), JSON.stringify(session));
  const run = createProbeRun(paths, { query: 'DeepSeek paper', fallbackQuery: 'DeepSeek research',
    requestedCount: 1, category: 'general', language: 'en', manualPolicy: 'pause' });
  const args = { query: 'DeepSeek paper', language: 'en', 'requested-count': '1' };
  const expectedSources = ['openalex', 'baidu', 'bing', 'brave', 'duckduckgo', 'google', 'yahoo',
    'toutiao', 'weixin', 'yandex', 'so', 'sogou', '52pojie', 'hupu', 'google-scholar',
    'baidu-scholar', 'wanfang', 'zhihu', 'tieba', 'weibo', 'xiaohongshu', 'rednote',
    '1point3acres', 'cnki'];
  let queryPlans = 0;
  let sourcePlans = 0;
  let offeredSources;
  const dispatched = [];
  const options = { environment: {}, orchestrationRunId: run.runId, channelMode: 'hot',
    planDiscovery: async (input) => {
      queryPlans++;
      return { effective: { ...input, category: queryPlans === 1 ? 'science' : 'news',
        source: 'automatic' }, jev: { status: 'used' } };
    },
    planSourceWaves: (input, plannerOptions) => {
      sourcePlans++;
      offeredSources = input.sources;
      assert.deepEqual(plannerOptions.sourceMetadata.map((row) => row.site), input.sources);
      return planSourceWaves(input, { ...plannerOptions, environment: {}, callJev: async () => ({
        ok: true, document: { answers: { plan: { type: 'choice', choice: 'p0', confidence: 0.95 } } },
      }) });
    },
    runProcess: async (spec) => {
      const value = (flag) => spec.args[spec.args.indexOf(flag) + 1];
      dispatched.push({ sources: value('--sources'), waveId: value('--wave-id') });
      return { code: 0, stdout: JSON.stringify({ candidates: [], status: 'complete' }) };
    },
  };
  setProbeDiscoveryReservation(paths, run.runId, { query: args.query, channel: 'hot' });
  const first = await runPublicDiscover(paths, args, options);
  assert.equal(first.nextHotWave, true);
  assert.deepEqual(offeredSources, expectedSources);
  const admitted = loadSession(paths).session.task.publicCollectRun.hotSourcePlan;
  assert.deepEqual(admitted.waves.flat(), expectedSources);
  assert.equal(admitted.cursor, 1);
  setProbeDiscoveryReservation(paths, run.runId, { query: args.query, channel: 'hot' });
  await runPublicDiscover(paths, args, { ...options,
    planDiscovery: async () => { throw Error('resume cannot call fresh planner'); },
    planSourceWaves: async () => { throw Error('resume cannot create a new source plan'); } });
  assert.equal(queryPlans, 1);
  assert.equal(sourcePlans, 1);
  assert.deepEqual(dispatched.map((row) => row.sources.split(',')), admitted.waves.slice(0, 2));
  assert.deepEqual(dispatched.map((row) => row.waveId), admitted.waveIds.slice(0, 2));
});

test('failed full plan restores hot-source preference without changing the selected query or category', async () => {
  const { paths } = makeInitializedSession(['public-internet'], '采集一篇关于米哈游的文章');
  const session = loadSession(paths).session;
  session.task.materializationTarget = 'selected';
  writeFileSync(join(paths.root, 'session.json'), JSON.stringify(session));
  const args = { query: '米哈游 报道', category: 'general', language: 'zh-CN', 'requested-count': '1' };
  const selectedQuery = '采集一篇关于米哈游的文章';
  let plannerCalls = 0;
  const sources = [];
  const result = await runPublicDiscover(paths, args, {
    environment: {}, channelMode: 'hot',
    planDiscovery: async (input, options) => {
      plannerCalls++;
      if (plannerCalls === 1) {
        assert.equal(options.deferHotSource, true);
        return { effective: { query: selectedQuery, category: 'news', timeRange: null, source: 'automatic' },
          jev: { status: 'used' } };
      }
      assert.equal(options.deferHotSource, undefined);
      assert.deepEqual(input.queryCandidates, [selectedQuery]);
      assert.deepEqual(input.categoryCandidates, ['news']);
      return { effective: { query: 'wrong', category: 'science', timeRange: 'day', source: 'github', hotSource: 'bing' },
        jev: { status: 'used' } };
    },
    planSourceWaves: async () => ({ waves: null, diagnostic: { status: 'fallback', code: 'TEST_INVALID_PLAN' } }),
    runProcess: async (spec) => {
      sources.push(spec.args.includes('--sources') ? spec.args[spec.args.indexOf('--sources') + 1] : null);
      return { code: 0, stdout: JSON.stringify({ candidates: [] }) };
    },
  });
  assert.equal(result.query, selectedQuery);
  assert.equal(result.category, 'news');
  assert.equal(plannerCalls, 2);
  assert.deepEqual(sources, ['bing,36kr,weixin', 'sogou', 'baidu']);
});

test('managed online and hot phases reuse planning without an unused hot-source question', async () => {
  const { paths } = makeInitializedSession(['public-internet'], '采集一篇关于米哈游的文章');
  const session = loadSession(paths).session;
  session.task.materializationTarget = 'selected';
  session.task.requiredContentGranularity = 'full-text';
  writeFileSync(join(paths.root, 'session.json'), JSON.stringify(session));
  const run = createProbeRun(paths, { query: '米哈游 报道', fallbackQuery: '米哈游 案例', requestedCount: 1,
    category: 'general', language: 'zh-CN', manualPolicy: 'pause' });
  const args = { query: run.input.query, category: 'general', language: 'zh-CN', 'requested-count': '1' };
  const asked = [];
  const callJev = async (payload) => {
    const fields = Object.keys(payload.questions);
    asked.push(fields);
    assert.equal(fields.includes('hotSource'), false);
    const answers = Object.fromEntries(fields.map((field) => [field, {
      type: 'choice', choice: `${{ query: 'q', category: 'c', timeRange: 't', source: 's', plan: 'p' }[field]}0`,
      confidence: 0.95,
    }]));
    return { ok: true, document: { answers } };
  };
  const common = { orchestrationRunId: run.runId, environment: {}, callJev,
    runOnlineSearch: async () => ({ ok: true, document: { results: [] } }),
    runProcess: async () => ({ code: 0, stdout: JSON.stringify({ candidates: [] }) }),
  };
  await withJevRun(async () => {
    setProbeDiscoveryReservation(paths, run.runId, { query: args.query, channel: 'online' });
    await runPublicDiscover(paths, args, { ...common, channelMode: 'online' });
    setProbeDiscoveryReservation(paths, run.runId, { query: args.query, channel: 'hot' });
    await runPublicDiscover(paths, args, { ...common, channelMode: 'hot' });
  });
  assert.equal(asked.filter((fields) => fields.includes('plan')).length, 1);
  assert.equal(asked.length, 2);
  assert.equal(loadSession(paths).session.task.discoveryGate.attemptCount, 1);
});

test('corrupt persisted wave IDs discard the plan and use the legacy hot command', async () => {
  const { paths } = makeInitializedSession(['public-internet'], 'DeepSeek');
  const session = loadSession(paths).session;
  session.task.materializationTarget = 'selected';
  session.task.requiredContentGranularity = 'full-text';
  writeFileSync(join(paths.root, 'session.json'), JSON.stringify(session));
  const run = createProbeRun(paths, { query: 'DeepSeek', fallbackQuery: 'DeepSeek architecture',
    requestedCount: 1, category: 'it', language: 'en', manualPolicy: 'pause' });
  const args = { query: 'DeepSeek', category: 'it', language: 'en', 'requested-count': '1' };
  const seen = [];
  const options = { environment: {}, orchestrationRunId: run.runId, channelMode: 'hot',
    planSourceWaves: (input, opts) => planSourceWaves(input, { ...opts, environment: {},
      callJev: async () => ({ ok: true, document: { answers: {
        plan: { type: 'choice', choice: 'p0', confidence: 0.95 },
      } } }) }),
    runProcess: async (spec) => {
      seen.push(spec.args);
      return { code: 0, stdout: JSON.stringify({ candidates: [], status: 'complete' }) };
    },
  };
  setProbeDiscoveryReservation(paths, run.runId, { query: args.query, channel: 'hot' });
  await runPublicDiscover(paths, args, options);
  const current = loadSession(paths).session;
  current.task.publicCollectRun.hotSourcePlan.waveIds[1] = 'forged-but-syntactically-plausible';
  writeFileSync(join(paths.root, 'session.json'), JSON.stringify(current));
  setProbeDiscoveryReservation(paths, run.runId, { query: args.query, channel: 'hot' });
  const resumed = await runPublicDiscover(paths, args, { ...options,
    planDiscovery: async () => { throw Error('corrupt plan cannot request fresh inference'); },
    planSourceWaves: async () => { throw Error('corrupt plan cannot be re-planned'); } });
  assert.equal(resumed.queryPlanning.code, 'SOURCE_PLAN_INVALID');
  assert.equal(seen.at(-1).includes('--sources'), false);
});

test('planning reuse respects cancellation, budget and an open run circuit', async () => {
  for (const gate of ['cancelled', 'budget', 'circuit']) {
    const { paths } = makeInitializedSession(['public-internet'], 'DeepSeek');
    const planningCache = new Map();
    let calls = 0;
    let planningStatus;
    const planDiscovery = async (input, options) => {
      calls++;
      const response = await safeCallJev({ state: { query: input.query }, questions: {
        source: { type: 'choice', criteria: { github: 'github' } },
      } }, { ...options, callJev: async () => ({ ok: true, document: {
        answers: { source: { type: 'choice', choice: 'github', confidence: 0.95 } },
      } }) });
      planningStatus = response.ok ? 'used' : response.diagnostic.status;
      return response.ok
        ? { effective: { ...input, source: 'github' }, jev: { status: 'used' } }
        : { effective: { ...input, source: 'automatic' }, jev: response.diagnostic };
    };
    await withJevRun(async () => {
      await runPublicDiscover(paths, { query: 'DeepSeek' }, {
        environment: {}, channelMode: 'online', planningCache, planDiscovery,
        runOnlineSearch: async () => ({ ok: true, document: { results: [] } }),
      });
      if (gate === 'circuit') await safeCallJev({ state: { fail: true }, questions: {
        fail: { type: 'choice', criteria: { yes: 'yes' } },
      } }, { environment: {}, callJev: async () => { throw Error('transport failure'); } });
      const controller = new AbortController();
      if (gate === 'cancelled') controller.abort();
      const discover = runPublicDiscover(paths, { query: 'DeepSeek' }, {
        environment: {}, channelMode: 'hot', planningCache, planDiscovery,
        signal: controller.signal, remainingBudgetMs: gate === 'budget' ? () => 0 : undefined,
        runProcess: async () => ({ code: 0, stdout: JSON.stringify({ candidates: [] }) }),
      });
      if (gate === 'budget') await assert.rejects(discover, /未返回有效结果/);
      else await discover;
      assert.notEqual(planningStatus, 'used', gate);
    });
    assert.equal(calls, 2, gate);
  }
});

test('standalone sequential discovery bounds hot by the remaining invocation budget', async () => {
  const { paths } = makeInitializedSession(['public-internet'], 'DeepSeek');
  let elapsed = 0;
  let hotTimeout;
  await runPublicDiscover(paths, { query: 'DeepSeek', 'requested-count': '1', timeout: '1' }, {
    environment: {}, budgetNow: () => elapsed,
    runOnlineSearch: async () => { elapsed = 800; return { ok: true, document: { results: [] } }; },
    runProcess: async (spec, options) => {
      hotTimeout = options.timeoutMs;
      assert.ok(Number(spec.args[spec.args.indexOf('--total-budget-ms') + 1]) <= 200);
      return { code: 0, stdout: JSON.stringify({ candidates: [] }) };
    },
  });
  assert.ok(hotTimeout > 0 && hotTimeout <= 200);
});

test('terminated hot process recovers only its own checkpoint and stops later waves at a gate', async () => {
  const { paths } = makeInitializedSession(['public-internet'], '采集一篇关于米哈游的文章');
  let calls = 0;
  const result = await runPublicDiscover(paths, {
    query: '米哈游 报道', category: 'general', language: 'zh-CN', 'requested-count': '1',
  }, { environment: {}, channelMode: 'hot', runProcess: async (spec) => {
    calls++;
    const args = Object.fromEntries(Array.from({ length: (spec.args.length - 2) / 2 }, (_, index) => [
      spec.args[2 + index * 2].slice(2), spec.args[3 + index * 2],
    ]));
    assert.equal(args['state-dir'], paths.inputDir);
    const store = await createHotRuntimeState({ directory: args['state-dir'],
      runId: args['run-id'], waveId: args['wave-id'], requestIdentity: hotRequestIdentity(args) });
    await store.saveCheckpoint({ channel: 'hot_discovery', query: args.query,
      candidates: [{ url: 'https://example.com/news/mihoyo', title: '米哈游深度报道', discoveredBy: ['bycli:36kr'] }],
      adapterStats: { '36kr': { status: 'ok' } },
      requiresUserAction: { kind: 'captcha', source: 'weixin' },
    });
    return { code: 1, stdout: '', stderr: 'timeout after 100ms', timedOut: true };
  } });
  assert.equal(calls, 1);
  assert.equal(result.channels.hotDiscovery.status, 'partial');
  assert.equal(result.channels.hotDiscovery.recoveredFromCheckpoint, true);
  assert.equal(result.requiresUserAction.kind, 'captcha');
  assert.ok(result.discoveryAuthorization.probeCandidateCount > 0);
});

test('hot wave state shares only run identity, never checkpoint identity', async () => {
  const { paths } = makeInitializedSession(['public-internet'], '采集一篇关于米哈游的文章');
  const flags = [];
  await runPublicDiscover(paths, { query: '米哈游 报道', category: 'general', language: 'zh-CN', 'requested-count': '1' }, {
    environment: {}, channelMode: 'hot', runProcess: async (spec) => {
      const get = (name) => spec.args[spec.args.indexOf(`--${name}`) + 1];
      flags.push({ run: get('run-id'), wave: get('wave-id') });
      return { code: 0, stdout: JSON.stringify({ candidates: [], adapterStats: {} }) };
    },
  });
  assert.equal(flags.length, 3);
  assert.equal(new Set(flags.map((entry) => entry.run)).size, 1);
  assert.equal(new Set(flags.map((entry) => entry.wave)).size, 3);
});

test('a checkpoint from another request cannot authorize candidates after child failure', async () => {
  const { paths } = makeInitializedSession(['public-internet'], 'DeepSeek');
  await assert.rejects(runPublicDiscover(paths, { query: 'DeepSeek' }, {
    environment: {}, channelMode: 'hot', runProcess: async (spec) => {
      const get = (name) => spec.args[spec.args.indexOf(`--${name}`) + 1];
      const store = await createHotRuntimeState({ directory: get('state-dir'),
        runId: get('run-id'), waveId: get('wave-id'), requestIdentity: 'another-request' });
      await store.saveCheckpoint({ channel: 'hot_discovery', query: 'other',
        candidates: [{ url: 'https://example.com/news/wrong', title: 'DeepSeek' }], adapterStats: {} });
      return { code: 1, stdout: '', stderr: 'interrupted' };
    },
  }), /未返回有效结果/);
  assert.equal(loadSession(paths).session.task.discoveryGate.candidates.length, 0);
});

test('hot-only collection reuses planning and prioritizes the chosen allowed source with fallback coverage', async () => {
  const { paths } = makeInitializedSession(['public-internet'], '采集一篇关于米哈游的文章');
  let plans = 0;
  let inferences = 0;
  const callJev = async () => {
    inferences++;
    return { ok: true, document: {
      answers: { hotSource: { type: 'choice', choice: 'bing', confidence: 0.95 } },
    } };
  };
  const hotSources = [];
  const args = { query: '米哈游 报道', category: 'general', language: 'zh-CN', 'requested-count': '1' };
  const options = {
    environment: {},
    planDiscovery: async (input, plannerOptions) => {
      plans += 1;
      assert.ok(input.hotSourceCandidates.includes('bing'));
      const response = await safeCallJev({ state: { query: input.query }, questions: {
        hotSource: { type: 'choice', criteria: { bing: 'bing' } },
      } }, { ...plannerOptions, callJev });
      return { effective: { ...input, source: 'automatic', hotSource: 'bing' },
        jev: response.ok ? { status: 'used' } : response.diagnostic };
    },
    runOnlineSearch: async () => ({ ok: true, document: { results: [] } }),
    runProcess: async (spec) => {
      hotSources.push(spec.args[spec.args.indexOf('--sources') + 1]);
      return { code: 0, stdout: JSON.stringify({ candidates: [], adapterStats: {} }), stderr: '' };
    },
    merge: () => ({ groups: { bothChannels: [], searxngTop: [] } }),
  };
  await withJevRun(async () => {
    await runPublicDiscover(paths, args, { ...options, channelMode: 'online' });
    const cachedAt = [...currentJevRun().cache.values()][0].at;
    await runPublicDiscover(paths, args, { ...options, channelMode: 'hot',
      runOnlineSearch: () => { throw new Error('hot-only must not invoke online search'); } });
    assert.equal([...currentJevRun().cache.values()][0].at, cachedAt);
  });
  assert.equal(plans, 2);
  assert.equal(inferences, 1);
  assert.deepEqual(hotSources, ['bing,36kr,weixin', 'sogou', 'baidu']);
});

test('ordinary hot discovery receives an internal budget before the outer process deadline', async () => {
  const { paths } = makeInitializedSession(['public-internet'], 'DeepSeek');
  let hotArgs;
  let outerTimeout;
  await runPublicDiscover(paths, { query: 'DeepSeek' }, {
    environment: {},
    runOnlineSearch: async () => ({ ok: false }),
    runProcess: async (spec, options) => {
      hotArgs = spec.args;
      outerTimeout = options.timeoutMs;
      return { code: 0, stdout: JSON.stringify({ candidates: [] }), stderr: '' };
    },
  });
  assert.ok(hotArgs.includes('--total-budget-ms'));
  const budget = Number(hotArgs[hotArgs.indexOf('--total-budget-ms') + 1]);
  assert.ok(budget > 0 && budget < outerTimeout);
  assert.ok(hotArgs.includes('--adapter-timeout-ms'));
});

test('global Jev order reaches authorization across display groups with bounded inference budgets', async () => {
  const { paths } = makeInitializedSession(['public-internet'], 'DeepSeek');
  const researchSession = loadSession(paths).session;
  researchSession.task.followups = ['benchmarks'];
  researchSession.research.branches = [{ status: 'done', query: 'design', researchGoal: 'system design',
    followups: ['tradeoffs'] }];
  writeFileSync(join(paths.root, 'session.json'), JSON.stringify(researchSession));
  const first = { url: 'https://example.com/news/deepseek-one', title: 'DeepSeek 深度报道', engine: 'google' };
  const second = { url: 'https://example.com/news/deepseek-two', title: 'DeepSeek 最新报道', engine: 'bing' };
  await runPublicDiscover(paths, { query: 'DeepSeek', category: 'general' }, {
    environment: {}, remainingBudgetMs: () => 500, budgetNow: () => 0,
    planDiscovery: async (input, options) => {
      assert.deepEqual(input.categoryCandidates, ['general']);
      assert.equal(options.remainingBudgetMs(), 50);
      return { effective: { ...input, source: 'automatic' }, jev: { status: 'used' } };
    },
    rankCandidates: async (_request, candidates, options) => {
      assert.equal(options.remainingBudgetMs(), 50);
      assert.deepEqual(options.evidenceContext, {
        coveredSubtopics: ['system design'], missingSubtopics: ['benchmarks', 'tradeoffs'],
      });
      return { candidates: [...candidates].reverse(), diagnostic: { status: 'used' } };
    },
    runOnlineSearch: async () => ({ ok: true, document: { results: [first, second] } }),
    runProcess: async () => ({ code: 0, stdout: JSON.stringify({ candidates: [] }), stderr: '' }),
    merge: () => ({ groups: { bothChannels: [first], searxngTop: [second] } }),
  });
  const observations = loadSession(paths).session.task.discoveryGate.observations;
  assert.equal(observations[0].url, second.url);
  assert.equal(observations[0].rank, 1);
});

test('planned queries preserve the reservation identity and explicit time range', async () => {
  const { paths } = makeInitializedSession(['public-internet'], '人工智能');
  const result = await runPublicDiscover(paths, { query: '人工智能 报道', 'time-range': 'week' }, {
    environment: {},
    planDiscovery: async (input) => {
      assert.deepEqual(input.timeRangeCandidates, ['week']);
      return { effective: { ...input, query: '人工智能', category: 'it', source: 'automatic' }, jev: { status: 'used' } };
    },
    runOnlineSearch: async (args) => {
      assert.equal(args.query, '人工智能');
      return { ok: true, document: { results: [] } };
    },
    runProcess: async () => ({ code: 0, stdout: JSON.stringify({ candidates: [] }), stderr: '' }),
  });
  assert.equal(result.ok, true);
  const run = loadSession(paths).session.task.discoveryGate.runs.at(-1);
  assert.equal(run.query, '人工智能 报道');
  assert.equal(run.category, 'general');
  assert.notEqual(run.status, 'running');
});

test('selects the bounded Chinese article profile from deterministic task state', () => {
  const session = newSession({
    query: '采集一篇关于米哈游的文章',
    mode: 'collection',
    sourceScope: ['public-internet'],
    discoveryGate: createDiscoveryAuthorization({ query: '采集一篇关于米哈游的文章' }),
  });
  assert.equal(publicDiscovery.isChineseArticleProfile(session, {
    query: '米哈游 报道', category: 'general', language: 'zh-CN', 'requested-count': '1',
  }), true);
  assert.equal(publicDiscovery.isChineseArticleProfile(session, {
    query: '米哈游', category: 'images', language: 'zh-CN', 'requested-count': '1',
  }), false);
  assert.equal(publicDiscovery.isChineseArticleProfile({
    ...session, task: { ...session.task, query: '查找米哈游官网' },
  }, {
    query: '米哈游', category: 'general', language: 'zh-CN', 'requested-count': '1',
  }), false);
});

test('uses the image-wide SearXNG CLI by default', () => {
  assert.deepEqual(
    publicDiscovery.resolveSearxngRuntime({}, {}),
    { executable: 'searxng-cli', argsPrefix: [] },
  );
});

test('prefers explicit SearXNG interpreter overrides over the image-wide command', () => {
  assert.deepEqual(
    publicDiscovery.resolveSearxngRuntime(
      { pythonExecutable: '/custom/python' },
      { ONLINE_SEARCH_PYTHON: '/environment/python' },
    ),
    { executable: '/custom/python', argsPrefix: ['/opt/searxng-cli/searxng_cli.py'] },
  );
  assert.deepEqual(
    publicDiscovery.resolveSearxngRuntime(
      {},
      { ONLINE_SEARCH_PYTHON: '/environment/python' },
    ),
    { executable: '/environment/python', argsPrefix: ['/opt/searxng-cli/searxng_cli.py'] },
  );
});

test('supports an explicit SearXNG script path for local development', () => {
  assert.deepEqual(
    publicDiscovery.resolveSearxngRuntime(
      { pythonExecutable: '/custom/python', searxngScript: '/workspace/searxng_cli.py' },
      { ONLINE_SEARCH_PYTHON: '/environment/python', ONLINE_SEARCH_SCRIPT: '/environment/searxng_cli.py' },
    ),
    { executable: '/custom/python', argsPrefix: ['/workspace/searxng_cli.py'] },
  );
  assert.deepEqual(
    publicDiscovery.resolveSearxngRuntime(
      {},
      { ONLINE_SEARCH_PYTHON: '/environment/python', ONLINE_SEARCH_SCRIPT: '/environment/searxng_cli.py' },
    ),
    { executable: '/environment/python', argsPrefix: ['/environment/searxng_cli.py'] },
  );
});

test('uses the unified online-search runner and exposes compatible provider aliases', async () => {
  const { paths } = makeInitializedSession(['public-internet'], '人工智能');
  let onlineSearchCalls = 0;
  let plannerCalls = 0;
  let rankerCalls = 0;
  const result = await runPublicDiscover(paths, {
    query: '人工智能 报道',
    category: 'general',
    language: 'zh-CN',
    'requested-count': '1',
  }, {
    planDiscovery: async (input) => {
      plannerCalls += 1;
      assert.deepEqual(input.queryCandidates, ['人工智能 报道', '人工智能']);
      return {
        effective: {
          query: input.query,
          category: input.category,
          language: input.language,
          timeRange: input.timeRange,
          source: 'github',
        },
        jev: { status: 'used', model: 'jev-test' },
      };
    },
    rankCandidates: async (_request, candidates) => {
      rankerCalls += 1;
      return { candidates, diagnostic: { status: 'used', model: 'jev-test', candidateCount: candidates.length } };
    },
    runOnlineSearch: async (args) => {
      onlineSearchCalls += 1;
      assert.equal(args.source, 'github');
      return {
        ok: true,
        durationMs: 12,
        document: {
          query: args.query,
          provider: 'tencent-wsa',
          fallbackUsed: false,
          providerDiagnostics: {
            tencentWsa: { status: 'success', durationMs: 12, resultCount: 1, requestId: 'request-1' },
            searxng: { status: 'skipped', durationMs: 0, skipReason: 'primary_provider_succeeded' },
          },
          results: [{
            url: 'https://example.com/news/1234567',
            title: '人工智能深度报道',
            passage: '人工智能产业发展深度报道摘要',
            content: '人工智能产业发展深度报道',
            engine: 'tencent-wsa',
            provider: 'tencent-wsa',
            providerVersion: 'flagship',
            requestId: 'request-1',
            publishedAt: '2026-09-20T08:00:00Z',
            site: 'example.com',
            evidenceLevel: 'search-summary',
          }],
        },
      };
    },
    runProcess: async (spec) => {
      if (spec.channel === 'searxng') {
        return {
          code: 0,
          stdout: JSON.stringify({ query: '人工智能 报道', results: [] }),
          stderr: '',
        };
      }
      return { code: 0, stdout: JSON.stringify({ query: '人工智能 报道', candidates: [] }), stderr: '' };
    },
  });

  assert.equal(onlineSearchCalls, 1);
  assert.equal(plannerCalls, 1);
  assert.equal(rankerCalls, 1);
  assert.deepEqual(result.queryPlanning, { status: 'used', model: 'jev-test' });
  assert.equal(result.candidateRanking.status, 'used');
  assert.equal(result.channels.onlineSearch.provider, 'tencent-wsa');
  assert.equal(result.channels.onlineSearch.fallbackUsed, false);
  assert.deepEqual(result.channels.searxng, result.channels.onlineSearch);
  assert.deepEqual(result.candidateQuality.searxng, result.candidateQuality.onlineSearch);
  assert.equal(result.timing.searxngMs, result.timing.onlineSearchMs);
  assert.equal(result.snapshots.searxng, result.snapshots.onlineSearch);
  assert.equal(result.channels.hotDiscovery.status, 'skipped');
  const persisted = JSON.parse(readFileSync(paths.session, 'utf8'));
  assert.deepEqual(
    persisted.task.discoveryGate.observations.map((observation) => ({
      provider: observation.provider,
      providerVersion: observation.providerVersion,
      requestId: observation.requestId,
      publishedAt: observation.publishedAt,
      passage: observation.passage,
      content: observation.content,
      site: observation.site,
      evidenceLevel: observation.evidenceLevel,
    })),
    [{
      provider: 'tencent-wsa',
      providerVersion: 'flagship',
      requestId: 'request-1',
      publishedAt: '2026-09-20T08:00:00Z',
      passage: '人工智能产业发展深度报道摘要',
      content: '人工智能产业发展深度报道',
      site: 'example.com',
      evidenceLevel: 'search-summary',
    }],
  );
});

test('keeps hot-discovery fallback when WSA returns a valid empty result', async () => {
  const { paths } = makeInitializedSession(['public-internet'], '人工智能');
  const calls = [];
  const result = await runPublicDiscover(paths, {
    query: '人工智能 报道',
    category: 'general',
    language: 'zh-CN',
    'requested-count': '1',
  }, {
    runOnlineSearch: async () => ({
      ok: true,
      document: {
        query: '人工智能 报道',
        provider: 'tencent-wsa',
        fallbackUsed: false,
        providerDiagnostics: {
          tencentWsa: { status: 'success', durationMs: 5, resultCount: 0 },
          searxng: { status: 'skipped', durationMs: 0, skipReason: 'primary_provider_succeeded' },
        },
        results: [],
      },
    }),
    runProcess: async (spec) => {
      calls.push(spec.channel);
      return {
        code: 0,
        stdout: JSON.stringify({ query: '人工智能 报道', candidates: [] }),
        stderr: '',
      };
    },
  });

  assert.deepEqual(calls, ['hot-discovery']);
  assert.equal(result.channels.onlineSearch.status, 'success');
  assert.equal(result.channels.onlineSearch.provider, 'tencent-wsa');
  assert.equal(result.channels.hotDiscovery.status, 'success');
});

test('preserves provider diagnostics when online-search fails and hot-discovery succeeds', async () => {
  const { paths } = makeInitializedSession(['public-internet'], '人工智能');
  const result = await runPublicDiscover(paths, {
    query: '人工智能 报道',
    category: 'general',
    'requested-count': '1',
  }, {
    runOnlineSearch: async () => ({
      ok: false,
      error: { category: 'provider', code: 'ONLINE_SEARCH_FAILED', message: 'both failed' },
      provider: 'searxng',
      fallbackUsed: true,
      providerDiagnostics: {
        tencentWsa: { status: 'failed', code: 'WSA_DISABLED', category: 'unavailable' },
        searxng: { status: 'failed', code: 'SEARXNG_FAILED', category: 'provider' },
      },
    }),
    runProcess: async () => ({
      code: 0,
      stdout: JSON.stringify({ query: '人工智能 报道', candidates: [] }),
      stderr: '',
    }),
  });

  assert.equal(result.channels.onlineSearch.provider, 'searxng');
  assert.equal(result.channels.onlineSearch.fallbackUsed, true);
  assert.equal(result.channels.onlineSearch.providerDiagnostics.tencentWsa.code, 'WSA_DISABLED');
  assert.equal(result.channels.onlineSearch.providerDiagnostics.searxng.code, 'SEARXNG_FAILED');
});

function makeInitializedSession(sourceScope = ['public-internet'], query = '采集一篇文章') {
  const root = mkdtempSync(join(tmpdir(), 'public-discovery-test-'));
  ensureSessionSkeleton(root);
  writeFileSync(join(root, 'session.json'), `${JSON.stringify(newSession({
    query,
    sourceScope,
    materializationTarget: 'candidates',
    ...(sourceScope.includes('public-internet') ? {
      discoveryGate: createDiscoveryAuthorization({ query }),
    } : {}),
  }))}\n`);
  return { root, paths: sessionPaths(root) };
}

test('owned online and hot channels share one gate attempt and fallback uses the second', async () => {
  const { paths } = makeInitializedSession(['public-internet'], 'DeepSeek Harness 文章');
  const session = loadSession(paths).session;
  session.task.materializationTarget = 'selected';
  session.task.requiredContentGranularity = 'full-text';
  writeFileSync(join(paths.root, 'session.json'), `${JSON.stringify(session)}\n`);
  const run = createProbeRun(paths, {
    query: 'DeepSeek Harness 文章', fallbackQuery: 'DeepSeek Harness 工程实践',
    requestedCount: 1, category: 'general', language: 'zh-CN', manualPolicy: 'pause',
  });
  const runOnlineSearch = async (args) => ({
    ok: true,
    document: { query: args.query, results: [] },
  });
  const runProcess = async () => ({ code: 0, stdout: JSON.stringify({ candidates: [] }), stderr: '' });

  setProbeDiscoveryReservation(paths, run.runId, { query: run.input.query, channel: 'online' });
  await runPublicDiscover(paths, { query: run.input.query, category: 'general', 'requested-count': '1' }, {
    orchestrationRunId: run.runId, channelMode: 'online', runOnlineSearch, runProcess,
  });
  assert.equal(loadSession(paths).session.task.discoveryGate.attemptCount, 1);
  assert.equal(loadSession(paths).session.task.discoveryGate.runs[0].status, 'running');

  setProbeDiscoveryReservation(paths, run.runId, { query: run.input.query, channel: 'hot' });
  await runPublicDiscover(paths, { query: run.input.query, category: 'general', 'requested-count': '1' }, {
    orchestrationRunId: run.runId, channelMode: 'hot', runOnlineSearch, runProcess,
  });
  assert.equal(loadSession(paths).session.task.discoveryGate.attemptCount, 1);
  assert.equal(loadSession(paths).session.task.discoveryGate.runs[0].status, 'complete');
  recordProbeDiscoveryRound(paths, run.runId, {
    query: run.input.query, status: 'complete', candidateCount: 0,
  });

  setProbeDiscoveryReservation(paths, run.runId, { query: run.input.fallbackQuery, channel: 'online' });
  await runPublicDiscover(paths, {
    query: run.input.fallbackQuery, category: 'general', 'requested-count': '1',
  }, { orchestrationRunId: run.runId, channelMode: 'online', runOnlineSearch, runProcess });
  assert.equal(loadSession(paths).session.task.discoveryGate.attemptCount, 2);
});

test('owned online channel failure retries the same open gate attempt', async () => {
  const { paths } = makeInitializedSession(['public-internet'], 'DeepSeek Harness 文章');
  const session = loadSession(paths).session;
  session.task.materializationTarget = 'selected';
  session.task.requiredContentGranularity = 'full-text';
  writeFileSync(join(paths.root, 'session.json'), `${JSON.stringify(session)}\n`);
  const run = createProbeRun(paths, {
    query: 'DeepSeek Harness 文章', fallbackQuery: 'DeepSeek Harness 工程实践',
    requestedCount: 1, category: 'general', language: 'zh-CN', manualPolicy: 'pause',
  });
  setProbeDiscoveryReservation(paths, run.runId, { query: run.input.query, channel: 'online' });
  const argumentsValue = { query: run.input.query, category: 'general', 'requested-count': '1' };
  await assert.rejects(runPublicDiscover(paths, argumentsValue, {
    orchestrationRunId: run.runId,
    channelMode: 'online',
    runOnlineSearch: async () => ({ ok: false, error: { code: 'FIXTURE_FAILURE' } }),
  }));
  assert.equal(loadSession(paths).session.task.discoveryGate.attemptCount, 1);
  await runPublicDiscover(paths, argumentsValue, {
    orchestrationRunId: run.runId,
    channelMode: 'online',
    runOnlineSearch: async (args) => ({ ok: true, document: { query: args.query, results: [] } }),
  });
  assert.equal(loadSession(paths).session.task.discoveryGate.attemptCount, 1);
  assert.equal(loadSession(paths).session.task.discoveryGate.runs[0].status, 'running');
});

test('public discovery requires public-internet in the parent source scope', async () => {
  const { paths } = makeInitializedSession(['ima']);
  let called = false;
  await assert.rejects(
    runPublicDiscover(paths, { query: 'q' }, {
      runProcess: async () => { called = true; return { code: 0, stdout: '{}', stderr: '' }; },
    }),
    /sourceScope.*public-internet/,
  );
  assert.equal(called, false);
});

test('default public process runner enforces timeout bounds', async () => {
  assert.equal(typeof publicDiscovery.runBoundedProcess, 'function');
  await assert.rejects(
    publicDiscovery.runBoundedProcess({
      bin: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 100)'],
    }, { timeoutMs: 25 }),
    /timeout after 25ms/,
  );
});

test('public channel runner converts a bound failure into an isolated channel failure', async () => {
  assert.equal(typeof publicDiscovery.runPublicProcess, 'function');
  const outcome = await publicDiscovery.runPublicProcess({
    bin: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 100)'],
  }, { timeoutMs: 25 });
  assert.equal(outcome.code, 1);
  assert.equal(outcome.stdout, '');
  assert.match(outcome.stderr, /timeout after 25ms/);
});

test('runs online search and hot discovery for every online-search category', async () => {
  const { paths } = makeInitializedSession();
  const calls = [];

  const result = await runPublicDiscover(paths, {
    query: 'DeepSeek Harness',
    category: 'images',
    language: 'zh-CN',
    'time-range': 'week',
  }, {
    runProcess: async (spec, options) => {
      calls.push({ spec, options });
      return spec.channel === 'searxng'
        ? { code: 0, stdout: JSON.stringify({ query: 'DeepSeek Harness', results: [] }), stderr: '' }
        : {
          code: 0,
          stdout: JSON.stringify({
            query: 'DeepSeek Harness',
            candidates: [],
            dimensions: ['images'],
            effectiveDimensions: ['images', 'general'],
          }),
          stderr: '',
        };
    },
    merge: ({ hotDoc, sxDoc }) => ({ query: sxDoc.query, effectiveDimensions: hotDoc.effectiveDimensions }),
  });

  assert.deepEqual(calls.map(({ spec }) => spec.channel).sort(), ['hot-discovery', 'searxng']);
  const hotArgs = calls.find(({ spec }) => spec.channel === 'hot-discovery').spec.args;
  assert.equal(hotArgs[hotArgs.indexOf('--dimensions') + 1], 'images');
  const hotTimeout = calls.find(({ spec }) => spec.channel === 'hot-discovery').options.timeoutMs;
  assert.ok(hotTimeout > 0 && hotTimeout < 60_000);
  const searxngCall = calls.find(({ spec }) => spec.channel === 'searxng');
  assert.ok(searxngCall.spec.args.includes('--time-range'));
  assert.ok(searxngCall.spec.args.includes('week'));
  assert.equal(searxngCall.spec.args[searxngCall.spec.args.indexOf('--timeout') + 1], '10');
  assert.ok(searxngCall.options.timeoutMs > 0 && searxngCall.options.timeoutMs <= 60_000);
  assert.equal(result.ok, true);
  assert.deepEqual(result.hotDiscovery.effectiveDimensions, ['images', 'general']);
  assert.equal(existsSync(result.snapshots.searxng), true);
  assert.equal(existsSync(result.snapshots.hotDiscovery), true);
  assert.equal(existsSync(result.snapshots.merged), true);
  const snapshot = JSON.parse(readFileSync(result.snapshots.merged, 'utf8'));
  assert.equal(snapshot.query, 'DeepSeek Harness');
  assert.deepEqual(snapshot.effectiveDimensions, ['images', 'general']);
  assert.equal(snapshot.channelDiagnostics.searxng.status, 'success');
  assert.equal(snapshot.channelDiagnostics.hotDiscovery.status, 'success');
  assert.ok(Number.isInteger(snapshot.timing.totalMs));
  assert.deepEqual(snapshot.candidateQuality.merged, {
    article: 0,
    weak: 0,
    reject: 0,
    eligibleArticle: 0,
    topicRelevance: { matched: 0, unmatched: 0, unknown: 0, notRequired: 0 },
  });
});

test('default merge preserves the source hostname used for acquisition', async () => {
  const { paths } = makeInitializedSession();
  const result = await runPublicDiscover(paths, { query: '浩鲸科技' }, {
    runProcess: async (spec) => spec.channel === 'searxng'
      ? {
        code: 0,
        stdout: JSON.stringify({
          query: '浩鲸科技',
          results: [
            { url: 'https://www.iwhalecloud.com/', title: '浩鲸科技', engine: 'baidu' },
            { url: 'https://iwhalecloud.com/', title: '浩鲸科技', engine: 'bing' },
          ],
        }),
        stderr: '',
      }
      : {
        code: 0,
        stdout: JSON.stringify({ query: '浩鲸科技', candidates: [] }),
        stderr: '',
      },
  });

  const candidate = result.merged.groups.searxngTop[0];
  assert.equal(candidate.url, 'https://www.iwhalecloud.com/');
  assert.deepEqual(candidate.sourceUrls, [
    'https://www.iwhalecloud.com/',
    'https://iwhalecloud.com/',
  ]);
});

test('returns merged user action without discarding successful SearXNG discovery', async () => {
  const { paths } = makeInitializedSession();
  const result = await runPublicDiscover(paths, { query: 'agent' }, {
    runProcess: async (spec) => spec.channel === 'searxng'
      ? {
        code: 0,
        stdout: JSON.stringify({
          query: 'agent',
          results: [{ url: 'https://example.com/a', title: 'A', engine: 'google' }],
        }),
        stderr: '',
      }
      : {
        code: 0,
        stdout: JSON.stringify({
          query: 'agent',
          candidates: [],
          warnings: ['byCLI 浏览器桥接不可用；已停止浏览器适配器并等待人工恢复。'],
          requiresUserAction: {
            kind: 'bridge_unavailable',
            message: 'bridge unavailable',
          },
        }),
        stderr: '',
      },
  });

  const expectedAction = {
    kind: 'bridge_unavailable',
    message: 'bridge unavailable',
    fallbackPolicy: {
      allowDirectHttp: false,
      allowGenericBrowser: false,
      nextAction: 'stop-and-report',
    },
  };
  assert.deepEqual(result.requiresUserAction, expectedAction);
  assert.deepEqual(result.merged.requiresUserAction, expectedAction);
  assert.equal(result.merged.groups.searxngTop.length, 1);
  assert.match(result.merged.warnings.join('\n'), /禁止使用.*HTTP.*通用浏览器.*降级/);
  const mergedSnapshot = JSON.parse(readFileSync(result.snapshots.merged, 'utf8'));
  assert.deepEqual(
    mergedSnapshot.requiresUserAction,
    expectedAction,
  );
  assert.match(mergedSnapshot.warnings.join('\n'), /禁止使用.*HTTP.*通用浏览器.*降级/);
});

test('uses only SearXNG when a requested article count is satisfied', async () => {
  const { paths } = makeInitializedSession();
  const calls = [];
  const result = await runPublicDiscover(paths, {
    query: 'DeepSeek',
    'requested-count': '1',
    'max-results': '20',
  }, {
    runProcess: async (spec, options) => {
      calls.push({ spec, options });
      return {
        code: 0,
        stdout: JSON.stringify({
          query: 'DeepSeek',
          results: [{
            url: 'https://example.com/news/deepseek-report',
            title: 'DeepSeek 深度报道',
            engine: 'google',
          }],
        }),
        stderr: '',
      };
    },
    merge: ({ hotDoc, sxDoc }) => ({
      query: sxDoc.query,
      hotDoc,
      groups: {
        bothChannels: [],
        searxngTop: sxDoc.results,
        agentReachTop: [],
        hotBySource: {},
        hotWithoutPopularity: [],
        unverified: [],
      },
    }),
  });

  assert.deepEqual(calls.map(({ spec }) => spec.channel), ['searxng']);
  const searxngCall = calls[0];
  assert.equal(searxngCall.spec.args[searxngCall.spec.args.indexOf('--max-results') + 1], '1');
  assert.equal(searxngCall.spec.args[searxngCall.spec.args.indexOf('--timeout') + 1], '10');
  assert.ok(searxngCall.options.timeoutMs > 0 && searxngCall.options.timeoutMs <= 60_000);
  assert.equal(result.hotDiscovery, null);
  assert.equal(result.snapshots.hotDiscovery, null);
  assert.equal(result.channels.hotDiscovery.status, 'skipped');
  assert.equal(result.channels.hotDiscovery.skipReason, 'sufficient_article_candidates');
  assert.equal(result.candidateQuality.searxng.article, 1);
  assert.equal(result.candidateQuality.searxng.eligibleArticle, 1);
  assert.equal(result.discoveryAuthorization.probeCandidateIds.length, 1);
  assert.equal(result.discoveryAuthorization.probeCandidateCount, 1);
  assert.equal(result.discoveryAuthorization.verificationRequired, true);
  assert.equal(result.merged.groups.searxngTop[0].discoveryDisposition, 'probe');
  assert.equal(result.merged.groups.searxngTop[0].probePriority, 'high');
  assert.equal(result.merged.groups.searxngTop[0].verificationRequired, true);
  const persisted = JSON.parse(readFileSync(paths.session, 'utf8'));
  assert.equal(persisted.task.discoveryGate.observations.length, 1);
  assert.equal(persisted.task.discoveryGate.candidates[0].candidateVersion, 1);
  assert.match(persisted.task.discoveryGate.candidates[0].evidenceHash, /^[a-f0-9]{64}$/);
  assert.ok(!result.warnings.some((warning) => warning.includes('hot-discovery')));
  assert.equal(
    JSON.parse(readFileSync(result.snapshots.merged, 'utf8')).channelDiagnostics.hotDiscovery.skipReason,
    'sufficient_article_candidates',
  );
});

test('Chinese article profile starts SearXNG and bounded hot discovery concurrently', async () => {
  const { paths } = makeInitializedSession(
    ['public-internet'],
    '采集一篇关于米哈游的文章',
  );
  const calls = [];
  const releases = [];
  let initialWaveReleased = false;
  const outcome = (spec) => spec.channel === 'searxng'
    ? { code: 0, stdout: JSON.stringify({ query: '米哈游 报道', results: [] }), stderr: '' }
    : { code: 0, stdout: JSON.stringify({
      query: '米哈游 报道', candidates: [], adapterStats: {},
      dimensions: ['general', 'news', 'blogs'], effectiveDimensions: ['general', 'news', 'blogs'],
    }), stderr: '' };
  const promise = runPublicDiscover(paths, {
    query: '米哈游 报道', category: 'general', language: 'zh-CN', 'requested-count': '1',
  }, {
    environment: {},
    runProcess: (spec, options) => new Promise((resolve) => {
      calls.push({ spec, options });
      if (initialWaveReleased) resolve(outcome(spec));
      else releases.push(() => resolve(outcome(spec)));
    }),
    merge: ({ sxDoc }) => ({
      query: sxDoc.query,
      groups: {
        bothChannels: [], searxngTop: [], agentReachTop: [], hotBySource: {},
        hotWithoutPopularity: [], unverified: [],
      },
    }),
  });
  for (let index = 0; index < 100 && calls.length < 2; index += 1) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.deepEqual(calls.map(({ spec }) => spec.channel).sort(), ['hot-discovery', 'searxng']);
  const hot = calls.find(({ spec }) => spec.channel === 'hot-discovery');
  const arg = (name) => hot.spec.args[hot.spec.args.indexOf(name) + 1];
  assert.equal(arg('--sources'), '36kr,weixin,sogou');
  assert.equal(arg('--adapter-timeout-ms'), '10000');
  assert.equal(arg('--minimum-attempts'), '3');
  assert.ok(Number(arg('--total-budget-ms')) > 0 && Number(arg('--total-budget-ms')) <= 60_000);
  assert.equal(arg('--dimensions'), 'general,news,blogs');
  assert.ok(calls.every(({ options }) => options.timeoutMs <= 90_000));
  initialWaveReleased = true;
  for (const release of releases) release();
  const result = await promise;
  assert.equal(result.discoveryProfile.name, 'chinese-article');
  assert.deepEqual(result.discoveryProfile.budget, { softMs: 60_000, hardMs: 90_000 });
});

test('an unrelated trusted publication does not satisfy requested count or receive authorization', async () => {
  const { paths } = makeInitializedSession(
    ['public-internet'],
    '采集一篇关于 kc-no-source-20260901-xqvzt 的文章',
  );
  const calls = [];
  const result = await runPublicDiscover(paths, {
    query: 'kc-no-source-20260901-xqvzt article',
    'requested-count': '1',
  }, {
    runProcess: async (spec) => {
      calls.push(spec.channel);
      return spec.channel === 'searxng'
        ? {
          code: 0,
          stdout: JSON.stringify({
            query: 'kc-no-source-20260901-xqvzt article',
            results: [{
              url: 'https://arxiv.org/abs/2103.05770v1',
              title: 'Notebook articles: towards a transformative publishing experience',
            }],
          }),
          stderr: '',
        }
        : { code: 0, stdout: JSON.stringify({ query: 'kc-no-source-20260901-xqvzt', candidates: [] }), stderr: '' };
    },
    merge: ({ sxDoc }) => ({
      query: sxDoc.query,
      groups: {
        bothChannels: [],
        searxngTop: sxDoc.results,
        agentReachTop: [],
        hotBySource: {},
        hotWithoutPopularity: [],
        unverified: [],
      },
    }),
  });

  assert.equal(calls.filter((channel) => channel === 'searxng').length, 1);
  assert.ok(calls.filter((channel) => channel === 'hot-discovery').length >= 1);
  assert.equal(result.candidateQuality.searxng.article, 1);
  assert.equal(result.candidateQuality.searxng.eligibleArticle, 0);
  assert.equal(result.candidateQuality.searxng.topicRelevance.unmatched, 1);
  assert.equal(result.discoveryAuthorization.articleCandidateIds.length, 0);
  assert.equal(result.discoveryAuthorization.structuralArticleCandidateIds.length, 1);
});

test('query drift fails before reserving or invoking discovery executors', async () => {
  const { paths } = makeInitializedSession(['public-internet'], '采集一篇关于 DeepSeek 的文章');
  let executorCalls = 0;
  await assert.rejects(
    runPublicDiscover(paths, { query: 'Qwen paper' }, {
      runProcess: async () => {
        executorCalls += 1;
        return { code: 0, stdout: '{}', stderr: '' };
      },
    }),
    /DISCOVERY_QUERY_DRIFT/,
  );
  assert.equal(executorCalls, 0);
  const session = JSON.parse(readFileSync(paths.session, 'utf8'));
  assert.equal(session.task.discoveryGate.attemptCount, 0);
});

test('a public legacy session with a missing gate is not silently upgraded', async () => {
  const { paths } = makeInitializedSession();
  const session = JSON.parse(readFileSync(paths.session, 'utf8'));
  delete session.task.discoveryGate;
  writeFileSync(paths.session, `${JSON.stringify(session, null, 2)}\n`);
  let executorCalls = 0;
  await assert.rejects(
    runPublicDiscover(paths, { query: 'article' }, {
      runProcess: async () => {
        executorCalls += 1;
        return { code: 0, stdout: '{}', stderr: '' };
      },
    }),
    /DISCOVERY_RELEVANCE_MIGRATION_REQUIRED/,
  );
  assert.equal(executorCalls, 0);
  assert.equal(JSON.parse(readFileSync(paths.session, 'utf8')).task.discoveryGate, undefined);
});

test('requested count merges duplicate SearXNG evidence before deciding hot fallback', async () => {
  const { paths } = makeInitializedSession(['public-internet'], 'neural scaling');
  const calls = [];
  const result = await runPublicDiscover(paths, {
    query: 'neural scaling',
    'requested-count': '1',
  }, {
    runProcess: async (spec) => {
      calls.push(spec.channel);
      return {
        code: 0,
        stdout: JSON.stringify({
          query: 'neural scaling',
          results: [
            { url: 'https://example.com/news/report', title: 'Neural report', content: '记者报道' },
            { url: 'https://example.com/news/report', title: 'Scaling analysis', content: '记者报道' },
          ],
        }),
        stderr: '',
      };
    },
    merge: ({ sxDoc }) => ({
      query: sxDoc.query,
      groups: {
        bothChannels: [],
        searxngTop: sxDoc.results,
        agentReachTop: [],
        hotBySource: {},
        hotWithoutPopularity: [],
        unverified: [],
      },
    }),
  });

  assert.deepEqual(calls, ['searxng']);
  assert.equal(result.channels.hotDiscovery.skipReason, 'sufficient_article_candidates');
});

test('falls back when non-empty SearXNG results are login and home pages', async () => {
  const { paths } = makeInitializedSession();
  const calls = [];
  const result = await runPublicDiscover(paths, {
    query: '米哈游',
    'requested-count': '1',
  }, {
    runProcess: async (spec) => {
      calls.push(spec.channel);
      return spec.channel === 'searxng'
        ? {
          code: 0,
          stdout: JSON.stringify({
            query: '米哈游',
            results: [
              { url: 'https://user.mihoyo.com/login', title: '米哈游通行证登录', engine: 'baidu' },
              { url: 'https://www.mihoyo.com/', title: '米哈游', engine: 'bing' },
            ],
          }),
          stderr: '',
        }
        : {
          code: 0,
          stdout: JSON.stringify({ query: '米哈游', candidates: [] }),
          stderr: '',
        };
    },
    merge: ({ sxDoc }) => ({
      query: sxDoc.query,
      groups: {
        bothChannels: [],
        searxngTop: sxDoc.results,
        agentReachTop: [],
        hotBySource: {},
        hotWithoutPopularity: [],
        unverified: [],
      },
    }),
  });

  assert.deepEqual(calls, ['searxng', 'hot-discovery']);
  assert.equal(result.candidateQuality.searxng.article, 0);
  assert.equal(result.candidateQuality.searxng.weak, 1);
  assert.equal(result.candidateQuality.searxng.reject, 1);
});

test('falls back when unique article count is below requested count', async () => {
  const { paths } = makeInitializedSession();
  const calls = [];
  await runPublicDiscover(paths, {
    query: '米哈游 报道',
    'requested-count': '2',
  }, {
    runProcess: async (spec) => {
      calls.push(spec.channel);
      return spec.channel === 'searxng'
        ? {
          code: 0,
          stdout: JSON.stringify({
            query: '米哈游 报道',
            results: [
              { url: 'https://example.com/news/mihoyo', title: '米哈游深度报道', engine: 'baidu' },
              { url: 'https://www.mihoyo.com/', title: '米哈游', engine: 'bing' },
            ],
          }),
          stderr: '',
        }
        : { code: 0, stdout: JSON.stringify({ query: '米哈游 报道', candidates: [] }), stderr: '' };
    },
    merge: ({ sxDoc }) => ({ query: sxDoc.query, groups: {} }),
  });

  assert.deepEqual(calls, ['searxng', 'hot-discovery']);
});

test('records deterministic discovery phase timings', async () => {
  const { paths } = makeInitializedSession();
  const ticks = [0, 0, 20, 20, 30, 35];
  const result = await runPublicDiscover(paths, {
    query: '米哈游 报道',
    'requested-count': '1',
  }, {
    now: () => ticks.shift(),
    runProcess: async () => ({
      code: 0,
      stdout: JSON.stringify({
        query: '米哈游 报道',
        results: [{ url: 'https://example.com/news/mihoyo', title: '米哈游深度报道' }],
      }),
      stderr: '',
    }),
    merge: ({ sxDoc }) => ({ query: sxDoc.query, groups: {} }),
  });

  assert.deepEqual(result.timing, {
    searxngMs: 20,
    onlineSearchMs: 20,
    hotDiscoveryMs: 0,
    mergeAndClassifyMs: 10,
    totalMs: 35,
  });
  assert.equal(result.channels.searxng.durationMs, 20);
  assert.equal(result.channels.hotDiscovery.durationMs, 0);
});

test('falls back to hot discovery when requested SearXNG result set is empty', async () => {
  const { paths } = makeInitializedSession();
  const calls = [];
  const result = await runPublicDiscover(paths, {
    query: '浩鲸科技',
    'requested-count': '1',
    'max-results': '20',
    timeout: '0.025',
  }, {
    runProcess: async (spec, options) => {
      calls.push({ spec, options });
      return spec.channel === 'searxng'
        ? { code: 0, stdout: JSON.stringify({ query: '浩鲸科技', results: [] }), stderr: '' }
        : {
          code: 0,
          stdout: JSON.stringify({
            query: '浩鲸科技',
            candidates: [],
            dimensions: ['general'],
            effectiveDimensions: ['general'],
          }),
          stderr: '',
        };
    },
    merge: ({ hotDoc, sxDoc }) => ({ query: sxDoc.query, usedHotDiscovery: Boolean(hotDoc) }),
  });

  assert.deepEqual(calls.map(({ spec }) => spec.channel), ['searxng', 'hot-discovery']);
  const hotDiscoveryCall = calls[1];
  assert.equal(
    hotDiscoveryCall.spec.args[hotDiscoveryCall.spec.args.indexOf('--limit') + 1],
    '1',
  );
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ options }) => options.timeoutMs > 0 && options.timeoutMs < 25));
  assert.equal(result.merged.usedHotDiscovery, true);
  assert.equal(result.channels.hotDiscovery.status, 'success');
  assert.equal(result.channels.hotDiscovery.exitCode, 0);
  assert.ok(Number.isInteger(result.channels.hotDiscovery.durationMs));
  assert.equal(existsSync(result.snapshots.hotDiscovery), true);
});

test('persists two empty discovery attempts and rejects a third attempt before executors run', async () => {
  const { paths } = makeInitializedSession();
  let executorCalls = 0;
  const options = {
    runProcess: async (spec) => {
      executorCalls += 1;
      return spec.channel === 'searxng'
        ? { code: 0, stdout: JSON.stringify({ query: 'DeepSeek', results: [] }), stderr: '' }
        : { code: 0, stdout: JSON.stringify({ query: 'DeepSeek', candidates: [] }), stderr: '' };
    },
    merge: ({ sxDoc }) => ({ query: sxDoc.query, groups: {} }),
  };

  await runPublicDiscover(paths, { query: 'DeepSeek', 'requested-count': '1' }, options);
  await runPublicDiscover(paths, {
    query: 'DeepSeek-R1 paper', category: 'science', 'requested-count': '1',
  }, options);

  const session = JSON.parse(readFileSync(paths.session, 'utf8'));
  assert.equal(session.task.discoveryGate.attemptCount, 2);
  assert.equal(session.task.discoveryGate.exhausted, true);
  assert.equal(session.task.discoveryGate.stopReason, 'no-article-candidates');
  assert.equal(session.task.discoveryGate.stopDetail, 'no-relevant-article-candidates');
  const callsBeforeRejectedAttempt = executorCalls;
  await assert.rejects(
    runPublicDiscover(paths, { query: '2501.12948', category: 'science' }, options),
    /DISCOVERY_ATTEMPTS_EXHAUSTED/,
  );
  assert.equal(executorCalls, callsBeforeRejectedAttempt);
});

test('applies a custom outer timeout to both public discovery channels', async () => {
  const { paths } = makeInitializedSession();
  const calls = [];
  await runPublicDiscover(paths, {
    query: 'timeout bounds',
    timeout: '0.025',
  }, {
    runProcess: async (spec, options) => {
      calls.push({ spec, options });
      return spec.channel === 'searxng'
        ? { code: 0, stdout: JSON.stringify({ query: 'timeout bounds', results: [] }), stderr: '' }
        : {
          code: 0,
          stdout: JSON.stringify({ query: 'timeout bounds', candidates: [] }),
          stderr: '',
        };
    },
    merge: ({ sxDoc }) => ({ query: sxDoc.query }),
  });

  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ options }) => options.timeoutMs > 0 && options.timeoutMs < 25));
});

test('falls back to hot discovery when requested SearXNG output is invalid', async () => {
  const { paths } = makeInitializedSession();
  const calls = [];
  const result = await runPublicDiscover(paths, {
    query: '浩鲸科技',
    'requested-count': '1',
  }, {
    runProcess: async (spec) => {
      calls.push(spec);
      return spec.channel === 'searxng'
        ? { code: 1, stdout: '', stderr: 'invalid response' }
        : {
          code: 0,
          stdout: JSON.stringify({
            query: '浩鲸科技',
            candidates: [],
            dimensions: ['general'],
            effectiveDimensions: ['general'],
          }),
          stderr: '',
        };
    },
    merge: ({ hotDoc, sxDoc, warnings }) => ({
      query: hotDoc.query,
      hasSearxng: Boolean(sxDoc),
      warnings,
    }),
  });

  assert.deepEqual(calls.map((spec) => spec.channel), ['searxng', 'hot-discovery']);
  assert.equal(result.merged.hasSearxng, false);
  assert.equal(result.channels.searxng.status, 'failed');
  assert.equal(result.channels.searxng.exitCode, 1);
  assert.equal(result.channels.searxng.timedOut, false);
  assert.equal(result.channels.searxng.stderr, 'invalid response');
  assert.ok(Number.isInteger(result.channels.searxng.durationMs));
  assert.equal(result.channels.hotDiscovery.status, 'success');
  assert.equal(result.channels.hotDiscovery.exitCode, 0);
  assert.ok(Number.isInteger(result.channels.hotDiscovery.durationMs));
  assert.match(result.warnings.join('\n'), /SearXNG 发现失败/);
});

test('keeps SearXNG output when hot discovery fails', async () => {
  const { paths } = makeInitializedSession();
  const result = await runPublicDiscover(paths, { query: 'q' }, {
    runProcess: async (spec) => spec.channel === 'searxng'
      ? { code: 0, stdout: JSON.stringify({ query: 'q', results: [] }), stderr: '' }
      : { code: 75, stdout: '', stderr: 'RATE_LIMITED' },
    merge: ({ sxDoc }) => ({ query: sxDoc.query, groups: {} }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.channels.searxng.status, 'success');
  assert.equal(result.channels.hotDiscovery.status, 'failed');
  assert.equal(result.channels.hotDiscovery.exitCode, 75);
  assert.equal(result.channels.hotDiscovery.timedOut, false);
  assert.equal(result.channels.hotDiscovery.stderr, 'RATE_LIMITED');
  assert.ok(result.warnings.some((warning) => warning.includes('hot-discovery')));
  assert.equal(existsSync(result.snapshots.searxng), true);
  assert.equal(result.snapshots.hotDiscovery, null);
  assert.equal(existsSync(result.snapshots.merged), true);
  const snapshotDiagnostics = JSON.parse(readFileSync(result.snapshots.merged, 'utf8')).channelDiagnostics;
  assert.equal(snapshotDiagnostics.searxng.status, 'success');
  assert.ok(Number.isInteger(snapshotDiagnostics.searxng.durationMs));
  assert.equal(snapshotDiagnostics.hotDiscovery.status, 'failed');
  assert.equal(snapshotDiagnostics.hotDiscovery.exitCode, 75);
  assert.ok(Number.isInteger(snapshotDiagnostics.hotDiscovery.durationMs));
  assert.equal(snapshotDiagnostics.hotDiscovery.timedOut, false);
  assert.equal(snapshotDiagnostics.hotDiscovery.stderr, 'RATE_LIMITED');
});

test('records outer timeout diagnostics with bounded and redacted stderr', async () => {
  const { paths } = makeInitializedSession();
  const result = await runPublicDiscover(paths, { query: 'q' }, {
    runProcess: async (spec) => spec.channel === 'searxng'
      ? { code: 0, stdout: JSON.stringify({ query: 'q', results: [] }), stderr: '' }
      : {
        code: 1,
        stdout: '',
        stderr: `CLI timeout after 30000ms authorization: Bearer ${'x'.repeat(3000)}`,
        timedOut: true,
      },
    merge: ({ sxDoc }) => ({ query: sxDoc.query, groups: {} }),
  });

  const diagnostic = result.channels.hotDiscovery;
  assert.equal(diagnostic.timedOut, true);
  assert.match(diagnostic.stderr, /CLI timeout after 30000ms authorization: \[REDACTED\]/i);
  assert.ok(diagnostic.stderr.length <= 2_000);
  assert.doesNotMatch(diagnostic.stderr, /x{20}/);
});

test('fails public discovery only when both channels fail', async () => {
  const { paths } = makeInitializedSession();

  await assert.rejects(
    runPublicDiscover(paths, { query: 'q' }, {
      runProcess: async () => ({ code: 1, stdout: '', stderr: 'failed' }),
    }),
    /SearXNG 与 hot-discovery 均未返回有效结果/,
  );
});
