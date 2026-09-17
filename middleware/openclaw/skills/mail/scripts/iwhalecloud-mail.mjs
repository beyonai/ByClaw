#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { runProcess } from './iwhalecloud/process.mjs';
import { download } from './iwhalecloud/download.mjs';

const identity = { schemaVersion: 1, source: 'iwhalecloud-mail', sourceSkill: 'mail', backend: 'bycli' };
const operations = new Set(['check', 'list', 'read', 'download']);
const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const safeCodes = new Set(['UNSUPPORTED', 'INVALID_REQUEST', 'INVALID_RESPONSE', 'AUTH_REQUIRED',
  'MESSAGE_NOT_FOUND', 'ATTACHMENT_NOT_FOUND', 'BRIDGE_UNAVAILABLE', 'BRIDGE_RECOVERY_BUSY',
  'UPSTREAM_UNAVAILABLE', 'MAILBOX_CHANGED', 'DOWNLOAD_LIMIT', 'DOWNLOAD_BUSY', 'OUTPUT_LIMIT']);
const messages = {
  AUTH_REQUIRED: '请在浩鲸邮箱账号浏览器中登录',
  UNSUPPORTED: '当前适配器不支持此操作',
  INVALID_REQUEST: '请求参数或下载目录无效',
  INVALID_RESPONSE: '邮箱返回的数据无法验证',
  MESSAGE_NOT_FOUND: '邮件不存在或已移动',
  ATTACHMENT_NOT_FOUND: '未找到指定文件附件',
  BRIDGE_UNAVAILABLE: '浏览器桥接不可用，请停止本次调用',
  BRIDGE_RECOVERY_BUSY: '浏览器桥接正在恢复，请停止本次调用',
  UPSTREAM_UNAVAILABLE: '邮箱服务或执行器暂时不可用',
  MAILBOX_CHANGED: '分页期间邮箱发生变化，结果可能不完整',
  DOWNLOAD_LIMIT: '附件下载超过大小预算',
  DOWNLOAD_BUSY: '此会话已有附件下载任务或未清理的下载锁',
  OUTPUT_LIMIT: '返回数据超过本次读取预算',
};

function text(value, { required = false } = {}) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > 16 * 1024 * 1024 || (required && !value.trim())) fail('INVALID_RESPONSE');
  return value;
}
function argument(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192 || value.startsWith('-') || /[\x00-\x1f]/.test(value)) fail('INVALID_REQUEST');
  return value;
}
function integer(value, fallback, min, max) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) fail('INVALID_REQUEST');
  return n;
}

function validate(request) {
  if (!operations.has(request.operation)) fail('UNSUPPORTED');
  const allowed = {
    check: [], list: ['folder', 'folderId', 'limit', 'offset', 'sort', 'order'],
    read: ['message', 'bodyType'], download: ['message', 'attachment', 'sessionDir'],
  }[request.operation];
  if (Object.keys(request).some(key => key !== 'operation' && !allowed.includes(key))) fail('INVALID_REQUEST');
  const r = { ...request };
  if (['read', 'download'].includes(r.operation)) argument(r.message);
  if (r.operation === 'download') {
    argument(r.attachment);
    if (r.attachment === 'all' || !r.sessionDir) fail('INVALID_REQUEST');
  }
  if (r.operation === 'read') {
    r.bodyType ||= 'text';
    if (!['text', 'html'].includes(r.bodyType)) fail('INVALID_REQUEST');
  }
  if (r.operation === 'list') {
    r.limit = integer(r.limit, 20, 1, 10000);
    r.offset = integer(r.offset, 0, 0, 2147483647);
    r.folder ||= 'inbox'; r.sort ||= 'date'; r.order ||= 'desc';
    if (!['inbox', 'sent', 'drafts', 'trash', 'spam'].includes(r.folder)
      || !['date', 'from', 'to', 'subject', 'attachments', 'importance', 'size', 'sent', 'created', 'default'].includes(r.sort)
      || !['asc', 'desc', 'default'].includes(r.order)
      || (r.sort === 'default' && r.order !== 'default')) fail('INVALID_REQUEST');
    if (r.folderId !== undefined) argument(r.folderId);
  }
  return r;
}

function parseJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}
function commandResult(result, operation) {
  if (result.failure) fail(safeCodes.has(result.failure) ? result.failure : 'UPSTREAM_UNAVAILABLE');
  const data = parseJson(result.stdout);
  const error = data?.error || parseJson(result.stderr)?.error;
  if (result.code !== 0 || error) {
    if (error?.code === 'EMPTY_RESULT') {
      if (['check', 'list'].includes(operation)) return [];
      fail(operation === 'read' ? 'MESSAGE_NOT_FOUND' : 'ATTACHMENT_NOT_FOUND');
    }
    if (error?.code === 'AUTH_REQUIRED') fail('AUTH_REQUIRED');
    if (error?.code === 'BROWSER_CONNECT') fail('BRIDGE_UNAVAILABLE');
    // Classify a known upstream pagination error; never return its raw message.
    if (error?.code === 'COMMAND_EXEC' && /^Mailbox changed while paging;/.test(error.message || '')) fail('MAILBOX_CHANGED');
    fail('UPSTREAM_UNAVAILABLE');
  }
  if (!Array.isArray(data)) fail('INVALID_RESPONSE');
  return data;
}

