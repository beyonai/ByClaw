import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordFailedCollectionItem, recordPendingCollectionItem } from './collection-state.mjs';
import { authorizePublicSource } from './discovery-authorization.mjs';
import { runCli } from './enterprise/shared/cli-runner.mjs';
import { assertExternalSessionWriteAllowed } from './probe-state.mjs';
import { assertNoSensitiveKeys, loadSession, persistSession, requireString, withSessionLock } from './session.mjs';
import { errorCode as gateErrorCode, runGate as sharedRunGate } from '../../bycli/scripts/weixin-login-gate.mjs';

const ACTION = 'acquire-weixin-channels';
const SOURCE_URL = 'https://channels.weixin.qq.com/platform/statistic/post';
const COMMANDS = ['overview', 'trend', 'sources', 'posts', 'post-detail'];
const DEFAULT_BRIDGE_SCRIPT = fileURLToPath(new URL('../../bycli/scripts/bridge-bootstrap.mjs', import.meta.url));
const SENSITIVE_KEYS = /(?:rawkeybuff|pluginsessionid|username|^_log_finder_(?:uin|id)$|session[_-]?id|access[_-]?key)/i;
const HUMAN_ERRORS = new Set(['AUTH_REQUIRED', 'CAPTCHA', 'MFA_REQUIRED', 'ENVIRONMENT_VALIDATION']);
const PENDING_ERRORS = new Set([...HUMAN_ERRORS, 'TIMEOUT', 'BROWSER_CONNECT', 'BRIDGE_UNAVAILABLE', 'BRIDGE_RECOVERY_BUSY']);
const KNOWN_ERRORS = new Set([
  ...PENDING_ERRORS, 'COMMAND_EXEC', 'ADAPTER_UNAVAILABLE', 'EXECUTOR_OUTPUT_INVALID',
  'EXECUTOR_OUTPUT_TRUNCATED', 'EXECUTOR_SENSITIVE_OUTPUT', 'EXECUTOR_POST_ID_INVALID',
  'SESSION_OWNED_BY_PUBLIC_COLLECT', 'ORCHESTRATION_IN_PROGRESS', 'ACQUISITION_CONFLICT',
  'ACQUISITION_BUSY', 'CHECKPOINT_INTEGRITY', 'ACQUISITION_INTERRUPTED', 'AUTH_RETRY_EXHAUSTED', 'OPERATION_ALREADY_FINALIZED',
]);

function fail(code) {
  const error = new Error(`${code}: 视频号统计采集状态不允许当前操作`);
  error.code = code;
  throw error;
}

function boundedInteger(value, fallback, max, label) {
  const raw = value === undefined ? fallback : value;
  const valid = typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw));
  const parsed = valid ? Number(raw) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) throw new Error(`${label} 必须是 1–${max} 的整数`);
  return parsed;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function relativePath(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join('/');
}

function assertPolicy(session) {
  if (session.task?.workflow === 'public-collect') fail('SESSION_OWNED_BY_PUBLIC_COLLECT');
  if (session.task?.activeOrchestrationRunId) fail('ORCHESTRATION_IN_PROGRESS');
  if (session.task?.requiredContentGranularity !== 'any') {
    throw new Error('视频号统计任务必须使用 requiredContentGranularity=any');
  }
  if (session.task?.materializationTarget === 'candidates') throw new Error('视频号统计不能用于 candidates 物化目标');
  const authorized = authorizePublicSource(session.task?.discoveryGate, SOURCE_URL);
  if (!authorized || authorized.origin !== 'user-provided') throw new Error('SOURCE_NOT_AUTHORIZED_BY_DISCOVERY');
}

function assertSafeDirectory(root, directory) {
  const absoluteRoot = path.resolve(root);
  const relative = path.relative(absoluteRoot, directory);
  if (relative.startsWith('..') || path.isAbsolute(relative)) fail('ACQUISITION_CONFLICT');
  let current = absoluteRoot;
  for (const segment of ['', ...relative.split(path.sep).filter(Boolean)]) {
    if (segment) current = path.join(current, segment);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error('ACQUISITION_SYMLINK: raw 路径不能包含符号链接');
    if (!stat.isDirectory()) fail('ACQUISITION_CONFLICT');
  }
}

function assertOutputSafe(value) {
  try { assertNoSensitiveKeys(value, 'executor output'); } catch { fail('EXECUTOR_SENSITIVE_OUTPUT'); }
  const visit = (item) => {
    if (Array.isArray(item)) { item.forEach(visit); return; }
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item)) {
      if (SENSITIVE_KEYS.test(key)) fail('EXECUTOR_SENSITIVE_OUTPUT');
      visit(child);
    }
  };
  visit(value);
}

