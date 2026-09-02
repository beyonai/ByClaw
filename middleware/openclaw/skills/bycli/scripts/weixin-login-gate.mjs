#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  mkdir, readFile, rename, rm, writeFile,
} from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SCHEMA_VERSION = '1.0';
const MAX_CONFIRMED_RERUNS = 10;
const EXCLUDED_OPTIONS = new Map([
  ['--output', true],
  ['--adapter-session', true],
  ['--adapter-queue-timeout', true],
  ['--site-session', true],
  ['--keep-tab', true],
  ['--format', true],
  ['-f', true],
  ['--trace', true],
  ['--verbose', false],
  ['-v', false],
]);
const TRANSIENT_QUERY_KEYS = new Set([
  'abtest_cookie', 'ascene', 'chksm', 'clicktime', 'countrycode',
  'devicetype', 'enterid', 'exportkey', 'fontScale', 'lang', 'nettype',
  'pass_ticket', 'scene', 'sessionid', 'version', 'wx_header',
]);
const HUMAN_GATE_CODES = new Set([
  'AUTH_REQUIRED',
  'CAPTCHA',
  'ENVIRONMENT_VALIDATION',
  'MFA_REQUIRED',
]);
const HUMAN_GATE_TEXT = /auth_required|captcha|mfa_required|environment[_ -]verification|login|环境异常|去验证|验证码|安全验证/i;
const LEGACY_TYPED_ERROR_CODES = [
  'ARGUMENT',
  'EMPTY_RESULT',
  'COMMAND_EXEC',
  'AUTH_REQUIRED',
  'TIMEOUT',
  'CAPTCHA',
  'ENVIRONMENT_VALIDATION',
  'MFA_REQUIRED',
  'RATE_LIMITED',
  'BROWSER_CONNECT',
  'RETRY_APPROVAL_REQUIRED',
];
const LEGACY_TYPED_ERROR_PATTERN = new RegExp(`\\b(${LEGACY_TYPED_ERROR_CODES.join('|')})\\b`, 'i');

function normalizeUrl(value) {
  try {
    const parsed = new URL(value);
    if (!['mp.weixin.qq.com', 'weixin.sogou.com'].includes(parsed.hostname)) return value;
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRANSIENT_QUERY_KEYS.has(key)) parsed.searchParams.delete(key);
    }
    parsed.searchParams.sort();
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return value;
  }
}

function optionName(value) {
  const separator = value.indexOf('=');
  return separator === -1 ? value : value.slice(0, separator);
}

function canonicalCommand(argv) {
  if (!Array.isArray(argv) || argv.length < 3
    || basename(String(argv[0])) !== 'bycli' || argv[1] !== 'weixin') {
    throw new Error('gate command must begin with: bycli weixin <command>');
  }
  const canonical = ['bycli', 'weixin', String(argv[2])];
  for (let index = 3; index < argv.length; index += 1) {
    const raw = String(argv[index]);
    const name = optionName(raw);
    if (EXCLUDED_OPTIONS.has(name)) {
      if (EXCLUDED_OPTIONS.get(name) && !raw.includes('=')) index += 1;
      continue;
    }
    if (raw.startsWith('--url=')) {
      canonical.push(`--url=${normalizeUrl(raw.slice('--url='.length))}`);
      continue;
    }
    canonical.push(raw === '--url' ? raw : normalizeUrl(raw));
    if (raw === '--url' && index + 1 < argv.length) {
      index += 1;
      canonical.push(normalizeUrl(String(argv[index])));
    }
  }
  return canonical;
}

export function operationFingerprint(argv) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalCommand(argv)))
    .digest('hex');
}

