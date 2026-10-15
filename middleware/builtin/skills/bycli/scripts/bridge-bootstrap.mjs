#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  chmod, mkdir, readFile, rename, rm, writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const BYCLI_TIMEOUT_MS = 30_000;
const LOCK_TIMEOUT_MS = 60_000;
const LOCK_POLL_INTERVAL_MS = 200;
const HEALTH_WAIT_TIMEOUT_MS = 10_000;
const HEALTH_POLL_INTERVAL_MS = 250;

function exitCode(result) {
  const value = result?.exitCode ?? result?.code;
  return Number.isInteger(Number(value)) ? Number(value) : 1;
}

function outputOf(result) {
  return `${result?.stdout || ''}\n${result?.stderr || ''}`;
}

export function createRecoveryBudget({
  maxBrowserStarts = 1,
  maxDaemonRestarts = 1,
} = {}) {
  return {
    maxBrowserStarts,
    maxDaemonRestarts,
    browserStartsUsed: 0,
    daemonRestartsUsed: 0,
  };
}

function budgetSnapshot(budget) {
  return {
    browserStartsUsed: budget.browserStartsUsed,
    daemonRestartsUsed: budget.daemonRestartsUsed,
  };
}

function parseDaemonState(result) {
  const output = outputOf(result);
  return /daemon\s*[:=]?\s*running\b/i.test(output) ? 'running'
    : /daemon\s*[:=]?\s*(?:stopped|not[ -]?running|unavailable)\b/i.test(output) ? 'stopped'
      : 'unknown';
}

function parseExtensionState(result) {
  const output = outputOf(result);
  return /extension\s*[:=]?\s*connected\b/i.test(output) ? 'connected'
    : /extension\s*[:=]?\s*(?:disconnected|not[ -]?connected|unavailable)\b/i.test(output)
      ? 'disconnected' : 'unknown';
}

export function isDaemonHealthy(result) {
  return exitCode(result) === 0
    && !result?.timedOut
    && parseDaemonState(result) === 'running'
    && parseExtensionState(result) === 'connected';
}