function errorCode(value) {
  if (KNOWN_ERRORS.has(value?.code)) return value.code;
  const typed = gateErrorCode(value);
  if (typed) return KNOWN_ERRORS.has(typed) ? typed : 'COMMAND_EXEC';
  return /timeout after \d+ms/i.test(value?.message || '') || value?.timedOut ? 'TIMEOUT' : 'COMMAND_EXEC';
}

function parseSuccess(outcome) {
  if (outcome?.exitCode !== 0 || outcome?.failure || outcome?.timedOut) fail(errorCode(outcome));
  if (outcome?.truncated) fail('EXECUTOR_OUTPUT_TRUNCATED');
  if (typeof outcome?.stdout !== 'string' || Buffer.byteLength(outcome.stdout) > 10 * 1024 * 1024) {
    fail('EXECUTOR_OUTPUT_TRUNCATED');
  }
  try { return JSON.parse(outcome.stdout); } catch { fail('EXECUTOR_OUTPUT_INVALID'); }
}

function validateDiscovery(list, help) {
  if (!Array.isArray(list) || help?.site !== 'weixin-channels' || !Array.isArray(help.commands)) fail('ADAPTER_UNAVAILABLE');
  const names = new Set(list.filter(row => row?.site === 'weixin-channels').map(row => row.name));
  const format = help.common_options?.find(option => option.name === 'format');
  if (!format?.choices?.includes('json')) fail('ADAPTER_UNAVAILABLE');
  for (const name of COMMANDS) {
    const command = help.commands.find(row => row?.name === name);
    if (!names.has(name) || !command || command.access !== 'read' || command.browser !== true
      || command.domain !== 'channels.weixin.qq.com') fail('ADAPTER_UNAVAILABLE');
    for (const flag of ['days', 'start-date', 'end-date']) {
      if (!command.command_options?.some(option => option.name === flag)) fail('ADAPTER_UNAVAILABLE');
    }
    if (name === 'posts' && !command.command_options.some(option => option.name === 'limit')) fail('ADAPTER_UNAVAILABLE');
    if (name === 'post-detail' && !command.positionals?.some(option => option.name === 'id')) fail('ADAPTER_UNAVAILABLE');
    if (name === 'sources' && (!Array.isArray(command.columns) || !command.columns.includes('views_pct'))) fail('ADAPTER_UNAVAILABLE');
    if (name === 'post-detail' && (!Array.isArray(command.columns) || !command.columns.includes('data_details'))) fail('ADAPTER_UNAVAILABLE');
    const options = command.browser_common_options ?? help.browser_common_options;
    for (const [flag, choice] of [['keep-tab', 'true'], ['site-session', 'persistent'], ['window', 'background']]) {
      if (!options?.some(option => option.name === flag && option.choices?.includes(choice))) fail('ADAPTER_UNAVAILABLE');
    }
  }
}

function confirmationValue(value) {
  if (value === undefined || value === false || value === 'false') return false;
  if (value === true || value === 'true') return true;
  throw new Error('--verification-confirmed 必须是 true 或 false');
}

function overviewRange(rows, days) {
  if (rows.length !== 1) fail('EXECUTOR_OUTPUT_INVALID');
  const { start_date: startDate, end_date: endDate } = rows[0];
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!validDate(startDate) || !validDate(endDate)
    || (Date.parse(endDate) - Date.parse(startDate)) / 86400000 + 1 !== days) fail('EXECUTOR_OUTPUT_INVALID');
  return { startDate, endDate };
}

function validateRows(rows, command, postId, days, limit) {
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) fail('EXECUTOR_OUTPUT_INVALID');
  assertOutputSafe(rows);
  if (command === 'overview') overviewRange(rows, days);
  if (command === 'posts') {
    if (rows.length > limit) fail('EXECUTOR_OUTPUT_INVALID');
    const ids = new Set();
    for (const row of rows) {
      if (typeof row.id !== 'string' || !/^\d+$/.test(row.id) || ids.has(row.id)) fail('EXECUTOR_POST_ID_INVALID');
      ids.add(row.id);
    }
  }
  if (postId && (rows.length !== 1 || rows[0].id !== postId)) fail('EXECUTOR_POST_ID_INVALID');
}

