import assert from 'node:assert/strict';
import {
  chmod, mkdtemp, readFile, readdir, rm, stat, writeFile,
} from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  operationFingerprint,
  runGate,
} from './weixin-login-gate.mjs';

const gateScript = join(dirname(new URL(import.meta.url).pathname), 'weixin-login-gate.mjs');

const ARTICLE_URL = [
  'https://mp.weixin.qq.com/s?__biz=stable-biz',
  'mid=123',
  'idx=1',
  'sn=stable-sn',
  'pass_ticket=secret-ticket',
  'exportkey=secret-export',
].join('&');

function command({
  url = ARTICLE_URL,
  output = '/tmp/weixin-output-a',
  adapterSession = 'batch-safe-worker-1',
} = {}) {
  return [
    'bycli', 'weixin', 'download',
    '--url', url,
    '--output', output,
    '--adapter-session', adapterSession,
    '--adapter-queue-timeout', '300',
    '--site-session', 'persistent',
    '--keep-tab', 'true',
    '-f', 'json',
  ];
}

function result(exitCode, code = null) {
  return {
    exitCode,
    stdout: '',
    stderr: code ? JSON.stringify({ ok: false, error: { code } }) : '',
  };
}

test('a retry-shaped message cannot reset the single confirmed rerun', async (t) => {
  const stateDir = await mkdtemp(join(tmpdir(), 'weixin-login-gate-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(stateDir, { recursive: true, force: true });
  });
  const executions = [];
  const outcomes = [
    result(77, 'AUTH_REQUIRED'),
    result(77, 'AUTH_REQUIRED'),
  ];
  const execute = async argv => {
    executions.push(argv);
    return outcomes.shift();
  };

  const initial = await runGate({ stateDir, argv: command(), execute });
  assert.equal(initial.executed, true);
  assert.equal(initial.phase, 'waiting-confirmation');
  assert.equal(executions.length, 1);

  const plainRetry = await runGate({ stateDir, argv: command(), execute });
  assert.equal(plainRetry.executed, false);
  assert.equal(plainRetry.phase, 'waiting-confirmation');
  assert.equal(plainRetry.reason, 'explicit-verification-confirmation-required');
  assert.equal(executions.length, 1);

  const confirmedRerun = await runGate({
    stateDir,
    argv: command(),
    verificationConfirmed: true,
    execute,
  });
  assert.equal(confirmedRerun.executed, true);
  assert.equal(confirmedRerun.phase, 'terminal');
  assert.equal(executions.length, 2);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const denied = await runGate({ stateDir, argv: command(), execute });
    assert.equal(denied.executed, false);
    assert.equal(denied.phase, 'terminal');
    assert.equal(denied.reason, 'login-gate-rerun-exhausted');
  }
  assert.equal(executions.length, 2);
});

test('lifecycle, output, and transient URL options do not create a new operation', () => {
  const first = operationFingerprint(command());
  const second = operationFingerprint(command({
    url: 'https://mp.weixin.qq.com/s?sn=stable-sn&idx=1&mid=123&__biz=stable-biz&pass_ticket=other',
    output: '/tmp/weixin-output-b',
    adapterSession: 'batch-safe-worker-3',
  }));
  assert.equal(first, second);
});

test('a different article remains independent after another article is terminal', async (t) => {
  const stateDir = await mkdtemp(join(tmpdir(), 'weixin-login-gate-independent-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(stateDir, { recursive: true, force: true });
  });
  let executions = 0;
  const execute = async () => {
    executions += 1;
    return result(77, 'AUTH_REQUIRED');
  };

  await runGate({ stateDir, argv: command(), execute });
  await runGate({
    stateDir,
    argv: command(),
    verificationConfirmed: true,
    execute,
  });
  const other = await runGate({
    stateDir,
    argv: command({ url: 'https://mp.weixin.qq.com/s/another-article' }),
    execute,
  });

  assert.equal(other.executed, true);
  assert.equal(other.phase, 'waiting-confirmation');
  assert.equal(executions, 3);
});

test('state files are private and contain no command, URL, or session secrets', async (t) => {
  const stateDir = await mkdtemp(join(tmpdir(), 'weixin-login-gate-redaction-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(stateDir, { recursive: true, force: true });
  });
  const outcome = await runGate({
    stateDir,
    argv: command(),
    execute: async () => result(77, 'AUTH_REQUIRED'),
  });
  const statePath = join(stateDir, `${outcome.operationFingerprint}.json`);
  const persisted = await readFile(statePath, 'utf8');
  const metadata = await stat(statePath);

  assert.equal(metadata.mode & 0o777, 0o600);
  assert.doesNotMatch(persisted, /secret-ticket|secret-export|stable-biz|stable-sn/);
  assert.doesNotMatch(persisted, /batch-safe-worker|weixin-output|mp\.weixin\.qq\.com/);
  assert.equal(JSON.parse(persisted).phase, 'waiting-confirmation');
});

