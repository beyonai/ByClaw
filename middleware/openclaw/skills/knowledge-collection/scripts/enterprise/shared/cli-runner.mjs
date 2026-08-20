import { spawn } from 'node:child_process';

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

const USE_PROCESS_GROUP = process.platform !== 'win32';
const MAX_TIMEOUT_MS = 2_147_483_647;
const CLEANUP_TIMEOUT_MS = 1_000;
const CLEANUP_POLL_MS = 10;

export function positiveEnv(name, fallback, env = process.env) {
  const value = env[name];
  if (!/^\d+$/.test(value ?? '')) return fallback;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function validateExplicitBound(options, name) {
  const value = options[name];
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  if (name === 'timeoutMs' && value > MAX_TIMEOUT_MS) {
    throw new TypeError(`timeoutMs must be an integer between 1 and ${MAX_TIMEOUT_MS}`);
  }
}

export function runCli(bin, args, options = {}) {
  return new Promise((resolve, reject) => {
    validateExplicitBound(options, 'timeoutMs');
    validateExplicitBound(options, 'maxOutputBytes');

    const env = options.env ?? process.env;
    const environmentTimeoutMs = positiveEnv(
      'KNOWLEDGE_COLLECTION_CLI_TIMEOUT_MS',
      DEFAULT_TIMEOUT_MS,
      env,
    );
    const timeoutMs = options.timeoutMs
      ?? (environmentTimeoutMs <= MAX_TIMEOUT_MS ? environmentTimeoutMs : DEFAULT_TIMEOUT_MS);
    const maxOutputBytes = options.maxOutputBytes
      ?? positiveEnv('KNOWLEDGE_COLLECTION_MAX_CLI_OUTPUT_BYTES', DEFAULT_MAX_OUTPUT_BYTES, env);
    const child = spawn(bin, args, {
      detached: USE_PROCESS_GROUP,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let settled = false;
    let timeoutTimer;
    let cleanupTimer;
    let boundError = null;
    let cleanupFailure = null;
    let cleanupDeadline = 0;
    let closeSeen = false;
    let outputBytes = 0;

    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(cleanupTimer);
      callback(value);
    };

    const finish = (result) => settle(resolve, result);

    const processTreeIsRunning = () => {
      if (!child.pid) return false;
      try {
        process.kill(USE_PROCESS_GROUP ? -child.pid : child.pid, 0);
        return true;
      } catch (error) {
        if (error.code === 'ESRCH') return false;
        return true;
      }
    };

    const killProcessTree = () => {
      if (!child.pid) return;
      try {
        if (USE_PROCESS_GROUP) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') {
          cleanupFailure = {
            code: typeof error.code === 'string' ? error.code : 'UNKNOWN',
            operation: USE_PROCESS_GROUP ? 'kill-process-group' : 'kill-process',
            signal: 'SIGKILL',
          };
        }
      }
    };

    const annotateBoundError = (cleanupUnconfirmed = false) => {
      if (cleanupUnconfirmed) boundError.cleanupUnconfirmed = true;
      if (cleanupFailure) boundError.cleanupFailure = cleanupFailure;
    };

    const confirmBoundCleanup = () => {
      if (settled || !boundError) return;
      if (closeSeen && !processTreeIsRunning()) {
        annotateBoundError();
        settle(reject, boundError);
        return;
      }
      if (Date.now() >= cleanupDeadline) {
        killProcessTree();
        annotateBoundError(true);
        settle(reject, boundError);
        return;
      }
      clearTimeout(cleanupTimer);
      cleanupTimer = setTimeout(confirmBoundCleanup, CLEANUP_POLL_MS);
    };

    const failBound = (error) => {
      if (settled || boundError) return;
      boundError = error;
      clearTimeout(timeoutTimer);
      cleanupDeadline = Date.now() + CLEANUP_TIMEOUT_MS;
      killProcessTree();
      confirmBoundCleanup();
    };

    const capture = (target) => (chunk) => {
      if (settled || boundError) return;
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        failBound(new Error(`CLI output exceeds ${maxOutputBytes} bytes`));
        return;
      }
      target.push(chunk);
    };

    child.stdout.on('data', capture(stdout));
    child.stderr.on('data', capture(stderr));
    child.on('error', (failure) => {
      if (boundError) {
        confirmBoundCleanup();
        return;
      }
      finish({
        exitCode: null,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        failure,
      });
    });
    child.on('close', (exitCode) => {
      closeSeen = true;
      if (boundError) {
        confirmBoundCleanup();
        return;
      }
      finish({
        exitCode,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        failure: null,
      });
    });

    timeoutTimer = setTimeout(() => {
      failBound(new Error(`CLI timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
}
