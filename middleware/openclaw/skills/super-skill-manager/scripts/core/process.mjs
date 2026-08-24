import { spawn } from 'node:child_process';

const CREDENTIAL_ENV_KEY = /(?:token|secret|password|passwd|api[_-]?key|authorization|credential|private[_-]?key)/i;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const KILL_GRACE_MS = 250;
const FINAL_SETTLEMENT_GRACE_MS = 100;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeEnv(env) {
  if (env === undefined) return { ...process.env };
  if (!isPlainObject(env)) throw new TypeError('env must be a plain object');

  const normalized = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (!['string', 'number', 'boolean', 'bigint'].includes(typeof value)) {
      throw new TypeError(`env.${key} must be a string, number, boolean, or bigint`);
    }
    normalized[key] = String(value);
  }
  return normalized;
}

function validateInputs({ command, args, timeoutMs, cwd, env, maxOutputBytes }) {
  if (typeof command !== 'string' || !command.trim()) throw new TypeError('command must be a non-empty string');
  if (!Array.isArray(args) || !args.every((argument) => typeof argument === 'string')) {
    throw new TypeError('args must be an array of strings');
  }
  if (cwd !== undefined && typeof cwd !== 'string') throw new TypeError('cwd must be a string when provided');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be a positive finite number');
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new TypeError('maxOutputBytes must be a positive safe integer');
  }
  return normalizeEnv(env);
}

function sensitiveValues(env) {
  return Object.entries(env)
    .filter(([key, value]) => CREDENTIAL_ENV_KEY.test(key) && value.length > 0)
    .map(([, value]) => value)
    .sort((left, right) => right.length - left.length);
}

function matchingSecretAt(text, index, values) {
  return values.find((value) => text.startsWith(value, index));
}

function redact(text, values) {
  let result = '';
  for (let index = 0; index < text.length; ) {
    const match = matchingSecretAt(text, index, values);
    if (match) {
      result += '[REDACTED]';
      index += match.length;
    } else {
      result += text[index];
      index += 1;
    }
  }
  return result;
}

function redactStreamChunk(pending, chunk, values, final) {
  const text = pending + chunk;
  const maxSensitiveValueLength = values[0]?.length ?? 0;
  if (final && pending && values.some((value) => value.startsWith(pending))) {
    return { output: '[REDACTED]', pending: '' };
  }

  let output = '';
  for (let index = 0; index < text.length; ) {
    const remaining = text.slice(index);
    if (
      !final &&
      remaining.length < maxSensitiveValueLength &&
      values.some((value) => remaining.length < value.length && value.startsWith(remaining))
    ) {
      return { output, pending: remaining };
    }

    const match = matchingSecretAt(text, index, values);
    if (match) {
      output += '[REDACTED]';
      index += match.length;
      continue;
    }
    output += text[index];
    index += 1;
  }
  return { output, pending: '' };
}

function boundedPrefix(value, byteLimit) {
  let bytes = 0;
  let prefix = '';
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character);
    if (bytes + characterBytes > byteLimit) break;
    prefix += character;
    bytes += characterBytes;
  }
  return prefix;
}

export function signalOwnedProcess({ child, signal, detached, platform = process.platform, spawnCommand = spawn }) {
  if (platform === 'win32') {
    if (!child?.pid) return;
    try {
      const taskkill = spawnCommand(
        'taskkill.exe',
        ['/PID', String(child.pid), '/T', ...(signal === 'SIGKILL' ? ['/F'] : [])],
        { shell: false, stdio: 'ignore', windowsHide: true },
      );
      taskkill?.once?.('error', () => {});
    } catch {
      // Final settlement keeps the caller bounded if taskkill is unavailable.
    }
    return;
  }
  if (detached && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to the direct child when a process group is unavailable.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // The child may have exited between deadline handling and signal delivery.
  }
}

