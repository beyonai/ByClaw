#!/usr/bin/env node
/** Isolated, read-only screenshot collection. Never writes article session state. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import deps from './vendor/screenshot-deps.cjs';
import { atomicWriteJson, isInside, resolveTrustedSessionRoot, withSessionLock } from './session.mjs';

const { PNG, zipSync, unzipSync } = deps;
const evidenceTypes = ['request', 'analysis', 'creation', 'unpack', 'result'];
const origins = ['existing', 'newly-produced', 'unpacked'];
const businessStatuses = ['existing', 'newly-produced', 'in-progress', 'failed'];
const contextFields = ['pageTitle', 'section', 'parent', 'segment'];
const targetFields = ['id', 'url', ...contextFields, 'evidenceType', 'origin', 'businessStatus', 'use'];
const maxImageBytes = 25 * 1024 * 1024;
const credentialKey = /token|cookie|secret|password|auth|credential|api[_-]?key|session|signature|^sid$/i;
function reject(code) { throw Object.assign(new Error(code), { code }); }
function text(value, code) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4000 || /[\x00-\x08\x0b-\x1f]/.test(value)) reject(code);
  return value;
}
function keys(value, allowed, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) reject(code);
}
function parseJson(value, code) { try { return JSON.parse(value); } catch { reject(code); } }
function url(value, code = 'INVALID_PLAN') {
  text(value, code); let parsed;
  try { parsed = new URL(value); } catch { reject(code); }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password
    || [...parsed.searchParams.entries()].some(([k, v]) => credentialKey.test(k)
      && !(/^(groupsessionid|sessionid)$/i.test(k) && /^[1-9][0-9]*$/.test(v)))) reject(code);
  let fragment; try { fragment = decodeURIComponent(parsed.hash); } catch { reject(code); }
  if (/(?:token|cookie|secret|password|auth|credential|api[_-]?key|session|signature|sid)[^=]*=/i.test(fragment)) reject(code);
  return parsed.href;
}
function targetShape(item) {
  for (const field of targetFields) text(item[field], 'INVALID_PLAN');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(item.id) || !evidenceTypes.includes(item.evidenceType)
    || !origins.includes(item.origin) || !businessStatuses.includes(item.businessStatus)
    || (item.origin !== 'newly-produced' && item.businessStatus === 'newly-produced')) reject('INVALID_PLAN');
  if (url(item.url) !== item.url) reject('INVALID_PLAN');
}
function planShape(plan) {
  keys(plan, ['title', 'targets', 'budget'], 'INVALID_PLAN'); text(plan.title, 'INVALID_PLAN');
  if (!Array.isArray(plan.targets) || !plan.targets.length || plan.targets.length > 50) reject('INVALID_PLAN');
  const ids = new Set();
  for (const item of plan.targets) {
    keys(item, targetFields, 'INVALID_PLAN'); targetShape(item);
    if (ids.has(item.id)) reject('INVALID_PLAN'); ids.add(item.id);
  }
  const budget = { maxAttempts: 3, noProgressLimit: 2, deadlineMs: 600000, ...plan.budget };
  keys(budget, ['maxAttempts', 'noProgressLimit', 'deadlineMs'], 'INVALID_PLAN');
  for (const [key, max] of [['maxAttempts', 10], ['noProgressLimit', 10], ['deadlineMs', 3600000]]) {
    if (!Number.isInteger(budget[key]) || budget[key] < 1 || budget[key] > max) reject('INVALID_PLAN');
  }
  return { ...plan, budget };
}
function safeAncestors(absolute) {
  const parts = path.resolve(absolute).split(path.sep); let current = path.parse(absolute).root;
  for (const part of parts.filter(Boolean)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) reject('UNSAFE_PATH'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
function sessionPaths(options) {
  if (!path.isAbsolute(text(options['session-root'], 'INVALID_ARGUMENTS'))) reject('INVALID_ARGUMENTS');
  let sessionRoot;
  try { sessionRoot = resolveTrustedSessionRoot(options['session-root'], 'screenshot'); }
  catch { reject('UNSAFE_PATH'); }
  const requested = text(options['session-dir'], 'INVALID_ARGUMENTS');
  if (requested.split(/[\\/]/).includes('..')) reject('UNSAFE_PATH');
  const root = path.resolve(sessionRoot, requested);
  if (!isInside(sessionRoot, root) || root === sessionRoot) reject('UNSAFE_PATH');
  const relative = path.relative(sessionRoot, root).split(path.sep);
  if (relative.length !== 2 || !['collections', '.collection-runs'].includes(relative[0])) reject('UNSAFE_PATH');
  safeAncestors(root);
  return { root, sessionRoot, manifest: path.join(root, 'capture-manifest.json'), lock: path.join(root, '.capture.lock') };
}
function safeFile(paths, relative, required = true) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\')
    || relative.split('/').some(p => p === '..' || p === '.' || !p)) reject('UNSAFE_PATH');
  const absolute = path.join(paths.root, relative);
  if (!isInside(paths.root, absolute)) reject('UNSAFE_PATH'); safeAncestors(absolute);
  try { const stat = fs.lstatSync(absolute); if (!stat.isFile()) reject('UNSAFE_PATH'); }
  catch (error) { if (error.code === 'ENOENT') { if (required) reject('MISSING_FILE'); } else throw error; }
  return absolute;
}
function hash(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function rememberExcluded(paths, item, relative, reason) {
  try {
    const file = safeFile(paths, relative); const size = fs.statSync(file).size;
    if (size > maxImageBytes || item.excludedCaptures.some(c => c.file === relative)) return;
    item.excludedCaptures.push({ file: relative, size, sha256: hash(fs.readFileSync(file)), reason });
  } catch { /* Unsafe or missing files remain outside the archive without being read. */ }
}
function binding(item, capture) {
  return hash(Buffer.from(JSON.stringify([targetFields.map(k => item[k]), capture.id, capture.file, capture.sha256, capture.page])));
}
function decodeImage(file) {
  const size = fs.statSync(file).size;
  if (size < 33 || size > maxImageBytes) reject('INVALID_PNG');
  const bytes = fs.readFileSync(file);
  try {
    const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
    if (!width || !height || width * height > 20000000) reject('INVALID_PNG');
    // pngjs bounds scanline inflation and may stop before zlib's final checksum.
    // Consume the whole IDAT stream as well, then let pngjs decode all pixels/filters/CRCs.
    const compressed = []; let offset = 8; let ended = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset); const kind = bytes.toString('ascii', offset + 4, offset + 8);
      if (offset + length + 12 > bytes.length) reject('INVALID_PNG');
      if (kind === 'IDAT') compressed.push(bytes.subarray(offset + 8, offset + 8 + length));
      offset += length + 12;
      if (kind === 'IEND') { ended = true; break; }
    }
    if (!ended || offset !== bytes.length || !compressed.length) reject('INVALID_PNG');
    inflateSync(Buffer.concat(compressed), { maxOutputLength: 180000000 });
    const decoded = PNG.sync.read(bytes, { checkCRC: true });
    if (decoded.data.length !== decoded.width * decoded.height * 4) reject('INVALID_PNG');
  } catch { reject('INVALID_PNG'); }
  return bytes;
}
function refresh(manifest) {
  for (const item of manifest.targets) {
    if (item.inFlight) { item.inFlight = null; item.noProgress += 1; item.lastError = 'CAPTURE_INTERRUPTED'; }
    item.blockedReason ||= Date.now() >= Date.parse(manifest.deadlineAt) ? 'deadline'
      : item.attempts >= manifest.budget.maxAttempts ? 'attempts'
        : item.noProgress >= manifest.budget.noProgressLimit ? 'no-progress' : null;
  }
  manifest.status = manifest.targets.some(t => (t.blockedReason && t.state !== 'accepted') || t.state === 'missing') ? 'partial'
    : manifest.status === 'complete' && manifest.targets.every(t => t.state === 'accepted') ? 'complete' : 'pending';
}
function load(paths) {
  const file = safeFile(paths, 'capture-manifest.json'); const m = parseJson(fs.readFileSync(file, 'utf8'), 'INVALID_MANIFEST');
  if (m.schemaVersion !== '1.0' || m.workflow !== 'screenshot-collection' || m.sessionRoot !== paths.sessionRoot
    || m.sessionDir !== paths.root || !Array.isArray(m.targets) || !m.targets.length
    || !Number.isFinite(Date.parse(m.deadlineAt))) reject('INVALID_MANIFEST');
  planShape({ title: m.title, targets: m.targets.map(item => Object.fromEntries(targetFields.map(k => [k, item[k]]))), budget: m.budget });
  for (const item of m.targets) {
    if (!Number.isInteger(item.attempts) || item.attempts < 0 || !Number.isInteger(item.noProgress) || item.noProgress < 0
      || !Array.isArray(item.captures) || item.captures.length > item.attempts) reject('INVALID_MANIFEST');
    item.excludedCaptures ||= [];
    if (!Array.isArray(item.excludedCaptures)) reject('INVALID_MANIFEST');
    if (item.inFlight?.file) rememberExcluded(paths, item, item.inFlight.file, 'CAPTURE_INTERRUPTED');
  }
  refresh(m); return m;
}
function save(paths, manifest) { safeFile(paths, 'capture-manifest.json', false); atomicWriteJson(paths.manifest, manifest); }
function findTarget(manifest, id) { const item = manifest.targets.find(t => t.id === id); if (!item) reject('UNKNOWN_TARGET'); return item; }
function reviewShape(review, item, capture) {
  keys(review, ['decision', 'reviewer', 'sha256', 'captureId', 'context', 'pageIdentityMatches', 'sectionContextMatches', 'legible',
    'containsInternalReasoning', 'containsError', 'evidenceSupportsUse', 'reason', 'evidenceLimits'], 'INVALID_REVIEW');
  if (!['accept', 'reject'].includes(review.decision) || review.captureId !== capture.id || review.sha256 !== capture.sha256) reject('INVALID_REVIEW');
  for (const k of ['reviewer', 'reason', 'evidenceLimits']) text(review[k], 'INVALID_REVIEW');
  keys(review.context, contextFields, 'INVALID_REVIEW');
  for (const k of contextFields) if (!review.context[k] || review.context[k] !== item[k]) reject('INVALID_REVIEW');
  for (const k of ['pageIdentityMatches', 'sectionContextMatches', 'legible', 'containsInternalReasoning', 'containsError', 'evidenceSupportsUse']) {
    if (typeof review[k] !== 'boolean') reject('INVALID_REVIEW');
  }
  if (review.decision === 'accept' && (!review.pageIdentityMatches || !review.sectionContextMatches || !review.legible
    || !review.evidenceSupportsUse || review.containsInternalReasoning || review.containsError)) reject('INVALID_REVIEW');
}
function bycliCall(executable, argv, deadline) {
  const timeout = Math.min(30000, Date.parse(deadline) - Date.now());
  if (timeout <= 0) reject('BUDGET_EXHAUSTED');
  const result = spawnSync(executable, argv, { encoding: 'utf8', shell: false, timeout, maxBuffer: 1024 * 1024 });
  let payload; try { payload = JSON.parse(result.stdout); } catch {}
  const code = payload?.error?.code || payload?.data?.error?.code;
  if (result.status === 77 || ['AUTH_REQUIRED', 'CAPTCHA', 'MFA_REQUIRED', 'LOGIN_REQUIRED'].includes(code)) reject('LOGIN_PAUSED');
  if (result.error || result.status !== 0 || payload?.ok === false || code) reject('CAPTURE_FAILED');
  return payload ?? result.stdout?.trim();
}
function observedUrl(payload) {
  const value = typeof payload === 'string' ? payload : payload?.data?.url ?? payload?.url ?? payload?.data?.value ?? payload?.value;
  if (typeof value !== 'string' || /[\r\n]/.test(value)) reject('URL_NOT_AUTHORIZED');
  return url(value, 'URL_NOT_AUTHORIZED');
}
function captureTarget(paths, manifest, options) {
  const item = findTarget(manifest, options.target);
  if (item.state === 'paused') reject('LOGIN_PAUSED');
  if (item.blockedReason || item.state === 'missing') { save(paths, manifest); reject('BUDGET_EXHAUSTED'); }
  const session = text(options['browser-session'], 'INVALID_ARGUMENTS'); const tab = text(options.tab, 'INVALID_ARGUMENTS');
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(session) || !/^[a-zA-Z0-9_-]{1,150}$/.test(tab)) reject('INVALID_ARGUMENTS');
  const executable = options.bycli || 'bycli'; text(executable, 'INVALID_ARGUMENTS');
  item.attempts += 1; const relative = `captures/${item.id}-${item.attempts}.png`;
  item.inFlight = { attempt: item.attempts, file: relative, startedAt: new Date().toISOString() }; item.review = null;
  item.state = 'pending'; save(paths, manifest);
  const file = safeFile(paths, relative, false);
  try {
    const args = ['browser', session];
    if (observedUrl(bycliCall(executable, [...args, 'get', 'url', '--tab', tab], manifest.deadlineAt)) !== item.url) reject('URL_NOT_AUTHORIZED');
    bycliCall(executable, [...args, 'screenshot', file, '--tab', tab], manifest.deadlineAt);
    if (observedUrl(bycliCall(executable, [...args, 'get', 'url', '--tab', tab], manifest.deadlineAt)) !== item.url) reject('URL_NOT_AUTHORIZED');
    const bytes = decodeImage(safeFile(paths, relative)); const sha256 = hash(bytes);
    item.noProgress = item.captures.some(c => c.sha256 === sha256) ? item.noProgress + 1 : 0;
    item.captures.push({ id: crypto.randomUUID(), file: relative, sha256, size: bytes.length,
      capturedAt: new Date().toISOString(), page: { session, tab, url: item.url, expectedTitle: item.pageTitle } });
    item.state = 'captured'; item.lastError = null;
  } catch (error) {
    rememberExcluded(paths, item, relative, error.code || 'CAPTURE_FAILED');
    item.noProgress += error.code === 'LOGIN_PAUSED' ? 0 : 1;
    item.state = error.code === 'LOGIN_PAUSED' ? 'paused' : 'pending';
    item.lastError = error.code || 'CAPTURE_FAILED'; item.inFlight = null; refresh(manifest); save(paths, manifest); throw error;
  }
  item.inFlight = null; refresh(manifest); save(paths, manifest);
  return { target: item, status: manifest.status };
}
function validate(paths, manifest, allowPartial) {
  const accepted = []; const missing = []; const hashes = new Set();
  for (const item of manifest.targets) {
    if (item.state === 'missing' && typeof item.missingReason === 'string' && item.missingReason.trim()) { missing.push(item); continue; }
    if (item.state !== 'accepted' || item.review?.decision !== 'accept') reject('UNREVIEWED_TARGET');
    const capture = item.captures.at(-1); if (!capture) reject('UNREVIEWED_TARGET');
    const file = safeFile(paths, capture.file); const bytes = decodeImage(file);
    if (hash(bytes) !== capture.sha256) reject('HASH_MISMATCH');
    const { binding: bound, reviewedAt, ...review } = item.review;
    if (!reviewedAt || bound !== binding(item, capture)) reject('STALE_REVIEW');
    reviewShape(review, item, capture);
    if (capture.page?.url !== item.url || !capture.page?.session || !capture.page?.tab) reject('STALE_REVIEW');
    if (hashes.has(capture.sha256)) reject('DUPLICATE_HASH'); hashes.add(capture.sha256);
    accepted.push({ item, capture, bytes });
  }
  if (missing.length && !allowPartial) reject('MISSING_TARGETS');
  if (!accepted.length) reject('NO_ACCEPTED_IMAGES');
  const excludedCount = manifest.targets.reduce((count, t) => count + t.captures.length + t.excludedCaptures.length, 0) - accepted.length;
  return { accepted, missing, excludedCount, status: missing.length ? 'partial' : 'complete', acceptedCount: accepted.length, missingCount: missing.length };
}
function clean(value) { return String(value).replace(/[\r\n]/g, ' ').replace(/[<>]/g, ''); }
function sourceUrl(value) { const parsed = new URL(value); return `${parsed.origin}${parsed.pathname}`; }
function material(manifest, validated) {
  const { accepted, missing, excludedCount, status } = validated;
  const lines = [`# ${clean(manifest.title)}`, '', 'source: web-page', 'executor: bycli (read-only capture)',
    `Status: ${status}`, `Accepted images: ${accepted.length}`, `Missing targets: ${missing.length}`, `Excluded captures: ${excludedCount}`, '',
    'Visual meaning is Agent-reviewed. Hashes and PNG validation establish file integrity only.',
    'The archive receipt proves file generation only; it does not prove attachment or delivery.', '', '## Accepted images', ''];
  for (const { item, capture } of accepted) lines.push(`### ${clean(item.id)}`, `Image: ${capture.file}`, `Source URL: ${sourceUrl(item.url)}`,
    `Page: ${clean(item.pageTitle)}`, `Parent: ${clean(item.parent)}`, `Section: ${clean(item.section)}`, `Segment: ${clean(item.segment)}`,
    `Evidence type: ${item.evidenceType}`, `Origin: ${item.origin}`, `Business status: ${item.businessStatus}`, `Use: ${clean(item.use)}`,
    `SHA-256: ${capture.sha256}`, `Captured: ${capture.capturedAt}`, `Review: ${clean(item.review.reason)}`, `Evidence limits: ${clean(item.review.evidenceLimits)}`, '');
  lines.push('## Missing targets', '');
  for (const item of missing) lines.push(`- ${clean(item.id)}: ${clean(item.missingReason)}`);
  lines.push('', '## Excluded captures', '');
  const acceptedIds = new Set(accepted.map(a => a.capture.id));
  for (const item of manifest.targets) for (const capture of item.captures) if (!acceptedIds.has(capture.id)) {
    lines.push(`- ${clean(item.id)} / ${path.basename(capture.file)}: ${capture.review?.decision === 'reject'
      ? `rejected: ${clean(capture.review.reason)}; limits: ${clean(capture.review.evidenceLimits)}` : 'not accepted in final review'}`);
  }
  for (const item of manifest.targets) for (const capture of item.excludedCaptures) {
    lines.push(`- ${clean(item.id)} / ${path.basename(capture.file)}: ${clean(capture.reason)}`);
  }
  return Buffer.from(`${lines.join('\n')}\n`);
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function verifyZip(bytes, expected) {
  let decoded;
  try { decoded = unzipSync(bytes); } catch { reject('ARCHIVE_MISMATCH'); }
  if (JSON.stringify(Object.keys(decoded).sort()) !== JSON.stringify(expected.map(e => e.path).sort())) reject('ARCHIVE_MISMATCH');
  let offset = 0; const names = new Set(); const localRecords = new Map();
  for (const entry of expected) {
    if (!decoded[entry.path] || hash(decoded[entry.path]) !== entry.sha256 || decoded[entry.path].length !== entry.size) reject('ARCHIVE_MISMATCH');
  }
  // Our archive deliberately uses STORE. Check each local record's CRC and exact member set.
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    if (bytes.readUInt16LE(offset + 6) !== 0 || bytes.readUInt16LE(offset + 8) !== 0) reject('ARCHIVE_MISMATCH');
    const size = bytes.readUInt32LE(offset + 18); const nameSize = bytes.readUInt16LE(offset + 26); const extraSize = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameSize).toString('utf8');
    const start = offset + 30 + nameSize + extraSize; const data = bytes.subarray(start, start + size);
    if (names.has(name) || !decoded[name] || data.length !== size || crc32(data) !== bytes.readUInt32LE(offset + 14)
      || hash(data) !== hash(decoded[name])) reject('ARCHIVE_MISMATCH');
    names.add(name); localRecords.set(name, { offset, size, crc: crc32(data) }); offset = start + size;
  }
  if (names.size !== expected.length) reject('ARCHIVE_MISMATCH');
  const centralStart = offset; const centralNames = new Set();
  while (offset + 46 <= bytes.length && bytes.readUInt32LE(offset) === 0x02014b50) {
    const nameSize = bytes.readUInt16LE(offset + 28); const extraSize = bytes.readUInt16LE(offset + 30); const commentSize = bytes.readUInt16LE(offset + 32);
    const name = bytes.subarray(offset + 46, offset + 46 + nameSize).toString('utf8'); const local = localRecords.get(name);
    if (!local || centralNames.has(name) || bytes.readUInt16LE(offset + 8) !== 0 || bytes.readUInt16LE(offset + 10) !== 0
      || bytes.readUInt32LE(offset + 16) !== local.crc || bytes.readUInt32LE(offset + 20) !== local.size
      || bytes.readUInt32LE(offset + 24) !== local.size || bytes.readUInt32LE(offset + 42) !== local.offset) reject('ARCHIVE_MISMATCH');
    centralNames.add(name); offset += 46 + nameSize + extraSize + commentSize;
  }
  if (centralNames.size !== names.size || offset + 22 !== bytes.length || bytes.readUInt32LE(offset) !== 0x06054b50
    || bytes.readUInt32LE(offset + 4) !== 0 || bytes.readUInt16LE(offset + 8) !== names.size
    || bytes.readUInt16LE(offset + 10) !== names.size || bytes.readUInt32LE(offset + 12) !== offset - centralStart
    || bytes.readUInt32LE(offset + 16) !== centralStart || bytes.readUInt16LE(offset + 20) !== 0) reject('ARCHIVE_MISMATCH');
}
function verifyPackage(paths, manifest) {
  const receipt = parseJson(fs.readFileSync(safeFile(paths, 'capture-receipt.json'), 'utf8'), 'ARCHIVE_MISMATCH');
  if (receipt.archivePath !== path.join(paths.root, 'capture.zip') || receipt.manifestSha256 !== hash(fs.readFileSync(paths.manifest))) reject('ARCHIVE_MISMATCH');
  const bytes = fs.readFileSync(safeFile(paths, 'capture.zip'));
  if (bytes.length !== receipt.size || hash(bytes) !== receipt.sha256) reject('ARCHIVE_MISMATCH');
  const validated = validate(paths, manifest, receipt.status === 'partial');
  const expected = [...validated.accepted.map(a => ({ path: a.capture.file, sha256: a.capture.sha256, size: a.bytes.length })),
    { path: 'material.md', sha256: hash(material(manifest, validated)), size: material(manifest, validated).length }];
  if (JSON.stringify(receipt.entries) !== JSON.stringify(expected)) reject('ARCHIVE_MISMATCH');
  verifyZip(bytes, expected); return { receipt, status: validated.status };
}
const flags = {
  init: ['plan-json'], status: [], capture: ['target', 'browser-session', 'tab', 'bycli'], review: ['target', 'review-json'],
  missing: ['target', 'reason'], resume: ['target', 'verification-confirmed'], validate: ['allow-partial'],
  package: ['allow-partial'], 'verify-package': [],
};
function parseArgs(argv) {
  const [command, ...rest] = argv; if (!flags[command]) reject('INVALID_ARGUMENTS');
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]?.slice(2);
    if (!rest[i]?.startsWith('--') || !['session-root', 'session-dir', ...flags[command]].includes(key)
      || !rest[i + 1] || Object.hasOwn(options, key)) reject('INVALID_ARGUMENTS');
    options[key] = rest[i + 1];
  }
  for (const key of ['allow-partial', 'verification-confirmed']) if (options[key] && !['true', 'false'].includes(options[key])) reject('INVALID_ARGUMENTS');
  return { command, options };
}
export function run(argv) {
  const { command, options } = parseArgs(argv);
  const plan = command === 'init' ? planShape(parseJson(options['plan-json'], 'INVALID_PLAN')) : null;
  const paths = sessionPaths(options);
  if (command === 'init') {
    if (fs.existsSync(paths.root)) reject('ALREADY_INITIALIZED');
    fs.mkdirSync(path.dirname(paths.root), { recursive: true, mode: 0o700 });
    try { fs.mkdirSync(paths.root, { mode: 0o700 }); }
    catch (error) { if (error.code === 'EEXIST') reject('ALREADY_INITIALIZED'); throw error; }
    fs.mkdirSync(path.join(paths.root, 'captures'), { mode: 0o700 });
    const createdAt = new Date().toISOString();
    const manifest = { schemaVersion: '1.0', workflow: 'screenshot-collection', source: 'web-page', title: plan.title,
      sessionRoot: paths.sessionRoot, sessionDir: paths.root, createdAt, deadlineAt: new Date(Date.now() + plan.budget.deadlineMs).toISOString(),
      budget: plan.budget, status: 'pending', targets: plan.targets.map(t => ({ ...t, state: 'pending', attempts: 0,
        noProgress: 0, blockedReason: null, inFlight: null, captures: [], excludedCaptures: [], review: null, missingReason: null })) };
    save(paths, manifest); return { manifestPath: paths.manifest, status: manifest.status };
  }
  if (!fs.existsSync(paths.root)) reject('MISSING_FILE');
  return withSessionLock(paths, `capture-${command}`, () => {
    const manifest = load(paths);
    if (command === 'status') {
      let validationError;
      if (manifest.targets.every(t => ['accepted', 'missing'].includes(t.state))) {
        try { manifest.status = validate(paths, manifest, true).status; }
        catch (error) { validationError = error.code || 'INVALID_MANIFEST'; manifest.status = 'partial'; }
      }
      save(paths, manifest); return { manifest, status: manifest.status, ...(validationError ? { validationError } : {}) };
    }
    if (command === 'capture') return captureTarget(paths, manifest, options);
    if (command === 'review') {
      const item = findTarget(manifest, options.target); const capture = item.captures.at(-1);
      if (!capture) reject('UNREVIEWED_TARGET');
      const review = parseJson(options['review-json'], 'INVALID_REVIEW'); reviewShape(review, item, capture);
      const bytes = decodeImage(safeFile(paths, capture.file)); if (hash(bytes) !== capture.sha256) reject('HASH_MISMATCH');
      item.review = { ...review, binding: binding(item, capture), reviewedAt: new Date().toISOString() };
      capture.review = item.review;
      item.state = review.decision === 'accept' ? 'accepted' : 'rejected'; save(paths, manifest); return { target: item, status: manifest.status };
    }
    if (command === 'missing') {
      const item = findTarget(manifest, options.target); item.missingReason = text(options.reason, 'INVALID_ARGUMENTS');
      item.state = 'missing'; item.review = null; refresh(manifest); save(paths, manifest); return { target: item, status: 'partial' };
    }
    if (command === 'resume') {
      const item = findTarget(manifest, options.target);
      if (options['verification-confirmed'] !== 'true') reject('VERIFICATION_REQUIRED');
      if (item.state !== 'paused') reject('NOT_PAUSED');
      item.state = 'pending'; save(paths, manifest); return { target: item, status: manifest.status };
    }
    if (command === 'verify-package') return verifyPackage(paths, manifest);
    const validated = validate(paths, manifest, options['allow-partial'] === 'true');
    manifest.status = validated.status; save(paths, manifest);
    const result = { status: validated.status, acceptedCount: validated.acceptedCount, missingCount: validated.missingCount, excludedCount: validated.excludedCount };
    if (command === 'validate') return result;
    const files = Object.fromEntries(validated.accepted.map(a => [a.capture.file, a.bytes])); files['material.md'] = material(manifest, validated);
    const materialPath = safeFile(paths, 'material.md', false); fs.writeFileSync(materialPath, files['material.md'], { mode: 0o600 });
    const bytes = Buffer.from(zipSync(files, { level: 0 }));
    const entries = Object.entries(files).map(([name, data]) => ({ path: name, sha256: hash(data), size: data.length }));
    verifyZip(bytes, entries);
    const archivePath = safeFile(paths, 'capture.zip', false); fs.writeFileSync(archivePath, bytes, { mode: 0o600 });
    verifyZip(fs.readFileSync(archivePath), entries);
    const receipt = { schemaVersion: '1.0', archivePath, size: bytes.length, sha256: hash(bytes), entries,
      manifestSha256: hash(fs.readFileSync(paths.manifest)), status: validated.status, proves: 'file-generation-only', generatedAt: new Date().toISOString() };
    safeFile(paths, 'capture-receipt.json', false); atomicWriteJson(path.join(paths.root, 'capture-receipt.json'), receipt);
    return { ...result, materialPath, receipt };
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify({ ok: true, ...run(process.argv.slice(2)) })}\n`); }
  catch (error) { process.stdout.write(`${JSON.stringify({ ok: false, code: error.code || 'CAPTURE_WORKFLOW_FAILED' })}\n`); process.exitCode = 1; }
}
