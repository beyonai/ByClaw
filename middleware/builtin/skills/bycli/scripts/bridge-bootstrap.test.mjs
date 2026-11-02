import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRecoveryBudget, ensureBridge, runCommand } from './bridge-bootstrap.mjs';

const ok = (stdout = '') => ({ exitCode: 0, stdout, stderr: '' });
const fail = (exitCode = 1, stderr = '') => ({ exitCode, stdout: '', stderr });
const healthyStatus = ok('Daemon: running\nExtension: connected\n');
const disconnectedStatus = ok('Daemon: running\nExtension: disconnected\n');
const down = (status = disconnectedStatus) => ({ doctor: fail(69, 'BROWSER_CONNECT'), status });
const ready = () => ({ doctor: ok(), status: healthyStatus });

function bridgeRunner(healthChecks) {
  let pendingStatus;
  return {
    run: async (command, args) => {
      assert.equal(command, 'bycli', 'bootstrap must not launch another runtime');
      if (args.length === 1 && args[0] === 'doctor') {
        assert.equal(pendingStatus, undefined, 'every doctor must be followed by status');
        const step = healthChecks.shift();
        assert.ok(step, 'unexpected probe after bounded wait');
        pendingStatus = step.status;
        return step.doctor;
      }
      assert.deepEqual(args, ['daemon', 'status'], 'bootstrap must never restart the daemon');
      assert.notEqual(pendingStatus, undefined, 'status must follow doctor');
      const result = pendingStatus;
      pendingStatus = undefined;
      return result;
    },
    done() {
      assert.equal(healthChecks.length, 0, 'expected health probes were not performed');
      assert.equal(pendingStatus, undefined);
    },
  };
}

function fakeClock() {
  let elapsed = 0;
  const waits = [];
  return {
    now: () => elapsed,
    wait: async ms => { waits.push(ms); elapsed += ms; },
    advance: ms => { elapsed += ms; },
    waits,
    elapsed: () => elapsed,
  };
}

async function temporaryLock(t, prefix = 'bridge-bootstrap-') {
  const root = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  return join(root, 'bridge-bootstrap.lock');
}

test('runCommand preserves timeout diagnostics', async () => {
  const result = await runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 1_000)'], 20);
  assert.equal(result.exitCode, 1);
  assert.equal(result.timedOut, true);
  assert.equal(typeof result.durationMs, 'number');
  assert.ok(result.durationMs >= 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('runCommand forwards stderr before process exit and retains both captured streams', async () => {
  let streamed = false, completed = false;
  const result = await runCommand(process.execPath, ['-e', `
    process.stderr.write('processing\\n');
    setTimeout(() => process.stdout.write('{"ok":true}'), 150);
  `], 3000, { onStderr: chunk => {
    assert.equal(completed, false); assert.equal(String(chunk), 'processing\n'); streamed = true;
  } });
  completed = true;
  assert.equal(streamed, true); assert.equal(result.stderr, 'processing\n'); assert.equal(result.stdout, '{"ok":true}');
  assert.equal(result.exitCode, 0);
});

test('healthy bridge performs only doctor followed by status without acquiring a lock', async t => {
  const runner = bridgeRunner([ready()]);
  const lockDir = await temporaryLock(t);
  const result = await ensureBridge({ run: runner.run, lockDir });
  assert.equal(result.code, 'BRIDGE_READY');
  assert.equal(result.checks, 1);
  assert.deepEqual(result.actions, []);
  await assert.rejects(stat(lockDir), /ENOENT/);
  runner.done();
});

test('doctor failure still probes status and cannot claim ready from status alone', async t => {
  const runner = bridgeRunner([down(healthyStatus)]);
  const result = await ensureBridge({ run: runner.run, lockDir: await temporaryLock(t), healthWaitTimeoutMs: 0 });
  assert.equal(result.code, 'BRIDGE_UNAVAILABLE');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'DOCTOR_FAILED');
  assert.equal(result.checks, 1);
  runner.done();
});

test('bridge becomes ready during supervisor recovery without spending shared budgets', async t => {
  const runner = bridgeRunner([down(), down(), ready()]);
  const clock = fakeClock();
  const budget = createRecoveryBudget();
  budget.browserStartsUsed = 1;
  budget.daemonRestartsUsed = 1;
  const result = await ensureBridge({
    run: runner.run, budget, lockDir: await temporaryLock(t),
    healthWaitTimeoutMs: 1_000, healthPollIntervalMs: 100, now: clock.now, wait: clock.wait,
  });
  assert.equal(result.code, 'BRIDGE_READY');
  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.budget, { browserStartsUsed: 1, daemonRestartsUsed: 1 });
  assert.equal(result.checks, 3);
  assert.deepEqual(clock.waits, [100]);
  runner.done();
});