function commandArgv(command, postId, identity, range) {
  return ['bycli', 'weixin-channels', command, ...(postId ? [postId] : []),
    ...(range ? ['--start-date', range.startDate, '--end-date', range.endDate] : ['--days', String(identity.days)]),
    ...(command === 'posts' ? ['--limit', String(identity.limit)] : []),
    '--keep-tab', 'true', '--site-session', 'persistent', '--window', 'background', '-f', 'json'];
}

function artifactBytes(root, target, entry) {
  if (!entry || typeof entry.artifact !== 'string' || !Number.isSafeInteger(entry.size) || entry.size < 0
    || !/^[a-f0-9]{64}$/.test(entry.sha256)) fail('CHECKPOINT_INTEGRITY');
  const absolute = path.resolve(root, entry.artifact);
  if (relativePath(root, absolute) !== entry.artifact || !absolute.startsWith(`${target}${path.sep}`)) fail('CHECKPOINT_INTEGRITY');
  assertSafeDirectory(root, path.dirname(absolute));
  let stat;
  try { stat = fs.lstatSync(absolute); } catch { fail('CHECKPOINT_INTEGRITY'); }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.size || stat.size > 10 * 1024 * 1024) fail('CHECKPOINT_INTEGRITY');
  const bytes = fs.readFileSync(absolute);
  if (sha256(bytes) !== entry.sha256) fail('CHECKPOINT_INTEGRITY');
  return bytes;
}

function loadCheckpoint(paths, target, identity) {
  const artifact = relativePath(paths.root, path.join(target, 'acquisition-state.json'));
  const runs = loadSession(paths, { persistMigration: false }).session.task.weixinChannelsAcquisitionRuns;
  const matching = Array.isArray(runs) ? runs.filter(entry => entry?.itemId === identity.itemId) : [];
  if (matching.length !== 1 || matching[0].sourceUrl !== identity.sourceUrl || matching[0].artifact !== artifact) fail('ACQUISITION_CONFLICT');
  const filename = path.join(target, 'acquisition-state.json');
  let stat;
  try { stat = fs.lstatSync(filename); } catch { fail('CHECKPOINT_INTEGRITY'); }
  const bytes = artifactBytes(paths.root, target, { ...matching[0], size: stat.size });
  let state;
  try { state = JSON.parse(bytes); } catch { fail('CHECKPOINT_INTEGRITY'); }
  assertOutputSafe(state);
  if (state.schemaVersion !== '1.0' || state.adapter !== 'weixin-channels'
    || JSON.stringify(state.identity) !== JSON.stringify(identity)) fail('ACQUISITION_IDENTITY_CONFLICT');
  if (!Array.isArray(state.results) || !Array.isArray(state.gateArtifacts)
    || state.nextStep !== state.results.length || !Number.isFinite(state.startedAtMs)) fail('CHECKPOINT_INTEGRITY');
  const steps = ['overview', 'trend', 'sources', 'posts'].map(command => ({ command }));
  for (let index = 0; index < state.results.length; index++) {
    const entry = state.results[index];
    const step = steps[index];
    const filename = index < 4 ? `${step?.command}.json` : `post-detail-${String(index - 3).padStart(4, '0')}.json`;
    if (!step || entry.command !== step.command || entry.postId !== step.postId
      || entry.artifact !== relativePath(paths.root, path.join(target, filename))) fail('CHECKPOINT_INTEGRITY');
    let rows;
    try { rows = JSON.parse(artifactBytes(paths.root, target, entry)); } catch { fail('CHECKPOINT_INTEGRITY'); }
    validateRows(rows, entry.command, entry.postId, identity.days, identity.limit);
    if (index === 0 && JSON.stringify(state.range) !== JSON.stringify(overviewRange(rows, identity.days))) fail('CHECKPOINT_INTEGRITY');
    if (index === 3) steps.push(...rows.map(row => ({ command: 'post-detail', postId: row.id })));
  }
  for (const entry of state.gateArtifacts) {
    const gatePrefix = `${relativePath(paths.root, target)}/login-gate/`;
    if (!entry.artifact.startsWith(gatePrefix) || !/^[a-f0-9]{64}\.json$/.test(entry.artifact.slice(gatePrefix.length))) fail('CHECKPOINT_INTEGRITY');
    artifactBytes(paths.root, target, entry);
  }
  if (state.active) {
    const step = steps[state.nextStep];
    if (!step || state.active.command !== step.command || state.active.postId !== step.postId
      || JSON.stringify(state.active.argv) !== JSON.stringify(commandArgv(step.command, step.postId, identity, state.range))) fail('CHECKPOINT_INTEGRITY');
    if (state.active.gate && !state.gateArtifacts.some(entry => JSON.stringify(entry) === JSON.stringify(state.active.gate))) fail('CHECKPOINT_INTEGRITY');
  }
  if (state.phase === 'waiting-confirmation' && (!state.active?.gate || !HUMAN_ERRORS.has(state.errorCode))) fail('CHECKPOINT_INTEGRITY');
  return { state, steps };
}

