import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { deflateSync, inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('./screenshot-collection.mjs', import.meta.url));
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(color = 55, corruptPixels = false) {
  const chunk = (name, data) => {
    const type = Buffer.from(name); const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length); type.copy(out, 4); data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([type, data])), 8 + data.length); return out;
  };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  const pixels = deflateSync(Buffer.from([0, color, 100, 200, 255]));
  if (corruptPixels) pixels[4] ^= 0xff;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))]);
}
function target(id = 'request', extra = {}) {
  return { id, url: 'https://example.test/project/1', pageTitle: 'Project One', section: 'Customer request',
    parent: 'Project One', segment: 'Top', evidenceType: 'request', origin: 'existing',
    businessStatus: 'existing', use: 'Describe the existing request', ...extra };
}
function setup(t, targets = [target()], budget = {}) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'capture-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sessionRoot = path.join(dir, 'sessions/current'); fs.mkdirSync(sessionRoot, { recursive: true });
  const root = path.join(sessionRoot, 'collections/demo');
  const image = path.join(dir, 'source.png'); fs.writeFileSync(image, png());
  const bycli = path.join(dir, 'fake-bycli');
  fs.writeFileSync(bycli, `#!${process.execPath}\nconst fs = require('node:fs'); const a = process.argv.slice(2);\nfs.appendFileSync(process.env.CAPTURE_CALLS, JSON.stringify(a) + '\\n');\nif (process.env.CAPTURE_FAULT === 'login') { console.log(JSON.stringify({error:{code:'AUTH_REQUIRED'}})); process.exit(77); }\nif (process.env.CAPTURE_FAULT === 'fail') { console.log(JSON.stringify({error:{code:'TIMEOUT'}})); process.exit(1); }\nif (a[2] === 'get') console.log(JSON.stringify({data:{url:process.env.CAPTURE_URL || 'https://example.test/project/1'}}));\nelse if (a[2] === 'screenshot') { fs.copyFileSync(process.env.CAPTURE_IMAGE, a[3]); console.log(JSON.stringify({ok:true})); }\nelse process.exit(2);\n`, { mode: 0o700 });
  const env = { ...process.env, KNOWLEDGE_COLLECTION_SESSION_ROOT: '', KNOWLEDGE_COLLECTION_SESSIONS_ROOT: path.join(dir, 'sessions'), CAPTURE_IMAGE: image, CAPTURE_CALLS: path.join(dir, 'calls') };
  const run = (command, flags = [], overrides = {}) => {
    const result = spawnSync(process.execPath, [script, command, '--session-root', sessionRoot, '--session-dir', root, ...flags], { env: { ...env, ...overrides }, encoding: 'utf8' });
    let json; try { json = JSON.parse(result.stdout); } catch {}
    return { ...result, json };
  };
  const plan = { title: 'Project screenshot archive', targets, budget: { maxAttempts: 3, noProgressLimit: 2, deadlineMs: 600000, ...budget } };
  const init = () => run('init', ['--plan-json', JSON.stringify(plan)]);
  const capture = (id = targets[0].id, overrides = {}, session = 'capture-session') => run('capture', ['--target', id, '--browser-session', session, '--tab', 'tab-17', '--bycli', bycli], overrides);
  const manifest = () => JSON.parse(fs.readFileSync(path.join(root, 'capture-manifest.json')));
  const save = (m) => fs.writeFileSync(path.join(root, 'capture-manifest.json'), JSON.stringify(m));
  const review = (id = targets[0].id, changes = {}) => {
    const m = manifest(); const item = m.targets.find(x => x.id === id); const last = item.captures.at(-1);
    return run('review', ['--target', id, '--review-json', JSON.stringify({ decision: 'accept', reviewer: 'agent', sha256: last.sha256,
      captureId: last.id, context: { pageTitle: item.pageTitle, section: item.section, parent: item.parent, segment: item.segment },
      pageIdentityMatches: true, sectionContextMatches: true, legible: true, containsInternalReasoning: false,
      containsError: false, evidenceSupportsUse: true, reason: 'Reviewed visible page and parent section',
      evidenceLimits: 'Only the visible region; no claim about offscreen state', ...changes })]);
  };
  const calls = () => fs.existsSync(env.CAPTURE_CALLS) ? fs.readFileSync(env.CAPTURE_CALLS, 'utf8').trim().split('\n').map(JSON.parse) : [];
  return { dir, root, sessionRoot, image, run, plan, init, capture, manifest, save, review, calls };
}
function ok(result) { assert.equal(result.status, 0, result.stdout || result.stderr); assert.equal(result.json.ok, true); return result.json; }
function fail(result, code) { assert.notEqual(result.status, 0, result.stdout); assert.equal(result.json?.code, code, result.stdout || result.stderr); }
function accepted(t, targets = [target()]) { const f = setup(t, targets); ok(f.init()); ok(f.capture()); ok(f.review()); return f; }
function zipMembers(bytes) {
  const entries = {}; let pos = 0;
  while (bytes.readUInt32LE(pos) === 0x04034b50) {
    const method = bytes.readUInt16LE(pos + 8); const expectedCrc = bytes.readUInt32LE(pos + 14);
    const size = bytes.readUInt32LE(pos + 18); const nameSize = bytes.readUInt16LE(pos + 26); const extraSize = bytes.readUInt16LE(pos + 28);
    const name = bytes.subarray(pos + 30, pos + 30 + nameSize).toString(); const offset = pos + 30 + nameSize + extraSize;
    const packed = bytes.subarray(offset, offset + size); const data = method === 0 ? packed : inflateRawSync(packed);
    assert.equal(crc32(data), expectedCrc, name); entries[name] = data; pos = offset + size;
  }
  return entries;
}