test('persistent disconnection ends at bounded wait and leaves recovery to supervisor', async t => {
  const runner = bridgeRunner([down(), down(), down(), down()]);
  const clock = fakeClock();
  const lockDir = await temporaryLock(t);
  const result = await ensureBridge({
    run: runner.run, lockDir, healthWaitTimeoutMs: 250,
    healthPollIntervalMs: 100, now: clock.now, wait: clock.wait,
  });
  assert.equal(result.code, 'BRIDGE_UNAVAILABLE');
  assert.equal(result.reason, 'EXTENSION_DISCONNECTED');
  assert.deepEqual(result.actions, []);
  assert.equal(result.checks, 4);
  assert.equal(clock.elapsed(), 250);
  assert.deepEqual(clock.waits, [100, 100, 50]);
  assert.deepEqual(result.budget, { browserStartsUsed: 0, daemonRestartsUsed: 0 });
  assert.equal(result.diagnostics.recoveryOwner, 'supervisor');
  assert.equal(result.diagnostics.healthWaitTimedOut, true);
  await assert.rejects(stat(lockDir), /ENOENT/);
  runner.done();
});

test('locked health commands share the remaining deadline instead of individual 30 second waits', async t => {
  const clock = fakeClock();
  const calls = [];
  const steps = [
    { args: ['doctor'], timeout: 30_000, duration: 0, result: fail(69) },
    { args: ['daemon', 'status'], timeout: 30_000, duration: 0, result: disconnectedStatus },
    { args: ['doctor'], timeout: 50, duration: 35, result: fail(69) },
    { args: ['daemon', 'status'], timeout: 15, duration: 15,
      result: { ...fail(1), timedOut: true } },
  ];
  const result = await ensureBridge({
    run: async (command, args, timeoutMs) => {
      calls.push({ command, args, timeoutMs });
      const step = steps.shift();
      assert.ok(step, 'must not launch another command after the deadline');
      assert.equal(command, 'bycli');
      assert.deepEqual(args, step.args);
      assert.equal(timeoutMs, step.timeout);
      clock.advance(step.duration);
      return step.result;
    },
    lockDir: await temporaryLock(t), healthWaitTimeoutMs: 50,
    now: clock.now, wait: clock.wait,
  });
  assert.equal(result.code, 'BRIDGE_UNAVAILABLE');
  assert.equal(result.diagnostics.healthWaitTimedOut, true);
  assert.equal(result.diagnostics.recoveryOwner, 'supervisor');
  assert.equal(result.checks, 2);
  assert.equal(clock.elapsed(), 50);
  assert.equal(calls.length, 4);
  assert.equal(steps.length, 0);
});

test('doctor consuming the locked health deadline does not launch status or another probe', async t => {
  const clock = fakeClock();
  const calls = [];
  const result = await ensureBridge({
    run: async (command, args, timeoutMs) => {
      calls.push({ command, args, timeoutMs });
      assert.equal(command, 'bycli');
      if (calls.length === 1) {
        assert.deepEqual(args, ['doctor']);
        return fail(69);
      }
      if (calls.length === 2) {
        assert.deepEqual(args, ['daemon', 'status']);
        return disconnectedStatus;
      }
      assert.equal(calls.length, 3, 'health deadline prohibits more commands');
      assert.deepEqual(args, ['doctor']);
      assert.equal(timeoutMs, 40);
      clock.advance(40);
      return { ...fail(1), timedOut: true };
    },
    lockDir: await temporaryLock(t), healthWaitTimeoutMs: 40,
    now: clock.now, wait: clock.wait,
  });
  assert.equal(result.code, 'BRIDGE_UNAVAILABLE');
  assert.equal(result.diagnostics.healthWaitTimedOut, true);
  assert.equal(result.checks, 2);
  assert.equal(calls.length, 3);
  assert.equal(clock.elapsed(), 40);
});

test('unknown daemon output never inspects profiles or starts a browser', async t => {
  const runner = bridgeRunner([down(ok('unrecognized output'))]);
  const result = await ensureBridge({
    run: runner.run, lockDir: await temporaryLock(t), healthWaitTimeoutMs: 0,
    fileExists: async () => assert.fail('must not inspect a legacy launcher'),
    detectLocalBrowserState: async () => assert.fail('must not scan browser profiles'),
    startChromeScript: '/missing/legacy-launcher.sh',
  });
  assert.equal(result.code, 'BRIDGE_UNAVAILABLE');
  assert.equal(result.browserState, 'unknown');
  assert.equal(result.reason, 'DAEMON_UNAVAILABLE');
  assert.deepEqual(result.actions, []);
  runner.done();
});

