#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import {
  access, chmod, mkdir, readFile, readdir, rename, rm, writeFile,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const BYCLI_TIMEOUT_MS = 30_000;
const BROWSER_START_TIMEOUT_MS = 60_000;
const LOCK_TIMEOUT_MS = 60_000;
const LOCK_POLL_INTERVAL_MS = 200;
const HEALTH_WAIT_TIMEOUT_MS = 10_000;
const HEALTH_POLL_INTERVAL_MS = 250;
const START_CHROME_SCRIPT = '/usr/local/bin/start-chrome.sh';

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

export function parseBrowserState(result) {
  const output = outputOf(result).trim();
  if (output) {
    try {
      const parsed = JSON.parse(output);
      if (typeof parsed?.running === 'boolean') return parsed.running ? 'running' : 'stopped';
      if (typeof parsed?.status === 'string') {
        const status = parsed.status.toLowerCase();
        if (['running', 'started', 'ready'].includes(status)) return 'running';
        if (['stopped', 'not-running', 'not_running'].includes(status)) return 'stopped';
      }
    } catch {
      // Older OpenClaw versions print text. Parse only explicit lifecycle phrases.
    }
  }
  if (/\b(?:not[ -]?running|stopped)\b/i.test(output)
    || /\brunning\s*[:=]?\s*(?:false|no)\b/i.test(output)) return 'stopped';
  if (/\brunning\s*[:=]?\s*(?:true|yes)\b/i.test(output)
    || /\bchromium\s+(?:is\s+)?running\b/i.test(output)) return 'running';
  return 'unknown';
}

async function managedBrowserUserDataDir() {
  const stateDir = process.env.OPENCLAW_STATE_DIR || '/by/.openclaw';
  const configFile = process.env.OPENCLAW_CONFIG_FILE || join(stateDir, 'openclaw.json');
  let browser = {};
  try {
    const config = JSON.parse(await readFile(configFile, 'utf8'));
    browser = config.browser || config.tools?.browser || {};
  } catch {
    // The managed runtime defaults remain authoritative when config is absent or invalid.
  }
  const profile = browser.defaultProfile || browser.profile
    || process.env.OPENCLAW_BROWSER_PROFILE || 'openclaw';
  const entry = browser.profiles?.[profile];
  return entry?.userDataDir || process.env.OPENCLAW_BROWSER_USER_DATA_DIR
    || join(stateDir, 'browser', profile, 'user-data');
}

function isBrowserExecutable(command) {
  return /^(?:google-chrome(?:-stable)?|chromium(?:-browser)?)$/i.test(basename(command));
}

export async function detectManagedBrowserState({
  procRoot = '/proc',
  userDataDir,
} = {}) {
  let entries;
  try {
    entries = await readdir(procRoot, { withFileTypes: true });
  } catch {
    return 'unknown';
  }

  const expectedUserDataDir = userDataDir || await managedBrowserUserDataDir();
  let readableProcesses = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    try {
      const [stat, cmdline] = await Promise.all([
        readFile(join(procRoot, entry.name, 'stat'), 'utf8'),
        readFile(join(procRoot, entry.name, 'cmdline')),
      ]);
      readableProcesses += 1;
      const closeParen = stat.lastIndexOf(')');
      if (closeParen >= 0 && stat.slice(closeParen + 2, closeParen + 3) === 'Z') continue;
      const argv = cmdline.toString('utf8').split('\0').filter(Boolean);
      if (argv.length > 0
        && isBrowserExecutable(argv[0])
        && argv.includes(`--user-data-dir=${expectedUserDataDir}`)) return 'running';
    } catch {
      // Processes may exit while /proc is scanned; other readable entries still prove the scan works.
    }
  }
  return readableProcesses > 0 ? 'stopped' : 'unknown';
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

async function executableFileExists(path) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
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

function finalReason({ status, browserState, browserStartFailed, recoveryBudgetExhausted }) {
  if (parseDaemonState(status) !== 'running') return 'DAEMON_UNAVAILABLE';
  if (parseExtensionState(status) !== 'connected') return 'EXTENSION_DISCONNECTED';
  if (browserStartFailed) return 'BROWSER_START_FAILED';
  if (recoveryBudgetExhausted) return 'RECOVERY_BUDGET_EXHAUSTED';
  if (browserState === 'unknown') return 'BROWSER_STATUS_UNKNOWN';
  return 'DAEMON_UNAVAILABLE';
}

