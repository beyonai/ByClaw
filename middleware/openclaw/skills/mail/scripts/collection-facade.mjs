// Provider-neutral mail collection interface. Provider commands stay in this skill.
import { createHash } from 'node:crypto';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { execute as browserExecute } from './iwhalecloud-mail.mjs';
import { runProcess } from './iwhalecloud/process.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const safeCodes = new Set(['INVALID_REQUEST', 'INVALID_RESPONSE', 'ACCOUNT_BINDING_REQUIRED', 'ACCOUNT_BINDING_AMBIGUOUS',
  'UNSUPPORTED', 'CANDIDATE_BINDING_MISMATCH', 'AUTH_REQUIRED', 'AUTH_EXPIRED', 'PERMISSION_DENIED', 'ACCOUNT_NOT_FOUND',
  'MESSAGE_NOT_FOUND', 'ATTACHMENT_NOT_FOUND', 'UPSTREAM_UNAVAILABLE', 'BRIDGE_UNAVAILABLE', 'BRIDGE_RECOVERY_BUSY',
  'MAILBOX_CHANGED', 'DOWNLOAD_LIMIT', 'DOWNLOAD_BUSY', 'OUTPUT_LIMIT', 'DEADLINE_EXCEEDED', 'RATE_LIMITED']);
