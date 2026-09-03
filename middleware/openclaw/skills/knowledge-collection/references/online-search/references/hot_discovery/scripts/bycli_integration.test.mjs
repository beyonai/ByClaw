import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBycliIntegration,
  deriveExecutionProfile,
} from './bycli_integration.mjs';

const ok = (stdout = '') => ({ code: 0, stdout, stderr: '', timedOut: false, killed: false, rawErrorCode: null });
const failed = (code, stderr = '', stdout = '') => ({ code, stdout, stderr, timedOut: false, killed: false, rawErrorCode: null });
const bridgeScript = '/test/bridge-bootstrap.mjs';

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

test('bridge readiness delegates to the shared bridge CLI exactly once', async () => {
  const runner = scriptedRunner([
    {
      cmd: process.execPath,
      args: [bridgeScript, '--format', 'json'],
      result: ok(JSON.stringify({ ok: true, code: 'BRIDGE_READY', checks: 1 })),
    },
  ]);
  const bycli = createBycliIntegration({ run: runner.run, bridgeScript });

  const outcome = await bycli.ensureBridge();

  assert.equal(outcome.ok, true);
  assert.equal(outcome.bridge.code, 'BRIDGE_READY');
  assert.deepEqual(runner.calls, [[process.execPath, [bridgeScript, '--format', 'json']]]);
  assert.deepEqual(runner.timeouts, [60_000]);
});

test('bridge readiness keeps the container script when it exists', async () => {
  const containerBridgeScript = '/app/skills/bycli/scripts/bridge-bootstrap.mjs';
  const runner = scriptedRunner([{
    cmd: process.execPath,
    args: [containerBridgeScript, '--format', 'json'],
    result: ok(JSON.stringify({ ok: true, code: 'BRIDGE_READY', checks: 1 })),
  }]);
  const bycli = createBycliIntegration({
    run: runner.run,
    environment: {},
    fileExists: (candidate) => candidate === containerBridgeScript,
    containerBridgeScript,
    localBridgeScript: '/repo/skills/bycli/scripts/bridge-bootstrap.mjs',
  });

  const outcome = await bycli.ensureBridge();

  assert.equal(outcome.ok, true);
  assert.deepEqual(runner.calls, [[process.execPath, [containerBridgeScript, '--format', 'json']]]);
});

test('bridge readiness falls back to the repository script when the container script is absent', async () => {
  const localBridgeScript = '/repo/skills/bycli/scripts/bridge-bootstrap.mjs';
  const runner = scriptedRunner([{
    cmd: process.execPath,
    args: [localBridgeScript, '--format', 'json'],
    result: ok(JSON.stringify({ ok: true, code: 'BRIDGE_READY', checks: 1 })),
  }]);
  const bycli = createBycliIntegration({
    run: runner.run,
    environment: {},
    fileExists: () => false,
    containerBridgeScript: '/app/skills/bycli/scripts/bridge-bootstrap.mjs',
    localBridgeScript,
  });

  const outcome = await bycli.ensureBridge();

  assert.equal(outcome.ok, true);
  assert.deepEqual(runner.calls, [[process.execPath, [localBridgeScript, '--format', 'json']]]);
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

test('bridge unavailable maps the shared result to the existing user-action contract', async () => {
  const runner = scriptedRunner([
    {
      cmd: process.execPath,
      args: [bridgeScript, '--format', 'json'],
      result: failed(69, '', JSON.stringify({
        ok: false,
        code: 'BRIDGE_UNAVAILABLE',
        reason: 'EXTENSION_DISCONNECTED',
      })),
    },
  ]);
  const bycli = createBycliIntegration({ run: runner.run, bridgeScript });

  const outcome = await bycli.ensureBridge();

  assert.equal(outcome.ok, false);
  assert.equal(outcome.requiresUserAction.kind, 'bridge_unavailable');
  assert.equal(outcome.bridge.reason, 'EXTENSION_DISCONNECTED');
});

test('bridge recovery busy remains distinct from final bridge unavailability', async () => {
  const runner = scriptedRunner([
    {
      cmd: process.execPath,
      args: [bridgeScript, '--format', 'json'],
      result: failed(69, '', JSON.stringify({
        ok: false,
        code: 'BRIDGE_RECOVERY_BUSY',
        reason: 'RECOVERY_LOCK_TIMEOUT',
      })),
    },
  ]);
  const bycli = createBycliIntegration({ run: runner.run, bridgeScript });

  const outcome = await bycli.ensureBridge();

  assert.equal(outcome.ok, false);
  assert.equal(outcome.requiresUserAction.kind, 'bridge_recovery_busy');
  assert.equal(outcome.bridge.code, 'BRIDGE_RECOVERY_BUSY');
});
