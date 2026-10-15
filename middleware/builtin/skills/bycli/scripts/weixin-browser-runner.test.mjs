import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  commandExecutionTimeoutMs,
  loadRuntimeCapability,
  normalizeCommandResult,
  runWeixinBrowser,
} from './weixin-browser-runner.mjs';

const command = (name = 'user-info') => [
  'bycli', 'weixin', name,
  '--site-session', 'persistent',
  '--keep-tab', 'true',
  '-f', 'json',
];
const channelsCommand = (name = 'overview') => [
  'bycli', 'weixin-channels', name,
  '--site-session', 'persistent',
  '--keep-tab', 'true',
  '-f', 'json',
];
const channelsCapability = {
  browser: true,
  access: 'read',
  domain: 'channels.weixin.qq.com',
};
const success = (stdout = '{"ok":true}') => ({ exitCode: 0, stdout, stderr: '' });
const typedError = (exitCode, code) => ({
  exitCode,
  stdout: '',
  stderr: JSON.stringify({ ok: false, error: { code, exitCode } }),
});
const ready = {
  ok: true,
  code: 'BRIDGE_READY',
  budget: { browserStartsUsed: 0, daemonRestartsUsed: 0 },
};
const unavailable = {
  ok: false,
  code: 'BRIDGE_UNAVAILABLE',
  reason: 'EXTENSION_DISCONNECTED',
  browserState: 'unknown',
  actions: ['process_restart', 'token=must-not-leak'],
  daemonState: 'running',
  extensionState: 'disconnected',
  checks: 3,
  budget: { browserStartsUsed: 0, daemonRestartsUsed: 0 },
  diagnostics: {
    recoveryOwner: 'supervisor',
    healthWaitTimedOut: true,
    rawOutput: 'token=must-not-leak',
  },
  secret: 'must-not-leak',
};

