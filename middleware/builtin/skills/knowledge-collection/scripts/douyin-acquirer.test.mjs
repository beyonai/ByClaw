import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cmdInit } from './research-state.mjs';
import { loadSession, sessionPaths } from './session.mjs';
import { runDouyinAcquire } from './douyin-acquirer.mjs';

const SOURCE = 'https://v.douyin.com/RpopXC5PB9c/';
const ID = '18446744073709551615';
const VIDEO = Buffer.concat([Buffer.from('000000186674797069736f6d00000200', 'hex'), Buffer.from('fixture media')]);
const BROWSER = [
  { name: 'keep-tab', choices: ['true', 'false'] },
  { name: 'site-session', choices: ['ephemeral', 'persistent'] },
  { name: 'window', choices: ['foreground', 'background'] },
];
const args = extra => ({ 'item-id': 'video', 'source-url': SOURCE, ...extra });
function fixture(t, extra = {}, source = SOURCE) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-douyin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  cmdInit({ 'session-dir': root, query: '归档抖音视频', 'source-scope': '["public-internet"]',
    'direct-urls': JSON.stringify([source]), 'required-content-granularity': 'any' });
  const paths = sessionPaths(root);
  if (Object.keys(extra).length) {
    const { session } = loadSession(paths);
    Object.assign(session.task, extra);
    fs.writeFileSync(paths.session, JSON.stringify(session));
  }
  return { root, paths };
}
function executor(options = {}) {
  const calls = [];
  const runProcess = async (bin, argv, processOptions) => {
    calls.push({ bin, argv, processOptions });
    const ok = value => ({ exitCode: 0, stdout: JSON.stringify(value), stderr: '' });
    if (argv[0] === 'list') return ok(['download', 'read'].map(name => ({ site: 'douyin', name })));
    if (argv.includes('--help')) return ok({ site: 'douyin', name: argv[1], access: 'read', browser: true,
      domain: 'www.douyin.com', positionals: [{ name: 'target' }],
      command_options: (argv[1] === 'download' ? ['output', 'metadata'] : ['comments', 'replies']).map(name => ({ name })),
      common_options: [{ name: 'format', choices: ['json'] }], browser_common_options: BROWSER });
    if (bin === process.execPath) return ok({ ok: true, code: 'BRIDGE_READY' });
    if (options.fail?.(argv[1])) return { exitCode: Object.hasOwn(options, 'exitCode') ? options.exitCode : options.auth ? 77 : 1, stdout: '',
      stderr: JSON.stringify({ error: { code: options.errorCode ?? (options.auth ? 'AUTH_REQUIRED' : 'API_ERROR') } }) };
    if (argv[1] === 'download') {
      const dir = argv[argv.indexOf('--output') + 1];
      fs.mkdirSync(dir, { recursive: true });
      const video = path.join(dir, `${ID}.mp4`), metadata = path.join(dir, `${ID}.json`);
      fs.writeFileSync(video, options.html ? '<html>login</html>' : VIDEO);
      fs.writeFileSync(metadata, JSON.stringify({ aweme_id: ID, url: `https://www.douyin.com/video/${ID}`,
        title: '傅作义点破女儿傅冬菊的身份', media_type: 'video', author: { nickname: '红色范儿' } }));
      return ok([{ aweme_id: ID, type: 'video', status: 'success', path: options.escape || video, bytes: fs.statSync(video).size },
        { aweme_id: ID, type: 'metadata', status: 'success', path: metadata, bytes: fs.statSync(metadata).size }]);
    }
    return ok([{ work: { aweme_id: options.wrongId ? '99' : ID, media_type: 'video' }, comments: null,
      subtitles: options.noSubtitles ? [] : [{ source: 'official_subtitle', language: 'zh', format: 'vtt',
        status: 'available', cues: [{ from: 0, to: 1.25, text: '姜还是老的辣啊' }] }],
      limitations: options.noSubtitles ? ['No official subtitles were exposed by the work metadata.'] : [] }]);
  };
  return { calls, runProcess };
}

