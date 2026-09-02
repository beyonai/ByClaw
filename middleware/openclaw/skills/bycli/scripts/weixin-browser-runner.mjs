#!/usr/bin/env node

import { basename, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createRecoveryBudget,
  ensureBridge as ensureBridgeDefault,
  runCommand,
} from './bridge-bootstrap.mjs';
import {
  blockedCliPayload,
  errorCode,
  runGate,
} from './weixin-login-gate.mjs';

const LIST_TIMEOUT_MS = 60_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const COMMAND_TIMEOUT_GRACE_MS = 30_000;

function isBrowserConnect(result) {
  const exitCode = Number(result?.exitCode);
  return exitCode === 69 || (exitCode !== 0 && errorCode(result) === 'BROWSER_CONNECT');
}

function internalError({
  exitCode,
  code,
  message,
  bridgeCode,
  details,
  commandExecuted = false,
}) {
  return {
    exitCode,
    stdout: '',
    stderr: `${JSON.stringify({
      ok: false,
      error: {
        code,
        message,
        exitCode,
        commandExecuted,
        ...(details ? { details } : bridgeCode ? { details: { bridgeCode } } : {}),
      },
    })}\n`,
    commandExecuted,
    stateDisposition: 'no-auth-state',
  };
}

function bridgeErrorDetails(bridge) {
  const details = { bridgeCode: bridge.code };
  if (['running', 'stopped', 'unknown'].includes(bridge.browserState)) {
    details.browserState = bridge.browserState;
  }
  if (Array.isArray(bridge.actions)) {
    details.actions = bridge.actions.filter(action => [
      'browser_start_script',
      'browser_start_openclaw',
      'daemon_restart',
    ].includes(action));
  }
  if (['running', 'stopped', 'unknown'].includes(bridge.daemonState)) {
    details.daemonState = bridge.daemonState;
  }
  if (['connected', 'disconnected', 'unknown'].includes(bridge.extensionState)) {
    details.extensionState = bridge.extensionState;
  }
  if (Number.isInteger(bridge.checks) && bridge.checks >= 0) details.checks = bridge.checks;
  if (bridge.budget && typeof bridge.budget === 'object') {
    details.budget = {
      browserStartsUsed: Number.isInteger(bridge.budget.browserStartsUsed)
        ? bridge.budget.browserStartsUsed : 0,
      daemonRestartsUsed: Number.isInteger(bridge.budget.daemonRestartsUsed)
        ? bridge.budget.daemonRestartsUsed : 0,
    };
  }
  if (bridge.diagnostics && typeof bridge.diagnostics === 'object') {
    const diagnostics = {};
    if (['running', 'stopped', 'unknown'].includes(bridge.diagnostics.browserStatus)) {
      diagnostics.browserStatus = bridge.diagnostics.browserStatus;
    }
    for (const field of [
      'browserStartFailed',
      'recoveryBudgetExhausted',
      'lockTimeout',
    ]) {
      if (typeof bridge.diagnostics[field] === 'boolean') {
        diagnostics[field] = bridge.diagnostics[field];
      }
    }
    if (Object.keys(diagnostics).length > 0) details.diagnostics = diagnostics;
  }
  return details;
}

function bridgeError(bridge, commandExecuted = false) {
  return internalError({
    exitCode: 69,
    code: 'BROWSER_CONNECT',
    message: bridge.reason || 'Managed browser bridge is unavailable',
    details: bridgeErrorDetails(bridge),
    commandExecuted,
  });
}

function validateInvocation(stateDir, argv) {
  if (!isAbsolute(stateDir)) throw new Error('stateDir must be an absolute path');
  if (!Array.isArray(argv) || argv.length < 3
    || basename(String(argv[0])) !== 'bycli'
    || argv[1] !== 'weixin'
    || !String(argv[2])) {
    throw new Error('runner command must begin with: bycli weixin <command>');
  }
}

function optionValue(argv, name) {
  for (let index = 3; index < argv.length; index += 1) {
    const value = String(argv[index]);
    if (value === name) return argv[index + 1];
    if (value.startsWith(`${name}=`)) return value.slice(name.length + 1);
  }
  return null;
}

export function commandExecutionTimeoutMs(argv) {
  const commandTimeoutSeconds = Number(optionValue(argv, '--timeout'));
  if (!Number.isFinite(commandTimeoutSeconds) || commandTimeoutSeconds <= 0) {
    return DEFAULT_COMMAND_TIMEOUT_MS;
  }
  return Math.max(
    DEFAULT_COMMAND_TIMEOUT_MS,
    Math.ceil(commandTimeoutSeconds * 1_000) + COMMAND_TIMEOUT_GRACE_MS,
  );
}

export function normalizeCommandResult(result) {
  const exitCode = Number(result?.exitCode);
  const stdout = String(result?.stdout || '');
  const stderr = String(result?.stderr || '');
  if (exitCode === 0 || (!result?.timedOut && (stdout.trim() || stderr.trim()))) return result;

  const timedOut = result?.timedOut === true;
  return internalError({
    exitCode: Number.isFinite(exitCode) && exitCode !== 0 ? exitCode : 1,
    code: timedOut ? 'COMMAND_TIMEOUT_UNCERTAIN' : 'COMMAND_EXEC_UNCERTAIN',
    message: timedOut
      ? 'Weixin command timed out without a final structured result'
      : 'Weixin command failed without a structured result',
    details: {
      timedOut,
      signal: result?.signal || null,
      durationMs: Number.isFinite(result?.durationMs) ? result.durationMs : null,
      stdoutLength: Buffer.byteLength(stdout),
      stderrLength: Buffer.byteLength(stderr),
    },
    commandExecuted: result?.commandExecuted !== false,
  });
}

