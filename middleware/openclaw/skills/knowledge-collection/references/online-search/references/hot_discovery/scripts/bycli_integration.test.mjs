import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBycliIntegration,
  deriveExecutionProfile,
} from './bycli_integration.mjs';

const ok = (stdout = '') => ({ code: 0, stdout, stderr: '', timedOut: false, killed: false, rawErrorCode: null });
const failed = (code, stderr = '') => ({ code, stdout: '', stderr, timedOut: false, killed: false, rawErrorCode: null });
const healthyDaemon = 'Daemon: running\nExtension: connected\n';

function scriptedRunner(steps) {
  const calls = [];
  const timeouts = [];
  return {
    calls,
    timeouts,
    run: async (cmd, args, timeoutMs) => {
      calls.push([cmd, args]);
      timeouts.push(timeoutMs);
      const step = steps.shift();
      assert.ok(step, `unexpected command: ${cmd} ${args.join(' ')}`);
      assert.equal(cmd, step.cmd);
      assert.deepEqual(args, step.args);
      return step.result;
    },
  };
}

test('doctor is immediately followed by daemon status even when doctor fails', async () => {
  const runner = scriptedRunner([
    { cmd: 'bycli', args: ['doctor'], result: failed(69) },
    { cmd: 'bycli', args: ['daemon', 'status'], result: failed(1) },
    { cmd: 'openclaw', args: ['browser', '--browser-profile', 'openclaw', 'status'], result: ok('running') },
    { cmd: 'bycli', args: ['doctor'], result: failed(69) },
    { cmd: 'bycli', args: ['daemon', 'status'], result: failed(1) },
    { cmd: 'bycli', args: ['daemon', 'restart'], result: ok() },
    { cmd: 'bycli', args: ['daemon', 'status'], result: failed(1) },
  ]);
  const bycli = createBycliIntegration({ run: runner.run, fileExists: async () => false });

  const outcome = await bycli.ensureBridge();

  assert.equal(outcome.ok, false);
  assert.equal(outcome.requiresUserAction.kind, 'bridge_unavailable');
  assert.deepEqual(runner.calls.slice(0, 2), [
    ['bycli', ['doctor']],
    ['bycli', ['daemon', 'status']],
  ]);
  assert.deepEqual(runner.timeouts.slice(0, 2), [30_000, 30_000]);
});

test('runtime transport is independent from declared access tier', () => {
  assert.deepEqual(deriveExecutionProfile({ strategy: 'public', browser: false }), {
    needsBrowser: false,
    transport: 'direct',
  });
  assert.deepEqual(deriveExecutionProfile({ strategy: 'public', browser: true }), {
    needsBrowser: true,
    transport: 'browser',
  });
  assert.deepEqual(deriveExecutionProfile({ strategy: 'public', browser: 'conditional' }), {
    needsBrowser: true,
    transport: 'browser',
  });
});

test('runtime catalog validation does not depend on a declared version baseline', async () => {
  const runner = scriptedRunner([
    { cmd: 'bycli', args: ['--version'], result: ok('2.1.38\n') },
    { cmd: 'bycli', args: ['list', '-f', 'json'], result: ok('[{"site":"weread-official","name":"search"}]') },
  ]);
  const bycli = createBycliIntegration({ run: runner.run });

  const runtime = await bycli.loadRuntime();

  assert.equal(runtime.version, '2.1.38');
  assert.equal('compatibility' in runtime, false);
  assert.ok(runtime.catalog.has('weread-official/search'));
  assert.deepEqual(runner.timeouts, [30_000, 60_000]);
});

test('healthy bridge passes without recovery commands', async () => {
  const runner = scriptedRunner([
    { cmd: 'bycli', args: ['doctor'], result: ok('Everything looks good') },
    { cmd: 'bycli', args: ['daemon', 'status'], result: ok(healthyDaemon) },
  ]);
  const bycli = createBycliIntegration({ run: runner.run });

  const outcome = await bycli.ensureBridge();

  assert.deepEqual(outcome, { ok: true, attempts: 1 });
  assert.equal(runner.calls.length, 2);
});

test('cold starts managed Chrome with the recovery script before daemon restart', async () => {
  const runner = scriptedRunner([
    { cmd: 'bycli', args: ['doctor'], result: failed(69, 'BROWSER_CONNECT') },
    { cmd: 'bycli', args: ['daemon', 'status'], result: failed(1) },
    {
      cmd: 'openclaw',
      args: ['browser', '--browser-profile', 'openclaw', 'status'],
      result: ok('stopped'),
    },
    { cmd: '/usr/local/bin/start-chrome.sh', args: [], result: ok() },
    { cmd: 'bycli', args: ['doctor'], result: ok('Everything looks good') },
    { cmd: 'bycli', args: ['daemon', 'status'], result: ok(healthyDaemon) },
  ]);
  const bycli = createBycliIntegration({ run: runner.run, fileExists: async () => true });

  const outcome = await bycli.ensureBridge();

  assert.deepEqual(outcome, { ok: true, attempts: 2 });
  assert.deepEqual(runner.calls[3], ['/usr/local/bin/start-chrome.sh', []]);
  assert.equal(runner.calls.some(([cmd, args]) => cmd === 'bycli' && args[1] === 'restart'), false);
});