test('archives a verified video, safe metadata and normalized official JSON/VTT subtitles', async t => {
  const { paths, root } = fixture(t), fake = executor();
  const result = await runDouyinAcquire(paths, args(), fake);
  assert.equal(result.ok, true);
  const receipt = JSON.parse(fs.readFileSync(result.executorResultFile));
  assert.equal(receipt.workId, ID);
  assert.equal(receipt.subtitleStatus, 'available');
  assert.deepEqual(receipt.files.map(file => file.kind), ['video', 'metadata', 'subtitle-json', 'subtitle-vtt']);
  const subtitle = receipt.files.find(file => file.kind === 'subtitle-vtt');
  assert.match(fs.readFileSync(path.join(root, subtitle.artifact), 'utf8'), /00:00:00\.000 --> 00:00:01\.250\n姜还是老的辣啊/);
  assert.deepEqual(fs.readFileSync(path.join(root, receipt.files[0].artifact)), VIDEO);
  assert.equal(loadSession(paths).session.task.douyinAcquisitions.length, 1);
  const commands = fake.calls.filter(call => call.argv[0] === 'douyin' && !call.argv.includes('--help'));
  assert.deepEqual(commands.map(call => call.argv[1]), ['download', 'read']);
  assert.equal(commands[1].argv[2], `https://www.douyin.com/video/${ID}`);
  const before = fake.calls.length;
  assert.equal((await runDouyinAcquire(paths, args(), fake)).idempotent, true);
  assert.equal(fake.calls.length, before);
});

test('missing official subtitles still completes video acquisition without ASR', async t => {
  const { paths } = fixture(t), fake = executor({ noSubtitles: true });
  const result = await runDouyinAcquire(paths, args(), fake);
  assert.equal(result.ok, true);
  const receipt = JSON.parse(fs.readFileSync(result.executorResultFile));
  assert.equal(receipt.subtitleStatus, 'not-provided');
  assert.deepEqual(receipt.files.map(file => file.kind), ['video', 'metadata']);
  assert.equal(fake.calls.some(call => /ffmpeg|whisper|transcrib/.test(call.bin)), false);
});

test('modal links preserve authorized source and verify the downloaded work before reading subtitles', async t => {
  const source = `https://www.douyin.com/jingxuan?modal_id=${ID}`;
  const { paths } = fixture(t, {}, source), fake = executor();
  const result = await runDouyinAcquire(paths, args({ 'source-url': source }), fake);
  assert.equal(result.ok, true);
  const receipt = JSON.parse(fs.readFileSync(result.executorResultFile));
  assert.equal(receipt.sourceUrl, source);
  assert.equal(receipt.workId, ID);
  const commands = fake.calls.filter(call => call.argv[0] === 'douyin' && !call.argv.includes('--help'));
  assert.equal(commands[0].argv[2], source);
  assert.equal(commands[1].argv[2], `https://www.douyin.com/video/${ID}`);
});

test('modal work mismatch stops before subtitle acquisition or registering a successful receipt', async t => {
  const source = 'https://www.douyin.com/jingxuan?modal_id=99';
  const { paths } = fixture(t, {}, source), fake = executor();
  const result = await runDouyinAcquire(paths, args({ 'source-url': source }), fake);
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'DOUYIN_WORK_ID_MISMATCH');
  assert.equal(fake.calls.some(call => call.argv[1] === 'read' && !call.argv.includes('--help')), false);
  assert.equal(loadSession(paths).session.task.douyinAcquisitions?.length || 0, 0);
});

test('download and subtitle subprocesses receive independent default budgets with cleanup headroom', async t => {
  const { paths } = fixture(t), fake = executor();
  const environment = Object.freeze({ PATH: '/fixture/bin' });
  assert.equal((await runDouyinAcquire(paths, args(), { ...fake, environment })).ok, true);
  const commands = fake.calls.filter(call => call.argv[0] === 'douyin' && !call.argv.includes('--help'));
  assert.deepEqual(commands.map(call => [call.argv[1], call.processOptions.timeoutMs,
    call.processOptions.env.BYCLI_BROWSER_COMMAND_TIMEOUT]), [['download', 360000, '300'], ['read', 120000, '60']]);
  for (const command of commands) assert.equal(command.processOptions.env.PATH, environment.PATH);
  assert.equal(fake.calls[0].processOptions.env, environment);
  assert.equal(environment.BYCLI_BROWSER_COMMAND_TIMEOUT, undefined);
});

