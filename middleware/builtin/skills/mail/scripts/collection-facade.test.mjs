import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as facade from './collection-facade.mjs';
const binding = { ref: 'mail-1', revision: 'r1', kind: 'browser', providerHint: 'iwhalecloud' };
const context = { mailBindings: [binding] };
const request = { operation: 'discover', selector: { accountContextRef: 'mail-1' }, criteria: { query: 'contract' }, budget: {}, contentRequirement: 'full-text', includeAttachments: false };
const row = (id, body = 'contract body') => ({ emailId: id, subject: 'Title', fromEmail: 'a@example.test', date: '2026-09-10T12:00:00Z', body, contentGranularity: 'full-text', attachments: [] });
const provider = (rows, endObserved = true) => async (r) => r.operation === 'list' ? { items: rows, coverage: { endObserved } } : { items: [rows.find(x => x.emailId === r.message)] };
test('missing or ambiguous binding cannot execute', async () => {
  assert.equal(typeof facade.execute, 'function');
  for (const mailBindings of [[], [binding, binding]]) assert.equal((await facade.execute(request, { mailBindings }, { runMail: () => assert.fail('remote') })).status, 'needs-user-action');
});
test('local capabilities expose browser identity limitation', async () => {
  const out = await facade.describeCapabilities(context, request.selector);
  assert.equal(out.status, 'complete');
  assert.equal(out.identityBinding, 'context-only');
  assert.equal(out.capabilities.transparentResume, 'unsupported');
});
test('body scan matches case insensitively and respects scan budget', async () => {
  const out = await facade.execute({ ...request, budget: { maxScannedItems: 2 } }, context, { runMail: provider([row('1', 'nothing'), row('2', 'CONTRACT body')], false) });
  assert.equal(out.status, 'partial');
  assert.deepEqual(out.items.map(x => x.messageId), ['2']);
  assert.equal(out.items[0].contentGranularity, 'full-text');
  assert.equal(out.usage.scannedItems, 2);
  assert.equal(out.coverage.stopReason, 'SCAN_BUDGET_EXHAUSTED');
});
test('empty and auth have distinct states without error leakage', async () => {
  assert.equal((await facade.execute(request, context, { runMail: provider([]) })).status, 'complete');
  const out = await facade.execute(request, context, { runMail: async () => ({ ok: false, error: { code: 'AUTH_REQUIRED', message: 'secret token' } }) });
  assert.equal(out.status, 'needs-user-action');
  assert.equal(JSON.stringify(out).includes('secret token'), false);
});
test('successful matches survive subsequent read failure', async () => {
  const out = await facade.execute(request, context, { runMail: async r => r.operation === 'list' ? { items: [row('1'), row('2')], coverage: { endObserved: true } } : r.message === '1' ? { items: [row('1')] } : { ok: false, error: { code: 'UPSTREAM_UNAVAILABLE' } } });
  assert.equal(out.status, 'partial');
  assert.equal(out.items.length, 1);
  assert.equal(out.errors.length, 1);
});
test('materialize requires registered candidate, original criteria and binding', async () => {
  const deps = { runMail: provider([row('1')]) };
  const found = await facade.execute(request, context, deps);
  const item = found.items[0];
  const mat = { ...request, operation: 'materialize', candidateRefs: [{ skillItemId: item.skillItemId, revision: item.revision }] };
  const ctx = { ...context, candidates: [item] };
  assert.equal((await facade.execute(mat, ctx, deps)).status, 'complete');
  for (const changed of [{ ...mat, criteria: { query: 'other' } }, { ...mat, candidateRefs: [{ skillItemId: 'arbitrary', revision: item.revision }] }]) assert.equal((await facade.execute(changed, ctx, { runMail: () => assert.fail('remote') })).status, 'failed');
  assert.equal((await facade.execute(mat, { ...ctx, mailBindings: [{ ...binding, revision: 'r2' }] }, deps)).status, 'failed');
});
test('expired deadlines and unknown fields reject without remote access', async () => {
  const deps = { runMail: () => assert.fail('remote') };
  assert.equal((await facade.execute(request, { ...context, deadlineAt: '2000-01-01T00:00:00Z' }, deps)).status, 'failed');
  assert.equal((await facade.execute({ ...request, selector: { ...request.selector, command: 'secret' } }, context, deps)).status, 'failed');
});
test('date-only filters honor timezone and exclusive end', async () => {
  const rows = [{ ...row('1'), date: '2026-09-09T16:00:00Z' }, { ...row('2'), date: '2026-09-10T16:00:00Z' }];
  const out = await facade.execute({ ...request, criteria: { query: 'contract', timeRange: { from: '2026-09-10', toExclusive: '2026-09-11' }, timezone: 'Asia/Shanghai' } }, context, { runMail: provider(rows) });
  assert.deepEqual(out.items.map(x => x.messageId), ['1']);
});
test('metadata match is preserved when full body cannot be read', async () => {
  const out = await facade.execute(request, context, { runMail: async r => r.operation === 'list'
    ? { items: [{ ...row('1'), subject: 'Contract summary' }], coverage: { endObserved: true } }
    : { items: [{ ...row('1'), bodyTruncated: true }] } });
  assert.equal(out.status, 'partial');
  assert.equal(out.items[0].contentGranularity, 'metadata');
  assert.equal(out.items[0].bodyStatus, 'failed');
  assert.equal(out.items[0].body, undefined);
});
test('projected capabilities stay unknown absent local capability metadata', async () => {
  const out = await facade.describeCapabilities({ mailBindings: [{ ref: 'p', revision: '1', kind: 'projected', accountId: 'account' }] }, { accountContextRef: 'p' });
  assert.equal(out.capabilities.list, 'unknown');
  assert.equal(out.capabilities.readFullText, 'unknown');
});
test('offsets page under one scan budget and return cap remains partial', async () => {
  const seen = [];
  const out = await facade.execute({ ...request, budget: { maxScannedItems: 101, maxReturnedItems: 1 } }, context, { runMail: async r => {
    if (r.operation === 'read') return { items: [row(r.message, r.message === '100' ? 'contract' : 'none')] };
    seen.push([r.offset, r.limit]);
    return { items: Array.from({ length: r.limit }, (_, i) => row(String(r.offset + i))), coverage: { endObserved: false } };
  } });
  assert.deepEqual(seen, [[0, 100], [100, 1]]);
  assert.equal(out.usage.scannedItems, 101);
  assert.equal(out.status, 'partial');
  assert.equal(out.items.length, 1);
});
test('date times without UTC offset cannot silently use host timezone', async () => {
  const out = await facade.execute({ ...request, criteria: { query: 'contract', timezone: 'Asia/Shanghai', timeRange: { from: '2026-09-10T12:00:00', toExclusive: '2026-09-11T12:00:00' } } }, context, { runMail: () => assert.fail('remote') });
  assert.equal(out.errors[0].code, 'INVALID_REQUEST');
});
test('downloads are confined, reused and cumulatively budgeted', async () => {
  const sessionDir = await realpath(await mkdtemp(join(tmpdir(), 'mail-facade-')));
  const downloadRoot = join(sessionDir, 'downloads');
  const rows = [{ ...row('1'), attachments: [{ attachmentId: 'a', name: 'contract.pdf', size: 4, kind: 'FileAttachment' }] }];
  let downloads = 0;
  const runMail = async r => {
    if (r.operation !== 'download') return provider(rows)(r);
    downloads++;
    const path = join(r.sessionDir, 'contract.pdf');
    await writeFile(path, 'test', { mode: 0o600 });
    return { items: [{ path, size: 4 }] };
  };
  try {
    const ctx = { ...context, sessionDir, downloadRoot };
    const found = await facade.execute(request, ctx, { runMail });
    const mat = { ...request, operation: 'materialize', includeAttachments: true, budget: { maxDownloadedBytes: 4 }, candidateRefs: found.items.map(({ skillItemId, revision }) => ({ skillItemId, revision })) };
    const first = await facade.execute(mat, { ...ctx, candidates: found.items }, { runMail });
    assert.equal(first.status, 'complete');
    assert.equal(first.items[0].attachments[0].status, 'complete');
    assert.equal(first.usage.downloadedBytes, 4);
    const second = await facade.execute(mat, { ...ctx, candidates: found.items }, { runMail });
    assert.equal(second.status, 'complete');
    assert.equal(downloads, 1);
    assert.equal(second.usage.totalDownloadedBytes, 4);
    await symlink(tmpdir(), join(sessionDir, 'link'));
    assert.equal((await facade.execute(mat, { ...ctx, downloadRoot: join(sessionDir, 'link'), candidates: found.items }, { runMail })).status, 'failed');
  } finally { await rm(sessionDir, { recursive: true, force: true }); }
});
test('attachment errors preserve body and do not download unsupported or over-budget files', async () => {
  const sessionDir = await realpath(await mkdtemp(join(tmpdir(), 'mail-facade-')));
  const rows = [{ ...row('1'), attachments: [
    { attachmentId: 'a', name: 'script.exe', size: 1, kind: 'FileAttachment' },
    { attachmentId: 'b', name: 'large.pdf', size: 5, kind: 'FileAttachment' },
  ] }];
  try {
    const ctx = { ...context, sessionDir, downloadRoot: join(sessionDir, 'downloads') };
    const deps = { runMail: async r => { assert.notEqual(r.operation, 'download'); return provider(rows)(r); } };
    const found = await facade.execute(request, ctx, deps);
    const out = await facade.execute({ ...request, operation: 'materialize', includeAttachments: true, budget: { maxDownloadedBytes: 4 }, candidateRefs: found.items.map(({ skillItemId, revision }) => ({ skillItemId, revision })) }, { ...ctx, candidates: found.items }, deps);
    assert.equal(out.status, 'partial');
    assert.equal(out.items[0].body, 'contract body');
    assert.deepEqual(out.items[0].attachments.map(a => a.error.code), ['UNSUPPORTED', 'DOWNLOAD_LIMIT']);
  } finally { await rm(sessionDir, { recursive: true, force: true }); }
});
test('materialize stops immediately on terminal bridge error', async () => {
  const found = await facade.execute(request, context, { runMail: provider([row('1'), row('2')]) });
  let reads = 0;
  const out = await facade.execute({ ...request, operation: 'materialize', candidateRefs: found.items.map(({ skillItemId, revision }) => ({ skillItemId, revision })) }, { ...context, candidates: found.items }, { runMail: async () => { reads++; return { ok: false, error: { code: 'BRIDGE_RECOVERY_BUSY' } }; } });
  assert.equal(out.status, 'failed');
  assert.equal(reads, 1);
});
test('candidate revision changes with body or attachment metadata', async () => {
  const collect = async value => (await facade.execute(request, context, { runMail: provider([value]) })).items[0];
  const a = await collect(row('1'));
  const b = await collect(row('1', 'contract updated'));
  const c = await collect({ ...row('1'), attachments: [{ attachmentId: 'a', name: 'new.pdf', size: 2 }] });
  assert.equal(a.skillItemId, b.skillItemId);
  assert.notEqual(a.revision, b.revision);
  assert.notEqual(a.revision, c.revision);
});