function saveCheckpoint(paths, target, state) {
  withSessionLock(paths, ACTION, () => {
    const { session } = loadSession(paths, { persistMigration: false });
    assertPolicy(session);
    assertSafeDirectory(paths.root, target);
    const filename = path.join(target, 'acquisition-state.json');
    const runs = session.task.weixinChannelsAcquisitionRuns || [];
    if (!Array.isArray(runs)) fail('CHECKPOINT_INTEGRITY');
    const matching = runs.filter(row => row.itemId === state.identity.itemId);
    if (fs.existsSync(filename)) {
      if (matching.length !== 1 || matching[0].artifact !== relativePath(paths.root, filename)) fail('CHECKPOINT_INTEGRITY');
      artifactBytes(paths.root, target, { ...matching[0], size: fs.lstatSync(filename).size });
    } else if (matching.length) fail('CHECKPOINT_INTEGRITY');
    for (const entry of [...state.results, ...state.gateArtifacts]) artifactBytes(paths.root, target, entry);
    const temporary = `${filename}.${process.pid}.tmp`;
    const bytes = Buffer.from(`${JSON.stringify(state, null, 2)}\n`);
    fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, filename);
    const entry = { itemId: state.identity.itemId, sourceUrl: state.identity.sourceUrl,
      artifact: relativePath(paths.root, filename), sha256: sha256(bytes) };
    session.task.weixinChannelsAcquisitionRuns = [...runs.filter(row => row.itemId !== entry.itemId), entry];
    persistSession(paths, session);
  });
}

export async function runWeixinChannelsAcquire(paths, args, options = {}) {
  const itemId = requireString(args?.['item-id'], '--item-id').trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(itemId)) throw new Error('--item-id 格式无效');
  const sourceUrl = requireString(args?.['source-url'], '--source-url').trim();
  if (sourceUrl !== SOURCE_URL) throw new Error('--source-url 必须是视频号助手统计页');
  const days = boundedInteger(args?.days, 7, 366, '--days');
  const limit = boundedInteger(args?.limit, 20, 100, '--limit');
  const verificationConfirmed = confirmationValue(args?.['verification-confirmed']);
  const identity = { itemId, sourceUrl, days, limit };
  assertExternalSessionWriteAllowed(paths, ACTION);
  assertPolicy(loadSession(paths, { persistMigration: false }).session);
  const parent = path.join(path.resolve(paths.root), 'raw', 'bycli', 'weixin-channels');
  const target = path.join(parent, itemId);
  assertSafeDirectory(paths.root, target);
  if (!fs.existsSync(target) && verificationConfirmed) fail('ACQUISITION_CONFIRMATION_NOT_PENDING');
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  assertSafeDirectory(paths.root, parent);
  const executionLock = path.join(parent, '.execution.lock');
  try { fs.mkdirSync(executionLock, { mode: 0o700 }); } catch (error) {
    if (error.code === 'EEXIST') fail('ACQUISITION_BUSY');
    throw error;
  }
  try {
    const runs = loadSession(paths, { persistMigration: false }).session.task.weixinChannelsAcquisitionRuns || [];
    if (!Array.isArray(runs)) fail('CHECKPOINT_INTEGRITY');
    if (runs.some(run => run.sourceUrl === sourceUrl && run.itemId !== itemId)) fail('ACQUISITION_IDENTITY_CONFLICT');
    const exists = fs.existsSync(target);
    if (!exists && verificationConfirmed) fail('ACQUISITION_CONFIRMATION_NOT_PENDING');
    return await acquireLocked(paths, target, identity, exists, verificationConfirmed, options);
  } finally {
    // Only our empty live lock is released. Existing/stale locks are never reclaimed.
    assertSafeDirectory(paths.root, parent);
    fs.rmdirSync(executionLock);
  }
}

