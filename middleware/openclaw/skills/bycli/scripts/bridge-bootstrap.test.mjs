import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createRecoveryBudget,
  ensureBridge,
  parseBrowserState,
} from './bridge-bootstrap.mjs';

const ok = (stdout = '') => ({ exitCode: 0, stdout, stderr: '' });
const fail = (exitCode = 1, stderr = '') => ({ exitCode, stdout: '', stderr });
const healthyStatus = ok('Daemon: running\nExtension: connected\n');
const disconnectedStatus = ok('Daemon: running\nExtension: disconnected\n');
const stoppedDaemon = ok('Daemon: stopped\nExtension: disconnected\n');

function scriptedRunner(steps) {
  const calls = [];
  return {
    calls,
    run: async (command, args, timeoutMs) => {
      calls.push({ command, args, timeoutMs });
      const step = steps.shift();
      assert.ok(step, `unexpected command: ${command} ${args.join(' ')}`);
      assert.equal(command, step.command);
      assert.deepEqual(args, step.args);
      return step.result;
    },
    done() {
      assert.equal(steps.length, 0, `unused scripted steps: ${steps.length}`);
    },
  };
}

async function temporaryLock(t, prefix = 'bridge-bootstrap-') {
  const root = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  return join(root, 'bridge-bootstrap.lock');
}

test('healthy bridge performs only doctor followed by daemon status', async (t) => {
  const runner = scriptedRunner([
    { command: 'bycli', args: ['doctor'], result: ok() },
    { command: 'bycli', args: ['daemon', 'status'], result: healthyStatus },
  ]);

  const result = await ensureBridge({ run: runner.run, lockDir: await temporaryLock(t) });

  assert.equal(result.code, 'BRIDGE_READY');
  assert.equal(result.checks, 1);
  assert.deepEqual(result.actions, []);
  runner.done();
});

test('doctor failure is still immediately followed by daemon status', async (t) => {
  const runner = scriptedRunner([
    { command: 'bycli', args: ['doctor'], result: fail(69, 'BROWSER_CONNECT') },
    { command: 'bycli', args: ['daemon', 'status'], result: disconnectedStatus },
    { command: 'bycli', args: ['doctor'], result: fail(69, 'BROWSER_CONNECT') },
    { command: 'bycli', args: ['daemon', 'status'], result: disconnectedStatus },
    { command: 'openclaw', args: ['browser', '--browser-profile', 'openclaw', 'status'], result: ok('{"running":true}') },
    { command: 'bycli', args: ['doctor'], result: fail(69, 'BROWSER_CONNECT') },
    { command: 'bycli', args: ['daemon', 'status'], result: disconnectedStatus },
    { command: 'bycli', args: ['daemon', 'restart'], result: ok() },
    { command: 'bycli', args: ['daemon', 'status'], result: healthyStatus },
  ]);

  const result = await ensureBridge({ run: runner.run, lockDir: await temporaryLock(t) });

  assert.equal(result.ok, true);
  assert.deepEqual(runner.calls.slice(0, 2).map(({ command, args }) => [command, args]), [
    ['bycli', ['doctor']],
    ['bycli', ['daemon', 'status']],
  ]);
  runner.done();
});

test('running Chromium skips browser start and permits one daemon restart', async (t) => {
  const runner = scriptedRunner([
    { command: 'bycli', args: ['doctor'], result: ok() },
    { command: 'bycli', args: ['daemon', 'status'], result: disconnectedStatus },
    { command: 'bycli', args: ['doctor'], result: ok() },
    { command: 'bycli', args: ['daemon', 'status'], result: disconnectedStatus },
    { command: 'openclaw', args: ['browser', '--browser-profile', 'openclaw', 'status'], result: ok('{"running":true,"cdpPort":9222}') },
    { command: 'bycli', args: ['doctor'], result: ok() },
    { command: 'bycli', args: ['daemon', 'status'], result: disconnectedStatus },
    { command: 'bycli', args: ['daemon', 'restart'], result: ok() },
    { command: 'bycli', args: ['daemon', 'status'], result: healthyStatus },
  ]);

  const result = await ensureBridge({ run: runner.run, lockDir: await temporaryLock(t) });

  assert.equal(result.browserState, 'running');
  assert.deepEqual(result.actions, ['daemon_restart']);
  assert.equal(runner.calls.some(({ command }) => command === '/usr/local/bin/start-chrome.sh'), false);
  runner.done();
});

