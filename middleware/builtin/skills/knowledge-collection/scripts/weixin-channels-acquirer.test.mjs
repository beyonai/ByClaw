import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cmdInit } from './research-state.mjs';
import { loadSession, persistSession, sessionPaths } from './session.mjs';
import { runWeixinChannelsAcquire } from './weixin-channels-acquirer.mjs';

const SOURCE = 'https://channels.weixin.qq.com/platform/statistic/post';
const BIG_ID = '18446744073709551615';
const COMMANDS = ['overview', 'trend', 'sources', 'posts', 'post-detail'];
const BROWSER_OPTIONS = [
  { name: 'keep-tab', choices: ['true', 'false'] },
  { name: 'site-session', choices: ['ephemeral', 'persistent'] },
  { name: 'window', choices: ['foreground', 'background'] },
];
const HELP = {
  site: 'weixin-channels',
  commands: COMMANDS.map(name => ({
    name, access: 'read', browser: true, domain: 'channels.weixin.qq.com',
    command_options: [{ name: 'days' }, { name: 'start-date' }, { name: 'end-date' }, ...(name === 'posts' ? [{ name: 'limit' }] : [])],
    positionals: name === 'post-detail' ? [{ name: 'id', required: true }] : [],
    browser_common_options: BROWSER_OPTIONS,
    columns: name === 'sources' ? ['source', 'views', 'views_pct']
      : name === 'post-detail' ? ['id', 'overview', 'trend', 'sources', 'data_details', 'retention'] : ['views'],
  })),
  common_options: [{ name: 'format', choices: ['json', 'table'] }],
  browser_common_options: BROWSER_OPTIONS,
};

function fixture(context, task = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-channels-acquire-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  cmdInit({
    'session-dir': root, query: '视频号统计', 'direct-urls': JSON.stringify([SOURCE]),
    'source-scope': '["public-internet"]',
  });
  const paths = sessionPaths(root);
  if (Object.keys(task).length) {
    const { session } = loadSession(paths);
    Object.assign(session.task, task);
    // Install controlled states directly; production persist rejects active-run writes.
    fs.writeFileSync(paths.session, `${JSON.stringify(session, null, 2)}\n`);
  }
  return { root, paths };
}

function executor(overrides = {}) {
  const calls = [];
  const metrics = { views: 7, recommendations: -1, likes: 0, comments: null, shares: 1, follows: null };
  const overview = { start_date: '2026-10-06', end_date: '2026-10-12', ...metrics };
  const source = { ...overview, source_id: 1, source: '推荐', views_pct: 100 };
  const trend = Array.from({ length: 7 }, (_, index) => ({ date: `2026-10-${String(index + 6).padStart(2, '0')}`, ...metrics,
    views: 1, recommendations: index === 0 ? -1 : 0, shares: index === 0 ? 1 : 0 }));
  const post = { id: BIG_ID, title: '视频', published_at: '2026-10-06T12:00:00+08:00', ...metrics,
    recommendations: 1, completion_rate: 1.95, avg_play_seconds: 9.37, chat_shares: 1, ringtone_sets: 0,
    status_sets: null, cover_sets: 0, wecom_link_clicks: null, wecom_link_visitors: null,
    wecom_contact_adds: null, wecom_contact_visitors: null };
  const results = {
    overview: [overview], trend, sources: [source],
    posts: [post, { ...post, id: '2', title: '第二条', views: 0 }],
    ...overrides.results,
  };
  const runProcess = async (bin, args) => {
    calls.push({ bin, args: [...args] });
    if (args[0] === 'list') {
      return { exitCode: 0, stdout: JSON.stringify(overrides.list ?? COMMANDS.map(name => ({ site: 'weixin-channels', name }))), stderr: '' };
    }
    if (args.includes('--help')) return { exitCode: 0, stdout: JSON.stringify(overrides.help ?? HELP), stderr: '' };
    if (bin === process.execPath) return { exitCode: 0, stdout: '{"ok":true,"code":"BRIDGE_READY"}', stderr: '' };
    const command = args[1];
    if (overrides.fail === command) return { exitCode: overrides.exitCode ?? 75, stdout: '', stderr: overrides.stderr ?? 'error: TIMEOUT' };
    if (overrides.throw === command) throw new Error('CLI timeout after 30000ms token=fixture-secret');
    const rows = command === 'post-detail'
      ? overrides.detail ?? [{ id: args[2], start_date: overview.start_date, end_date: overview.end_date,
        overview, trend, sources: [source],
        data_details: trend.map(row => ({ ...row, source_id: 1, source: '推荐' })),
        retention: { video_seconds: 107, max_loss_second: 21,
          points: [{ second: 0, retained_pct: 100 }, { second: 21, retained_pct: 4.41 }, { second: 107, retained_pct: 0 }] },
        fans_breakdown_available: false }]
      : results[command];
    return { exitCode: 0, stdout: overrides.raw?.[command] ?? JSON.stringify(rows), stderr: '' };
  };
  return { calls, runProcess };
}