function processGroupExists(child, detached) {
  if (!detached || !child.pid) return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function runCommand({
  command,
  args = [],
  timeoutMs,
  cwd,
  env,
  signal,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
}) {
  const childEnv = validateInputs({ command, args, timeoutMs, cwd, env, maxOutputBytes });
  const startedAt = performance.now();
  const secrets = sensitiveValues(childEnv);
  const detached = process.platform !== 'win32';
  const isWindows = process.platform === 'win32';

  return new Promise((resolve) => {
    let child;
    let settled = false;
    let terminationStarted = false;
    let timedOut = false;
    let outputLimitExceeded = false;
    const streams = {
      stdout: { value: '', bytes: 0, truncated: false, pending: '' },
      stderr: { value: '', bytes: 0, truncated: false, pending: '' },
    };
    let closeResult = null;
    let forceKillSent = false;
    let deadlineTimer;
    let forceKillTimer;
    let finalSettlementTimer;
    const onAbort = () => { timedOut = true; terminate(); };

    const onStdout = (chunk) => appendOutput('stdout', chunk);
    const onStderr = (chunk) => appendOutput('stderr', chunk);
    const onError = (error) => {
      appendOutput('stderr', `${error.code ?? 'SPAWN_ERROR'}: ${error.message}`);
      finish({});
    };
    const onClose = (exitCode, signal) => {
      const result = { exitCode, signal };
      if (!terminationStarted || forceKillSent || (!isWindows && !processGroupExists(child, detached))) {
        finish(result);
        return;
      }
      closeResult = result;
    };

    const cleanup = () => {
      clearTimeout(deadlineTimer);
      clearTimeout(forceKillTimer);
      clearTimeout(finalSettlementTimer);
      child?.stdout?.removeListener('data', onStdout);
      child?.stderr?.removeListener('data', onStderr);
      child?.removeListener('error', onError);
      child?.removeListener('close', onClose);
      signal?.removeEventListener?.('abort', onAbort);
    };

    const finish = ({ exitCode = null, signal = null }) => {
      if (settled) return;
      flushPendingOutput();
      settled = true;
      cleanup();
      resolve({
        ok: !timedOut && !outputLimitExceeded && exitCode === 0,
        command: redact(command, secrets),
        args: args.map((argument) => redact(argument, secrets)),
        exitCode,
        signal,
        stdout: streams.stdout.value,
        stderr: streams.stderr.value,
        timedOut,
        stdoutTruncated: streams.stdout.truncated,
        stderrTruncated: streams.stderr.truncated,
        outputLimitExceeded,
        errorCode: outputLimitExceeded ? 'OUTPUT_LIMIT' : null,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
    };

    const settleAfterDeadline = () => {
      if (outputLimitExceeded) {
        if (!child?.stdout?.readableEnded) streams.stdout.truncated = true;
        if (!child?.stderr?.readableEnded) streams.stderr.truncated = true;
      }
      child?.stdout?.destroy();
      child?.stderr?.destroy();
      finish({});
    };

    const terminate = () => {
      if (terminationStarted || !child) return;
      terminationStarted = true;
      signalOwnedProcess({ child, signal: 'SIGTERM', detached });
      forceKillTimer = setTimeout(() => {
        forceKillSent = true;
        signalOwnedProcess({ child, signal: 'SIGKILL', detached });
        if (closeResult) finish(closeResult);
      }, KILL_GRACE_MS);
      finalSettlementTimer = setTimeout(settleAfterDeadline, KILL_GRACE_MS + FINAL_SETTLEMENT_GRACE_MS);
    };

    const appendOutput = (stream, chunk) => {
      if (settled) return;
      const state = streams[stream];
      const redacted = redactStreamChunk(state.pending, chunk, secrets, false);
      state.pending = redacted.pending;
      captureOutput(stream, redacted.output);
    };

    const captureOutput = (stream, value) => {
      if (!value) return;
      const state = streams[stream];
      const valueBytes = Buffer.byteLength(value);
      const availableBytes = maxOutputBytes - state.bytes;
      const prefix = valueBytes <= availableBytes ? value : boundedPrefix(value, Math.max(availableBytes, 0));
      state.value += prefix;
      state.bytes += Buffer.byteLength(prefix);

      if (valueBytes > availableBytes) {
        state.truncated = true;
        outputLimitExceeded = true;
        terminate();
      }
    };

    const flushPendingOutput = () => {
      for (const stream of ['stdout', 'stderr']) {
        const state = streams[stream];
        if (!state.pending) continue;
        const redacted = redactStreamChunk(state.pending, '', secrets, true);
        state.pending = redacted.pending;
        captureOutput(stream, redacted.output);
      }
    };

    try {
      child = spawn(command, args, {
        cwd,
        env: childEnv,
        shell: false,
        detached,
      });
    } catch (error) {
      appendOutput('stderr', `${error.code ?? 'SPAWN_ERROR'}: ${error.message}`);
      finish({});
      return;
    }

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);
    child.once('error', onError);
    child.once('close', onClose);
    if (signal?.aborted) { timedOut = true; terminate(); return; }
    signal?.addEventListener?.('abort', onAbort, { once: true });
    deadlineTimer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
  });
}