for (const [environment, expectedOuter] of [
  [{ BYCLI_BROWSER_COMMAND_TIMEOUT: '900' }, 960000],
  [{ BYCLI_BROWSER_COMMAND_TIMEOUT: '900', KNOWLEDGE_COLLECTION_CLI_TIMEOUT_MS: '1200000' }, 1200000],
]) {
  test(`honors a longer browser budget and a compatible explicit outer budget ${JSON.stringify(environment)}`, async t => {
    const { paths } = fixture(t), fake = executor();
    const original = { ...environment };
    assert.equal((await runDouyinAcquire(paths, args(), { ...fake, environment: Object.freeze(environment) })).ok, true);
    const commands = fake.calls.filter(call => call.argv[0] === 'douyin' && !call.argv.includes('--help'));
    for (const command of commands) {
      assert.equal(command.processOptions.timeoutMs, expectedOuter);
      assert.equal(command.processOptions.env.BYCLI_BROWSER_COMMAND_TIMEOUT, '900');
    }
    assert.deepEqual(environment, original);
  });
}

for (const environment of [
  ...['0', '-1', '', '1.5', 'Infinity', '1e3', '2147424'].map(value => ({ BYCLI_BROWSER_COMMAND_TIMEOUT: value })),
  ...['0', '-1', '', '1.5', '2147483648', '300000'].map(value => ({ KNOWLEDGE_COLLECTION_CLI_TIMEOUT_MS: value })),
  { BYCLI_BROWSER_COMMAND_TIMEOUT: '900', KNOWLEDGE_COLLECTION_CLI_TIMEOUT_MS: '900000' },
  { BYCLI_BROWSER_COMMAND_TIMEOUT: '60', KNOWLEDGE_COLLECTION_CLI_TIMEOUT_MS: '120000' },
]) {
  test(`rejects invalid or insufficient timeout budget before external execution and state writes ${JSON.stringify(environment)}`, async t => {
    const { paths, root } = fixture(t), fake = executor();
    const previousSession = fs.readFileSync(paths.session);
    await assert.rejects(runDouyinAcquire(paths, args(), { ...fake, environment }), /DOUYIN_TIMEOUT_CONFIG_INVALID/);
    assert.equal(fake.calls.length, 0);
    assert.equal(fs.existsSync(path.join(root, 'raw/bycli/douyin')), false);
    assert.deepEqual(fs.readFileSync(paths.session), previousSession);
  });
}

test('increasing the timeout after uncertain execution cannot replay the stopped acquisition', async t => {
  const { paths } = fixture(t), fake = executor({ fail: command => command === 'download', exitCode: 75, errorCode: 'TIMEOUT' });
  const result = await runDouyinAcquire(paths, args(), { ...fake, environment: {} });
  assert.equal(result.errorCode, 'COMMAND_EXEC_UNCERTAIN');
  assert.equal(result.phase, 'stopped');
  const before = fake.calls.length;
  await assert.rejects(runDouyinAcquire(paths, args(), { ...fake, environment: { BYCLI_BROWSER_COMMAND_TIMEOUT: '900' } }), /ACQUISITION_STOPPED/);
  assert.equal(fake.calls.length, before);
});

test('optional subtitle API failure preserves the successful video archive', async t => {
  const { paths } = fixture(t), fake = executor({ fail: command => command === 'read' });
  const result = await runDouyinAcquire(paths, args(), fake);
  assert.equal(result.ok, true);
  assert.equal(JSON.parse(fs.readFileSync(result.executorResultFile)).subtitleStatus, 'unavailable');
});

for (const options of [{ html: true }, { escape: '/etc/hosts' }, { wrongId: true }]) {
  test(`rejects corrupt media, escaped paths or mismatched work identity ${JSON.stringify(options)}`, async t => {
    const { paths } = fixture(t);
    const result = await runDouyinAcquire(paths, args(), executor(options));
    assert.equal(result.ok, false);
    assert.equal(loadSession(paths).session.task.douyinAcquisitions?.length || 0, 0);
  });
}

