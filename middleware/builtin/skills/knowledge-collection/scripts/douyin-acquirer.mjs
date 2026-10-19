import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorizePublicSource } from './discovery-authorization.mjs';
import { recordFailedCollectionItem, recordPendingCollectionItem } from './collection-state.mjs';
import { assertExternalSessionWriteAllowed } from './probe-state.mjs';
import { runCli } from './enterprise/shared/cli-runner.mjs';
import { assertNoSensitiveKeys, loadSession, persistSession, withSessionLock } from './session.mjs';
import { assertPolicy, digest, ensureDirectory, fileEntry, safeFile, sourceUrl, sourceWorkId, workUrl } from './douyin-artifacts.mjs';

const ACTION = 'acquire-douyin';
const HUMAN_ERRORS = new Set(['AUTH_REQUIRED', 'CAPTCHA', 'MFA_REQUIRED', 'ENVIRONMENT_VALIDATION', 'RATE_LIMITED']);
const BRIDGE_SCRIPT = fileURLToPath(new URL('../../bycli/scripts/bridge-bootstrap.mjs', import.meta.url));
const fail = code => { throw Object.assign(new Error(code), { code }); };
const relative = (root, file) => path.relative(root, file).split(path.sep).join('/');
function commandBudgets(environment) {
  const maxTimeoutMs = 2147483647;
  const parse = value => {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)
      || !Number.isSafeInteger(Number(value)) || Number(value) > maxTimeoutMs) fail('DOUYIN_TIMEOUT_CONFIG_INVALID');
    return Number(value);
  };
  const browserSeconds = parse(environment.BYCLI_BROWSER_COMMAND_TIMEOUT);
  const outerMs = parse(environment.KNOWLEDGE_COLLECTION_CLI_TIMEOUT_MS);
  return Object.fromEntries([['download', 300, 300000], ['read', 60, 120000]].map(([command, defaultSeconds, minimumMs]) => {
    const innerSeconds = browserSeconds ?? defaultSeconds;
    // Let byCLI finish and report its own timeout before terminating its process group.
    const requiredMs = Math.max(minimumMs, innerSeconds * 1000 + 60000);
    if (requiredMs > maxTimeoutMs || outerMs !== undefined && outerMs < requiredMs) fail('DOUYIN_TIMEOUT_CONFIG_INVALID');
    return [command, { timeoutMs: outerMs ?? requiredMs,
      env: { ...environment, BYCLI_BROWSER_COMMAND_TIMEOUT: String(innerSeconds) } }];
  }));
}
function codeOf(value) {
  const text = `${value?.stderr || ''} ${value?.stdout || ''} ${value?.message || ''}`;
  if (value?.timedOut || value?.signal || value?.exitCode === null || /timeout/i.test(text)) return 'COMMAND_EXEC_UNCERTAIN';
  for (const output of [value?.stdout, value?.stderr]) {
    try {
      const code = JSON.parse(output)?.error?.code;
      if (typeof code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(code)) return code;
    } catch { /* Some byCLI versions print their typed error as plain text. */ }
  }
  for (const code of [...HUMAN_ERRORS, 'BROWSER_CONNECT', 'BRIDGE_UNAVAILABLE', 'BRIDGE_RECOVERY_BUSY', 'API_ERROR', 'EMPTY_RESULT']) {
    if (value?.code === code || new RegExp(`\\b${code}\\b`).test(text)) return code;
  }
  if (value?.exitCode === 77) return 'AUTH_REQUIRED';
  if (value?.exitCode === 69) return 'BROWSER_CONNECT';
  return value?.code || 'COMMAND_EXEC';
}
function parsed(outcome) {
  if (outcome?.exitCode !== 0 || outcome.failure || outcome.timedOut) fail(codeOf(outcome));
  if (outcome.truncated || typeof outcome.stdout !== 'string'
    || Buffer.byteLength(outcome.stdout) > 10 * 1024 * 1024) fail('EXECUTOR_OUTPUT_TRUNCATED');
  let result;
  try { result = JSON.parse(outcome.stdout); } catch { fail('EXECUTOR_OUTPUT_INVALID'); }
  assertNoSensitiveKeys(result, 'douyin output');
  return result;
}
function validateHelp(list, help, command) {
  if (!Array.isArray(list) || !list.some(row => row.site === 'douyin' && row.name === command)
    || help?.site !== 'douyin' || help.name !== command || help.access !== 'read'
    || help.browser !== true || help.domain !== 'www.douyin.com'
    || !help.positionals?.some(arg => arg.name === 'target')
    || !help.common_options?.some(arg => arg.name === 'format' && arg.choices?.includes('json'))) fail('ADAPTER_UNAVAILABLE');
  for (const name of command === 'download' ? ['output', 'metadata'] : ['comments', 'replies']) {
    if (!help.command_options?.some(arg => arg.name === name)) fail('ADAPTER_UNAVAILABLE');
  }
  for (const [name, choice] of [['keep-tab', 'true'], ['site-session', 'persistent'], ['window', 'background']]) {
    if (!help.browser_common_options?.some(arg => arg.name === name && arg.choices?.includes(choice))) fail('ADAPTER_UNAVAILABLE');
  }
}
function verifyEntries(paths, files) {
  for (const entry of files) {
    const actual = fileEntry(paths.root, path.join(paths.root, entry.artifact), entry.kind);
    if (actual.size !== entry.size || actual.sha256 !== entry.sha256) fail('CHECKPOINT_INTEGRITY');
  }
}
function saveState(paths, target, state) {
  withSessionLock(paths, ACTION, () => {
    const { session } = loadSession(paths, { persistMigration: false });
    assertPolicy(session);
    const filename = path.join(target, 'acquisition-state.json');
    const bytes = Buffer.from(`${JSON.stringify(state, null, 2)}\n`);
    const previous = (session.task.douyinAcquisitionRuns || []).find(row => row.itemId === state.itemId);
    if (fs.existsSync(filename)) {
      if (!previous || previous.artifact !== relative(paths.root, filename)
        || digest(fs.readFileSync(safeFile(paths.root, filename))) !== previous.sha256) fail('CHECKPOINT_INTEGRITY');
    } else if (previous) fail('CHECKPOINT_INTEGRITY');
    ensureDirectory(paths.root, relative(paths.root, target));
    const temporary = `${filename}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, filename);
    session.task.douyinAcquisitionRuns = [...(session.task.douyinAcquisitionRuns || []).filter(row => row.itemId !== state.itemId),
      { itemId: state.itemId, sourceUrl: state.sourceUrl, artifact: relative(paths.root, filename), sha256: digest(bytes) }];
    persistSession(paths, session);
  });
}
function savedResult(paths, target, state, idempotent = false) {
  verifyEntries(paths, state.files);
  const filename = safeFile(paths.root, path.join(target, 'executor-result.json'));
  const { session } = loadSession(paths, { persistMigration: false });
  const entry = session.task.douyinAcquisitions?.find(row => row.itemId === state.itemId);
  if (!entry || entry.sourceUrl !== state.sourceUrl || entry.artifact !== relative(paths.root, filename)
    || digest(fs.readFileSync(filename)) !== entry.sha256) fail('CHECKPOINT_INTEGRITY');
  return { ok: true, action: ACTION, itemId: state.itemId, executorResultFile: filename,
    subtitleStatus: state.subtitleStatus, idempotent };
}
function pauseResult(state) {
  return { ok: false, action: ACTION, itemId: state.itemId, sourceUrl: state.sourceUrl,
    phase: state.phase, status: 'pending', errorCode: state.errorCode,
    requiresUserAction: state.phase === 'waiting-confirmation', failedCommand: state.step };
}
function videoEntries(paths, target, rows, requestedUrl) {
  if (!Array.isArray(rows) || rows.length !== 2 || rows.some(row => row.status !== 'success')) fail('DOUYIN_DOWNLOAD_INCOMPLETE');
  const video = rows.find(row => row.type === 'video'), metadata = rows.find(row => row.type === 'metadata');
  if (!video || !metadata || typeof video.aweme_id !== 'string' || metadata.aweme_id !== video.aweme_id) fail('DOUYIN_WORK_ID_INVALID');
  const id = video.aweme_id, canonicalUrl = workUrl(id);
  const requestedId = sourceWorkId(requestedUrl);
  if (requestedId && requestedId !== id) fail('DOUYIN_WORK_ID_MISMATCH');
  const files = [video, metadata].map(row => {
    const expected = path.join(target, 'download', `${id}.${row.type === 'video' ? 'mp4' : 'json'}`);
    if (typeof row.path !== 'string' || path.resolve(row.path) !== expected) fail('DOUYIN_PATH_INVALID');
    const entry = fileEntry(paths.root, expected, row.type);
    if (row.bytes !== entry.size) fail('DOUYIN_DOWNLOAD_INCOMPLETE');
    return entry;
  });
  const header = Buffer.alloc(12), fd = fs.openSync(safeFile(paths.root, video.path), 'r');
  try { fs.readSync(fd, header, 0, header.length, 0); } finally { fs.closeSync(fd); }
  if (header.toString('ascii', 4, 8) !== 'ftyp') fail('DOUYIN_MEDIA_INVALID');
  const document = JSON.parse(fs.readFileSync(safeFile(paths.root, metadata.path), 'utf8'));
  assertNoSensitiveKeys(document, 'metadata');
  if (document.aweme_id !== id || document.url !== canonicalUrl || document.media_type !== 'video') fail('DOUYIN_WORK_ID_MISMATCH');
  return { id, canonicalUrl, files };
}
function timestamp(seconds) {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
function saveSubtitles(paths, target, state, rows) {
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.work?.aweme_id !== state.workId) fail('DOUYIN_WORK_ID_MISMATCH');
  const evidence = rows[0];
  if (!Array.isArray(evidence.subtitles) || evidence.subtitles.length > 3) fail('EXECUTOR_OUTPUT_INVALID');
  state.limitations.push(...(Array.isArray(evidence.limitations) ? evidence.limitations.filter(text => typeof text === 'string') : []));
  const available = [];
  for (const track of evidence.subtitles) {
    if (track?.status !== 'available') continue;
    if (track.source !== 'official_subtitle' || !Array.isArray(track.cues) || !track.cues.length || track.cues.length > 10000
      || track.cues.some(cue => !Number.isFinite(cue.from) || !Number.isFinite(cue.to) || cue.from < 0 || cue.to < cue.from
        || typeof cue.text !== 'string' || !cue.text.trim())) continue;
    if (Buffer.byteLength(JSON.stringify(track)) > 2 * 1024 * 1024) continue;
    available.push(track);
  }
  state.subtitleStatus = available.length ? 'available' : evidence.subtitles.length ? 'unavailable' : 'not-provided';
  for (const [index, track] of available.entries()) {
    const stem = `subtitle-${String(index + 1).padStart(2, '0')}`;
    const normalized = { source: 'official_subtitle', status: 'available', language: typeof track.language === 'string' ? track.language : null,
      format: track.format, cues: track.cues.map(({ from, to, text }) => ({ from, to, text })) };
    const vtt = `WEBVTT\n\n${normalized.cues.map(cue => `${timestamp(cue.from)} --> ${timestamp(cue.to)}\n${cue.text.replace(/-->/g, '→')}\n`).join('\n')}`;
    for (const [extension, kind, contents] of [['json', 'subtitle-json', `${JSON.stringify(normalized, null, 2)}\n`], ['vtt', 'subtitle-vtt', vtt]]) {
      const filename = path.join(target, `${stem}.${extension}`);
      fs.writeFileSync(filename, contents, { flag: 'wx', mode: 0o600 });
      state.files.push(fileEntry(paths.root, filename, kind));
    }
  }
  if (available.length < evidence.subtitles.length) state.limitations.push('部分官方字幕未能归档；视频文件已独立保存。');
}

export async function runDouyinAcquire(paths, args, options = {}) {
  const itemId = args?.['item-id'];
  if (typeof itemId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(itemId)) throw new Error('DOUYIN_ITEM_ID_INVALID');
  const url = sourceUrl(args?.['source-url']);
  const confirmation = args?.['verification-confirmed'] ?? false;
  if (![true, false, 'true', 'false'].includes(confirmation)) throw new Error('DOUYIN_CONFIRMATION_INVALID');
  const confirmed = confirmation === true || confirmation === 'true';
  const budgets = commandBudgets(options.environment || process.env);
  assertExternalSessionWriteAllowed(paths, ACTION);
  const { session } = loadSession(paths, { persistMigration: false });
  assertPolicy(session);
  if (authorizePublicSource(session.task.discoveryGate, url)?.origin !== 'user-provided') throw new Error('SOURCE_NOT_AUTHORIZED_BY_DISCOVERY');
  const parent = path.join(paths.root, 'raw/bycli/douyin'), target = path.join(parent, itemId);
  if (confirmed && !fs.existsSync(target)) throw new Error('ACQUISITION_CONFIRMATION_NOT_PENDING');
  ensureDirectory(paths.root, relative(paths.root, parent));
  const lock = path.join(parent, '.execution.lock');
  try { fs.mkdirSync(lock, { mode: 0o700 }); } catch (error) { if (error.code === 'EEXIST') fail('ACQUISITION_BUSY'); throw error; }
  try {
    return await acquireLocked(paths, target, itemId, url, confirmed, options, budgets);
  } finally { fs.rmdirSync(lock); }
}
async function acquireLocked(paths, target, itemId, url, confirmed, options, budgets) {
  const runProcess = options.runProcess || runCli;
  const environment = options.environment || process.env;
  const execute = (bin, argv, budget = {}) => runProcess(bin, argv,
    { timeoutMs: 60000, maxOutputBytes: 10 * 1024 * 1024, env: environment, ...budget });
  const { session } = loadSession(paths, { persistMigration: false });
  const runs = session.task.douyinAcquisitionRuns || [];
  if (runs.some(row => row.sourceUrl === url && row.itemId !== itemId)) fail('ACQUISITION_IDENTITY_CONFLICT');
  let state;
  const stateFile = path.join(target, 'acquisition-state.json');
  const existed = fs.existsSync(target);
  if (existed) {
    const bytes = fs.readFileSync(safeFile(paths.root, stateFile));
    const registered = runs.find(row => row.itemId === itemId);
    if (!registered || registered.sha256 !== digest(bytes) || registered.artifact !== relative(paths.root, stateFile)) fail('CHECKPOINT_INTEGRITY');
    state = JSON.parse(bytes);
    if (state.itemId !== itemId || state.sourceUrl !== url) fail('ACQUISITION_IDENTITY_CONFLICT');
    verifyEntries(paths, state.files);
    if (state.phase === 'saved') {
      if (confirmed) fail('ACQUISITION_CONFIRMATION_NOT_PENDING');
      return savedResult(paths, target, state, true);
    }
    if (state.phase !== 'waiting-confirmation') fail('ACQUISITION_STOPPED');
    if (!confirmed) return pauseResult(state);
  } else {
    if (confirmed) fail('ACQUISITION_CONFIRMATION_NOT_PENDING');
    state = { schemaVersion: '1.0', itemId, sourceUrl: url, phase: 'initializing', step: 'download', files: [], limitations: [], subtitleStatus: 'not-provided' };
    ensureDirectory(paths.root, relative(paths.root, target));
  }
  const base = { itemId, source: 'public-internet', sourceSkill: 'bycli', backend: 'bycli', sourceUrl: url, title: '抖音视频归档' };
  const record = (failed, reason, extra = []) => {
    assertPolicy(loadSession(paths, { persistMigration: false }).session);
    const result = (failed ? recordFailedCollectionItem : recordPendingCollectionItem)(paths,
      { ...base, rawArtifacts: [...state.files.map(file => file.artifact), ...extra], reason }, ACTION);
    if (result.preservedMaterialized) fail('ACQUISITION_CONFLICT');
  };
  try {
    saveState(paths, target, state);
    record(false, 'acquiring');
    if (!existed) {
      const list = parsed(await execute('bycli', ['list', '-f', 'json']));
      for (const command of ['download', 'read']) validateHelp(list, parsed(await execute('bycli', ['douyin', command, '--help', '-f', 'json'])), command);
      const script = options.bridgeScript || environment.BYCLI_BRIDGE_BOOTSTRAP_SCRIPT
        || BRIDGE_SCRIPT;
      const bridge = options.bridgeBootstrap ? await options.bridgeBootstrap()
        : parsed(await execute(process.execPath, [script, '--format', 'json']));
      if (bridge?.ok !== true || !['BRIDGE_READY', 'BRIDGE_RECOVERED'].includes(bridge.code)) fail(bridge?.code || 'BRIDGE_UNAVAILABLE');
    }
    const flags = ['--keep-tab', 'true', '--site-session', 'persistent', '--window', 'background', '-f', 'json'];
    if (state.step === 'download') {
      state.phase = 'executing'; saveState(paths, target, state);
      const rows = parsed(await execute('bycli', ['douyin', 'download', url, '--output', path.join(target, 'download'), '--metadata', 'true', ...flags], budgets.download));
      const media = videoEntries(paths, target, rows, url);
      state.workId = media.id; state.canonicalUrl = media.canonicalUrl; state.files = media.files;
      state.step = 'read'; saveState(paths, target, state);
      record(false, 'acquiring-subtitles');
    }
    state.phase = 'executing'; saveState(paths, target, state);
    let rows;
    try { rows = parsed(await execute('bycli', ['douyin', 'read', state.canonicalUrl, '--comments', '0', '--replies', '0', ...flags], budgets.read)); }
    catch (error) {
      if (!['API_ERROR', 'EMPTY_RESULT', 'SUBTITLE_UNAVAILABLE', 'SUBTITLE_FETCH_FAILED'].includes(codeOf(error))) throw error;
      state.subtitleStatus = 'unavailable';
      state.limitations.push('官方字幕读取失败；视频与元数据已归档，未执行语音转录。');
    }
    if (rows) saveSubtitles(paths, target, state, rows);
    verifyEntries(paths, state.files);
    const result = { schemaVersion: '1.0', executor: 'bycli', adapter: 'douyin', status: 'saved', exitCode: 0,
      itemId, sourceUrl: url, workId: state.workId, canonicalUrl: state.canonicalUrl,
      subtitleStatus: state.subtitleStatus, limitations: state.limitations, files: state.files };
    const filename = path.join(target, 'executor-result.json'), bytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`);
    fs.writeFileSync(filename, bytes, { flag: 'wx', mode: 0o600 });
    withSessionLock(paths, ACTION, () => {
      const loaded = loadSession(paths, { persistMigration: false }).session;
      assertPolicy(loaded);
      if (loaded.task.douyinAcquisitions?.some(row => row.itemId === itemId)) fail('ACQUISITION_CONFLICT');
      loaded.task.douyinAcquisitions = [...(loaded.task.douyinAcquisitions || []),
        { itemId, sourceUrl: url, artifact: relative(paths.root, filename), sha256: digest(bytes) }];
      persistSession(paths, loaded);
    });
    record(false, 'awaiting-materialization', [relative(paths.root, filename)]);
    state.phase = 'saved'; saveState(paths, target, state);
    return savedResult(paths, target, state);
  } catch (error) {
    state.errorCode = codeOf(error);
    state.phase = HUMAN_ERRORS.has(state.errorCode) ? 'waiting-confirmation' : 'stopped';
    try { saveState(paths, target, state); record(state.phase === 'stopped', state.errorCode); } catch { /* Preserve original evidence on policy change. */ }
    return pauseResult(state);
  }
}