test('confirmed stopped Chromium uses executable start-chrome script', async (t) => {
  const runner = scriptedRunner([
    { command: 'bycli', args: ['doctor'], result: fail(69) },
    { command: 'bycli', args: ['daemon', 'status'], result: stoppedDaemon },
    { command: 'bycli', args: ['doctor'], result: fail(69) },
    { command: 'bycli', args: ['daemon', 'status'], result: stoppedDaemon },
    { command: 'openclaw', args: ['browser', '--browser-profile', 'openclaw', 'status'], result: ok('{"running":false}') },
    { command: '/usr/local/bin/start-chrome.sh', args: [], result: ok() },
    { command: 'bycli', args: ['doctor'], result: ok() },
    { command: 'bycli', args: ['daemon', 'status'], result: healthyStatus },
  ]);

  const result = await ensureBridge({
    run: runner.run,
    fileExists: async () => true,
    lockDir: await temporaryLock(t),
  });

  assert.equal(result.code, 'BRIDGE_READY');
  assert.deepEqual(result.actions, ['browser_start_script']);
  assert.equal(result.budget.browserStartsUsed, 1);
  runner.done();
});

test('confirmed stopped Chromium falls back to OpenClaw start when script is unavailable', async (t) => {
  const runner = scriptedRunner([
    { command: 'bycli', args: ['doctor'], result: fail(69) },
    { command: 'bycli', args: ['daemon', 'status'], result: stoppedDaemon },
    { command: 'bycli', args: ['doctor'], result: fail(69) },
    { command: 'bycli', args: ['daemon', 'status'], result: stoppedDaemon },
    { command: 'openclaw', args: ['browser', '--browser-profile', 'openclaw', 'status'], result: ok('stopped') },
    { command: 'openclaw', args: ['browser', '--browser-profile', 'openclaw', 'start'], result: ok() },
    { command: 'bycli', args: ['doctor'], result: ok() },
    { command: 'bycli', args: ['daemon', 'status'], result: healthyStatus },
  ]);

  const result = await ensureBridge({
    run: runner.run,
    fileExists: async () => false,
    lockDir: await temporaryLock(t),
  });

  assert.deepEqual(result.actions, ['browser_start_openclaw']);
  runner.done();
});

test('unknown browser status never starts Chromium', async (t) => {
  const runner = scriptedRunner([
    { command: 'bycli', args: ['doctor'], result: fail(69) },
    { command: 'bycli', args: ['daemon', 'status'], result: disconnectedStatus },
    { command: 'bycli', args: ['doctor'], result: fail(69) },
    { command: 'bycli', args: ['daemon', 'status'], result: disconnectedStatus },
    { command: 'openclaw', args: ['browser', '--browser-profile', 'openclaw', 'status'], result: fail(1, 'unrecognized output') },
    { command: 'bycli', args: ['doctor'], result: fail(69) },
    { command: 'bycli', args: ['daemon', 'status'], result: disconnectedStatus },
    { command: 'bycli', args: ['daemon', 'restart'], result: ok() },
    { command: 'bycli', args: ['daemon', 'status'], result: disconnectedStatus },
  ]);

  const result = await ensureBridge({
    run: runner.run,
    fileExists: async () => {
      assert.fail('fileExists must not be called for unknown browser state');
    },
    lockDir: await temporaryLock(t),
  });

  assert.equal(result.code, 'BRIDGE_UNAVAILABLE');
  assert.equal(result.browserState, 'unknown');
  assert.equal(result.reason, 'EXTENSION_DISCONNECTED');
  assert.deepEqual(result.actions, ['daemon_restart']);
  runner.done();
});

test('shared recovery budget prevents a second daemon restart', async (t) => {
  const budget = createRecoveryBudget();
  budget.daemonRestartsUsed = 1;
  const runner = scriptedRunner([
    { command: 'bycli', args: ['doctor'], result: fail(69) },
    { command: 'bycli', args: ['daemon', 'status'], result: disconnectedStatus },
    { command: 'bycli', args: ['doctor'], result: fail(69) },
    { command: 'bycli', args: ['daemon', 'status'], result: disconnectedStatus },
    { command: 'openclaw', args: ['browser', '--browser-profile', 'openclaw', 'status'], result: ok('running: true') },
    { command: 'bycli', args: ['doctor'], result: fail(69) },
    { command: 'bycli', args: ['daemon', 'status'], result: disconnectedStatus },
  ]);

  const result = await ensureBridge({ run: runner.run, budget, lockDir: await temporaryLock(t) });

  assert.equal(result.reason, 'EXTENSION_DISCONNECTED');
  assert.deepEqual(result.actions, []);
  assert.equal(result.diagnostics.recoveryBudgetExhausted, true);
  runner.done();
});

test('a recovery lock timeout returns BRIDGE_RECOVERY_BUSY without recovery commands', async (t) => {
  const lockDir = await temporaryLock(t);
  await mkdir(lockDir, { mode: 0o700 });
  await writeFile(join(lockDir, 'owner.json'), JSON.stringify({
    token: 'other-owner',
    pid: process.pid,
    processStart: null,
    createdAt: Date.now(),
  }), { mode: 0o600 });
  const runner = scriptedRunner([
    { command: 'bycli', args: ['doctor'], result: fail(69) },
    { command: 'bycli', args: ['daemon', 'status'], result: disconnectedStatus },
  ]);

  const result = await ensureBridge({
    run: runner.run,
    lockDir,
    lockTimeoutMs: 5,
    pollIntervalMs: 1,
  });

  assert.equal(result.code, 'BRIDGE_RECOVERY_BUSY');
  assert.equal(result.reason, 'RECOVERY_LOCK_TIMEOUT');
  runner.done();
});