test('live recovery lock returns BUSY after bounded waiting without lifecycle commands', async t => {
  const lockDir = await temporaryLock(t);
  await mkdir(lockDir, { mode: 0o700 });
  await writeFile(join(lockDir, 'owner.json'), JSON.stringify({
    token: 'other-owner', pid: process.pid, processStart: null, createdAt: 0,
  }), { mode: 0o600 });
  const runner = bridgeRunner([down()]);
  const clock = fakeClock();
  const result = await ensureBridge({
    run: runner.run, lockDir, lockTimeoutMs: 5, pollIntervalMs: 2, now: clock.now, wait: clock.wait,
  });
  assert.equal(result.code, 'BRIDGE_RECOVERY_BUSY');
  assert.equal(result.reason, 'RECOVERY_LOCK_TIMEOUT');
  assert.deepEqual(result.actions, []);
  assert.deepEqual(clock.waits, [2, 2, 1]);
  assert.equal(JSON.parse(await readFile(join(lockDir, 'owner.json'), 'utf8')).token, 'other-owner');
  runner.done();
});

test('stale lock owned by a missing process is replaced and released safely', async t => {
  const lockDir = await temporaryLock(t, 'bridge-stale-');
  await mkdir(lockDir, { mode: 0o700 });
  await writeFile(join(lockDir, 'owner.json'), JSON.stringify({
    token: 'stale-owner', pid: 999999, processStart: 'old', createdAt: 1,
  }), { mode: 0o600 });
  const runner = bridgeRunner([down(), ready()]);
  const result = await ensureBridge({ run: runner.run, lockDir, processAlive: async pid => pid !== 999999 });
  assert.equal(result.code, 'BRIDGE_READY');
  await assert.rejects(readFile(join(lockDir, 'owner.json'), 'utf8'), /ENOENT/);
  runner.done();
});

test('owner metadata failure removes the newly acquired lock directory', async t => {
  const lockDir = await temporaryLock(t, 'bridge-owner-failure-');
  const runner = bridgeRunner([down()]);
  await assert.rejects(ensureBridge({
    run: runner.run, lockDir,
    writeLockOwner: async () => { throw new Error('simulated owner metadata failure'); },
  }), /simulated owner metadata failure/);
  await assert.rejects(stat(lockDir), /ENOENT/);
  runner.done();
});

test('CLI waits for externally recovered bridge without browser start or daemon restart', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bridge-cli-scenario-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  const log = join(root, 'commands.log');
  const count = join(root, 'status-count');
  await mkdir(bin);
  const bycli = join(bin, 'bycli');
  const launcher = join(bin, 'forbidden-launcher.sh');
  await writeFile(bycli, `#!/bin/sh
printf 'bycli %s\\n' "$*" >> "$SCENARIO_LOG"
if [ "$1" = doctor ]; then
  if [ -f "$SCENARIO_COUNT" ] && [ "$(cat "$SCENARIO_COUNT")" -ge 2 ]; then exit 0; fi
  exit 69
fi
if [ "$1 $2" = "daemon status" ]; then
  n=0
  if [ -f "$SCENARIO_COUNT" ]; then n=$(cat "$SCENARIO_COUNT"); fi
  n=$((n + 1))
  printf '%s' "$n" > "$SCENARIO_COUNT"
  if [ "$n" -ge 3 ]; then
    printf 'Daemon: running\\nExtension: connected\\n'
  else
    printf 'Daemon: running\\nExtension: disconnected\\n'
  fi
  exit 0
fi
exit 91
`);
  await writeFile(launcher, `#!/bin/sh
printf 'forbidden-lifecycle %s\\n' "$*" >> "$SCENARIO_LOG"
exit 91
`);
  await Promise.all([bycli, launcher].map(path => chmod(path, 0o700)));
  const result = await new Promise(resolve => {
    const child = spawn(process.execPath, [
      new URL('./bridge-bootstrap.mjs', import.meta.url).pathname, '--format', 'json',
    ], {
      env: {
        ...process.env, PATH: `${bin}:/usr/bin:/bin`, BYCLI_CONFIG_DIR: join(root, 'config'),
        BYCLI_BROWSER_RECOVERY_COMMAND: launcher, SCENARIO_LOG: log, SCENARIO_COUNT: count,
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
  assert.deepEqual(JSON.parse(result.stdout).actions, []);
  assert.deepEqual((await readFile(log, 'utf8')).trim().split('\n'), [
    'bycli doctor', 'bycli daemon status',
    'bycli doctor', 'bycli daemon status',
    'bycli doctor', 'bycli daemon status',
  ]);
});