const actionCodes = new Set(['ACCOUNT_BINDING_REQUIRED', 'ACCOUNT_BINDING_AMBIGUOUS', 'AUTH_REQUIRED', 'AUTH_EXPIRED']);
const terminal = code => actionCodes.has(code) || ['DEADLINE_EXCEEDED', 'BRIDGE_UNAVAILABLE', 'BRIDGE_RECOVERY_BUSY'].includes(code);
const safeError = (error, extra = {}) => ({ code: safeCodes.has(error?.code) ? error.code : 'UPSTREAM_UNAVAILABLE', ...extra });
const boundedString = (s, max = 4096) => typeof s === 'string' && s.length <= max && !/[\x00-\x1f]/.test(s);
function keys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) fail('INVALID_REQUEST');
}
function bindingFor(context, selector) {
  keys(selector, ['accountContextRef', 'userSourceHint']);
  if (!boundedString(selector.accountContextRef, 256) || !selector.accountContextRef
    || (selector.userSourceHint !== undefined && !boundedString(selector.userSourceHint))) fail('INVALID_REQUEST');
  const matches = (context?.mailBindings || []).filter(b => b.ref === selector.accountContextRef);
  if (!matches.length) fail('ACCOUNT_BINDING_REQUIRED');
  if (matches.length !== 1) fail('ACCOUNT_BINDING_AMBIGUOUS');
  const b = matches[0];
  if (!boundedString(b.revision, 256) || !b.revision) fail('ACCOUNT_BINDING_REQUIRED');
  if (b.kind === 'projected' && boundedString(b.accountId, 128) && b.accountId && !b.accountId.startsWith('-')) return b;
  const hint = String(b.providerHint || selector.userSourceHint || '').toLowerCase().trim();
  if (b.kind === 'browser' && ['iwhalecloud', 'iwhalecloud-mail', '浩鲸邮箱', 'mail.iwhalecloud.com', 'https://mail.iwhalecloud.com', 'https://mail.iwhalecloud.com/owa/', 'https://mail.iwhalecloud.com/'].includes(hint)) return b;
  fail('UNSUPPORTED');
}
export async function describeCapabilities(context, selector) {
  try {
    const b = bindingFor(context, selector);
    // Projected providers differ. Absence of projected capability metadata is not support.
    const capability = name => b.kind === 'browser' ? 'supported'
      : b.capabilityStatus?.[name] === 'YES' ? 'supported' : b.capabilityStatus?.[name] === 'NO' ? 'unsupported'
        : b.capabilities?.includes(name) && !b.capabilityStatus?.[name] ? 'supported' : 'unknown';
    return { status: 'complete', capabilities: { list: capability('list'), serverSearch: 'unsupported', readFullText: capability('get'),
      downloadAttachment: capability('downloadAttachment'), boundedLocalScan: capability('list'), timeFilter: 'supported', transparentResume: 'unsupported' },
    identityBinding: b.kind === 'browser' ? 'context-only' : 'projected-account', bindingRevision: b.revision };
  } catch (error) {
    const { code } = safeError(error);
    return { status: actionCodes.has(code) ? 'needs-user-action' : 'failed', capabilities: {}, identityBinding: 'unknown', bindingRevision: null, reasonCode: code };
  }
}
function criteriaKey(criteria) { return hash([criteria.query, criteria.timeRange?.from || null, criteria.timeRange?.toExclusive || null, criteria.timezone || null]); }
function validate(request) {
  keys(request, ['schemaVersion', 'sessionId', 'channel', 'operation', 'selector', 'criteria', 'budget', 'contentRequirement', 'includeAttachments', 'candidateRefs']);
  if (!['discover', 'materialize'].includes(request.operation)) fail('UNSUPPORTED');
  keys(request.criteria, ['query', 'timeRange', 'timezone']);
  if (!boundedString(request.criteria.query) || !['any', 'full-text'].includes(request.contentRequirement)
    || typeof request.includeAttachments !== 'boolean') fail('INVALID_REQUEST');
  if (request.criteria.timezone !== undefined) {
    try { new Intl.DateTimeFormat('en', { timeZone: request.criteria.timezone }); } catch { fail('INVALID_REQUEST'); }
  }
  if (request.criteria.timeRange) {
    keys(request.criteria.timeRange, ['from', 'toExclusive']);
    if (!request.criteria.timezone) fail('INVALID_REQUEST');
    const { from, toExclusive } = request.criteria.timeRange;
    if (![from, toExclusive].every(x => boundedString(x, 64) && Number.isFinite(Date.parse(x))
      && (/^\d{4}-\d{2}-\d{2}$/.test(x) || /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(x)))
      || Date.parse(from) >= Date.parse(toExclusive)) fail('INVALID_REQUEST');
  }
  keys(request.budget || {}, ['maxScannedItems', 'maxReturnedItems', 'timeoutMs', 'maxDownloadedBytes']);
  const defaults = { maxScannedItems: 200, maxReturnedItems: 20, timeoutMs: 120000, maxDownloadedBytes: 100 * 1024 * 1024 };
  const budget = { ...defaults, ...request.budget };
  for (const [key, value] of Object.entries(budget)) if (!Number.isSafeInteger(value) || value < (key === 'maxDownloadedBytes' ? 0 : 1)) fail('INVALID_REQUEST');
  budget.maxScannedItems = Math.min(budget.maxScannedItems, 10000);
  budget.maxReturnedItems = Math.min(budget.maxReturnedItems, 10000);
  budget.maxDownloadedBytes = Math.min(budget.maxDownloadedBytes, defaults.maxDownloadedBytes);
  if (request.operation === 'materialize') {
    if (!Array.isArray(request.candidateRefs) || !request.candidateRefs.length || request.candidateRefs.length > 10000) fail('INVALID_REQUEST');
    for (const ref of request.candidateRefs) { keys(ref, ['skillItemId', 'revision']); if (![ref.skillItemId, ref.revision].every(s => boundedString(s, 256) && s)) fail('INVALID_REQUEST'); }
    if (new Set(request.candidateRefs.map(r => r.skillItemId)).size !== request.candidateRefs.length) fail('INVALID_REQUEST');
  } else if (request.candidateRefs !== undefined) fail('INVALID_REQUEST');
  return budget;
}
function normalized(row, binding, criteria) {
  const messageId = row?.emailId || row?.messageId;
  if (!boundedString(messageId, 4096) || !messageId || messageId.startsWith('-')) fail('INVALID_RESPONSE');
  const full = row.contentGranularity === 'full-text' && typeof row.body === 'string' && row.bodyTruncated !== true;
  const skillItemId = hash([binding.ref, binding.kind, binding.accountId || 'iwhalecloud', messageId]);
  const attachments = (row.attachments || []).map(a => ({ attachmentId: a.attachmentId, name: a.name || a.filename || '',
    size: a.size, contentType: a.contentType || '', kind: a.kind || 'FileAttachment', inline: a.inline === true, status: 'not-requested' }));
  return { skillItemId, revision: hash([binding.revision, messageId, row.subject || row.title || '', row.date || row.receivedAt || '',
    full ? row.body : null, attachments.map(a => [a.attachmentId, a.name, a.size, a.contentType, a.kind, a.inline])]),
    messageId, title: row.subject || row.title || '', sourceUrl: row.url || `mail://${encodeURIComponent(binding.ref)}/${encodeURIComponent(messageId)}`,
    from: row.fromEmail || row.sender || '', date: row.date || row.receivedAt || '', ...(full ? { body: row.body } : {}),
    contentGranularity: full ? 'full-text' : 'metadata', bodyStatus: full ? 'complete' : 'not-read', attachments,
    accountContextRef: binding.ref, bindingRevision: binding.revision, criteriaFingerprint: criteriaKey(criteria), identityVerified: false,
    provider: binding.kind === 'browser' ? 'iwhalecloud' : 'projected-mail', backend: binding.kind === 'browser' ? 'bycli' : 'mailctl' };
}
function inTimeRange(item, criteria) {
  if (!criteria.timeRange) return true;
  const date = new Date(item.date);
  if (!Number.isFinite(date.getTime())) fail('INVALID_RESPONSE');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: criteria.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = type => parts.find(p => p.type === type).value;
  const local = `${get('year')}-${get('month')}-${get('day')}`;
  const compare = boundary => /^\d{4}-\d{2}-\d{2}$/.test(boundary) ? local.localeCompare(boundary) : date.getTime() - Date.parse(boundary);
  return compare(criteria.timeRange.from) >= 0 && compare(criteria.timeRange.toExclusive) < 0;
}
// Every whitespace token (or double-quoted phrase) must occur, case-insensitively.
// No stemming, semantic rewrite, provider query syntax or external-link following.
function matches(item, query) {
  const terms = [...query.matchAll(/"([^"]+)"|(\S+)/g)].map(m => (m[1] || m[2]).toLowerCase());
  const text = [item.title, item.from, item.body || ''].join('\n').toLowerCase();
  return terms.every(term => text.includes(term));
}
const within = (root, path) => { const r = relative(root, path); return r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r); };
async function safeDirectory(path) {
  if (!isAbsolute(path) || resolve(path) !== path) fail('INVALID_REQUEST');
  for (let p = path; ; p = dirname(p)) {
    const stat = await lstat(p);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('INVALID_REQUEST');
    if (p === dirname(p)) break;
  }
  return realpath(path);
}
async function fileBytes(root, controlRoot = true) {
  let bytes = 0;
  for (const name of await readdir(root)) {
    if (controlRoot && (name === '.collection-receipts.json' || name === '.collection.lock')) continue;
    const path = join(root, name), stat = await lstat(path);
    if (stat.isSymbolicLink()) fail('INVALID_RESPONSE');
    if (stat.isDirectory()) bytes += await fileBytes(path, false);
    else if (stat.isFile() && stat.nlink === 1) bytes += stat.size;
    else fail('INVALID_RESPONSE');
  }
  return bytes;
}
async function downloadStore(context) {
  if (!context.sessionDir || !context.downloadRoot || context.sessionDir === context.downloadRoot
    || !within(context.sessionDir, context.downloadRoot)) fail('INVALID_REQUEST');
  await safeDirectory(context.sessionDir);
  // Only a direct child may be created: never traverse an untrusted intermediate symlink.
  if (dirname(context.downloadRoot) !== context.sessionDir) await safeDirectory(dirname(context.downloadRoot));
  await mkdir(context.downloadRoot, { mode: 0o700 }).catch(e => { if (e.code !== 'EEXIST') throw e; });
  await safeDirectory(context.downloadRoot);
  const stat = await lstat(context.downloadRoot);
  if ((stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) fail('INVALID_REQUEST');
  const lock = join(context.downloadRoot, '.collection.lock');
  try { await mkdir(lock, { mode: 0o700 }); } catch { fail('DOWNLOAD_BUSY'); }
  try {
    const receiptPath = join(context.downloadRoot, '.collection-receipts.json');
    let receipts = {};
    try {
      const receiptStat = await lstat(receiptPath);
      if (!receiptStat.isFile() || receiptStat.isSymbolicLink() || receiptStat.nlink !== 1 || receiptStat.size > 1024 * 1024) fail('INVALID_RESPONSE');
      receipts = JSON.parse(await readFile(receiptPath, 'utf8'));
      if (!receipts || typeof receipts !== 'object' || Array.isArray(receipts)) fail('INVALID_RESPONSE');
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return { receipts, bytes: await fileBytes(context.downloadRoot),
      save: async () => { const temp = join(lock, 'receipt'); await writeFile(temp, JSON.stringify(receipts), { mode: 0o600 }); await rename(temp, receiptPath); },
      close: () => rm(lock, { recursive: true, force: true }) };
  } catch (e) { await rm(lock, { recursive: true, force: true }); throw e; }
}
async function checkedFile(root, item, expectedSize) {
  if (!item || typeof item.path !== 'string' || !within(root, item.path) || item.path === root) fail('INVALID_RESPONSE');
  if (relative(root, item.path).split(sep).some(part => part.startsWith('.'))) fail('INVALID_RESPONSE');
  await safeDirectory(dirname(item.path));
  const stat = await lstat(item.path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== item.size || stat.size !== expectedSize) fail('INVALID_RESPONSE');
  return { path: item.path, size: stat.size, sha256: createHash('sha256').update(await readFile(item.path)).digest('hex') };
}
async function runMail(request, binding, options) {
  if (binding.kind === 'browser') {
    return browserExecute(request, { roots: [options.sessionDir], maxSessionBytes: options.maxDownloadedBytes,
      run: (bin, args, limits = {}) => runProcess(bin, args, { ...limits, timeoutMs: Math.max(1, Math.min(limits.timeoutMs || Infinity, options.deadline - Date.now())) }) });
  }
  const operation = { list: 'list', read: 'get', download: 'attachment' }[request.operation];
  const args = [fileURLToPath(new URL('./mailctl.py', import.meta.url)), operation, '--account', binding.accountId];
  if (operation === 'list') args.push('--limit', String(request.limit), ...(request.cursor ? ['--cursor', request.cursor] : []));
  else args.push('--message', request.message);
  if (operation === 'attachment') {
    const dest = join(request.sessionDir, 'mail-attachments');
    await mkdir(dest, { mode: 0o700 }).catch(e => { if (e.code !== 'EEXIST') throw e; });
    await safeDirectory(dest);
    args.push('--attachment', request.attachment, '--output-dir', dest);
    if (within('/by/.sessions', options.sessionDir)) args.push('--collection-session-dir', options.sessionDir);
  }
  const result = await runProcess('python3', args, { timeoutMs: options.timeoutMs, ...(operation === 'attachment' ? {
    monitor: async () => { if (await fileBytes(request.sessionDir) > options.maxDownloadedBytes) fail('DOWNLOAD_LIMIT'); },
  } : {}) });
  if (result.failure) fail(result.failure);
  let envelope;
  try { envelope = JSON.parse(result.stdout); } catch { fail('INVALID_RESPONSE'); }
  if (result.code !== 0 || !envelope.ok) fail(safeError(envelope.error).code);
  const data = envelope.data;
  if (operation === 'list') return { items: data.items, coverage: { endObserved: data.nextCursor === null, nextCursor: data.nextCursor } };
  if (operation === 'get') return { items: [{ ...data, body: typeof data.text === 'string' ? data.text : data.html,
    contentGranularity: typeof data.text === 'string' || typeof data.html === 'string' ? 'full-text' : 'metadata' }] };
  return { items: [data] };
}

export async function execute(request, context, deps = {}) {
  const started = Date.now();
  const out = { schemaVersion: 1, channel: 'mail', sourceSkill: 'mail', operation: request?.operation,
    status: 'failed', items: [], coverage: { mode: 'bounded-local-scan', scope: 'inbox', scannedCount: 0, matchedCount: 0, complete: false, stopReason: null },
    continuation: null, errors: [], usage: { scannedItems: 0, returnedItems: 0, downloadedBytes: 0, totalDownloadedBytes: 0, elapsedMs: 0 } };
  let store;
  try {
    const budget = validate(request), binding = bindingFor(context, request.selector);
    const deadline = Math.min(started + budget.timeoutMs, context.deadlineAt ? Date.parse(context.deadlineAt) : Infinity);
    if (!Number.isFinite(deadline)) fail('INVALID_REQUEST');
    const checkTime = () => { if (Date.now() >= deadline) fail('DEADLINE_EXCEEDED'); };
    checkTime();
    const call = async r => {
      checkTime();
      const result = await (deps.runMail || runMail)(r, binding, { timeoutMs: deadline - Date.now(), deadline,
        maxDownloadedBytes: budget.maxDownloadedBytes, sessionDir: context.sessionDir });
      if (result?.ok === false) fail(safeError(result.error).code);
      if (!Array.isArray(result?.items)) fail('INVALID_RESPONSE');
      return result;
    };
    const read = async message => {
      const result = await call({ operation: 'read', message, ...(binding.kind === 'browser' ? { bodyType: 'text' } : {}) });
      if (result.items.length !== 1) fail('INVALID_RESPONSE');
      const item = normalized(result.items[0], binding, request.criteria);
      if (item.messageId !== message || item.contentGranularity !== 'full-text') fail('INVALID_RESPONSE');
      return item;
    };
    if (request.operation === 'discover') {
      const seen = new Set();
      let offset = 0, cursor;
      while (out.usage.scannedItems < budget.maxScannedItems && out.items.length < budget.maxReturnedItems) {
        const limit = Math.min(100, budget.maxScannedItems - out.usage.scannedItems);
        const page = await call({ operation: 'list', limit, ...(binding.kind === 'browser' ? { offset } : cursor ? { cursor } : {}) });
        if (page.items.length > limit) fail('INVALID_RESPONSE');
        let processed = 0;
        for (const row of page.items) {
          checkTime(); out.usage.scannedItems++; processed++;
          let summary;
          try {
            summary = normalized({ ...row, body: undefined, contentGranularity: 'metadata' }, binding, request.criteria);
            if (seen.has(summary.messageId)) fail('MAILBOX_CHANGED');
            seen.add(summary.messageId);
            if (!inTimeRange(summary, request.criteria)) continue;
            // Query matching includes body, so each in-scope candidate requires a full read.
            const item = await read(summary.messageId);
            if (matches(item, request.criteria.query)) out.items.push(item);
          } catch (error) {
            const e = safeError(error); out.errors.push(e);
            if (summary && e.code !== 'MAILBOX_CHANGED' && inTimeRange(summary, request.criteria) && matches(summary, request.criteria.query)) {
              out.items.push({ ...summary, bodyStatus: 'failed' });
            }
            if (terminal(e.code)) throw error;
          }
          if (out.items.length >= budget.maxReturnedItems) break;
        }
        if (processed === page.items.length && page.coverage?.endObserved === true) { out.coverage.complete = true; out.coverage.stopReason = 'END_OBSERVED'; break; }
        if (!page.items.length) fail('INVALID_RESPONSE');
        offset += page.items.length;
        if (binding.kind === 'projected') {
          if (!boundedString(page.coverage?.nextCursor) || !page.coverage.nextCursor || cursor === page.coverage.nextCursor) fail('INVALID_RESPONSE');
          cursor = page.coverage.nextCursor;
        }
      }
      out.coverage.stopReason ||= out.items.length >= budget.maxReturnedItems ? 'RETURN_BUDGET_EXHAUSTED' : 'SCAN_BUDGET_EXHAUSTED';
    } else {
      out.coverage.mode = 'registered-candidates';
      const candidates = request.candidateRefs.map(ref => {
        const matches = (context.candidates || []).filter(c => c.skillItemId === ref.skillItemId && c.revision === ref.revision);
        const c = matches[0];
        if (matches.length !== 1 || c.accountContextRef !== binding.ref || c.bindingRevision !== binding.revision
          || c.criteriaFingerprint !== criteriaKey(request.criteria)
          || hash([binding.ref, binding.kind, binding.accountId || 'iwhalecloud', c.messageId]) !== c.skillItemId) fail('CANDIDATE_BINDING_MISMATCH');
        return c;
      });
      if (request.includeAttachments) { store = await downloadStore(context); out.usage.totalDownloadedBytes = store.bytes; }
      for (const candidate of candidates) {
        if (out.usage.scannedItems >= budget.maxScannedItems || out.items.length >= budget.maxReturnedItems) break;
        checkTime(); out.usage.scannedItems++;
        let item;
        try { item = await read(candidate.messageId); } catch (e) {
          out.errors.push(safeError(e, { skillItemId: candidate.skillItemId }));
          if (terminal(e.code)) throw e;
          continue;
        }
        out.items.push(item);
        if (store) for (const attachment of item.attachments) {
          try {
            if (attachment.inline || attachment.kind !== 'FileAttachment' || !['.pdf', '.txt', '.md', '.csv', '.json', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'].includes(extname(attachment.name).toLowerCase())) fail('UNSUPPORTED');
            if (!boundedString(attachment.attachmentId, 4096) || !attachment.attachmentId || attachment.attachmentId.startsWith('-') || !Number.isSafeInteger(attachment.size) || attachment.size < 0) fail('INVALID_RESPONSE');
            const key = hash([binding.ref, binding.revision, item.messageId, attachment.attachmentId]);
            const cached = store.receipts[key];
            if (cached) {
              const checked = await checkedFile(context.downloadRoot, cached, attachment.size);
              if (checked.sha256 !== cached.sha256) fail('INVALID_RESPONSE');
              Object.assign(attachment, checked, { status: 'complete', reused: true }); continue;
            }
            store.bytes = await fileBytes(context.downloadRoot);
            if (attachment.size > 25 * 1024 * 1024 || store.bytes + attachment.size > budget.maxDownloadedBytes) fail('DOWNLOAD_LIMIT');
            const result = await call({ operation: 'download', message: item.messageId, attachment: attachment.attachmentId, sessionDir: context.downloadRoot });
            if (result.items.length !== 1) fail('INVALID_RESPONSE');
            const checked = await checkedFile(context.downloadRoot, result.items[0], attachment.size);
            store.bytes = await fileBytes(context.downloadRoot);
            if (store.bytes > budget.maxDownloadedBytes) fail('DOWNLOAD_LIMIT');
            store.receipts[key] = checked; await store.save();
            Object.assign(attachment, checked, { status: 'complete', reused: false });
            out.usage.downloadedBytes += checked.size;
          } catch (error) {
            attachment.status = 'failed'; attachment.error = safeError(error);
            out.errors.push(safeError(error, { skillItemId: item.skillItemId, attachmentId: attachment.attachmentId }));
            if (terminal(error.code)) throw error;
          }
          finally { out.usage.totalDownloadedBytes = await fileBytes(context.downloadRoot); }
        }
      }
      out.coverage.complete = out.usage.scannedItems === candidates.length;
      out.coverage.stopReason = out.coverage.complete ? 'END_OBSERVED' : 'SCAN_BUDGET_EXHAUSTED';
    }
    if (out.errors.length) out.coverage.complete = false;
    out.status = out.errors.some(e => actionCodes.has(e.code)) && !out.items.length ? 'needs-user-action'
      : out.coverage.complete ? 'complete' : out.items.length || !out.errors.length ? 'partial' : 'failed';
  } catch (error) {
    const e = safeError(error);
    if (!out.errors.some(x => x.code === e.code)) out.errors.push(e);
    out.coverage.complete = false; out.coverage.stopReason = e.code;
    out.status = out.items.length ? 'partial' : actionCodes.has(e.code) ? 'needs-user-action' : 'failed';
  } finally {
    if (store) await store.close();
    out.coverage.scannedCount = out.usage.scannedItems; out.coverage.matchedCount = out.items.length;
    out.usage.returnedItems = out.items.length; out.usage.elapsedMs = Date.now() - started;
  }
  return out;
}