async function executeArgv(argv) {
  const result = await runCommand(
    argv[0],
    argv.slice(1),
    commandExecutionTimeoutMs(argv),
  );
  return normalizeCommandResult(result);
}

export async function loadRuntimeCapability(commandName) {
  const result = await runCommand('bycli', ['list', '-f', 'json'], LIST_TIMEOUT_MS);
  if (Number(result.exitCode) !== 0) {
    throw new Error('bycli structured command catalog is unavailable');
  }
  let rows;
  try {
    rows = JSON.parse(result.stdout);
  } catch {
    throw new Error('bycli structured command catalog is invalid JSON');
  }
  if (!Array.isArray(rows)) throw new Error('bycli structured command catalog is not an array');
  const entry = rows.find(row => row?.site === 'weixin' && row?.name === commandName);
  if (!entry) throw new Error(`weixin command capability not found: ${commandName}`);
  return entry.meta && typeof entry.meta === 'object'
    ? { ...entry, ...entry.meta }
    : entry;
}

function capabilityDecision(capability, selectedMode) {
  const browser = capability?.browser;
  if (browser === true) return { allowed: true };
  if (browser === 'conditional' && selectedMode === 'browser') return { allowed: true };
  if (browser === false) {
    return { allowed: false, message: 'API-only Weixin command must not use the browser runner' };
  }
  if (browser === 'conditional') {
    return { allowed: false, message: 'conditional Weixin command requires --selected-mode browser' };
  }
  return { allowed: false, unknown: true, message: 'Weixin command browser capability is unknown' };
}

function accessMode(capability) {
  const access = capability?.access ?? capability?.operation?.access;
  return access === 'read' ? 'read' : access === 'write' ? 'write' : 'unknown';
}

export async function runWeixinBrowser({
  stateDir,
  argv,
  verificationConfirmed = false,
  selectedMode = null,
  execute = executeArgv,
  loadCapability = loadRuntimeCapability,
  ensureBridge = ensureBridgeDefault,
  gate = runGate,
} = {}) {
  validateInvocation(stateDir, argv);
  if (selectedMode !== null && selectedMode !== 'browser') {
    throw new Error('selectedMode must be browser when provided');
  }

  return gate({
    stateDir,
    argv,
    verificationConfirmed,
    execute: async (commandArgv, context) => {
      if (context.attemptKind === 'confirmed-rerun') return execute(commandArgv);

      let capability;
      try {
        capability = await loadCapability(commandArgv[2]);
      } catch (error) {
        return internalError({
          exitCode: 2,
          code: 'COMMAND_CAPABILITY_UNKNOWN',
          message: error.message,
        });
      }
      const decision = capabilityDecision(capability, selectedMode);
      if (!decision.allowed) {
        return internalError({
          exitCode: 2,
          code: decision.unknown ? 'COMMAND_CAPABILITY_UNKNOWN' : 'ARGUMENT',
          message: decision.message,
        });
      }

      const budget = createRecoveryBudget();
      const preflight = await ensureBridge({ budget });
      if (!preflight?.ok) return bridgeError(preflight, false);

      const initial = await execute(commandArgv);
      if (!isBrowserConnect(initial)) return initial;

      const recovered = await ensureBridge({ budget });
      if (!recovered?.ok) return bridgeError(recovered, true);

      if (accessMode(capability) !== 'read') {
        return internalError({
          exitCode: 1,
          code: 'RETRY_APPROVAL_REQUIRED',
          message: 'Bridge recovered; explicit approval is required before retrying this command',
          bridgeCode: 'BRIDGE_RECOVERED_RETRY_REQUIRES_APPROVAL',
          commandExecuted: true,
        });
      }

      const rerun = await execute(commandArgv);
      if (!isBrowserConnect(rerun)) return rerun;
      return internalError({
        exitCode: 69,
        code: 'BROWSER_CONNECT',
        message: 'Managed browser bridge remained unavailable after the single read retry',
        bridgeCode: 'BRIDGE_UNAVAILABLE',
        commandExecuted: true,
      });
    },
  });
}

function parseCli(argv) {
  const separator = argv.indexOf('--');
  if (separator === -1) throw new Error('missing -- before the bycli command');
  const options = argv.slice(0, separator);
  const command = argv.slice(separator + 1);
  let stateDir = '';
  let verificationConfirmed = false;
  let selectedMode = null;
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    const value = options[index + 1];
    if (option === '--state-dir') stateDir = value || '';
    else if (option === '--verification-confirmed') {
      if (!['true', 'false'].includes(value)) {
        throw new Error('--verification-confirmed must be true or false');
      }
      verificationConfirmed = value === 'true';
    } else if (option === '--selected-mode') selectedMode = value || '';
    else throw new Error(`unknown option: ${option}`);
    index += 1;
  }
  return { stateDir, verificationConfirmed, selectedMode, command };
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  const result = await runWeixinBrowser({
    stateDir: options.stateDir,
    argv: options.command,
    verificationConfirmed: options.verificationConfirmed,
    selectedMode: options.selectedMode,
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
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: { code: 'ARGUMENT', message: error.message, exitCode: 2 },
    }, null, 2)}\n`);
    process.exitCode = 2;
  });
}