test('invalid init leaves no collection directory', (t) => {
  const f = setup(t); delete f.plan.targets[0].parent;
  fail(f.init(), 'INVALID_PLAN'); assert.equal(fs.existsSync(f.root), false);
});
test('init binds immutable targets and repeat init cannot reset the budget', (t) => {
  const f = setup(t); ok(f.init()); fail(f.init(), 'ALREADY_INITIALIZED');
  assert.equal(fs.existsSync(path.join(f.root, 'session.json')), false);
  assert.equal(f.manifest().targets[0].attempts, 0);
});
test('capture uses readonly argv and records actual file, tab, session, URL and hash without auto approval', (t) => {
  const f = setup(t); ok(f.init()); ok(f.capture()); const item = f.manifest().targets[0];
  assert.equal(item.state, 'captured'); assert.equal(item.review, null); assert.equal(item.attempts, 1);
  assert.equal(item.captures[0].page.tab, 'tab-17'); assert.equal(item.captures[0].page.session, 'capture-session');
  assert.equal(item.captures[0].page.url, 'https://example.test/project/1');
  assert.match(item.captures[0].sha256, /^[a-f0-9]{64}$/); assert.ok(fs.existsSync(path.join(f.root, item.captures[0].file)));
  assert.deepEqual(f.calls().map(a => a[2]), ['get', 'screenshot', 'get']);
});
test('installed byCLI plain URL and Screenshot saved to stdout are accepted without a live browser', (t) => {
  // @sovovs/bycli dist/src/cli.js:1348-1350 prints the URL itself;
  // :964 prints `Screenshot saved to: ${path}`. Exercise those exact stdout forms.
  const f = setup(t); ok(f.init());
  const executable = path.join(f.dir, 'bycli-plain-output');
  fs.writeFileSync(executable, `#!${process.execPath}\nconst fs = require('node:fs'); const a = process.argv.slice(2);\nif (process.env.PLAIN_NONZERO) { console.log('https://example.test/project/1'); process.exit(1); }\nif (a[2] === 'get') console.log('https://example.test/project/1');\nelse if (a[2] === 'screenshot') { fs.copyFileSync(${JSON.stringify(f.image)}, a[3]); console.log('Screenshot saved to: ' + a[3]); }\nelse process.exit(2);\n`, { mode: 0o700 });
  fail(f.run('capture', ['--target', 'request', '--browser-session', 'capture-session', '--tab', 'tab-17', '--bycli', executable], { PLAIN_NONZERO: '1' }), 'CAPTURE_FAILED');
  ok(f.run('capture', ['--target', 'request', '--browser-session', 'capture-session', '--tab', 'tab-17', '--bycli', executable]));
  ok(f.review()); assert.equal(ok(f.run('validate')).acceptedCount, 1);
});
test('accept review requires parent, section and segment context', (t) => {
  const f = setup(t); ok(f.init()); ok(f.capture()); fail(f.review('request', { context: {} }), 'INVALID_REVIEW');
});
test('new capture preserves rejected image review reasons and evidence limits', (t) => {
  const f = setup(t); ok(f.init()); ok(f.capture()); ok(f.review('request', { decision: 'reject', reason: 'Parent section absent' }));
  fs.writeFileSync(f.image, png(77)); ok(f.capture());
  const first = f.manifest().targets[0].captures[0]; assert.equal(first.review.decision, 'reject');
  assert.equal(first.review.reason, 'Parent section absent'); assert.equal(first.review.sha256, first.sha256);
  assert.equal(first.review.evidenceLimits, 'Only the visible region; no claim about offscreen state');
});
for (const field of ['containsInternalReasoning', 'containsError']) test(`formal evidence rejects ${field}`, (t) => {
  const f = setup(t); ok(f.init()); ok(f.capture()); fail(f.review('request', { [field]: true }), 'INVALID_REVIEW');
});
test('unpacked or reused material cannot claim a newly produced result', (t) => {
  const f = setup(t, [target('result', { evidenceType: 'result', origin: 'unpacked', businessStatus: 'newly-produced' })]);
  fail(f.init(), 'INVALID_PLAN'); assert.equal(fs.existsSync(f.root), false);
});
test('unreviewed targets fail validation even with partial enabled', (t) => {
  const f = setup(t); ok(f.init()); ok(f.capture()); fail(f.run('validate', ['--allow-partial', 'true']), 'UNREVIEWED_TARGET');
});
test('uncaptured targets require explicit missing reasons', (t) => {
  const f = setup(t); ok(f.init()); fail(f.run('validate', ['--allow-partial', 'true']), 'UNREVIEWED_TARGET');
});
test('accepted coverage is complete only after full validation', (t) => {
  const f = accepted(t); const result = ok(f.run('validate')); assert.equal(result.status, 'complete'); assert.equal(result.acceptedCount, 1);
});
test('public page capture never claims authenticated provenance without authentication evidence', (t) => {
  const f = accepted(t); const result = ok(f.run('package'));
  assert.equal(f.manifest().source, 'web-page');
  const material = fs.readFileSync(result.materialPath, 'utf8'); assert.match(material, /source: web-page/);
  assert.doesNotMatch(material, /authenticated-web/);
});
for (const mutation of ['hash-change', 'missing-file', 'symlink', 'traversal', 'stale-review', 'corrupt-image']) test(`validation rejects ${mutation}`, (t) => {
  const f = accepted(t); const m = f.manifest(); const capture = m.targets[0].captures[0]; const file = path.join(f.root, capture.file);
  if (mutation === 'hash-change') fs.writeFileSync(file, png(77));
  if (mutation === 'missing-file') fs.unlinkSync(file);
  if (mutation === 'symlink') { fs.unlinkSync(file); fs.symlinkSync(f.image, file); }
  if (mutation === 'traversal') { capture.file = '../../escape.png'; f.save(m); }
  if (mutation === 'stale-review') { m.targets[0].section = 'Different section'; f.save(m); }
  if (mutation === 'corrupt-image') fs.writeFileSync(file, png(55, true));
  const codes = { 'hash-change': 'HASH_MISMATCH', 'missing-file': 'MISSING_FILE', symlink: 'UNSAFE_PATH', traversal: 'UNSAFE_PATH', 'stale-review': 'STALE_REVIEW', 'corrupt-image': 'INVALID_PNG' };
  fail(f.run('validate'), codes[mutation]);
});
test('full PNG decode rejects damaged compressed pixels even with valid PNG chunk CRCs', (t) => {
  const f = setup(t); ok(f.init()); fs.writeFileSync(f.image, png(55, true)); fail(f.capture(), 'INVALID_PNG');
  assert.equal(f.manifest().targets[0].attempts, 1);
});
test('duplicate accepted hashes cannot count twice', (t) => {
  const f = accepted(t, [target(), target('other')]); ok(f.capture('other')); ok(f.review('other')); fail(f.run('validate'), 'DUPLICATE_HASH');
});
test('partial archive requires explicit missing targets and never claims complete', (t) => {
  const f = accepted(t, [target(), target('other')]); ok(f.run('missing', ['--target', 'other', '--reason', 'Authorized page unavailable']));
  fail(f.run('validate'), 'MISSING_TARGETS'); const result = ok(f.run('package', ['--allow-partial', 'true']));
  assert.equal(result.status, 'partial'); assert.equal(result.missingCount, 1);
});
test('package allowlist excludes logs, rejected captures and manifest; material counts match CRC-verified ZIP', (t) => {
  const f = accepted(t); fs.writeFileSync(path.join(f.root, 'internal.log'), 'private diagnostics');
  ok(f.capture()); ok(f.review('request', { decision: 'reject', reason: 'Wrong crop' }));
  fs.writeFileSync(f.image, png(77)); ok(f.capture()); ok(f.review());
  const result = ok(f.run('package')); const bytes = fs.readFileSync(result.receipt.archivePath); const entries = zipMembers(bytes);
  assert.deepEqual(Object.keys(entries).sort(), ['captures/request-3.png', 'material.md']);
  assert.match(entries['material.md'].toString(), /Accepted images: 1/); assert.match(entries['material.md'].toString(), /Excluded captures: 2/);
  assert.match(entries['material.md'].toString(), /source: web-page/); assert.equal(result.receipt.size, bytes.length);
  assert.deepEqual(result.receipt.entries.map(x => x.path).sort(), Object.keys(entries).sort());
  assert.equal(result.receipt.proves, 'file-generation-only'); ok(f.run('verify-package'));
});
test('archive readback detects modified ZIP bytes', (t) => {
  const f = accepted(t); const result = ok(f.run('package')); const bytes = fs.readFileSync(result.receipt.archivePath); bytes[50] ^= 0xff;
  fs.writeFileSync(result.receipt.archivePath, bytes); fail(f.run('verify-package'), 'ARCHIVE_MISMATCH');
});
test('archive readback validates central CRC even if the outer archive hash was recomputed', (t) => {
  const f = accepted(t); const result = ok(f.run('package')); const bytes = fs.readFileSync(result.receipt.archivePath);
  const central = bytes.indexOf(Buffer.from('504b0102', 'hex')); assert.ok(central > 0); bytes[central + 16] ^= 0xff;
  fs.writeFileSync(result.receipt.archivePath, bytes);
  const receiptFile = path.join(f.root, 'capture-receipt.json'); const receipt = JSON.parse(fs.readFileSync(receiptFile));
  receipt.sha256 = createHash('sha256').update(bytes).digest('hex'); fs.writeFileSync(receiptFile, JSON.stringify(receipt));
  fail(f.run('verify-package'), 'ARCHIVE_MISMATCH');
});
test('no-progress budget survives new sessions and processes while other targets continue', (t) => {
  const f = setup(t, [target(), target('other')], { maxAttempts: 5 }); ok(f.init()); ok(f.capture()); ok(f.review('request', { decision: 'reject' }));
  ok(f.capture('request', {}, 'moved-session')); ok(f.review('request', { decision: 'reject' }));
  ok(f.capture()); const count = f.calls().length; fail(f.capture(), 'BUDGET_EXHAUSTED'); assert.equal(f.calls().length, count);
  ok(f.capture('other')); assert.equal(f.manifest().status, 'partial');
});
test('failed attempts exhaust persistent budget without repeated init or capture resetting it', (t) => {
  const f = setup(t, [target()], { maxAttempts: 2, noProgressLimit: 2 }); ok(f.init());
  fail(f.capture('request', { CAPTURE_FAULT: 'fail' }), 'CAPTURE_FAILED'); fail(f.capture('request', { CAPTURE_FAULT: 'fail' }), 'CAPTURE_FAILED');
  fail(f.init(), 'ALREADY_INITIALIZED'); const count = f.calls().length; fail(f.capture(), 'BUDGET_EXHAUSTED');
  assert.equal(f.calls().length, count); assert.equal(f.manifest().targets[0].attempts, 2); assert.equal(f.manifest().status, 'partial');
});
test('deadline cannot be renewed by process restart', (t) => {
  const f = setup(t, [target()], { deadlineMs: 1 }); ok(f.init()); fail(f.capture(), 'BUDGET_EXHAUSTED'); assert.equal(f.calls().length, 0);
});
test('login wait is paused, needs explicit confirmation, and preserves deadline and attempts', (t) => {
  const f = setup(t); ok(f.init()); const deadline = f.manifest().deadlineAt;
  fail(f.capture('request', { CAPTURE_FAULT: 'login' }), 'LOGIN_PAUSED'); fail(f.capture(), 'LOGIN_PAUSED');
  fail(f.run('resume', ['--target', 'request']), 'VERIFICATION_REQUIRED');
  ok(f.run('resume', ['--target', 'request', '--verification-confirmed', 'true'])); ok(f.capture());
  assert.equal(f.manifest().deadlineAt, deadline); assert.equal(f.manifest().targets[0].attempts, 2);
});
test('unauthorized tab URL refuses screenshot and retains charged attempt', (t) => {
  const f = setup(t); ok(f.init()); fail(f.capture('request', { CAPTURE_URL: 'https://evil.test/' }), 'URL_NOT_AUTHORIZED');
  assert.deepEqual(f.calls().map(a => a[2]), ['get']); assert.equal(f.manifest().targets[0].attempts, 1);
});
test('init rejects symlinked collection ancestors without side effects', (t) => {
  const f = setup(t); const outside = path.join(f.dir, 'outside'); fs.mkdirSync(outside); fs.symlinkSync(outside, path.join(f.sessionRoot, 'collections'));
  fail(f.init(), 'UNSAFE_PATH'); assert.deepEqual(fs.readdirSync(outside), []);
});
test('unknown init options are rejected before filesystem writes', (t) => {
  const f = setup(t); fail(f.run('init', ['--plan-json', JSON.stringify(f.plan), '--unexpected', 'yes']), 'INVALID_ARGUMENTS'); assert.equal(fs.existsSync(f.root), false);
});
test('expired budget is persisted as partial before capture is refused', (t) => {
  const f = setup(t, [target()], { deadlineMs: 1 }); ok(f.init()); fail(f.capture(), 'BUDGET_EXHAUSTED');
  assert.equal(f.manifest().status, 'partial'); assert.equal(f.manifest().targets[0].blockedReason, 'deadline');
});
test('status cannot preserve a complete claim after accepted evidence is deleted', (t) => {
  const f = accepted(t); ok(f.run('validate')); fs.unlinkSync(path.join(f.root, f.manifest().targets[0].captures[0].file));
  const result = ok(f.run('status')); assert.equal(result.status, 'partial'); assert.equal(result.validationError, 'MISSING_FILE');
});
test('public material source metadata removes query and fragment values', (t) => {
  const sourceUrl = 'https://example.test/project/1?view=customer#private-section';
  const f = setup(t, [target('request', { url: sourceUrl })]); ok(f.init()); ok(f.capture('request', { CAPTURE_URL: sourceUrl })); ok(f.review());
  const result = ok(f.run('package')); const material = fs.readFileSync(result.materialPath, 'utf8');
  assert.match(material, /Source URL: https:\/\/example.test\/project\/1\n/); assert.doesNotMatch(material, /view=customer|private-section/);
});
for (const businessKey of ['groupsessionid', 'sessionId']) test(`numeric business ${businessKey} stays in exact authorization scope`, (t) => {
  const sourceUrl = `https://www.beyonai.cn/beyond/hacu/group/chat?${businessKey}=10287230`;
  const f = setup(t, [target('request', { url: sourceUrl })]); ok(f.init());
  fail(f.capture('request', { CAPTURE_URL: sourceUrl.replace('10287230', '10287231') }), 'URL_NOT_AUTHORIZED');
  ok(f.capture('request', { CAPTURE_URL: sourceUrl })); ok(f.review());
  const result = ok(f.run('package')); assert.doesNotMatch(fs.readFileSync(result.materialPath, 'utf8'), /10287230/);
});
test('failed captured images remain counted as excluded without entering ZIP', (t) => {
  const f = accepted(t, [target(), target('bad')]); fs.writeFileSync(f.image, png(55, true)); fail(f.capture('bad'), 'INVALID_PNG');
  ok(f.run('missing', ['--target', 'bad', '--reason', 'Image failed complete decoding']));
  const result = ok(f.run('package', ['--allow-partial', 'true'])); assert.equal(result.excludedCount, 1);
  assert.deepEqual(Object.keys(zipMembers(fs.readFileSync(result.receipt.archivePath))).sort(), ['captures/request-1.png', 'material.md']);
});
for (const suffix of ['?token=secret', '?sessionId=secret', '?auth=secret', '?api_key=secret', '#access_token=secret']) test(`init refuses credential-bearing URL ${suffix.split('=')[0]}`, (t) => {
  const f = setup(t, [target('request', { url: `https://example.test/project/1${suffix}` })]); fail(f.init(), 'INVALID_PLAN'); assert.equal(fs.existsSync(f.root), false);
});
test('path traversal and an outside absolute session directory are refused', (t) => {
  const f = setup(t);
  fail(f.run('init', ['--plan-json', JSON.stringify(f.plan), '--session-dir', '../escape']), 'INVALID_ARGUMENTS');
  const r = spawnSync(process.execPath, [script, 'init', '--session-root', f.sessionRoot,
    '--session-dir', path.join(f.dir, 'outside'), '--plan-json', JSON.stringify(f.plan)], {
    encoding: 'utf8', env: { ...process.env, KNOWLEDGE_COLLECTION_SESSION_ROOT: '', KNOWLEDGE_COLLECTION_SESSIONS_ROOT: path.join(f.dir, 'sessions') },
  });
  fail({ ...r, json: JSON.parse(r.stdout) }, 'UNSAFE_PATH'); assert.equal(fs.existsSync(path.join(f.dir, 'outside')), false);
});