export async function ensureBridge({
  run = runCommand,
  fileExists = executableFileExists,
  budget = createRecoveryBudget(),
  lockDir = join(process.env.BYCLI_CONFIG_DIR || '/by/.bycli', 'bridge-bootstrap.lock'),
  lockTimeoutMs = LOCK_TIMEOUT_MS,
  pollIntervalMs = LOCK_POLL_INTERVAL_MS,
  healthWaitTimeoutMs = HEALTH_WAIT_TIMEOUT_MS,
  healthPollIntervalMs = HEALTH_POLL_INTERVAL_MS,
  now = Date.now,
  wait = sleep,
  processAlive: isProcessAlive = processAlive,
  getProcessStartIdentity = processStartIdentity,
  detectLocalBrowserState = detectManagedBrowserState,
  startChromeScript = process.env.BYCLI_BROWSER_RECOVERY_COMMAND || START_CHROME_SCRIPT,
  writeLockOwner = (path, owner) => writeFile(path, `${JSON.stringify(owner)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  }),
} = {}) {
  const actions = [];
  let checks = 0;
  let browserState = 'unknown';
  let status = null;
  let browserStartFailed = false;
  let browserStartAttempted = false;
  let recoveryBudgetExhausted = false;

  const doctorAndStatus = async () => {
    const doctor = await run('bycli', ['doctor'], BYCLI_TIMEOUT_MS);
    status = await run('bycli', ['daemon', 'status'], BYCLI_TIMEOUT_MS);
    checks += 1;
    return { doctor, status, healthy: exitCode(doctor) === 0 && isDaemonHealthy(status) };
  };

  const waitForHealthy = async ({ checkImmediately = true } = {}) => {
    const deadline = now() + healthWaitTimeoutMs;
    let health = checkImmediately ? await doctorAndStatus() : { healthy: false };
    while (!health.healthy && now() < deadline) {
      await wait(Math.min(healthPollIntervalMs, Math.max(0, deadline - now())));
      health = await doctorAndStatus();
    }
    return health;
  };

  const initial = await doctorAndStatus();
  if (initial.healthy) {
    return normalizedResult({
      ok: true,
      code: 'BRIDGE_READY',
      browserState,
      reason: null,
      actions,
      status,
      checks,
      budget,
    });
  }

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
    return normalizedResult({
      ok: false,
      code: 'BRIDGE_RECOVERY_BUSY',
      browserState,
      reason: 'RECOVERY_LOCK_TIMEOUT',
      actions,
      status,
      checks,
      budget,
      diagnostics: { lockTimeout: true },
    });
  }

  try {
    const lockedCheck = await doctorAndStatus();
    if (lockedCheck.healthy) {
      return normalizedResult({
        ok: true,
        code: 'BRIDGE_READY',
        browserState,
        reason: null,
        actions,
        status,
        checks,
        budget,
      });
    }

    const browserStatus = await run(
      'openclaw',
      ['browser', '--browser-profile', 'openclaw', 'status'],
      BYCLI_TIMEOUT_MS,
    );
    browserState = parseBrowserState(browserStatus);
    if (browserState === 'unknown') browserState = await detectLocalBrowserState();
    if (browserState === 'stopped') {
      if (budget.browserStartsUsed < budget.maxBrowserStarts) {
        budget.browserStartsUsed += 1;
        browserStartAttempted = true;
        let startResult;
        if (await fileExists(startChromeScript)) {
          actions.push('browser_start_script');
          startResult = await run(startChromeScript, [], BROWSER_START_TIMEOUT_MS);
        } else {
          actions.push('browser_start_openclaw');
          startResult = await run(
            'openclaw',
            ['browser', '--browser-profile', 'openclaw', 'start'],
            BROWSER_START_TIMEOUT_MS,
          );
        }
        browserStartFailed = exitCode(startResult) !== 0 || Boolean(startResult?.timedOut);
      } else {
        recoveryBudgetExhausted = true;
      }
    }

    const afterBrowser = browserStartAttempted && !browserStartFailed
      ? await waitForHealthy()
      : await doctorAndStatus();
    if (afterBrowser.healthy) {
      return normalizedResult({
        ok: true,
        code: 'BRIDGE_READY',
        browserState,
        reason: null,
        actions,
        status,
        checks,
        budget,
        diagnostics: { browserStartFailed },
      });
    }

    if (budget.daemonRestartsUsed < budget.maxDaemonRestarts) {
      budget.daemonRestartsUsed += 1;
      actions.push('daemon_restart');
      await run('bycli', ['daemon', 'restart'], BYCLI_TIMEOUT_MS);
      status = await run('bycli', ['daemon', 'status'], BYCLI_TIMEOUT_MS);
      if (!isDaemonHealthy(status)) await waitForHealthy({ checkImmediately: false });
    } else {
      recoveryBudgetExhausted = true;
    }

    const reason = finalReason({
      status,
      browserState,
      browserStartFailed,
      recoveryBudgetExhausted,
    });
    if (isDaemonHealthy(status)) {
      return normalizedResult({
        ok: true,
        code: 'BRIDGE_READY',
        browserState,
        reason: null,
        actions,
        status,
        checks,
        budget,
        diagnostics: { browserStartFailed, recoveryBudgetExhausted },
      });
    }
    return normalizedResult({
      ok: false,
      code: 'BRIDGE_UNAVAILABLE',
      browserState,
      reason,
      actions,
      status,
      checks,
      budget,
      diagnostics: {
        browserStatus: browserState,
        browserStartFailed,
        recoveryBudgetExhausted,
      },
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
