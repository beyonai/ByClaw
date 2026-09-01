import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runWeixinBrowser } from './weixin-browser-runner.mjs';

const command = (name = 'user-info') => [
  'bycli', 'weixin', name,
  '--site-session', 'persistent',
  '--keep-tab', 'true',
  '-f', 'json',
];
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
  budget: { browserStartsUsed: 0, daemonRestartsUsed: 1 },
};

async function stateDir(t, prefix = 'weixin-runner-') {
  const path = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

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
  assert.match(outcome.stderr, /BRIDGE_UNAVAILABLE/);
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

test('confirmed rerun skips capability and bridge and executes command once', async (t) => {
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
  assert.match(outcome.stderr, /RETRY_APPROVAL_REQUIRED/);
  assert.match(outcome.stderr, /BRIDGE_RECOVERED_RETRY_REQUIRES_APPROVAL/);
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