test('a successful confirmed rerun completes the operation', async (t) => {
  const stateDir = await mkdtemp(join(tmpdir(), 'weixin-login-gate-success-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(stateDir, { recursive: true, force: true });
  });
  const outcomes = [result(77, 'AUTH_REQUIRED'), result(0)];
  const execute = async () => outcomes.shift();

  await runGate({ stateDir, argv: command(), execute });
  const completed = await runGate({
    stateDir,
    argv: command(),
    verificationConfirmed: true,
    execute,
  });

  assert.equal(completed.executed, true);
  assert.equal(completed.phase, 'complete');
});

test('initial no-auth-state result receives initial context and creates no gate state', async (t) => {
  const stateDir = await mkdtemp(join(tmpdir(), 'weixin-login-gate-no-auth-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const contexts = [];

  const outcome = await runGate({
    stateDir,
    argv: command(),
    execute: async (_argv, context) => {
      contexts.push(context);
      return {
        ...result(69, 'BROWSER_CONNECT'),
        commandExecuted: false,
        stateDisposition: 'no-auth-state',
      };
    },
  });

  assert.deepEqual(contexts, [{ attemptKind: 'initial' }]);
  assert.equal(outcome.exitCode, 69);
  assert.equal('commandExecuted' in outcome, false);
  assert.equal('stateDisposition' in outcome, false);
  assert.deepEqual(await readdir(stateDir), []);
});

test('typed initial BROWSER_CONNECT does not consume authentication state', async (t) => {
  const stateDir = await mkdtemp(join(tmpdir(), 'weixin-login-gate-bridge-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));

  const outcome = await runGate({
    stateDir,
    argv: command(),
    execute: async () => result(69, 'BROWSER_CONNECT'),
  });

  assert.equal(outcome.phase, 'initial');
  assert.deepEqual(await readdir(stateDir), []);
});

test('confirmed rerun is consumed before callback and remains terminal for no-auth-state result', async (t) => {
  const stateDir = await mkdtemp(join(tmpdir(), 'weixin-login-gate-confirmed-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const contexts = [];
  const execute = async (_argv, context) => {
    contexts.push(context);
    if (context.attemptKind === 'initial') return result(77, 'AUTH_REQUIRED');
    return {
      ...result(69, 'BROWSER_CONNECT'),
      commandExecuted: true,
      stateDisposition: 'no-auth-state',
    };
  };

  await runGate({ stateDir, argv: command(), execute });
  const rerun = await runGate({
    stateDir,
    argv: command(),
    verificationConfirmed: true,
    execute,
  });
  const denied = await runGate({ stateDir, argv: command(), execute });

  assert.deepEqual(contexts, [
    { attemptKind: 'initial' },
    { attemptKind: 'confirmed-rerun' },
  ]);
  assert.equal(rerun.phase, 'terminal');
  assert.equal('stateDisposition' in rerun, false);
  assert.equal(denied.reason, 'login-gate-rerun-exhausted');
});

function runGateCli(args, env) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [gateScript, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('close', code => resolveRun({ code, stdout, stderr }));
  });
}

test('CLI replay executes only the initial attempt and one explicitly confirmed rerun', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'weixin-login-gate-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateDir = join(root, 'state');
  const fakeBycli = join(root, 'bycli');
  const counter = join(root, 'executions.log');
  await writeFile(fakeBycli, `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
appendFileSync(process.env.WEIXIN_GATE_TEST_COUNTER, 'executed\\n');
process.stderr.write(JSON.stringify({ ok: false, error: { code: 'AUTH_REQUIRED', exitCode: 77 } }) + '\\n');
process.exit(77);
`);
  await chmod(fakeBycli, 0o700);
  const commandArgs = [
    '--state-dir', stateDir, '--', fakeBycli, 'weixin', 'download',
    '--url', ARTICLE_URL, '--output', join(root, 'output'),
    '--site-session', 'persistent', '--keep-tab', 'true', '-f', 'json',
  ];
  const env = { WEIXIN_GATE_TEST_COUNTER: counter };

  const initial = await runGateCli(commandArgs, env);
  assert.equal(initial.code, 77);
  assert.match(initial.stderr, /AUTH_REQUIRED/);

  const plainRetry = await runGateCli(commandArgs, env);
  assert.equal(plainRetry.code, 77);
  assert.match(plainRetry.stderr, /explicit-verification-confirmation-required/);

  const confirmed = await runGateCli([
    '--state-dir', stateDir, '--verification-confirmed', 'true',
    ...commandArgs.slice(2),
  ], env);
  assert.equal(confirmed.code, 77);
  assert.match(confirmed.stderr, /AUTH_REQUIRED/);

  for (let retry = 0; retry < 4; retry += 1) {
    const terminal = await runGateCli(commandArgs, env);
    assert.equal(terminal.code, 77);
    assert.match(terminal.stderr, /login-gate-rerun-exhausted/);
  }
  assert.equal((await readFile(counter, 'utf8')).trim().split('\n').length, 2);
});