for (const extra of [{ requiredContentGranularity: 'full-text' }, { sourceScope: ['cloud-knowledge'] }, { workflow: 'public-collect' }]) {
  test(`rejects incompatible task policy before external commands ${JSON.stringify(extra)}`, async t => {
    const { paths } = fixture(t, extra), fake = executor();
    await assert.rejects(runDouyinAcquire(paths, args(), fake));
    assert.equal(fake.calls.length, 0);
  });
}

test('rejects unauthorized URLs, unsafe identifiers and premature confirmation before external commands', async t => {
  const { paths } = fixture(t), fake = executor();
  for (const input of [{ 'source-url': 'https://www.douyin.com/video/99' }, { 'source-url': 'https://example.com/' },
    { 'item-id': '../escape' }, { 'verification-confirmed': 'yes' }, { 'verification-confirmed': true }]) {
    await assert.rejects(runDouyinAcquire(paths, args(input), fake));
  }
  assert.equal(fake.calls.length, 0);
});

test('rejects non-string item identifiers before external commands', async t => {
  const { paths } = fixture(t), fake = executor();
  for (const value of [true, 99, [], {}]) await assert.rejects(runDouyinAcquire(paths, args({ 'item-id': value }), fake));
  assert.equal(fake.calls.length, 0);
});

test('auth pause preserves download and resumes only the paused read after explicit confirmation', async t => {
  const { paths, root } = fixture(t);
  let locked = true;
  const fake = executor({ auth: true, fail: command => command === 'read' && locked });
  const paused = await runDouyinAcquire(paths, args(), fake);
  assert.equal(paused.phase, 'waiting-confirmation');
  assert.equal(paused.requiresUserAction, true);
  const count = fake.calls.length;
  assert.equal((await runDouyinAcquire(paths, args(), fake)).requiresUserAction, true);
  assert.equal(fake.calls.length, count);
  locked = false;
  const resumed = await runDouyinAcquire(paths, args({ 'verification-confirmed': true }), fake);
  assert.equal(resumed.ok, true);
  assert.equal(fake.calls.filter(call => call.argv[1] === 'download' && !call.argv.includes('--help')).length, 1);
  assert.equal(fake.calls.filter(call => call.bin === process.execPath).length, 1);
  assert.deepEqual(fs.readFileSync(path.join(root, 'raw/bycli/douyin/video/download', `${ID}.mp4`)), VIDEO);
});

test('bridge failure never executes source commands or automatically repeats recovery', async t => {
  const { paths } = fixture(t), fake = executor();
  let bridges = 0;
  const options = { ...fake, bridgeBootstrap: async () => { bridges++; return { ok: false, code: 'BRIDGE_UNAVAILABLE' }; } };
  const result = await runDouyinAcquire(paths, args(), options);
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'BRIDGE_UNAVAILABLE');
  assert.equal(fake.calls.some(call => call.argv[1] === 'download' && !call.argv.includes('--help')), false);
  await assert.rejects(runDouyinAcquire(paths, args(), options));
  assert.equal(bridges, 1);
});

for (const [exitCode, errorCode] of [[69, 'BROWSER_CONNECT'], [75, 'TIMEOUT'], [75, 'RATE_LIMITED'], [1, 'UNKNOWN'], [null, 'UNKNOWN']]) {
  test(`subtitle ${errorCode} stops acquisition instead of claiming a successful archive`, async t => {
    const { paths } = fixture(t), fake = executor({ fail: command => command === 'read', exitCode, errorCode });
    const result = await runDouyinAcquire(paths, args(), fake);
    assert.equal(result.ok, false);
    assert.equal(loadSession(paths).session.task.douyinAcquisitions?.length || 0, 0);
    const count = fake.calls.length;
    if (result.requiresUserAction) await runDouyinAcquire(paths, args(), fake);
    else await assert.rejects(runDouyinAcquire(paths, args(), fake));
    assert.equal(fake.calls.length, count);
  });
}