async function acquireLocked(paths, target, identity, exists, verificationConfirmed, options) {
  const { itemId, sourceUrl, days, limit } = identity;
  const runProcess = options.runProcess || runCli;
  const gate = options.runGate || sharedRunGate;
  const now = options.now || Date.now;
  let state;
  let steps = ['overview', 'trend', 'sources', 'posts'].map(command => ({ command }));
  if (exists) {
    ({ state, steps } = loadCheckpoint(paths, target, identity));
    if (['executing', 'initializing'].includes(state.phase)) fail('ACQUISITION_INTERRUPTED');
    if (state.phase === 'terminal') fail('ACQUISITION_TERMINAL');
    if (state.phase !== 'waiting-confirmation') fail('ACQUISITION_STOPPED');
    if (!verificationConfirmed) return publicPause(state, now());
  } else {
    state = { schemaVersion: '1.0', adapter: 'weixin-channels', identity, phase: 'initializing',
      nextStep: 0, range: null, results: [], gateArtifacts: [], active: null, startedAtMs: now() };
  }
  const timing = () => {
    const finishedAtMs = now();
    return { startedAt: new Date(state.startedAtMs).toISOString(), finishedAt: new Date(finishedAtMs).toISOString(), durationMs: Math.max(0, finishedAtMs - state.startedAtMs) };
  };
  const base = { itemId, source: 'public-internet', sourceSkill: 'bycli', backend: 'bycli', sourceUrl, title: '视频号后台统计' };
  const record = (status, reason, extra = []) => {
    assertPolicy(loadSession(paths, { persistMigration: false }).session);
    const write = status === 'failed' ? recordFailedCollectionItem : recordPendingCollectionItem;
    const outcome = write(paths, { ...base, rawArtifacts: [...state.results.map(entry => entry.artifact), ...extra], reason }, ACTION);
    if (outcome.preservedMaterialized) fail('ACQUISITION_CONFLICT');
  };
  const execute = (bin, argv) => runProcess(bin, argv, {
    timeoutMs: 60_000, maxOutputBytes: 10 * 1024 * 1024, env: options.environment || process.env,
  });
  let failedCommand = exists ? state.active.command : 'discovery';
  let confirmNext = verificationConfirmed;
  try {
    if (!exists) {
      record('pending', 'acquiring');
      fs.mkdirSync(target, { mode: 0o700 });
      saveCheckpoint(paths, target, state);
      const list = parseSuccess(await execute('bycli', ['list', '-f', 'json']));
      const help = parseSuccess(await execute('bycli', ['weixin-channels', '--help', '-f', 'json']));
      validateDiscovery(list, help);
      failedCommand = 'bridge';
      const bridgeScript = options.bridgeScript || (options.environment || process.env).BYCLI_BRIDGE_BOOTSTRAP_SCRIPT
        || DEFAULT_BRIDGE_SCRIPT;
      const bridge = options.bridgeBootstrap ? await options.bridgeBootstrap()
        : parseSuccess(await execute(process.execPath, [bridgeScript, '--format', 'json']));
      if (bridge?.ok !== true || !['BRIDGE_READY', 'BRIDGE_RECOVERED'].includes(bridge.code)) {
        fail(PENDING_ERRORS.has(bridge?.code) ? bridge.code : 'BRIDGE_UNAVAILABLE');
      }
    }
    while (state.nextStep < steps.length) {
      const { command, postId } = steps[state.nextStep];
      failedCommand = command;
      assertPolicy(loadSession(paths, { persistMigration: false }).session);
      const argv = confirmNext ? state.active.argv : commandArgv(command, postId, identity, state.range);
      state.active = { command, ...(postId ? { postId } : {}), argv };
      state.phase = 'executing';
      saveCheckpoint(paths, target, state);
      const outcome = await gate({
        stateDir: path.join(target, 'login-gate'), argv, verificationConfirmed: confirmNext,
        execute: commandArgv => execute(commandArgv[0], commandArgv.slice(1)),
      });
      confirmNext = false;
      assertPolicy(loadSession(paths, { persistMigration: false }).session);
      if (outcome.operationFingerprint && /^[a-f0-9]{64}$/.test(outcome.operationFingerprint)) {
        const filename = path.join(target, 'login-gate', `${outcome.operationFingerprint}.json`);
        assertSafeDirectory(paths.root, path.dirname(filename));
        if (fs.existsSync(filename)) {
          const stat = fs.lstatSync(filename);
          if (!stat.isFile() || stat.isSymbolicLink()) fail('CHECKPOINT_INTEGRITY');
          const bytes = fs.readFileSync(filename);
          const entry = { artifact: relativePath(paths.root, filename), size: bytes.length, sha256: sha256(bytes) };
          state.gateArtifacts = [...state.gateArtifacts.filter(row => row.artifact !== entry.artifact), entry];
          state.active.gate = entry;
        }
      }
      if (outcome.phase === 'waiting-confirmation' || (outcome.phase === 'terminal' && HUMAN_ERRORS.has(errorCode(outcome)))) {
        state.phase = outcome.phase;
        state.errorCode = outcome.phase === 'terminal' ? 'AUTH_RETRY_EXHAUSTED' : errorCode(outcome);
        saveCheckpoint(paths, target, state);
        record('pending', state.errorCode);
        return publicPause(state, now());
      }
      if (outcome.executed === false) fail(outcome.code || 'OPERATION_ALREADY_FINALIZED');
      const rows = parseSuccess(outcome);
      validateRows(rows, command, postId, days, limit);
      const filename = postId ? `post-detail-${String(state.nextStep - 3).padStart(4, '0')}.json` : `${command}.json`;
      const absolute = path.join(target, filename);
      assertSafeDirectory(paths.root, target);
      const bytes = Buffer.from(`${JSON.stringify(rows, null, 2)}\n`);
      fs.writeFileSync(absolute, bytes, { flag: 'wx', mode: 0o600 });
      state.results.push({ command, ...(postId ? { postId } : {}), artifact: relativePath(paths.root, absolute), size: bytes.length, sha256: sha256(bytes) });
      if (command === 'overview') state.range = overviewRange(rows, days);
      if (command === 'posts') steps.push(...rows.map(row => ({ command: 'post-detail', postId: row.id })));
      state.nextStep++;
      state.active = null;
      state.phase = 'executing';
      saveCheckpoint(paths, target, state);
      record('pending', 'acquiring');
    }
    const result = { schemaVersion: '1.0', executor: 'bycli', adapter: 'weixin-channels', status: 'saved', exitCode: 0,
      sourceUrl, itemId, days, limit, results: state.results, timing: timing() };
    const executorResultFile = path.join(target, 'executor-result.json');
    const bytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`);
    assertPolicy(loadSession(paths, { persistMigration: false }).session);
    assertSafeDirectory(paths.root, target);
    fs.writeFileSync(executorResultFile, bytes, { flag: 'wx', mode: 0o600 });
    const artifact = relativePath(paths.root, executorResultFile);
    record('pending', 'awaiting-materialization', [artifact]);
    withSessionLock(paths, ACTION, () => {
      const { session } = loadSession(paths, { persistMigration: false });
      assertPolicy(session);
      const acquisitions = session.task.weixinChannelsAcquisitions || [];
      if (!Array.isArray(acquisitions) || acquisitions.some(entry => entry.itemId === itemId)) fail('ACQUISITION_CONFLICT');
      session.task.weixinChannelsAcquisitions = [...acquisitions, { itemId, sourceUrl, artifact, sha256: sha256(bytes) }];
      persistSession(paths, session);
    });
    state.phase = 'saved';
    saveCheckpoint(paths, target, state);
    return { ok: true, action: ACTION, itemId, executorResultFile, commandCount: state.results.length,
      detailCount: state.results.filter(entry => entry.command === 'post-detail').length, timing: result.timing };
  } catch (error) {
    const code = errorCode(error);
    const status = PENDING_ERRORS.has(code) || failedCommand === 'bridge' ? 'pending' : 'failed';
    state.phase = 'stopped';
    state.errorCode = code;
    try {
      saveCheckpoint(paths, target, state);
      record(status, code);
    } catch { /* A concurrent policy change must not be bypassed to update inventory or checkpoint. */ }
    return { ok: false, action: ACTION, itemId, sourceUrl, status, errorCode: code, phase: 'stopped', requiresUserAction: false,
      failedCommand, commandCount: state.results.length, detailCount: state.results.filter(entry => entry.command === 'post-detail').length, timing: timing() };
  }
}

function publicPause(state, finishedAtMs) {
  return { ok: false, action: ACTION, itemId: state.identity.itemId, sourceUrl: state.identity.sourceUrl,
    status: 'pending', errorCode: state.errorCode, phase: state.phase, requiresUserAction: state.phase === 'waiting-confirmation',
    failedCommand: state.active.command, commandCount: state.results.length,
    detailCount: state.results.filter(entry => entry.command === 'post-detail').length,
    timing: { startedAt: new Date(state.startedAtMs).toISOString(), finishedAt: new Date(finishedAtMs).toISOString(), durationMs: Math.max(0, finishedAtMs - state.startedAtMs) } };
}
