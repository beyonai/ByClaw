import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import * as sessionRuntime from './session.mjs';
import { cmdInit } from './research-state.mjs';

const ENV_KEYS = ['KNOWLEDGE_COLLECTION_SESSION_ROOT', 'KNOWLEDGE_COLLECTION_SESSIONS_ROOT'];
let originalEnv;

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

function isolatedRoot(context) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-trusted-root-test-'));
  context.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const sessionsRoot = path.join(fixture, '.sessions');
  const root = path.join(sessionsRoot, 'fixture-session');
  fs.mkdirSync(root, { recursive: true });
  process.env.KNOWLEDGE_COLLECTION_SESSIONS_ROOT = sessionsRoot;
  return { fixture, sessionsRoot, root };
}

test('rejects relative paths without a trusted current root and never writes fixture directories', (context) => {
  const { root } = isolatedRoot(context);
  assert.throws(() => sessionRuntime.resolveTrustedSessionRoot(undefined, '--session-dir'), /缺少当前.*Session Root/);
  assert.throws(() => sessionRuntime.resolveSandboxPath('collections/task', '--session-dir'), /缺少当前.*Session Root/);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('resolves paths from an explicit trusted DSH child without creating target directories', (context) => {
  const { root } = isolatedRoot(context);
  assert.equal(sessionRuntime.resolveTrustedSessionRoot(root, '--session-dir'), root);
  assert.equal(sessionRuntime.resolveSandboxPath('collections/task', '--session-dir', { currentSessionRoot: root }), path.join(root, 'collections/task'));
  assert.equal(fs.existsSync(path.join(root, 'collections/task')), false);
});

test('prefers the configured root over the explicit root while validating the selected DSH child', (context) => {
  const { fixture, sessionsRoot, root } = isolatedRoot(context);
  const argumentRoot = path.join(sessionsRoot, 'argument-session');
  process.env.KNOWLEDGE_COLLECTION_SESSION_ROOT = root;
  assert.equal(sessionRuntime.resolveTrustedSessionRoot(argumentRoot, '--session-dir'), root);
  assert.equal(sessionRuntime.resolveTrustedSessionRoot(path.join(fixture, 'untrusted-ignored'), '--session-dir'), root);
  assert.equal(sessionRuntime.resolveSandboxPath('collections/task', '--session-dir', { currentSessionRoot: argumentRoot }), path.join(root, 'collections/task'));
  process.env.KNOWLEDGE_COLLECTION_SESSION_ROOT = path.join(sessionsRoot, 'nested', 'session');
  assert.throws(() => sessionRuntime.resolveTrustedSessionRoot(argumentRoot, '--session-dir'), /Session Root 必须是/);
});

test('rejects invalid roots, the sessions parent itself, and nested or unrelated roots', (context) => {
  const { fixture, sessionsRoot } = isolatedRoot(context);
  for (const root of [0, false, '', '   ', sessionsRoot, path.join(fixture, 'untrusted'), path.join(sessionsRoot, 'nested', 'session')]) {
    assert.throws(() => sessionRuntime.resolveTrustedSessionRoot(root, '--session-dir'), /Session Root|字符串/);
  }
});

test('keeps relative traversal and symlink escape guards for explicit fixture roots', (context) => {
  const { fixture, sessionsRoot, root } = isolatedRoot(context);
  const outside = path.join(fixture, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(root, 'linked'));
  fs.symlinkSync(outside, path.join(sessionsRoot, 'linked-root'));
  assert.throws(() => sessionRuntime.resolveSandboxPath('../escaped', '--session-dir', { currentSessionRoot: root }), /越出当前 Session Root/);
  assert.throws(() => sessionRuntime.resolveSandboxPath('linked/escaped', '--session-dir', { currentSessionRoot: root }), /符号链接越出/);
  assert.throws(() => sessionRuntime.resolveTrustedSessionRoot(path.join(sessionsRoot, 'linked-root'), '--session-dir'), /不能是符号链接/);
  assert.equal(fs.existsSync(path.join(outside, 'escaped')), false);
});

test('requires a current root argument for delivery initialization even when an environment root is configured', (context) => {
  const { root } = isolatedRoot(context);
  process.env.KNOWLEDGE_COLLECTION_SESSION_ROOT = root;
  assert.throws(() => cmdInit({
    'session-dir': '.collection-runs/missing-current-root', query: 'fixture', 'delivery-requested': true,
  }), /必须传入当前 Session Root/);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('initializes authorized delivery staging with explicit root and environment precedence', (context) => {
  const { root, sessionsRoot } = isolatedRoot(context);
  process.env.KNOWLEDGE_COLLECTION_SESSION_ROOT = root;
  const result = cmdInit({
    'session-dir': '.collection-runs/fixture-run', query: 'fixture', 'delivery-requested': true,
    'session-root': path.join(sessionsRoot, 'argument-session'),
    'delivery-dir': 'deliveries/local-task',
  });
  assert.equal(result.ok, true);
  assert.equal(result.sessionDir, path.join(root, '.collection-runs/fixture-run'));
  const stored = JSON.parse(fs.readFileSync(path.join(result.sessionDir, 'session.json'), 'utf8'));
  assert.equal(stored.task.deliveryRequested, true);
  assert.equal(stored.task.deliveryTarget.requestedDirectory, path.join(root, 'deliveries/local-task'));
  assert.equal(fs.existsSync(path.join(root, 'deliveries/local-task')), false);
});

test('keeps session-dir required regardless of the root context', () => {
  assert.throws(() => cmdInit({ query: 'missing directory' }), /--session-dir 必须是非空字符串/);
});

test('keeps delivery intent and strict staging layout interlocks for an explicit trusted root', (context) => {
  const { root } = isolatedRoot(context);
  process.env.KNOWLEDGE_COLLECTION_SESSION_ROOT = root;
  for (const directory of ['collections/task', '.collection-runs', '.collection-runs/task/nested']) {
    assert.throws(() => cmdInit({ 'session-dir': directory, 'session-root': root, query: 'fixture', 'delivery-requested': true }), /必须严格匹配/);
    assert.equal(fs.existsSync(path.join(root, directory)), false);
  }
  assert.throws(() => cmdInit({ 'session-dir': '.collection-runs/no-intent', 'session-root': root, query: 'fixture' }), /只有用户明确提供保存路径/);
  assert.throws(() => cmdInit({ 'session-dir': 'collections/no-intent', 'session-root': root, query: 'fixture', 'delivery-dir': 'deliveries/task' }), /--delivery-requested true/);
  assert.equal(fs.existsSync(path.join(root, 'collections/no-intent')), false);
});
