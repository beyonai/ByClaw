import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateRoute, resolveRoute, dispatchRoute } from './dispatcher.mjs';
import { loadSession, writePlan, withRouteLock } from './plan-store.mjs';
import { ensureSessionSkeleton, newSession, persistSession, sessionPaths } from '../session.mjs';
import { executeLocalCommand } from '../command-router.mjs';
import { collectionStatus } from '../collection-state.mjs';

const binding = { ref: 'work', revision: '1', kind: 'browser', providerHint: 'iwhalecloud' };
const mailRequest = { schemaVersion: 1, channel: 'mail', operation: 'discover', selector: { accountContextRef: 'work' }, criteria: { query: 'contract' } };
function sessionFor(scope) {
  return newSession({ query: 'contract', sourceScope: scope, concurrency: 2, mailBindings: [binding],
    materializationTarget: 'selected', requiredContentGranularity: 'any' });
}
function requestFor(channel) {
  return channel === 'mail' ? structuredClone(mailRequest)
    : { schemaVersion: 1, channel, operation: 'discover', ...(channel === 'public-internet' ? { workflow: 'public-discover' } : {}) };
}
async function workspace(fn, scope = ['mail']) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kc-scenario-')));
  ensureSessionSkeleton(root);
  fs.writeFileSync(path.join(root, 'session.json'), JSON.stringify(sessionFor(scope)));
  const paths = sessionPaths(root);
  try { return await fn(paths); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
const row = { emailId: 'one', subject: 'contract', date: '2026-09-11T00:00:00Z', body: 'contract body', contentGranularity: 'full-text', attachments: [] };
const mailDependencies = { runMail: async args => args.operation === 'list'
  ? { items: [row], coverage: { endObserved: true } } : { items: [row] } };

const expectedOwners = { 'public-internet': 'public-workflow', dingtalk: 'dws', feishu: 'fws',
  wecom: 'wecomcli', ima: 'ima-workflow', 'cloud-knowledge': 'project-cloud-knowledge', mail: 'mail' };
for (const channel of Object.keys(expectedOwners)) {
  test(`R01 ${channel}: explicit source selects its registered owner`, async () => {
    const result = await evaluateRoute(requestFor(channel), sessionFor([channel]));
    assert.equal(result.channel, channel);
    assert.equal(result.owner, expectedOwners[channel]);
  });
  for (const denied of Object.keys(expectedOwners).filter(other => other !== channel)) {
    test(`R02 ${channel} authorization cannot widen to ${denied}`, async () => {
      await assert.rejects(evaluateRoute(requestFor(denied), sessionFor([channel])), /SOURCE_NOT_AUTHORIZED/);
    });
  }
}

for (const field of ['criteria', 'budget', 'selector']) {
  for (const value of [null, false, 0, '', []]) {
    test(`V01 ${field} rejects ${JSON.stringify(value)} instead of applying defaults`, async () => {
      await assert.rejects(evaluateRoute({ ...mailRequest, [field]: value }, sessionFor(['mail'])), /INVALID_REQUEST/);
    });
  }
}
for (const value of [null, false, 0, '', []]) {
  test(`V02 workflow options rejects ${JSON.stringify(value)}`, async () => {
    await assert.rejects(evaluateRoute({ ...requestFor('public-internet'), options: value }, sessionFor(['public-internet'])), /INVALID_REQUEST/);
  });
}
for (const [name, patch, expected] of [
  ['unknown channel', { channel: 'unregistered' }, /UNKNOWN_CHANNEL/],
  ['unknown operation', { operation: 'send' }, /INVALID_REQUEST/],
  ['unknown version', { schemaVersion: 2 }, /INVALID_REQUEST/],
  ['arbitrary command', { command: 'unexpected' }, /INVALID_REQUEST/],
  ['credential field', { selector: { accountContextRef: 'work', authorization: 'test-only' } }, /INVALID_REQUEST/],
  ['changed query', { criteria: { query: 'different topic' } }, /QUERY_CHANGED/],
  ['missing timezone', { criteria: { query: 'contract', timeRange: { from: '2026-09-01', toExclusive: '2026-09-12' } } }, /INVALID_REQUEST/],
  ['inverted interval', { criteria: { query: 'contract', timezone: 'Asia/Shanghai', timeRange: { from: '2026-09-12', toExclusive: '2026-09-01' } } }, /INVALID_REQUEST/],
  ['unknown timezone', { criteria: { query: 'contract', timezone: 'Invalid/Zone' } }, /INVALID_REQUEST/],
  ['negative budget', { budget: { maxScannedItems: -1 } }, /INVALID_REQUEST/],
  ['fractional budget', { budget: { maxScannedItems: 1.5 } }, /INVALID_REQUEST/],
  ['unsupported resource', { operation: 'resource' }, /UNSUPPORTED_CAPABILITY/],
  ['unbound account', { selector: { accountContextRef: 'other' } }, /ACCOUNT_SELECTION_REQUIRED/],
]) {
  test(`V03 ${name}: reject before writing a plan`, () => workspace(async paths => {
    await assert.rejects(resolveRoute(paths, { ...mailRequest, ...patch }), expected);
    assert.equal(fs.existsSync(path.join(paths.root, '.routing')), false);
  }));
}

test('R03 explicit IMA quantity never selects public-collect', async () => {
  const out = await evaluateRoute({ ...requestFor('ima'), options: { limit: 5 } }, sessionFor(['ima']));
  assert.equal(out.channel, 'ima'); assert.equal(out.owner, 'ima-workflow');
});
test('R04 parent full-text requirement cannot be weakened by the request', async () => {
  const session = sessionFor(['mail']); session.task.requiredContentGranularity = 'full-text';
  assert.equal((await evaluateRoute({ ...mailRequest, contentRequirement: 'any' }, session)).request.contentRequirement, 'full-text');
});
test('R05 unified workflow requires both authorized sources', async () => {
  await assert.rejects(evaluateRoute({ ...requestFor('public-internet'), workflow: 'unified-search' }, sessionFor(['public-internet'])), /SOURCE_NOT_AUTHORIZED/);
});
test('B01 elapsed parent deadline prevents any executor call', () => workspace(async paths => {
  const session = loadSession(paths); session.task.startedAt = '2000-01-01T00:00:00Z'; session.task.deadlineMinutes = 1;
  persistSession(paths, session);
  const plan = await resolveRoute(paths, mailRequest);
  await assert.rejects(dispatchRoute(paths, plan.planId, { execute: () => assert.fail('must not execute') }), /ROUTE_DEADLINE_EXCEEDED/);
}));
test('S01 active route excludes another route and legacy writes', () => workspace(async paths => {
  const first = await resolveRoute(paths, mailRequest);
  const second = await resolveRoute(paths, { ...mailRequest, attempt: 'separate' });
  let release, started;
  const start = new Promise(resolve => { started = resolve; });
  const run = dispatchRoute(paths, first.planId, { execute: async () => {
    started(); await new Promise(resolve => { release = resolve; });
    return { status: 'complete', usage: { scannedItems: 0 } };
  } });
  await start;
  try {
    await assert.rejects(dispatchRoute(paths, second.planId, { execute: () => assert.fail() }), /SESSION_EXECUTION_ACTIVE/);
    assert.throws(() => executeLocalCommand('collect', { 'session-dir': paths.root }), /SESSION_EXECUTION_ACTIVE/);
  } finally { release(); await run; }
}));
for (const changed of ['sourceScope', 'query', 'mailBindings']) {
  test(`A01 ${changed} change invalidates a resolved plan`, () => workspace(async paths => {
    const plan = await resolveRoute(paths, mailRequest);
    const session = loadSession(paths);
    if (changed === 'sourceScope') session.task.sourceScope = ['ima'];
    if (changed === 'query') session.task.query = 'other';
    if (changed === 'mailBindings') session.task.mailBindings[0].revision = '2';
    persistSession(paths, session);
    await assert.rejects(dispatchRoute(paths, plan.planId, { execute: () => assert.fail() }), /CONTEXT_CHANGED/);
  }));
}
test('A02 tampered channel cannot replace the fixed executor', () => workspace(async paths => {
  const plan = await resolveRoute(paths, mailRequest);
  withRouteLock(paths, () => writePlan(paths, { ...plan, channel: 'ima' }));
  await assert.rejects(dispatchRoute(paths, plan.planId, { execute: () => assert.fail() }), /INVALID_PLAN/);
}));
test('A03 candidate revisions and account selection cannot cross discovery grants', () => workspace(async paths => {
  const session = loadSession(paths); session.task.mailBindings.push({ ...binding, ref: 'other' }); persistSession(paths, session);
  const plan = await resolveRoute(paths, mailRequest);
  const found = await dispatchRoute(paths, plan.planId, { mailDependencies });
  const candidate = found.candidates[0];
  for (const request of [
    { ...mailRequest, operation: 'materialize', candidateRefs: [{ skillItemId: candidate.skillItemId, revision: 'forged' }] },
    { ...mailRequest, operation: 'materialize', selector: { accountContextRef: 'other' }, candidateRefs: [{ skillItemId: candidate.skillItemId, revision: candidate.revision }] },
  ]) await assert.rejects(resolveRoute(paths, request), /CANDIDATE_NOT_AUTHORIZED/);
}));
for (const target of ['candidates', 'selected', 'all']) {
  test(`D01 successful empty mailbox with ${target} delivery target`, () => workspace(async paths => {
    const session = loadSession(paths); session.task.materializationTarget = target; persistSession(paths, session);
    const plan = await resolveRoute(paths, mailRequest);
    const result = await dispatchRoute(paths, plan.planId, { mailDependencies: { runMail: async () => ({ items: [], coverage: { endObserved: true } }) } });
    assert.equal(result.status, 'complete');
    assert.equal(collectionStatus(paths).deliveryComplete, target === 'candidates');
  }));
}
test('M01 materialization download failure preserves body but blocks delivery', () => workspace(async paths => {
  const value = { ...row, attachments: [{ attachmentId: 'a', name: 'contract.pdf', size: 10 }] };
  let downloads = 0;
  const deps = { mailDependencies: { runMail: async args => {
    if (args.operation === 'list') return { items: [value], coverage: { endObserved: true } };
    if (args.operation === 'read') return { items: [value] };
    downloads++; return { ok: false, error: { code: 'ATTACHMENT_NOT_FOUND' } };
  } } };
  const discovery = await resolveRoute(paths, mailRequest);
  const found = await dispatchRoute(paths, discovery.planId, deps);
  const plan = await resolveRoute(paths, { ...mailRequest, operation: 'materialize', includeAttachments: true,
    candidateRefs: found.candidates.map(({ skillItemId, revision }) => ({ skillItemId, revision })) });
  const result = await dispatchRoute(paths, plan.planId, deps);
  assert.equal(downloads, 1); assert.equal(result.status, 'partial');
  assert.equal(loadSession(paths).collection.collection.items[0].materialization.status, 'materialized');
  assert.equal(collectionStatus(paths).deliveryComplete, false);
}));