function parseJson(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function structuredErrorCode(value) {
  const parsed = parseJson(value);
  const code = parsed?.error?.code;
  return typeof code === 'string' && code.trim() ? code.trim().toUpperCase() : null;
}

export function errorCode(result) {
  const stderrCode = structuredErrorCode(result?.stderr);
  if (stderrCode) return stderrCode;
  const exitCode = Number(result?.exitCode);
  if (exitCode !== 0) {
    const stdoutCode = structuredErrorCode(result?.stdout);
    if (stdoutCode) return stdoutCode;
  }
  const legacyOutput = String(result?.stderr || '');
  const codeMatch = legacyOutput.match(LEGACY_TYPED_ERROR_PATTERN);
  return codeMatch?.[1]?.toUpperCase() || null;
}

function isHumanGate(result) {
  const code = errorCode(result);
  if (Number(result?.exitCode) === 77 || HUMAN_GATE_CODES.has(code)) return true;
  if (Number(result?.exitCode) !== 75 && code !== 'TIMEOUT') return false;
  return HUMAN_GATE_TEXT.test(`${result?.stdout || ''}\n${result?.stderr || ''}`);
}

async function readState(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    if (parsed?.schemaVersion !== SCHEMA_VERSION || typeof parsed.phase !== 'string') {
      throw new Error('invalid Weixin login-gate state');
    }
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeState(path, state) {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  const payload = `${JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    phase: state.phase,
    initialAttempts: state.initialAttempts,
    confirmedRerunCount: state.confirmedRerunCount,
    rerunConsumed: state.rerunConsumed,
    lastCode: state.lastCode,
    lastOutcome: state.lastOutcome,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`;
  await writeFile(temporary, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}

function confirmedRerunCount(state) {
  if (Number.isInteger(state?.confirmedRerunCount)) {
    return Math.max(0, Math.min(MAX_CONFIRMED_RERUNS, state.confirmedRerunCount));
  }
  return state?.rerunConsumed === true ? 1 : 0;
}

function blockedResult(operationFingerprintValue, phase, reason, previousOutcome = 'unknown') {
  const waitingForUser = reason === 'explicit-verification-confirmation-required';
  const authExhausted = reason === 'login-gate-rerun-exhausted';
  const code = waitingForUser
    ? 'AUTH_REQUIRED'
    : authExhausted ? 'AUTH_RETRY_EXHAUSTED' : 'OPERATION_ALREADY_FINALIZED';
  return {
    executed: false,
    commandExecuted: false,
    exitCode: waitingForUser ? 77 : 1,
    code,
    stdout: '',
    stderr: '',
    operationFingerprint: operationFingerprintValue,
    phase,
    reason,
    retryable: waitingForUser,
    requiresUserAction: waitingForUser,
    ...(code === 'OPERATION_ALREADY_FINALIZED' ? { previousOutcome } : {}),
  };
}

function callbackControls(result) {
  const stateDisposition = result?.stateDisposition === 'no-auth-state'
    ? 'no-auth-state' : 'classify';
  return {
    stateDisposition,
    commandExecuted: result?.commandExecuted !== false,
  };
}

function publicChildResult(result) {
  if (!result || typeof result !== 'object') return result;
  const {
    stateDisposition: _stateDisposition,
    ...publicResult
  } = result;
  return publicResult;
}

function resultRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.list)) return payload.data.list;
  return [];
}

function resultOutcome(result) {
  if (Number(result?.exitCode) !== 0) return 'failed';
  const payload = parseJson(result?.stdout);
  const directStatus = payload?.status ?? payload?.data?.status;
  if (directStatus === 'partial') return 'partial';
  if (directStatus === 'failed' || payload?.ok === false) return 'failed';
  const rows = resultRows(payload);
  const statuses = rows.map(row => row?.status).filter(status => typeof status === 'string');
  const failedCount = statuses.filter(status => status === 'failed').length;
  if (statuses.includes('partial') || (failedCount > 0 && failedCount < statuses.length)) {
    return 'partial';
  }
  if (failedCount > 0) return 'failed';
  return 'succeeded';
}

export function blockedCliPayload(result) {
  return {
    ok: false,
    gate: {
      executed: false,
      commandExecuted: false,
      phase: result.phase,
      reason: result.reason,
    },
    error: {
      code: result.code,
      message: result.reason,
      exitCode: result.exitCode,
      retryable: result.retryable,
      requiresUserAction: result.requiresUserAction,
      ...(result.previousOutcome ? { previousOutcome: result.previousOutcome } : {}),
    },
  };
}

function isBridgeOnlyResult(result) {
  return Number(result?.exitCode) === 69 && errorCode(result) === 'BROWSER_CONNECT';
}