function normalize(row, full) {
  if (!row || typeof row !== 'object') fail('INVALID_RESPONSE');
  const out = {};
  out.emailId = text(row.emailId, { required: true });
  for (const key of ['subject', 'fromName', 'fromEmail', 'toDisplay', 'date', 'importance']) out[key] = text(row[key]);
  out.url = `https://mail.iwhalecloud.com/owa/#path=/mail/item/${encodeURIComponent(out.emailId)}`;
  out.unread = typeof row.unread === 'boolean' ? row.unread : null;
  out.hasAttachments = row.hasAttachments === true;
  out.size = Number.isSafeInteger(row.size) && row.size >= 0 ? row.size : null;
  out.times = { sentAt: text(row.times?.sentAt), createdAt: text(row.times?.createdAt) };
  if (full) {
    if (typeof row.body !== 'string' || row.bodyTruncated === true || row.IsTruncated === true
      || !['text', 'html'].includes(String(row.bodyType).toLowerCase())) fail('INVALID_RESPONSE');
    out.body = text(row.body); out.bodyType = row.bodyType.toLowerCase();
    out.contentGranularity = 'full-text';
    for (const key of ['to', 'cc', 'bcc']) {
      if (row[key] !== undefined && !Array.isArray(row[key])) fail('INVALID_RESPONSE');
      out[key] = (row[key] || []).map(a => ({ name: text(a?.name), email: text(a?.email) }));
    }
    if (!Array.isArray(row.attachments)) fail('INVALID_RESPONSE');
    out.attachments = row.attachments.map(a => ({ attachmentId: text(a?.attachmentId, { required: true }),
      name: text(a.name), contentType: text(a.contentType), kind: text(a.kind),
      size: Number.isSafeInteger(a.size) && a.size >= 0 ? a.size : null, inline: a.inline === true }));
  }
  return out;
}

export async function execute(request, deps = {}) {
  const base = { ...identity, operation: operations.has(request?.operation) ? request.operation : 'unsupported' };
  try {
    const r = validate(request);
    const run = deps.run || runProcess;
    const bootstrap = deps.bootstrap || (async () => {
      const result = await run(process.execPath, ['/app/skills/bycli/scripts/bridge-bootstrap.mjs', '--format', 'json'], { timeoutMs: 300_000, maxOutputBytes: 1024 * 1024 });
      return result.failure ? null : parseJson(result.stdout);
    });
    const bridge = await bootstrap();
    if (bridge?.ok !== true) fail(bridge?.code === 'BRIDGE_RECOVERY_BUSY' ? bridge.code : 'BRIDGE_UNAVAILABLE');
    const call = async (operation, args, options) => commandResult(await run('bycli',
      ['iwhalecloud', operation, ...args, '-f', 'json', '--trace', 'off', '--site-session', 'persistent', '--keep-tab', 'true'], options), operation);
    let items;
    let coverage = null;
    if (r.operation === 'download') {
      items = await download(r, { ...deps, call, roots: deps.roots || ['/by/workspace', '/by/.sessions'] });
    } else {
      const args = r.operation === 'read' ? [r.message, '--body-type', r.bodyType]
        : r.operation === 'check' ? ['--limit', '1']
          : ['--limit', String(r.limit), '--offset', String(r.offset), '--folder', r.folder, '--sort', r.sort, '--order', r.order,
            ...(r.folderId ? ['--folder-id', r.folderId] : [])];
      const rows = await call(r.operation === 'read' ? 'read' : 'list', args);
      if (r.operation === 'read' && (rows.length !== 1 || rows[0]?.emailId !== r.message)) fail('INVALID_RESPONSE');
      if (r.operation !== 'read' && rows.length > (r.operation === 'check' ? 1 : r.limit)) fail('INVALID_RESPONSE');
      items = rows.map(row => normalize(row, r.operation === 'read'));
      if (new Set(items.map(i => i.emailId)).size !== items.length) fail('INVALID_RESPONSE');
      if (r.operation === 'check') items = []; // Connection checks do not expose mail metadata.
      if (r.operation === 'list') coverage = { complete: false, returnedCount: items.length, offset: r.offset,
        nextOffset: items.length === r.limit ? r.offset + items.length : null,
        endObserved: items.length < r.limit, snapshotConsistent: false };
    }
    return { ...base, ok: true, status: 'complete', identityVerified: false, items, coverage };
  } catch (error) {
    const code = safeCodes.has(error?.code) ? error.code : 'UPSTREAM_UNAVAILABLE';
    return { ...base, ok: false, status: 'failed', items: [], coverage: null,
      error: { code, message: messages[code], retryable: ['UPSTREAM_UNAVAILABLE', 'DOWNLOAD_BUSY'].includes(code) } };
  }
}

export function parseArgs(argv) {
  const request = { operation: argv[0] };
  const names = { '--message': 'message', '--attachment': 'attachment', '--session-dir': 'sessionDir',
    '--body-type': 'bodyType', '--folder': 'folder', '--folder-id': 'folderId', '--limit': 'limit',
    '--offset': 'offset', '--sort': 'sort', '--order': 'order' };
  for (let i = 1; i < argv.length; i += 2) {
    const key = names[argv[i]];
    if (!key || key in request || argv[i + 1] === undefined) fail('INVALID_REQUEST');
    request[key] = argv[i + 1];
  }
  return request;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  let result;
  try { result = await execute(parseArgs(process.argv.slice(2))); }
  catch { result = { ...identity, ok: false, status: 'failed', items: [], error: { code: 'INVALID_REQUEST', message: messages.INVALID_REQUEST, retryable: false } }; }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