export function runCommand(command, args, timeoutMs = BYCLI_TIMEOUT_MS) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    execFile(command, args, {
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      env: process.env,
    }, (error, stdout, stderr) => {
      resolve({
        exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
        stdout: stdout || '',
        stderr: stderr || '',
        timedOut: Boolean(error && (error.killed || error.code === 'ETIMEDOUT')),
        signal: error?.signal || null,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function processStartIdentity(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    return stat.trim().split(/\s+/)[21] || null;
  } catch {
    return null;
  }
}

async function readOwner(lockDir) {
  try {
    return JSON.parse(await readFile(join(lockDir, 'owner.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function ownerIsStale(owner, {
  isProcessAlive,
  getProcessStartIdentity,
}) {
  if (!owner || !Number.isInteger(owner.pid)) return false;
  if (!(await isProcessAlive(owner.pid))) return true;
  if (!owner.processStart) return false;
  const currentStart = await getProcessStartIdentity(owner.pid);
  return currentStart !== null && currentStart !== owner.processStart;
}

async function acquireRecoveryLock({
  lockDir,
  timeoutMs,
  pollIntervalMs,
  now,
  wait,
  isProcessAlive,
  getProcessStartIdentity,
  writeLockOwner,
}) {
  await mkdir(dirname(lockDir), { recursive: true, mode: 0o700 });
  await chmod(dirname(lockDir), 0o700);
  const token = randomUUID();
  const deadline = now() + timeoutMs;
  while (true) {
    try {
      await mkdir(lockDir, { mode: 0o700 });
      const owner = {
        token,
        pid: process.pid,
        processStart: await getProcessStartIdentity(process.pid),
        createdAt: now(),
      };
      try {
        await writeLockOwner(join(lockDir, 'owner.json'), owner);
      } catch (error) {
        await rm(lockDir, { recursive: true, force: true });
        throw error;
      }
      return { acquired: true, token };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const owner = await readOwner(lockDir);
      if (await ownerIsStale(owner, { isProcessAlive, getProcessStartIdentity })) {
        const stalePath = `${lockDir}.stale-${token}`;
        try {
          await rename(lockDir, stalePath);
          await rm(stalePath, { recursive: true, force: true });
          continue;
        } catch (renameError) {
          if (!['ENOENT', 'EEXIST'].includes(renameError?.code)) throw renameError;
        }
      }
      if (now() >= deadline) return { acquired: false, token };
      await wait(Math.min(pollIntervalMs, Math.max(0, deadline - now())));
    }
  }
}

async function releaseRecoveryLock(lockDir, token) {
  const owner = await readOwner(lockDir);
  if (owner?.token === token) await rm(lockDir, { recursive: true, force: true });
}

function normalizedResult({
  ok,
  code,
  browserState,
  reason,
  actions,
  status,
  checks,
  budget,
  diagnostics = {},
}) {
  return {
    ok,
    code,
    browserState,
    reason,
    actions,
    daemonState: parseDaemonState(status),
    extensionState: parseExtensionState(status),
    checks,
    budget: budgetSnapshot(budget),
    diagnostics,
  };
}

function finalReason({ status, doctor }) {
  if (parseDaemonState(status) !== 'running') return 'DAEMON_UNAVAILABLE';
  if (parseExtensionState(status) !== 'connected') return 'EXTENSION_DISCONNECTED';
  if (exitCode(doctor) !== 0) return 'DOCTOR_FAILED';
  return 'DAEMON_UNAVAILABLE';
}

// Runtime startup and reconnects belong to the DSH browser supervisor. This
// entry point only serializes health waiting; it must not spend its callers'
// legacy browser-start or daemon-restart budgets.
export async function ensureBridge({
  run = runCommand,
  budget = createRecoveryBudget(),
  lockDir = join(process.env.BYCLI_CONFIG_DIR || join(process.env.BYCLAW_DATA_ROOT || '.', '.bycli'), 'bridge-bootstrap.lock'),
  lockTimeoutMs = LOCK_TIMEOUT_MS,
  pollIntervalMs = LOCK_POLL_INTERVAL_MS,
  healthWaitTimeoutMs = HEALTH_WAIT_TIMEOUT_MS,
  healthPollIntervalMs = HEALTH_POLL_INTERVAL_MS,
  now = Date.now,
  wait = sleep,
  processAlive: isProcessAlive = processAlive,
  getProcessStartIdentity = processStartIdentity,
  writeLockOwner = (path, owner) => writeFile(path, `${JSON.stringify(owner)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  }),
} = {}) {
  const actions = [];
  let checks = 0;
  const browserState = 'unknown';
  let status = null;
  let doctor = null;

  const doctorAndStatus = async (deadline = Infinity) => {
    const remainingTimeout = () => Math.min(BYCLI_TIMEOUT_MS, deadline - now());
    if (remainingTimeout() <= 0) return { healthy: false };
    checks += 1;
    // Clear previous status so a partial probe cannot mix health from two rounds.
    status = null;
    doctor = await run('bycli', ['doctor'], remainingTimeout());
    if (remainingTimeout() <= 0) return { healthy: false };
    status = await run('bycli', ['daemon', 'status'], remainingTimeout());
    return {
      healthy: now() <= deadline && exitCode(doctor) === 0
        && !doctor?.timedOut && isDaemonHealthy(status),
    };
  };

  const result = (ok, code, reason, diagnostics = {}) => normalizedResult({
    ok, code, browserState, reason, actions, status, checks, budget,
    diagnostics: { recoveryOwner: 'supervisor', ...diagnostics },
  });

  const initial = await doctorAndStatus();
  if (initial.healthy) return result(true, 'BRIDGE_READY', null);

  const lock = await acquireRecoveryLock({
    lockDir,
    timeoutMs: lockTimeoutMs,
    pollIntervalMs,
    now,
    wait,
    isProcessAlive,
    getProcessStartIdentity,
    writeLockOwner,
  });
  if (!lock.acquired) {
    return result(false, 'BRIDGE_RECOVERY_BUSY', 'RECOVERY_LOCK_TIMEOUT', { lockTimeout: true });
  }

  try {
    // Initial probes and lock acquisition have their own bounds. Once the lock
    // is held, both commands and polling share this single health deadline.
    const deadline = now() + healthWaitTimeoutMs;
    let health = { healthy: false };
    while (now() < deadline) {
      health = await doctorAndStatus(deadline);
      if (health.healthy || now() >= deadline) break;
      await wait(Math.min(healthPollIntervalMs, Math.max(0, deadline - now())));
    }
    if (health.healthy) return result(true, 'BRIDGE_READY', null);
    return result(false, 'BRIDGE_UNAVAILABLE', finalReason({ status, doctor }), {
      healthWaitTimedOut: true,
    });
  } finally {
    await releaseRecoveryLock(lockDir, lock.token);
  }
}

function parseCli(argv) {
  if (argv.length === 0) return { format: 'json' };
  if (argv.length === 2 && argv[0] === '--format' && argv[1] === 'json') {
    return { format: 'json' };
  }
  throw new Error('usage: bridge-bootstrap.mjs [--format json]');
}

async function main() {
  parseCli(process.argv.slice(2));
  const result = await ensureBridge();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 69;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(() => {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      code: 'BRIDGE_UNAVAILABLE',
      reason: 'DAEMON_UNAVAILABLE',
      actions: [],
      error: { code: 'COMMAND_EXEC', message: 'bridge bootstrap failed' },
    }, null, 2)}\n`);
    process.exitCode = 69;
  });
}