async function stateDir(t, prefix = 'weixin-runner-') {
  const path = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('runtime catalog chooses capabilities from the requested site and defaults to Weixin', async (t) => {
  const directory = await stateDir(t, 'weixin-runner-catalog-');
  const bin = join(directory, 'bin');
  await mkdir(bin);
  const bycli = join(bin, 'bycli');
  await writeFile(bycli, `#!/bin/sh
if [ "$1 $2 $3" != "list -f json" ]; then exit 2; fi
printf '%s\\n' '[{"site":"weixin","name":"overview","browser":true,"access":"write","domain":"mp.weixin.qq.com"},{"site":"weixin-channels","name":"overview","browser":true,"meta":{"access":"read","domain":"channels.weixin.qq.com"}}]'
`);
  await chmod(bycli, 0o700);
  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}:/usr/bin:/bin`;
  try {
    const channels = await loadRuntimeCapability('overview', 'weixin-channels');
    assert.equal(channels.site, 'weixin-channels');
    assert.equal(channels.domain, 'channels.weixin.qq.com');
    assert.equal(channels.access, 'read');
    const weixin = await loadRuntimeCapability('overview');
    assert.equal(weixin.site, 'weixin');
    assert.equal(weixin.domain, 'mp.weixin.qq.com');
    assert.equal(weixin.access, 'write');
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  }
});

test('initial Weixin capability lookup supplies the site to injected loaders', async (t) => {
  const outcome = await runWeixinBrowser({
    stateDir: await stateDir(t),
    argv: command(),
    loadCapability: async (name, site) => {
      assert.equal(name, 'user-info');
      assert.equal(site, 'weixin');
      return { browser: true, access: 'read' };
    },
    ensureBridge: async () => ready,
    execute: async () => success(),
  });
  assert.equal(outcome.exitCode, 0, outcome.stderr);
  assert.equal(outcome.phase, 'complete');
});

test('Channels statistics commands run with site-specific read-only browser capability', async (t) => {
  for (const name of ['overview', 'trend', 'sources', 'posts', 'post-detail']) {
    const argv = channelsCommand(name);
    const events = [];
    const outcome = await runWeixinBrowser({
      stateDir: await stateDir(t, 'channels-runner-command-'),
      argv,
      loadCapability: async (commandName, site) => {
        assert.equal(commandName, name);
        assert.equal(site, 'weixin-channels');
        events.push('capability');
        return channelsCapability;
      },
      ensureBridge: async () => {
        events.push('bridge');
        return ready;
      },
      execute: async received => {
        assert.deepEqual(received, argv);
        events.push('command');
        return success('{"ok":true,"site":"channels"}');
      },
    });
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.phase, 'complete');
    assert.equal(outcome.commandExecuted, true);
    assert.deepEqual(JSON.parse(outcome.stdout), { ok: true, site: 'channels' });
    assert.deepEqual(events, ['capability', 'bridge', 'command']);
  }
});

test('unknown Channels commands fail before capability, bridge, execution, or Gate state', async (t) => {
  const directory = await stateDir(t, 'channels-runner-command-rejected-');
  const dependencies = {
    loadCapability: async () => assert.fail('capability must not run'),
    ensureBridge: async () => assert.fail('bridge must not run'),
    execute: async () => assert.fail('command must not run'),
  };
  for (const name of ['create-draft', 'user-info', '']) {
    await assert.rejects(runWeixinBrowser({
      stateDir: directory,
      argv: channelsCommand(name),
      ...dependencies,
    }), /command/);
  }
  assert.deepEqual(await readdir(directory), []);
});

test('Channels capability rejects writes, wrong domains, and non-browser commands before side effects', async (t) => {
  for (const capability of [
    { browser: true, access: 'write', domain: 'channels.weixin.qq.com' },
    { browser: true, domain: 'channels.weixin.qq.com' },
    { browser: true, access: 'read', domain: 'mp.weixin.qq.com' },
    { browser: true, access: 'read' },
    { browser: false, access: 'read', domain: 'channels.weixin.qq.com' },
    { browser: 'conditional', access: 'read', domain: 'channels.weixin.qq.com' },
  ]) {
    const directory = await stateDir(t, 'channels-runner-capability-rejected-');
    const outcome = await runWeixinBrowser({
      stateDir: directory,
      argv: channelsCommand(),
      selectedMode: 'browser',
      loadCapability: async () => capability,
      ensureBridge: async () => assert.fail('bridge must not run'),
      execute: async () => assert.fail('command must not run'),
    });
    assert.equal(outcome.exitCode, 2);
    assert.equal(outcome.commandExecuted, false);
    assert.equal(JSON.parse(outcome.stderr).error.code, 'ARGUMENT');
    assert.deepEqual(await readdir(directory), []);
  }
});

test('unavailable Channels capability leaves the Gate operation unconsumed', async (t) => {
  const directory = await stateDir(t, 'channels-runner-capability-unavailable-');
  const outcome = await runWeixinBrowser({
    stateDir: directory,
    argv: channelsCommand(),
    loadCapability: async () => { throw new Error('catalog unavailable'); },
    ensureBridge: async () => assert.fail('bridge must not run'),
    execute: async () => assert.fail('command must not run'),
  });
  assert.equal(outcome.exitCode, 2);
  assert.equal(outcome.commandExecuted, false);
  assert.equal(JSON.parse(outcome.stderr).error.code, 'COMMAND_CAPABILITY_UNKNOWN');
  assert.deepEqual(await readdir(directory), []);
});

test('Channels confirmation resumes the same Gate operation without capability or bridge work', async (t) => {
  const directory = await stateDir(t, 'channels-runner-auth-');
  const argv = channelsCommand();
  const initial = await runWeixinBrowser({
    stateDir: directory,
    argv,
    loadCapability: async () => channelsCapability,
    ensureBridge: async () => ready,
    execute: async () => typedError(77, 'AUTH_REQUIRED'),
  });
  assert.equal(initial.phase, 'waiting-confirmation');
  const unavailablePreflight = {
    loadCapability: async () => assert.fail('capability must not run'),
    ensureBridge: async () => assert.fail('bridge must not run'),
  };
  const blocked = await runWeixinBrowser({
    stateDir: directory,
    argv,
    ...unavailablePreflight,
    execute: async () => assert.fail('unconfirmed command must not run'),
  });
  assert.equal(blocked.executed, false);
  assert.equal(blocked.requiresUserAction, true);
  assert.equal(blocked.operationFingerprint, initial.operationFingerprint);
  const confirmed = await runWeixinBrowser({
    stateDir: directory,
    argv,
    verificationConfirmed: true,
    ...unavailablePreflight,
    execute: async received => {
      assert.deepEqual(received, argv);
      return success('{"ok":true,"resumed":true}');
    },
  });
  assert.equal(confirmed.exitCode, 0);
  assert.equal(confirmed.phase, 'complete');
  assert.equal(confirmed.operationFingerprint, initial.operationFingerprint);
  assert.deepEqual(JSON.parse(confirmed.stdout), { ok: true, resumed: true });
  const files = (await readdir(directory)).filter(name => name.endsWith('.json'));
  assert.equal(files.length, 1);
  const state = JSON.parse(await readFile(join(directory, files[0]), 'utf8'));
  assert.equal(state.phase, 'complete');
  assert.equal(state.confirmedRerunCount, 1);
});

test('command execution timeout includes the command timeout plus a safety margin', () => {
  assert.equal(commandExecutionTimeoutMs(command()), 30_000);
  assert.equal(commandExecutionTimeoutMs([...command(), '--timeout', '60']), 90_000);
  assert.equal(commandExecutionTimeoutMs([...command(), '--timeout=180']), 210_000);
  assert.equal(commandExecutionTimeoutMs([...command(), '--timeout', 'invalid']), 30_000);
});

test('timeout without structured output becomes a diagnosable non-authentication result', async (t) => {
  const directory = await stateDir(t, 'weixin-runner-timeout-');
  const processResult = normalizeCommandResult({
    exitCode: 1,
    stdout: '',
    stderr: '',
    timedOut: true,
    signal: 'SIGTERM',
    durationMs: 30_012,
  });

  const outcome = await runWeixinBrowser({
    stateDir: directory,
    argv: command('download-publish-data'),
    loadCapability: async () => ({ browser: true, access: 'write' }),
    ensureBridge: async () => ready,
    execute: async () => processResult,
  });

  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.phase, 'initial');
  assert.equal(outcome.commandExecuted, true);
  assert.deepEqual(await readdir(directory), []);
  const error = JSON.parse(outcome.stderr).error;
  assert.equal(error.code, 'COMMAND_TIMEOUT_UNCERTAIN');
  assert.equal(error.commandExecuted, true);
  assert.deepEqual(error.details, {
    timedOut: true,
    signal: 'SIGTERM',
    durationMs: 30_012,
    stdoutLength: 0,
    stderrLength: 0,
  });
});

test('empty unknown process failure becomes a diagnosable non-authentication result', () => {
  const outcome = normalizeCommandResult({
    exitCode: 1,
    stdout: '',
    stderr: '',
    timedOut: false,
    signal: null,
    durationMs: 321,
  });

  const error = JSON.parse(outcome.stderr).error;
  assert.equal(error.code, 'COMMAND_EXEC_UNCERTAIN');
  assert.equal(outcome.stateDisposition, 'no-auth-state');
  assert.equal(error.details.durationMs, 321);
});

test('initial browser command runs capability check, bridge, then command', async (t) => {
  const events = [];
  const outcome = await runWeixinBrowser({
    stateDir: await stateDir(t),
    argv: command(),
    loadCapability: async name => {
      events.push(`help:${name}`);
      return { browser: true, access: 'read' };
    },
    ensureBridge: async ({ budget }) => {
      events.push(`bridge:${budget.daemonRestartsUsed}`);
      return ready;
    },
    execute: async argv => {
      events.push(`command:${argv[2]}`);
      return success();
    },
  });

  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.commandExecuted, true);
  assert.deepEqual(events, ['help:user-info', 'bridge:0', 'command:user-info']);
});

test('bridge failure does not execute Weixin command or create Gate state', async (t) => {
  const directory = await stateDir(t);
  let commands = 0;
  const outcome = await runWeixinBrowser({
    stateDir: directory,
    argv: command(),
    loadCapability: async () => ({ browser: true, access: 'read' }),
    ensureBridge: async () => unavailable,
    execute: async () => {
      commands += 1;
      return success();
    },
  });

  assert.equal(outcome.exitCode, 69);
  assert.equal(outcome.commandExecuted, false);
  const error = JSON.parse(outcome.stderr).error;
  assert.equal(error.commandExecuted, false);
  assert.deepEqual(error.details, {
    bridgeCode: 'BRIDGE_UNAVAILABLE',
    browserState: 'unknown',
    actions: [],
    daemonState: 'running',
    extensionState: 'disconnected',
    checks: 3,
    budget: { browserStartsUsed: 0, daemonRestartsUsed: 0 },
    diagnostics: {
      recoveryOwner: 'supervisor',
      healthWaitTimedOut: true,
    },
  });
  assert.doesNotMatch(outcome.stderr, /must-not-leak/);
  assert.equal(commands, 0);
  assert.deepEqual(await readdir(directory), []);
});

test('waiting confirmation blocks before capability, bridge, or command work', async (t) => {
  const directory = await stateDir(t);
  const events = [];
  const options = {
    stateDir: directory,
    argv: command(),
    loadCapability: async () => {
      events.push('help');
      return { browser: true, access: 'read' };
    },
    ensureBridge: async () => {
      events.push('bridge');
      return ready;
    },
    execute: async () => {
      events.push('command');
      return typedError(77, 'AUTH_REQUIRED');
    },
  };
  await runWeixinBrowser(options);
  events.length = 0;

  const blocked = await runWeixinBrowser(options);

  assert.equal(blocked.executed, false);
  assert.equal(blocked.reason, 'explicit-verification-confirmation-required');
  assert.deepEqual(events, []);
});

test('every confirmed rerun skips capability and bridge', async (t) => {
  const directory = await stateDir(t);
  const events = [];
  const options = {
    stateDir: directory,
    argv: command(),
    loadCapability: async () => {
      events.push('help');
      return { browser: true, access: 'read' };
    },
    ensureBridge: async () => {
      events.push('bridge');
      return ready;
    },
    execute: async () => {
      events.push('command');
      return typedError(77, 'AUTH_REQUIRED');
    },
  };
  await runWeixinBrowser(options);
  events.length = 0;

  const outcome = await runWeixinBrowser({ ...options, verificationConfirmed: true });

  assert.equal(outcome.exitCode, 77);
  assert.deepEqual(events, ['command']);

  events.length = 0;
  const secondOutcome = await runWeixinBrowser({ ...options, verificationConfirmed: true });

  assert.equal(secondOutcome.exitCode, 77);
  assert.deepEqual(events, ['command']);
});

test('read command reuses one budget for bridge recovery and retries command once', async (t) => {
  const budgets = [];
  let executions = 0;
  const outcome = await runWeixinBrowser({
    stateDir: await stateDir(t),
    argv: command(),
    loadCapability: async () => ({ browser: true, access: 'read' }),
    ensureBridge: async ({ budget }) => {
      budgets.push(budget);
      return ready;
    },
    execute: async () => {
      executions += 1;
      return executions === 1 ? typedError(69, 'BROWSER_CONNECT') : success();
    },
  });

  assert.equal(outcome.exitCode, 0);
  assert.equal(executions, 2);
  assert.equal(budgets.length, 2);
  assert.equal(budgets[0], budgets[1]);
});

test('successful business data containing BROWSER_CONNECT does not trigger bridge recovery', async (t) => {
  let bridgeChecks = 0;
  let executions = 0;
  const outcome = await runWeixinBrowser({
    stateDir: await stateDir(t),
    argv: command(),
    loadCapability: async () => ({ browser: true, access: 'read' }),
    ensureBridge: async () => {
      bridgeChecks += 1;
      return ready;
    },
    execute: async () => {
      executions += 1;
      return success(JSON.stringify({ ok: true, records: [{ code: 'BROWSER_CONNECT' }] }));
    },
  });

  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.phase, 'complete');
  assert.equal(bridgeChecks, 1);
  assert.equal(executions, 1);
});

test('write command recovers bridge but requires approval instead of automatic retry', async (t) => {
  let executions = 0;
  const outcome = await runWeixinBrowser({
    stateDir: await stateDir(t),
    argv: command('create-draft'),
    loadCapability: async () => ({ browser: true, access: 'write' }),
    ensureBridge: async () => ready,
    execute: async () => {
      executions += 1;
      return typedError(69, 'BROWSER_CONNECT');
    },
  });

  assert.equal(outcome.exitCode, 1);
  const error = JSON.parse(outcome.stderr).error;
  assert.equal(error.code, 'RETRY_APPROVAL_REQUIRED');
  assert.equal(error.commandExecuted, true);
  assert.equal(error.details.bridgeCode, 'BRIDGE_RECOVERED_RETRY_REQUIRES_APPROVAL');
  assert.equal(executions, 1);
});

test('second read BROWSER_CONNECT becomes final bridge result without a third command', async (t) => {
  let executions = 0;
  const outcome = await runWeixinBrowser({
    stateDir: await stateDir(t),
    argv: command(),
    loadCapability: async () => ({ browser: true, access: 'read' }),
    ensureBridge: async () => ready,
    execute: async () => {
      executions += 1;
      return typedError(69, 'BROWSER_CONNECT');
    },
  });

  assert.equal(outcome.exitCode, 69);
  assert.match(outcome.stderr, /BRIDGE_UNAVAILABLE/);
  assert.equal(executions, 2);
});

test('API-only and unselected conditional commands fail without bridge or command execution', async (t) => {
  for (const capability of [
    { browser: false, access: 'read' },
    { browser: 'conditional', access: 'read' },
  ]) {
    let sideEffects = 0;
    const outcome = await runWeixinBrowser({
      stateDir: await stateDir(t, 'weixin-runner-capability-'),
      argv: command('articles'),
      loadCapability: async () => capability,
      ensureBridge: async () => {
        sideEffects += 1;
        return ready;
      },
      execute: async () => {
        sideEffects += 1;
        return success();
      },
    });

    assert.equal(outcome.exitCode, 2);
    assert.match(outcome.stderr, /ARGUMENT/);
    assert.equal(sideEffects, 0);
  }
});

test('selected conditional browser command is accepted but the selector is not forwarded', async (t) => {
  let received;
  const outcome = await runWeixinBrowser({
    stateDir: await stateDir(t),
    argv: command('articles'),
    selectedMode: 'browser',
    loadCapability: async () => ({ browser: 'conditional', access: 'read' }),
    ensureBridge: async () => ready,
    execute: async argv => {
      received = argv;
      return success();
    },
  });

  assert.equal(outcome.exitCode, 0);
  assert.deepEqual(received, command('articles'));
});

test('invalid state directory and command prefix fail before any dependency call', async () => {
  const dependencies = {
    loadCapability: async () => assert.fail('help must not run'),
    ensureBridge: async () => assert.fail('bridge must not run'),
    execute: async () => assert.fail('command must not run'),
  };

  await assert.rejects(
    runWeixinBrowser({ stateDir: 'relative', argv: command(), ...dependencies }),
    /absolute/,
  );
  await assert.rejects(
    runWeixinBrowser({ stateDir: '/tmp/gate', argv: ['echo', 'unsafe'], ...dependencies }),
    /bycli weixin/,
  );
});

test('CLI scenario runs Gate, live bridge subprocesses, and read-only Weixin command end to end', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'weixin-runner-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  const gateState = join(root, 'gate-state');
  const log = join(root, 'commands.log');
  await mkdir(bin);
  const bycli = join(bin, 'bycli');
  await writeFile(bycli, `#!/bin/sh
printf 'bycli %s\\n' "$*" >> "$SCENARIO_LOG"
if [ "$1 $2 $3" = "list -f json" ]; then
  printf '[{"site":"weixin","name":"user-info","browser":true,"access":"read"}]\\n'
  exit 0
fi
if [ "$1" = doctor ]; then exit 0; fi
if [ "$1 $2" = "daemon status" ]; then
  printf 'Daemon: running\\nExtension: connected\\n'
  exit 0
fi
if [ "$1 $2" = "weixin user-info" ]; then
  printf '{"ok":true,"account":"local-scenario"}\\n'
  exit 0
fi
exit 2
`);
  await chmod(bycli, 0o700);

  const outcome = await new Promise((resolve) => {
    const child = spawn(process.execPath, [
      new URL('./weixin-browser-runner.mjs', import.meta.url).pathname,
      '--state-dir', gateState,
      '--', 'bycli', 'weixin', 'user-info',
      '--site-session', 'persistent', '--keep-tab', 'true', '-f', 'json',
    ], {
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        BYCLI_CONFIG_DIR: join(root, 'config'),
        SCENARIO_LOG: log,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('close', code => resolve({ code, stdout, stderr }));
  });

  assert.equal(outcome.code, 0, outcome.stderr);
  assert.deepEqual(JSON.parse(outcome.stdout), { ok: true, account: 'local-scenario' });
  assert.deepEqual((await readFile(log, 'utf8')).trim().split('\n'), [
    'bycli list -f json',
    'bycli doctor',
    'bycli daemon status',
    'bycli weixin user-info --site-session persistent --keep-tab true -f json',
  ]);
  const stateFiles = (await readdir(gateState)).filter(name => name.endsWith('.json'));
  assert.equal(stateFiles.length, 1);
  assert.equal(JSON.parse(await readFile(join(gateState, stateFiles[0]), 'utf8')).phase, 'complete');
});