test('stale lock owned by a missing process is replaced safely', async (t) => {
  const lockDir = await temporaryLock(t, 'bridge-stale-');
  await mkdir(lockDir, { mode: 0o700 });
  await writeFile(join(lockDir, 'owner.json'), JSON.stringify({
    token: 'stale-owner',
    pid: 999999,
    processStart: 'old',
    createdAt: 1,
  }), { mode: 0o600 });
  const runner = scriptedRunner([
    { command: 'bycli', args: ['doctor'], result: fail(69) },
    { command: 'bycli', args: ['daemon', 'status'], result: disconnectedStatus },
    { command: 'bycli', args: ['doctor'], result: ok() },
    { command: 'bycli', args: ['daemon', 'status'], result: healthyStatus },
  ]);

  const result = await ensureBridge({
    run: runner.run,
    lockDir,
    processAlive: async pid => pid !== 999999,
  });

  assert.equal(result.code, 'BRIDGE_READY');
  await assert.rejects(readFile(join(lockDir, 'owner.json'), 'utf8'), /ENOENT/);
  runner.done();
});

test('owner metadata failure removes the newly acquired lock directory', async (t) => {
  const lockDir = await temporaryLock(t, 'bridge-owner-failure-');
  const run = async (command, args) => {
    if (command === 'bycli' && args[0] === 'doctor') return fail(69);
    if (command === 'bycli' && args[0] === 'daemon' && args[1] === 'status') {
      return disconnectedStatus;
    }
    if (command === 'openclaw' && args.at(-1) === 'status') return ok('{"running":true}');
    return ok();
  };

  await assert.rejects(ensureBridge({
    run,
    lockDir,
    writeLockOwner: async () => {
      throw new Error('simulated owner metadata failure');
    },
  }), /simulated owner metadata failure/);
  await assert.rejects(stat(lockDir), /ENOENT/);
});

test('browser state parser distinguishes running, stopped, and unknown without profile inference', () => {
  assert.equal(parseBrowserState(ok('{"running":true,"profile":"9gvevbxy"}')), 'running');
  assert.equal(parseBrowserState(ok('{"running":false,"profile":"9gvevbxy"}')), 'stopped');
  assert.equal(parseBrowserState(ok('Chromium is stopped')), 'stopped');
  assert.equal(parseBrowserState(fail(1, 'profile 9gvevbxy')), 'unknown');
});

test('CLI cold-start scenario executes configured start-chrome process and reaches ready state', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'bridge-cli-scenario-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  const log = join(root, 'commands.log');
  const marker = join(root, 'chromium-started');
  await mkdir(bin);
  const bycli = join(bin, 'bycli');
  const openclaw = join(bin, 'openclaw');
  const startChrome = join(bin, 'start-chrome.sh');
  await writeFile(bycli, `#!/bin/sh
printf 'bycli %s\\n' "$*" >> "$SCENARIO_LOG"
if [ "$1" = doctor ]; then
  [ -f "$SCENARIO_MARKER" ] && exit 0
  exit 69
fi
if [ "$1 $2" = "daemon status" ]; then
  if [ -f "$SCENARIO_MARKER" ]; then
    printf 'Daemon: running\\nExtension: connected\\n'
  else
    printf 'Daemon: stopped\\nExtension: disconnected\\n'
  fi
  exit 0
fi
exit 0
`);
  await writeFile(openclaw, `#!/bin/sh
printf 'openclaw %s\\n' "$*" >> "$SCENARIO_LOG"
printf '{"running":false}\\n'
`);
  await writeFile(startChrome, `#!/bin/sh
printf 'start-chrome\\n' >> "$SCENARIO_LOG"
touch "$SCENARIO_MARKER"
`);
  await Promise.all([bycli, openclaw, startChrome].map(path => chmod(path, 0o700)));

  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [
      new URL('./bridge-bootstrap.mjs', import.meta.url).pathname,
      '--format', 'json',
    ], {
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        BYCLI_CONFIG_DIR: join(root, 'config'),
        BYCLI_BROWSER_RECOVERY_COMMAND: startChrome,
        SCENARIO_LOG: log,
        SCENARIO_MARKER: marker,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('close', code => resolve({ code, stdout, stderr }));
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).code, 'BRIDGE_READY');
  assert.deepEqual((await readFile(log, 'utf8')).trim().split('\n'), [
    'bycli doctor',
    'bycli daemon status',
    'bycli doctor',
    'bycli daemon status',
    'openclaw browser --browser-profile openclaw status',
    'start-chrome',
    'bycli doctor',
    'bycli daemon status',
  ]);
});