export async function runGate({
  stateDir,
  argv,
  verificationConfirmed = false,
  execute,
}) {
  if (!isAbsolute(stateDir)) throw new Error('stateDir must be an absolute path');
  if (typeof execute !== 'function') throw new Error('execute must be a function');
  const fingerprint = operationFingerprint(argv);
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const statePath = join(stateDir, `${fingerprint}.json`);
  const lockPath = join(stateDir, `${fingerprint}.lock`);
  await mkdir(lockPath, { mode: 0o700 });
  try {
    const state = await readState(statePath);
    const consumedReruns = confirmedRerunCount(state);
    if (state?.phase === 'terminal') {
      const terminalAuthCode = HUMAN_GATE_CODES.has(state.lastCode) || state.lastCode === 'TIMEOUT';
      const legacyTerminalAuthState = !Number.isInteger(state.confirmedRerunCount)
        && state.rerunConsumed === true;
      const authRetriesExhausted = terminalAuthCode
        && (consumedReruns >= MAX_CONFIRMED_RERUNS || legacyTerminalAuthState);
      return blockedResult(
        fingerprint,
        'terminal',
        authRetriesExhausted ? 'login-gate-rerun-exhausted' : 'operation-already-finalized',
        state.lastOutcome || 'unknown',
      );
    }
    if (state?.phase === 'rerun-consumed') {
      const phase = consumedReruns >= MAX_CONFIRMED_RERUNS
        ? 'terminal' : 'waiting-confirmation';
      await writeState(statePath, {
        ...state,
        phase,
        confirmedRerunCount: consumedReruns,
        rerunConsumed: consumedReruns > 0,
        lastCode: state.lastCode || 'INTERRUPTED_AFTER_RERUN_CONSUMPTION',
      });
      return blockedResult(
        fingerprint,
        phase,
        phase === 'terminal'
          ? 'login-gate-rerun-exhausted'
          : 'explicit-verification-confirmation-required',
      );
    }
    if (state?.phase === 'complete') {
      return blockedResult(
        fingerprint,
        'complete',
        'operation-already-finalized',
        state.lastOutcome || 'unknown',
      );
    }
    if (state?.phase === 'waiting-confirmation' && verificationConfirmed !== true) {
      return blockedResult(
        fingerprint,
        'waiting-confirmation',
        'explicit-verification-confirmation-required',
      );
    }

    const isConfirmedRerun = state?.phase === 'waiting-confirmation';
    if (isConfirmedRerun && consumedReruns >= MAX_CONFIRMED_RERUNS) {
      await writeState(statePath, {
        ...state,
        phase: 'terminal',
        confirmedRerunCount: consumedReruns,
        rerunConsumed: true,
      });
      return blockedResult(fingerprint, 'terminal', 'login-gate-rerun-exhausted');
    }
    const nextConfirmedRerunCount = isConfirmedRerun
      ? consumedReruns + 1 : consumedReruns;
    if (isConfirmedRerun) {
      await writeState(statePath, {
        ...state,
        phase: 'rerun-consumed',
        confirmedRerunCount: nextConfirmedRerunCount,
        rerunConsumed: true,
        lastCode: state.lastCode,
      });
    }

    const attemptKind = isConfirmedRerun ? 'confirmed-rerun' : 'initial';
    const childResult = await execute(argv, { attemptKind });
    const controls = callbackControls(childResult);
    const visibleChildResult = publicChildResult(childResult);
    if (!isConfirmedRerun
      && (controls.stateDisposition === 'no-auth-state' || isBridgeOnlyResult(childResult))) {
      return {
        ...visibleChildResult,
        executed: true,
        commandExecuted: controls.commandExecuted,
        operationFingerprint: fingerprint,
        phase: 'initial',
        reason: null,
      };
    }
    const humanGate = isHumanGate(childResult);
    let phase = 'complete';
    if (humanGate) {
      phase = isConfirmedRerun && nextConfirmedRerunCount >= MAX_CONFIRMED_RERUNS
        ? 'terminal' : 'waiting-confirmation';
    }
    else if (Number(childResult?.exitCode) !== 0) phase = 'terminal';
    await writeState(statePath, {
      phase,
      initialAttempts: state?.initialAttempts || 1,
      confirmedRerunCount: nextConfirmedRerunCount,
      rerunConsumed: nextConfirmedRerunCount > 0,
      lastCode: errorCode(childResult),
      lastOutcome: resultOutcome(childResult),
    });
    return {
      ...visibleChildResult,
      executed: true,
      commandExecuted: controls.commandExecuted,
      operationFingerprint: fingerprint,
      phase,
      reason: null,
    };
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

function parseCli(argv) {
  const separator = argv.indexOf('--');
  if (separator === -1) throw new Error('missing -- before the bycli command');
  const options = argv.slice(0, separator);
  const command = argv.slice(separator + 1);
  let stateDir = '';
  let verificationConfirmed = false;
  for (let index = 0; index < options.length; index += 1) {
    if (options[index] === '--state-dir') {
      stateDir = options[index + 1] || '';
      index += 1;
    } else if (options[index] === '--verification-confirmed') {
      verificationConfirmed = options[index + 1] === 'true';
      index += 1;
    } else {
      throw new Error(`unknown option: ${options[index]}`);
    }
  }
  return { stateDir, verificationConfirmed, command };
}

function executeCommand(argv) {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({
      exitCode: Number.isInteger(code) ? code : 1,
      signal: signal || null,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
  });
}

async function main() {
  const { stateDir, verificationConfirmed, command } = parseCli(process.argv.slice(2));
  const result = await runGate({
    stateDir,
    argv: command,
    verificationConfirmed,
    execute: executeCommand,
  });
  if (result.executed) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
  } else {
    process.stderr.write(`${JSON.stringify(blockedCliPayload(result), null, 2)}\n`);
  }
  process.exitCode = Number(result.exitCode) || 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: { code: 'ARGUMENT', message: error.message, exitCode: 2 },
    }, null, 2)}\n`);
    process.exitCode = 2;
  });
}