const args = extra => ({ 'item-id': 'channels-statistics', 'source-url': SOURCE, ...extra });
const inventory = paths => loadSession(paths).session.collection.collection.items;
const rawDir = root => path.join(root, 'raw/bycli/weixin-channels/channels-statistics');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('collects four queries and every post detail serially with controlled hashed artifacts', async (context) => {
  const { root, paths } = fixture(context);
  const fake = executor();
  let bridgeCalls = 0;
  const result = await runWeixinChannelsAcquire(paths, args({ days: '7', limit: '20' }), {
    ...fake,
    bridgeBootstrap: async () => {
      bridgeCalls++;
      assert.equal(inventory(paths)[0].materialization.status, 'pending');
      return { ok: true, code: 'BRIDGE_READY' };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.action, 'acquire-weixin-channels');
  assert.equal(result.commandCount, 6);
  assert.equal(result.detailCount, 2);
  assert.equal(bridgeCalls, 1);
  assert.deepEqual(fake.calls.slice(0, 2).map(call => call.args), [
    ['list', '-f', 'json'], ['weixin-channels', '--help', '-f', 'json'],
  ]);
  assert.deepEqual(fake.calls.slice(2).map(call => call.args), [
    ...['overview', 'trend', 'sources', 'posts'].map(command => [
      'weixin-channels', command, ...(command === 'overview' ? ['--days', '7'] : ['--start-date', '2026-10-06', '--end-date', '2026-10-12']), ...(command === 'posts' ? ['--limit', '20'] : []),
      '--keep-tab', 'true', '--site-session', 'persistent', '--window', 'background', '-f', 'json',
    ]),
    ...[BIG_ID, '2'].map(id => [
      'weixin-channels', 'post-detail', id, '--start-date', '2026-10-06', '--end-date', '2026-10-12',
      '--keep-tab', 'true', '--site-session', 'persistent', '--window', 'background', '-f', 'json',
    ]),
  ]);
  assert.equal(result.executorResultFile, path.join(rawDir(root), 'executor-result.json'));
  const bytes = fs.readFileSync(result.executorResultFile);
  const evidence = JSON.parse(bytes);
  assert.equal(evidence.schemaVersion, '1.0');
  assert.equal(evidence.executor, 'bycli');
  assert.equal(evidence.adapter, 'weixin-channels');
  assert.equal(evidence.status, 'saved');
  assert.equal(evidence.exitCode, 0);
  assert.equal(evidence.sourceUrl, SOURCE);
  assert.equal(evidence.days, 7);
  assert.equal(evidence.limit, 20);
  assert.deepEqual(evidence.results.map(({ command, postId }) => ({ command, postId })), [
    { command: 'overview', postId: undefined }, { command: 'trend', postId: undefined },
    { command: 'sources', postId: undefined }, { command: 'posts', postId: undefined },
    { command: 'post-detail', postId: BIG_ID }, { command: 'post-detail', postId: '2' },
  ]);
  for (const entry of evidence.results) {
    assert.ok(entry.artifact.startsWith('raw/bycli/weixin-channels/channels-statistics/'));
    const artifact = fs.readFileSync(path.join(root, entry.artifact));
    assert.equal(entry.size, artifact.length);
    assert.equal(entry.sha256, digest(artifact));
    assert.equal(Array.isArray(JSON.parse(artifact)), true);
  }
  const overview = JSON.parse(fs.readFileSync(path.join(root, evidence.results[0].artifact)));
  assert.equal(overview[0].recommendations, -1);
  assert.equal(overview[0].comments, null);
  assert.equal(overview[0].likes, 0);
  const { session } = loadSession(paths);
  assert.deepEqual(session.task.weixinChannelsAcquisitions, [{
    itemId: 'channels-statistics', sourceUrl: SOURCE,
    artifact: 'raw/bycli/weixin-channels/channels-statistics/executor-result.json', sha256: digest(bytes),
  }]);
  assert.equal(inventory(paths)[0].materialization.status, 'pending');
  assert.equal(inventory(paths)[0].rawArtifacts.length, 7);
});

test('empty posts save four queries and explicitly report zero detail coverage', async (context) => {
  const { paths } = fixture(context);
  const fake = executor({ results: { posts: [] } });
  const result = await runWeixinChannelsAcquire(paths, args(), fake);
  assert.equal(result.ok, true);
  assert.equal(result.commandCount, 4);
  assert.equal(result.detailCount, 0);
  assert.equal(fake.calls.filter(call => call.bin === process.execPath).length, 1);
  assert.equal(fake.calls.some(call => call.args[1] === 'post-detail'), false);
});

for (const extra of [
  { 'item-id': '../escape' }, { 'item-id': '' }, { 'source-url': 'https://example.com/statistics' },
  { 'source-url': `${SOURCE}?token=fixture-secret` }, { days: 0 }, { days: 367 }, { days: 1.5 },
  { days: true }, { limit: 0 }, { limit: 101 }, { limit: '1.5' },
]) {
  test(`rejects invalid acquisition arguments ${JSON.stringify(extra)} before external commands`, async (context) => {
    const { root, paths } = fixture(context);
    const fake = executor();
    await assert.rejects(runWeixinChannelsAcquire(paths, args(extra), fake));
    assert.equal(fake.calls.length, 0);
    assert.equal(fs.existsSync(rawDir(root)), false);
  });
}

test('requires an init directUrls authorization and rejects ordinary discovered candidates', async (context) => {
  const { paths } = fixture(context);
  const { session } = loadSession(paths);
  session.task.discoveryGate.candidates[0].origin = 'public-discover';
  persistSession(paths, session);
  const fake = executor();
  await assert.rejects(runWeixinChannelsAcquire(paths, args(), fake), /AUTHORIZED/);
  assert.equal(fake.calls.length, 0);
  assert.equal(inventory(paths).length, 0);
});

for (const task of [
  { requiredContentGranularity: 'full-text' }, { requiredContentGranularity: 'metadata' },
  { materializationTarget: 'candidates' },
  { workflow: 'public-collect' }, { activeOrchestrationRunId: 'active-run' },
]) {
  test(`rejects incompatible task policy ${JSON.stringify(task)}`, async (context) => {
    const { paths } = fixture(context, task);
    const fake = executor();
    await assert.rejects(runWeixinChannelsAcquire(paths, args(), fake));
    assert.equal(fake.calls.length, 0);
    assert.equal(inventory(paths).length, 0);
  });
}

test('bridge failure keeps the registered item pending and never calls a source query', async (context) => {
  const { root, paths } = fixture(context);
  const fake = executor();
  let calls = 0;
  const result = await runWeixinChannelsAcquire(paths, args(), {
    ...fake, bridgeBootstrap: async () => { calls++; return { ok: false, code: 'BRIDGE_UNAVAILABLE', token: 'fixture-secret' }; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'BRIDGE_UNAVAILABLE');
  assert.equal(calls, 1);
  assert.equal(fake.calls.length, 2);
  assert.equal(inventory(paths)[0].materialization.status, 'pending');
  assert.equal(fs.existsSync(path.join(rawDir(root), 'executor-result.json')), false);
  assert.equal(JSON.stringify(result).includes('fixture-secret'), false);
});

test('accepts a successfully recovered bridge without another bootstrap or retry', async (context) => {
  const { paths } = fixture(context);
  const fake = executor({ results: { posts: [] } });
  let bridgeCalls = 0;
  const result = await runWeixinChannelsAcquire(paths, args(), {
    ...fake, bridgeBootstrap: async () => { bridgeCalls++; return { ok: true, code: 'BRIDGE_RECOVERED' }; },
  });
  assert.equal(result.ok, true);
  assert.equal(result.commandCount, 4);
  assert.equal(result.detailCount, 0);
  assert.equal(bridgeCalls, 1);
});

for (const [stderr, exitCode, status] of [
  ['error: AUTH_REQUIRED token=fixture-secret', 77, 'pending'],
  ['error: TIMEOUT cookie=fixture-secret', 75, 'pending'],
  ['unknown source failure password=fixture-secret', 1, 'failed'],
]) {
  test(`stops at a source failure while preserving safe preceding evidence (${status}/${exitCode})`, async (context) => {
    const { root, paths } = fixture(context);
    const fake = executor({ fail: 'sources', stderr, exitCode });
    const result = await runWeixinChannelsAcquire(paths, args(), fake);
    assert.equal(result.ok, false);
    assert.equal(result.commandCount, 2);
    assert.equal(fake.calls.some(call => call.args[1] === 'posts'), false);
    assert.equal(inventory(paths)[0].materialization.status, status);
    assert.equal(inventory(paths)[0].rawArtifacts.length, 2);
    assert.deepEqual(inventory(paths)[0].rawArtifacts.map(file => path.basename(file)), ['overview.json', 'trend.json']);
    assert.equal(JSON.stringify(result).includes('fixture-secret'), false);
    assert.equal(loadSession(paths).session.task.weixinChannelsAcquisitions, undefined);
  });
}

test('transport exceptions are sanitized and stop without retrying the failing query', async (context) => {
  const { paths } = fixture(context);
  const fake = executor({ throw: 'trend' });
  const result = await runWeixinChannelsAcquire(paths, args(), fake);
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'TIMEOUT');
  assert.equal(fake.calls.filter(call => call.args[1] === 'trend').length, 1);
  assert.equal(JSON.stringify(result).includes('fixture-secret'), false);
});

for (const rows of [
  { views: 1 }, [{ views: 1, rawKeyBuff: 'fixture-secret' }],
  [{ views: 1, nested: { pluginSessionId: 'fixture-secret' } }],
  [{ views: 1, username: 'private-account' }],
]) {
  test(`rejects malformed or sensitive source output before persistence (${JSON.stringify(rows)})`, async (context) => {
    const { root, paths } = fixture(context);
    const fake = executor({ results: { overview: rows } });
    const result = await runWeixinChannelsAcquire(paths, args(), fake);
    assert.equal(result.ok, false);
    assert.deepEqual(inventory(paths)[0].rawArtifacts, []);
    assert.equal(fake.calls.some(call => call.args[1] === 'trend'), false);
    assert.equal(JSON.stringify(result).includes('fixture-secret'), false);
    assert.equal(JSON.stringify(inventory(paths)).includes('fixture-secret'), false);
  });
}

test('refuses missing discovered commands or unsupported browser flags before bridging', async (context) => {
  const { paths } = fixture(context);
  const fake = executor({ help: { ...HELP, browser_common_options: [], commands: HELP.commands.map(command => ({ ...command, browser_common_options: [] })) } });
  const result = await runWeixinChannelsAcquire(paths, args(), fake);
  assert.equal(result.ok, false);
  assert.equal(fake.calls.filter(call => call.bin === process.execPath).length, 0);
});

for (const [command, column] of [['sources', 'views_pct'], ['post-detail', 'data_details']]) {
  test(`refuses an adapter missing ${command}.${column} before bridging or source queries`, async (context) => {
    const { paths } = fixture(context);
    const fake = executor({ help: { ...HELP, commands: HELP.commands.map(row => row.name === command
      ? { ...row, columns: row.columns.filter(name => name !== column) } : row) } });
    let bridgeCalls = 0;
    const result = await runWeixinChannelsAcquire(paths, args(), {
      ...fake, bridgeBootstrap: async () => { bridgeCalls++; return { ok: true, code: 'BRIDGE_READY' }; },
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'ADAPTER_UNAVAILABLE');
    assert.equal(bridgeCalls, 0);
    assert.equal(fake.calls.length, 2);
  });
}

test('refuses replacing an existing acquisition directory without external commands', async (context) => {
  const { root, paths } = fixture(context);
  fs.mkdirSync(rawDir(root), { recursive: true });
  const sentinel = path.join(rawDir(root), 'existing.json');
  fs.writeFileSync(sentinel, 'original');
  const fake = executor();
  await assert.rejects(runWeixinChannelsAcquire(paths, args(), fake), /CONFLICT/);
  assert.equal(fake.calls.length, 0);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'original');
});

test('refuses raw ancestors that are symlinks and does not write outside the session', async (context) => {
  const { root, paths } = fixture(context);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-channels-outside-'));
  context.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, path.join(root, 'raw', 'bycli'));
  const fake = executor();
  await assert.rejects(runWeixinChannelsAcquire(paths, args(), fake), /SYMLINK|符号链接/);
  assert.equal(fake.calls.length, 0);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('rejects numeric post IDs rather than losing precision or inventing details', async (context) => {
  const { paths } = fixture(context);
  const fake = executor({ results: { posts: [{ id: 9007199254740992 }] } });
  const result = await runWeixinChannelsAcquire(paths, args(), fake);
  assert.equal(result.ok, false);
  assert.equal(fake.calls.some(call => call.args[1] === 'post-detail'), false);
});

test('rejects a detail envelope for another post ID', async (context) => {
  const { paths } = fixture(context);
  const fake = executor({ detail: [{ id: 'wrong-id' }] });
  const result = await runWeixinChannelsAcquire(paths, args(), fake);
  assert.equal(result.ok, false);
  assert.equal(fake.calls.filter(call => call.args[1] === 'post-detail').length, 1);
  assert.equal(loadSession(paths).session.task.weixinChannelsAcquisitions, undefined);
});

for (const [task, expectedCode] of [
  [{ workflow: 'public-collect' }, 'SESSION_OWNED_BY_PUBLIC_COLLECT'],
  [{ activeOrchestrationRunId: 'inflight-owner' }, 'ORCHESTRATION_IN_PROGRESS'],
]) {
  test(`does not save a query returned after ownership changes (${expectedCode})`, async (context) => {
    const { root, paths } = fixture(context);
    const fake = executor();
    const result = await runWeixinChannelsAcquire(paths, args(), {
      runProcess: async (bin, argv) => {
        const outcome = await fake.runProcess(bin, argv);
        if (argv[1] === 'overview') {
          const { session } = loadSession(paths);
          Object.assign(session.task, task);
          fs.writeFileSync(paths.session, `${JSON.stringify(session, null, 2)}\n`);
        }
        return outcome;
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, expectedCode);
    assert.equal(result.commandCount, 0);
    assert.equal(fs.existsSync(path.join(rawDir(root), 'overview.json')), false);
    assert.deepEqual(inventory(paths)[0].rawArtifacts, []);
    assert.equal(fake.calls.some(call => call.args[1] === 'trend'), false);
  });
}

test('does not publish executor attestation after ownership changes before the final write', async (context) => {
  const { root, paths } = fixture(context);
  const fake = executor({ results: { posts: [] } });
  let clockReads = 0;
  const result = await runWeixinChannelsAcquire(paths, args(), {
    ...fake,
    now: () => {
      if (++clockReads === 2) {
        const { session } = loadSession(paths);
        session.task.workflow = 'public-collect';
        fs.writeFileSync(paths.session, `${JSON.stringify(session, null, 2)}\n`);
      }
      return 1_791_817_200_000;
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'SESSION_OWNED_BY_PUBLIC_COLLECT');
  assert.equal(result.commandCount, 4);
  assert.equal(fs.existsSync(path.join(rawDir(root), 'executor-result.json')), false);
  assert.equal(inventory(paths)[0].rawArtifacts.length, 4);
  assert.equal(loadSession(paths).session.task.weixinChannelsAcquisitions, undefined);
});

const checkpointFile = root => path.join(rawDir(root), 'acquisition-state.json');
const checkpoint = root => JSON.parse(fs.readFileSync(checkpointFile(root), 'utf8'));
const sourceCalls = fake => fake.calls.filter(call => call.args[0] === 'weixin-channels' && !call.args.includes('--help'));

async function pausedFixture(context, command = 'sources') {
  const state = fixture(context);
  const fake = executor({ fail: command, exitCode: 77, stderr: JSON.stringify({ ok: false, error: { code: 'AUTH_REQUIRED', message: '人工登录', exitCode: 77 } }) });
  const paused = await runWeixinChannelsAcquire(state.paths, args(), fake);
  assert.equal(paused.errorCode, 'AUTH_REQUIRED');
  assert.equal(paused.phase, 'waiting-confirmation');
  assert.equal(fs.existsSync(checkpointFile(state.root)), true);
  return { ...state, paused, fake };
}

test('AUTH pauses with a registered checkpoint and a sanitized human confirmation result', async context => {
  const { root, paths, paused } = await pausedFixture(context);
  assert.equal(paused.phase, 'waiting-confirmation');
  assert.equal(paused.requiresUserAction, true);
  assert.equal(paused.sourceUrl, SOURCE);
  const bytes = fs.readFileSync(checkpointFile(root));
  const state = JSON.parse(bytes);
  assert.equal(state.phase, 'waiting-confirmation');
  assert.equal(state.nextStep, 2);
  assert.deepEqual(state.range, { startDate: '2026-10-06', endDate: '2026-10-12' });
  assert.equal(state.results.length, 2);
  assert.deepEqual(loadSession(paths).session.task.weixinChannelsAcquisitionRuns, [{
    itemId: 'channels-statistics', sourceUrl: SOURCE,
    artifact: 'raw/bycli/weixin-channels/channels-statistics/acquisition-state.json', sha256: digest(bytes),
  }]);
});

test('an unconfirmed paused acquisition reads only trusted local state', async context => {
  const { root, paths } = await pausedFixture(context);
  const before = fs.readFileSync(checkpointFile(root));
  const fake = executor();
  let bridgeCalls = 0;
  const result = await runWeixinChannelsAcquire(paths, args(), { ...fake, bridgeBootstrap: async () => { bridgeCalls++; return { ok: true, code: 'BRIDGE_READY' }; } });
  assert.equal(result.phase, 'waiting-confirmation');
  assert.equal(result.requiresUserAction, true);
  assert.equal(result.commandCount, 2);
  assert.equal(fake.calls.length, 0);
  assert.equal(bridgeCalls, 0);
  assert.deepEqual(fs.readFileSync(checkpointFile(root)), before);
});

test('explicit confirmation resumes only the paused operation and remaining queries without altering prefix evidence', async context => {
  const { root, paths, fake: initial } = await pausedFixture(context);
  const overview = fs.readFileSync(path.join(rawDir(root), 'overview.json'));
  const trend = fs.readFileSync(path.join(rawDir(root), 'trend.json'));
  const failedArgv = sourceCalls(initial).find(call => call.args[1] === 'sources').args;
  const fake = executor();
  let bridgeCalls = 0;
  const result = await runWeixinChannelsAcquire(paths, args({ 'verification-confirmed': true }), {
    ...fake, bridgeBootstrap: async () => { bridgeCalls++; return { ok: true, code: 'BRIDGE_READY' }; },
  });
  assert.equal(result.ok, true);
  assert.equal(result.commandCount, 6);
  assert.equal(result.detailCount, 2);
  assert.deepEqual(sourceCalls(fake).map(call => call.args[1]), ['sources', 'posts', 'post-detail', 'post-detail']);
  assert.deepEqual(sourceCalls(fake)[0].args, failedArgv);
  assert.equal(bridgeCalls, 0);
  assert.deepEqual(fs.readFileSync(path.join(rawDir(root), 'overview.json')), overview);
  assert.deepEqual(fs.readFileSync(path.join(rawDir(root), 'trend.json')), trend);
  assert.equal(checkpoint(root).phase, 'saved');
});

test('confirmation before any successful overview preserves the exact original Gate command', async context => {
  const { paths, fake: initial } = await pausedFixture(context, 'overview');
  const fake = executor({ results: { posts: [] } });
  const result = await runWeixinChannelsAcquire(paths, args({ 'verification-confirmed': 'true' }), fake);
  assert.equal(result.ok, true);
  assert.deepEqual(sourceCalls(fake)[0].args, sourceCalls(initial)[0].args);
  assert.equal(sourceCalls(fake)[0].args.includes('--days'), true);
  assert.deepEqual(sourceCalls(fake).slice(1).map(call => call.args.includes('--start-date')), [true, true, true]);
  assert.equal(fake.calls.some(call => call.bin === process.execPath), false);
});

test('confirmation is consumed by one operation and a later AUTH requires a new human confirmation', async context => {
  const { root, paths } = await pausedFixture(context, 'trend');
  const fake = executor({ fail: 'sources', exitCode: 77, stderr: 'AUTH_REQUIRED' });
  const result = await runWeixinChannelsAcquire(paths, args({ 'verification-confirmed': true }), fake);
  assert.equal(result.phase, 'waiting-confirmation');
  assert.equal(result.failedCommand, 'sources');
  assert.equal(result.requiresUserAction, true);
  assert.deepEqual(sourceCalls(fake).map(call => call.args[1]), ['trend', 'sources']);
  const active = checkpoint(root).active;
  const gate = JSON.parse(fs.readFileSync(path.join(root, active.gate.artifact)));
  assert.equal(gate.confirmedRerunCount, 0);
});

for (const value of ['yes', 1, 0, null, {}, 'TRUE']) {
  test(`rejects an invalid verification-confirmed value ${JSON.stringify(value)} before creating raw`, async context => {
    const { root, paths } = fixture(context);
    const fake = executor();
    await assert.rejects(runWeixinChannelsAcquire(paths, args({ 'verification-confirmed': value }), fake), /verification-confirmed/);
    assert.equal(fake.calls.length, 0);
    assert.equal(fs.existsSync(rawDir(root)), false);
  });
}

test('does not accept confirmation when no paused authentication operation exists', async context => {
  const { root, paths } = fixture(context);
  const fake = executor();
  await assert.rejects(runWeixinChannelsAcquire(paths, args({ 'verification-confirmed': true }), fake), /CONFIRMATION/);
  assert.equal(fake.calls.length, 0);
  assert.equal(fs.existsSync(rawDir(root)), false);
});

for (const change of [{ days: 30 }, { limit: 10 }]) {
  test(`refuses to change the paused operation identity ${JSON.stringify(change)}`, async context => {
    const { paths } = await pausedFixture(context);
    const fake = executor();
    await assert.rejects(runWeixinChannelsAcquire(paths, args({ ...change, 'verification-confirmed': true }), fake), /IDENTITY|CONFLICT/);
    assert.equal(fake.calls.length, 0);
  });
}

test('a source TIMEOUT remains pending but is not a login confirmation operation', async context => {
  const { root, paths } = fixture(context);
  const fake = executor({ fail: 'trend', stderr: 'TIMEOUT session capture timed out; login', exitCode: 75 });
  const result = await runWeixinChannelsAcquire(paths, args(), fake);
  assert.equal(result.errorCode, 'TIMEOUT');
  assert.equal(result.requiresUserAction, false);
  assert.equal(result.phase, 'stopped');
  assert.equal(checkpoint(root).phase, 'stopped');
  const next = executor();
  await assert.rejects(runWeixinChannelsAcquire(paths, args({ 'verification-confirmed': true }), next), /CONFIRMATION|STOPPED/);
  assert.equal(next.calls.length, 0);
});

test('ten confirmed AUTH attempts exhaust the shared Gate and cannot reset its fingerprint', async context => {
  const { root, paths } = await pausedFixture(context, 'overview');
  for (let count = 1; count <= 10; count++) {
    const fake = executor({ fail: 'overview', stderr: 'AUTH_REQUIRED', exitCode: 77 });
    const result = await runWeixinChannelsAcquire(paths, args({ 'verification-confirmed': true }), fake);
    assert.equal(sourceCalls(fake).length, 1);
    assert.equal(result.phase, count === 10 ? 'terminal' : 'waiting-confirmation');
    assert.equal(result.requiresUserAction, count < 10);
    assert.equal(result.errorCode, count === 10 ? 'AUTH_RETRY_EXHAUSTED' : 'AUTH_REQUIRED');
  }
  assert.equal(checkpoint(root).phase, 'terminal');
  const next = executor();
  await assert.rejects(runWeixinChannelsAcquire(paths, args({ 'verification-confirmed': true }), next), /TERMINAL|CONFIRMATION/);
  assert.equal(next.calls.length, 0);
});

for (const target of ['checkpoint', 'prefix', 'gate']) {
  test(`refuses a changed ${target} before resuming any external operation`, async context => {
    const { root, paths } = await pausedFixture(context);
    const filename = target === 'checkpoint' ? checkpointFile(root)
      : target === 'prefix' ? path.join(rawDir(root), 'overview.json')
        : path.join(root, checkpoint(root).active.gate.artifact);
    fs.appendFileSync(filename, ' ');
    const fake = executor();
    await assert.rejects(runWeixinChannelsAcquire(paths, args({ 'verification-confirmed': true }), fake), /CHECKPOINT|INTEGRITY/);
    assert.equal(fake.calls.length, 0);
  });
}

test('refuses a checkpoint without its session registration even when JSON and raw files exist', async context => {
  const { paths } = await pausedFixture(context);
  const { session } = loadSession(paths);
  delete session.task.weixinChannelsAcquisitionRuns;
  persistSession(paths, session);
  const fake = executor();
  await assert.rejects(runWeixinChannelsAcquire(paths, args({ 'verification-confirmed': true }), fake), /CHECKPOINT|CONFLICT/);
  assert.equal(fake.calls.length, 0);
});

test('refuses a symlinked checkpoint without reading or changing its target', async context => {
  const { root, paths } = await pausedFixture(context);
  const original = fs.readFileSync(checkpointFile(root));
  const outside = path.join(root, 'outside-checkpoint.json');
  fs.writeFileSync(outside, original);
  fs.unlinkSync(checkpointFile(root));
  fs.symlinkSync(outside, checkpointFile(root));
  const fake = executor();
  await assert.rejects(runWeixinChannelsAcquire(paths, args({ 'verification-confirmed': true }), fake), /SYMLINK|INTEGRITY/);
  assert.equal(fake.calls.length, 0);
  assert.deepEqual(fs.readFileSync(outside), original);
});

test('an async acquisition lock rejects concurrent continuation without a second source operation', async context => {
  const { paths } = fixture(context);
  const fake = executor({ results: { posts: [] } });
  let release;
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  const first = runWeixinChannelsAcquire(paths, args(), {
    runProcess: async (bin, argv) => {
      if (argv[1] === 'overview') { entered(); await wait; }
      return fake.runProcess(bin, argv);
    },
  });
  await ready;
  const second = executor();
  try {
    await assert.rejects(runWeixinChannelsAcquire(paths, args(), second), /BUSY/);
    assert.equal(second.calls.length, 0);
  } finally { release(); assert.equal((await first).ok, true); }
});

test('retains a stale execution lock instead of reclaiming an uncertain run', async context => {
  const { root, paths } = await pausedFixture(context);
  const lock = path.join(path.dirname(rawDir(root)), '.execution.lock');
  fs.mkdirSync(lock);
  const fake = executor();
  await assert.rejects(runWeixinChannelsAcquire(paths, args({ 'verification-confirmed': true }), fake), /BUSY/);
  assert.equal(fs.existsSync(lock), true);
  assert.equal(fake.calls.length, 0);
});

test('an authenticated in-flight checkpoint cannot be recovered by scanning existing raw data', async context => {
  const { root, paths } = await pausedFixture(context);
  const state = checkpoint(root);
  state.phase = 'executing';
  const bytes = Buffer.from(`${JSON.stringify(state, null, 2)}\n`);
  fs.writeFileSync(checkpointFile(root), bytes);
  const { session } = loadSession(paths);
  session.task.weixinChannelsAcquisitionRuns[0].sha256 = digest(bytes);
  persistSession(paths, session);
  const fake = executor();
  await assert.rejects(runWeixinChannelsAcquire(paths, args({ 'verification-confirmed': true }), fake), /INTERRUPTED/);
  assert.equal(fake.calls.length, 0);
  assert.equal(fs.existsSync(path.join(rawDir(root), 'sources.json')), false);
});

test('post-overview queries keep their original date window when resumed on another day', async context => {
  const { paths } = await pausedFixture(context);
  const fake = executor({ results: { posts: [] } });
  const result = await runWeixinChannelsAcquire(paths, args({ 'verification-confirmed': true }), { ...fake, now: () => Date.UTC(2026, 10, 1) });
  assert.equal(result.ok, true);
  for (const call of sourceCalls(fake)) {
    assert.equal(call.args.includes('--days'), false);
    assert.equal(call.args[call.args.indexOf('--start-date') + 1], '2026-10-06');
    assert.equal(call.args[call.args.indexOf('--end-date') + 1], '2026-10-12');
  }
});

test('resumes the second post detail using the authenticated posts list and stable detail filenames', async context => {
  const { root, paths } = fixture(context);
  const fake = executor();
  const paused = await runWeixinChannelsAcquire(paths, args(), {
    runProcess: async (bin, argv) => argv[1] === 'post-detail' && argv[2] === '2'
      ? { exitCode: 77, stdout: '', stderr: '{"error":{"code":"AUTH_REQUIRED"}}' }
      : fake.runProcess(bin, argv),
  });
  assert.equal(paused.phase, 'waiting-confirmation');
  assert.equal(paused.commandCount, 5);
  const prefix = fs.readFileSync(path.join(rawDir(root), 'post-detail-0001.json'));
  const next = executor();
  const result = await runWeixinChannelsAcquire(paths, args({ 'verification-confirmed': true }), next);
  assert.equal(result.ok, true);
  assert.equal(result.detailCount, 2);
  assert.deepEqual(sourceCalls(next).map(call => call.args.slice(1, 3)), [['post-detail', '2']]);
  assert.deepEqual(fs.readFileSync(path.join(rawDir(root), 'post-detail-0001.json')), prefix);
  assert.equal(JSON.parse(fs.readFileSync(path.join(rawDir(root), 'post-detail-0002.json')))[0].id, '2');
});

test('does not reinterpret an explicit COMMAND_EXEC auth hint as an authentication pause', async context => {
  const { root, paths } = fixture(context);
  const fake = executor({ fail: 'overview', exitCode: 1,
    stderr: '{"error":{"code":"COMMAND_EXEC","message":"prior AUTH_REQUIRED diagnostic"}}' });
  const result = await runWeixinChannelsAcquire(paths, args(), fake);
  assert.equal(result.phase, 'stopped');
  assert.equal(result.requiresUserAction, false);
  assert.equal(result.errorCode, 'COMMAND_EXEC');
  assert.equal(inventory(paths)[0].materialization.status, 'failed');
  assert.equal(checkpoint(root).phase, 'stopped');
});

test('uses a typed AUTH_REQUIRED code even when stdout contains an unrelated TIMEOUT diagnostic', async context => {
  const { paths } = fixture(context);
  const fake = executor();
  const result = await runWeixinChannelsAcquire(paths, args(), {
    runProcess: (bin, argv) => argv[1] === 'overview'
      ? { exitCode: 77, stdout: 'TIMEOUT unrelated diagnostic', stderr: '{"error":{"code":"AUTH_REQUIRED"}}' }
      : fake.runProcess(bin, argv),
  });
  assert.equal(result.phase, 'waiting-confirmation');
  assert.equal(result.errorCode, 'AUTH_REQUIRED');
  const next = executor({ results: { posts: [] } });
  assert.equal((await runWeixinChannelsAcquire(paths, args({ 'verification-confirmed': true }), next)).ok, true);
});

test('typed TIMEOUT remains non-auth even when stdout contains AUTH_REQUIRED', async context => {
  const { paths } = fixture(context);
  const fake = executor();
  const result = await runWeixinChannelsAcquire(paths, args(), {
    runProcess: (bin, argv) => argv[1] === 'overview'
      ? { exitCode: 75, stdout: 'AUTH_REQUIRED unrelated diagnostic', stderr: '{"error":{"code":"TIMEOUT"}}' }
      : fake.runProcess(bin, argv),
  });
  assert.equal(result.phase, 'stopped');
  assert.equal(result.errorCode, 'TIMEOUT');
  assert.equal(result.requiresUserAction, false);
});

test('changing item-id cannot replace a registered authentication operation or reset its Gate budget', async context => {
  const { root, paths } = await pausedFixture(context, 'overview');
  const fake = executor();
  await assert.rejects(runWeixinChannelsAcquire(paths, args({ 'item-id': 'replacement' }), fake), /IDENTITY.*CONFLICT/);
  assert.equal(fake.calls.length, 0);
  assert.equal(fs.existsSync(path.join(path.dirname(rawDir(root)), 'replacement')), false);
});

test('the async execution lock covers another item-id in the same session', async context => {
  const { paths } = fixture(context);
  const fake = executor({ results: { posts: [] } });
  let release;
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  const first = runWeixinChannelsAcquire(paths, args(), {
    runProcess: async (bin, argv) => {
      if (argv[1] === 'overview') { entered(); await wait; }
      return fake.runProcess(bin, argv);
    },
  });
  await ready;
  const second = executor();
  try {
    await assert.rejects(runWeixinChannelsAcquire(paths, args({ 'item-id': 'parallel' }), second), /BUSY/);
    assert.equal(second.calls.length, 0);
  } finally { release(); assert.equal((await first).ok, true); }
});

for (const kind of ['checkpoint', 'prefix']) {
  test(`does not accept ${kind} tampering while a source operation is in flight`, async context => {
    const { root, paths } = fixture(context);
    const fake = executor();
    const result = await runWeixinChannelsAcquire(paths, args(), {
      runProcess: async (bin, argv) => {
        const outcome = await fake.runProcess(bin, argv);
        if (argv[1] === 'sources') fs.appendFileSync(kind === 'checkpoint' ? checkpointFile(root) : path.join(rawDir(root), 'overview.json'), ' ');
        return outcome;
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'CHECKPOINT_INTEGRITY');
    assert.equal(sourceCalls(fake).some(call => call.args[1] === 'posts'), false);
    assert.equal(fs.existsSync(path.join(rawDir(root), 'executor-result.json')), false);
  });
}
