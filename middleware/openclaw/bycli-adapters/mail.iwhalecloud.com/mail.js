import { openSync, fstatSync, readSync, closeSync, constants } from 'node:fs';
import { cli, Strategy } from '@sovovs/bycli/registry';
import { ArgumentError } from '@sovovs/bycli/errors';

const SITE = 'mail-iwhalecloud';
const OWA_ORIGIN = 'https://mail.iwhalecloud.com';
const OWA_HOME = 'https://mail.iwhalecloud.com/owa/';
const OWA_SERVICE = 'https://mail.iwhalecloud.com/owa/service.svc';
const MAX_INPUT = 1024 * 1024;

function loadRequest(path) {
  let fd;
  try {
    if (typeof path !== 'string' || !path.startsWith('/') || path.length > 4096) throw new Error();
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.uid !== process.geteuid()
        || stat.size < 2 || stat.size > MAX_INPUT) throw new Error();
    const raw = Buffer.alloc(stat.size); let offset = 0;
    while (offset < raw.length) {
      const count = readSync(fd, raw, offset, raw.length - offset, null);
      if (count <= 0) throw new Error();
      offset += count;
    }
    const value = JSON.parse(raw.toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1 || typeof value.accountId !== 'string') {
    throw new Error('INVALID_REQUEST');
  }
  const forbidden = /cookie|canary|token|credential|password|authorization|secret|session|auth/;
  let visited = 0;
  const inspect = (node, depth = 0) => {
    if (depth > 16 || ++visited > 2000) throw new Error('INVALID_REQUEST');
    if (typeof node === 'string' && new TextEncoder().encode(node).byteLength > 256 * 1024) throw new Error('INVALID_REQUEST');
    if (Array.isArray(node)) {
      if (node.length > 500) throw new Error('INVALID_REQUEST');
      node.forEach((entry) => inspect(entry, depth + 1));
    } else if (node && typeof node === 'object') {
      const entries = Object.entries(node);
      if (entries.length > 200) throw new Error('INVALID_REQUEST');
      for (const [key, entry] of entries) {
        const canonical = key.normalize('NFKC');
        if (/[^\x20-\x7e]/.test(canonical)) throw new Error('INVALID_REQUEST');
        const normalized = canonical.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!normalized || normalized.length > 256 || forbidden.test(normalized)) throw new Error('INVALID_REQUEST');
        inspect(entry, depth + 1);
      }
    }
  };
    inspect(value);
    return value;
  } catch {
    throw new ArgumentError('Invalid managed mail request');
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); }
      catch { throw new ArgumentError('Invalid managed mail request'); }
    }
  }
}

async function invokeOwa(page, operation, request) {
  const program = `(${owaCall.toString()})(${JSON.stringify(operation)},${JSON.stringify(request)})`;
  try {
    return await page.evaluate(program);
  } catch (error) {
    const message = typeof error?.message === 'string' ? error.message : '';
    const stable = new Set(['AUTH_REQUIRED', 'AUTH_EXPIRED', 'INVALID_REQUEST', 'PERMISSION_DENIED',
      'MESSAGE_NOT_FOUND', 'ATTACHMENT_NOT_FOUND', 'RATE_LIMITED', 'UPSTREAM_UNAVAILABLE', 'UNSUPPORTED']);
    const code = stable.has(message) ? message : 'UPSTREAM_UNAVAILABLE';
    const envelope = { error: { code, retryable: code === 'RATE_LIMITED' || code === 'UPSTREAM_UNAVAILABLE' } };
    if (code === 'RATE_LIMITED' && Number.isSafeInteger(error?.retryAfterMs)
        && error.retryAfterMs > 0 && error.retryAfterMs <= 3600000) envelope.error.retryAfterMs = error.retryAfterMs;
    return envelope;
  }
}

async function owaCall(operation, request) {
  const ORIGIN = 'https://mail.iwhalecloud.com';
  const SERVICE = 'https://mail.iwhalecloud.com/owa/service.svc';
  if (location.origin !== ORIGIN || !location.pathname.toLowerCase().startsWith('/owa/')) throw new Error('AUTH_REQUIRED');
  const forbidden = /cookie|canary|token|credential|authorization|password/i;
  const idPattern = /^[^\u0000-\u001f\u007f]{1,2048}$/;
  if (typeof request.accountEmail !== 'string' || request.accountEmail !== request.accountEmail.trim().toLowerCase()
      || !/^[^@\s]+@[^@\s]+$/.test(request.accountEmail) || request.accountEmail.length > 320) throw new Error('INVALID_REQUEST');
  const antiCsrfEntry = document.cookie.split(';').map((entry) => entry.trim())
    .find((entry) => entry.startsWith('X-OWA-CANARY='));
  if (!antiCsrfEntry) throw new Error('AUTH_REQUIRED');
  let antiCsrf;
  try { antiCsrf = decodeURIComponent(antiCsrfEntry.slice('X-OWA-CANARY='.length)); }
  catch { throw new Error('AUTH_REQUIRED'); }
  if (!antiCsrf || antiCsrf.length > 4096 || /[\u0000-\u001f\u007f]/.test(antiCsrf)) throw new Error('AUTH_REQUIRED');
  const encodeCursor = (value) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `owac1.${btoa(binary).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}`;
  };
  const decodeCursor = (value) => {
    if (typeof value !== 'string' || !value.startsWith('owac1.') || value.length > 8192) throw new Error('INVALID_REQUEST');
    const raw = value.slice('owac1.'.length).replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(raw + '='.repeat((4 - raw.length % 4) % 4)), (c) => c.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || parsed.v !== 1 || parsed.a !== request.accountId) throw new Error('INVALID_REQUEST');
    return parsed;
  };
  const rawMessage = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || !idPattern.test(value.id || '') || !idPattern.test(value.changeKey || '')
        || Object.keys(value).some((key) => !['id', 'changeKey'].includes(key))) throw new Error('INVALID_REQUEST');
    return { i: value.id, c: value.changeKey };
  };
  const headers = {
    __type: 'JsonRequestHeaders:#Exchange',
    RequestServerVersion: 'Exchange2013',
  };
  const folder = { inbox: 'inbox', sent: 'sentitems', drafts: 'drafts', trash: 'deleteditems' };
  const distinguished = (id) => ({ __type: 'DistinguishedFolderId:#Exchange', Id: id,
    Mailbox: { __type: 'EmailAddressWrapper:#Exchange', EmailAddress: request.accountEmail } });
  let action;
  let body;
  let downloadContext = null;
  if (operation === 'probe') {
    action = null;
    body = null;
  } else if (operation === 'list' || operation === 'search') {
    action = 'FindItem';
    const cursor = request.cursor ? decodeCursor(request.cursor) : null;
    const offset = cursor ? cursor.o : 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) throw new Error('INVALID_REQUEST');
    if (cursor && ((operation === 'list' && cursor.f !== request.folder) || (operation === 'search' && cursor.q !== request.query))) throw new Error('INVALID_REQUEST');
    body = {
      __type: 'FindItemRequest:#Exchange',
      ItemShape: { __type: 'ItemResponseShape:#Exchange', BaseShape: 'IdOnly', AdditionalProperties: [
        { __type: 'PropertyUri:#Exchange', FieldURI: 'item:Subject' },
        { __type: 'PropertyUri:#Exchange', FieldURI: 'item:DateTimeReceived' },
        { __type: 'PropertyUri:#Exchange', FieldURI: 'message:From' },
        { __type: 'PropertyUri:#Exchange', FieldURI: 'item:HasAttachments' },
        { __type: 'PropertyUri:#Exchange', FieldURI: 'item:Preview' },
      ] },
      Paging: { __type: 'IndexedPageView:#Exchange', MaxEntriesReturned: request.limit, Offset: offset, BasePoint: 'Beginning' },
      ParentFolderIds: [distinguished(operation === 'list' ? folder[request.folder] : 'msgfolderroot')],
      Traversal: 'Shallow',
    };
    if (operation === 'search') body.QueryString = request.query;
  } else if (operation === 'get') {
    action = 'GetItem'; const loc = rawMessage(request.messageId);
    body = { __type: 'GetItemRequest:#Exchange', ItemShape: { __type: 'ItemResponseShape:#Exchange', BaseShape: 'AllProperties', BodyType: 'Best' },
      ItemIds: [{ __type: 'ItemId:#Exchange', Id: loc.i, ChangeKey: loc.c }] };
  } else if (operation === 'downloadAttachment') {
    action = 'GetAttachment'; const message = rawMessage(request.messageId); const attachment = request.attachmentId;
    if (!idPattern.test(attachment || '')) throw new Error('INVALID_REQUEST');
    downloadContext = { message, attachment };
    body = { __type: 'GetAttachmentRequest:#Exchange', AttachmentIds: [{ __type: 'AttachmentId:#Exchange', Id: attachment }] };
  } else if (operation === 'send') {
    action = 'CreateItem';
    body = { __type: 'CreateItemRequest:#Exchange', MessageDisposition: 'SaveOnly', SavedItemFolderId: { __type: 'TargetFolderId:#Exchange',
      BaseFolderId: distinguished('drafts') }, Items: [messageFromDraft(request.draft)] };
  } else if (operation === 'reply') {
    action = 'CreateItem'; const loc = rawMessage(request.messageId); const draft = request.draft || {};
    body = { __type: 'CreateItemRequest:#Exchange', MessageDisposition: 'SaveOnly', SavedItemFolderId: { __type: 'TargetFolderId:#Exchange',
      BaseFolderId: distinguished('drafts') }, Items: [{ __type: 'ReplyToItem:#Exchange',
      ReferenceItemId: { __type: 'ItemId:#Exchange', Id: loc.i, ChangeKey: loc.c },
      NewBodyContent: { __type: 'BodyContentType:#Exchange', BodyType: draft.html != null ? 'HTML' : 'Text', Value: draft.html ?? draft.text ?? '' } }] };
  } else if (operation === 'delete') {
    action = 'MoveItem'; const loc = rawMessage(request.messageId);
    body = { __type: 'MoveItemRequest:#Exchange', ToFolderId: { __type: 'TargetFolderId:#Exchange', BaseFolderId: distinguished('deleteditems') },
      ItemIds: [{ __type: 'ItemId:#Exchange', Id: loc.i, ChangeKey: loc.c }] };
  } else throw new Error('UNSUPPORTED');

  function messageFromDraft(draft = {}) {
    const recipients = (values) => (Array.isArray(values) ? values : []).map((address) => ({ __type: 'EmailAddressWrapper:#Exchange', EmailAddress: address }));
    return { __type: 'Message:#Exchange', Subject: draft.subject || '', Body: { __type: 'BodyContentType:#Exchange', BodyType: draft.html != null ? 'HTML' : 'Text', Value: draft.html ?? draft.text ?? '' },
      ToRecipients: recipients(draft.to), CcRecipients: recipients(draft.cc), BccRecipients: recipients(draft.bcc) };
  }
  const callService = async (serviceAction, serviceBody) => {
    const packet = { __type: `${serviceAction}JsonRequest:#Exchange`, Header: headers, Body: serviceBody };
    const response = await fetch(`${SERVICE}?action=${serviceAction}&app=Mail`, {
      method: 'POST', credentials: 'include', redirect: 'error',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Action: serviceAction, 'X-OWA-CANARY': antiCsrf,
        'X-OWA-UrlPostData': JSON.stringify(packet) }, body: JSON.stringify(packet),
    });
    let text;
    if (response.body?.getReader) {
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let size = 0; const parts = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 10 * 1024 * 1024) { await reader.cancel(); throw new Error('UPSTREAM_UNAVAILABLE'); }
        parts.push(decoder.decode(value, { stream: true }));
      }
      parts.push(decoder.decode()); text = parts.join('');
    } else {
      text = await response.text();
      if (new TextEncoder().encode(text).byteLength > 10 * 1024 * 1024) throw new Error('UPSTREAM_UNAVAILABLE');
    }
    if (response.status === 401 || response.status === 440) throw new Error('AUTH_REQUIRED');
    if (!response.ok) throw new Error('UPSTREAM_UNAVAILABLE');
    const value = JSON.parse(text); const messages = value?.Body?.ResponseMessages?.Items;
    if (!Array.isArray(messages) || messages.length !== 1) throw new Error('UPSTREAM_UNAVAILABLE');
    const serviceResult = messages[0];
    if (serviceResult?.__type !== `${serviceAction}ResponseMessage:#Exchange`) throw new Error('UPSTREAM_UNAVAILABLE');
    if (serviceResult.ResponseClass !== 'Success' || serviceResult.ResponseCode !== 'NoError') {
      const code = serviceResult.ResponseCode;
      if (['ErrorInvalidCredentials', 'ErrorNonPrimarySmtpAddress'].includes(code)) throw new Error('AUTH_REQUIRED');
      if (code === 'ErrorPasswordExpired') throw new Error('AUTH_EXPIRED');
      if (code === 'ErrorAccessDenied') throw new Error('PERMISSION_DENIED');
      if (code === 'ErrorServerBusy') {
        const error = new Error('RATE_LIMITED');
        if (Number.isSafeInteger(serviceResult.BackOffMilliseconds)) error.retryAfterMs = serviceResult.BackOffMilliseconds;
        throw error;
      }
      if (code === 'ErrorInvalidIdMalformed') throw new Error('INVALID_REQUEST');
      if (code === 'ErrorItemNotFound') throw new Error(serviceAction === 'GetAttachment' ? 'ATTACHMENT_NOT_FOUND' : 'MESSAGE_NOT_FOUND');
      if (code === 'ErrorAttachmentNotFound') throw new Error('ATTACHMENT_NOT_FOUND');
      throw new Error('UPSTREAM_UNAVAILABLE');
    }
    return serviceResult;
  };
  await callService('GetFolder', { __type: 'GetFolderRequest:#Exchange',
    FolderShape: { __type: 'FolderResponseShape:#Exchange', BaseShape: 'IdOnly' }, FolderIds: [distinguished('msgfolderroot')] });
  if (operation === 'probe') return {};
  if (downloadContext) {
    const current = await callService('GetItem', { __type: 'GetItemRequest:#Exchange',
      ItemShape: { __type: 'ItemResponseShape:#Exchange', BaseShape: 'IdOnly', AdditionalProperties: [
        { __type: 'PropertyUri:#Exchange', FieldURI: 'item:Attachments' }] },
      ItemIds: [{ __type: 'ItemId:#Exchange', Id: downloadContext.message.i, ChangeKey: downloadContext.message.c }] });
    const currentItems = current.Items || [];
    const currentAttachments = currentItems[0]?.Attachments || [];
    if (currentItems.length !== 1 || !Array.isArray(currentAttachments) || currentAttachments.length > 100
        || !currentAttachments.some((item) => item?.AttachmentId?.Id === downloadContext.attachment)) throw new Error('ATTACHMENT_NOT_FOUND');
  }
  const result = await callService(action, body);
  const items = result.RootFolder?.Items || result.Items || [];
  const itemId = (item) => item?.ItemId || item?.ReferenceItemId || {};
  const mailbox = (value) => value?.Mailbox?.EmailAddress || value?.EmailAddress || null;
  const locator = (item) => { const id = itemId(item); if (!idPattern.test(id.Id || '') || !idPattern.test(id.ChangeKey || '')) throw new Error('UPSTREAM_UNAVAILABLE'); return { id: id.Id, changeKey: id.ChangeKey }; };
  let mutationReceipt = null;
  if (operation === 'send' || operation === 'reply') {
    if (items.length !== 1) throw new Error('UPSTREAM_UNAVAILABLE');
    const draftId = itemId(items[0]);
    await callService('SendItem', { __type: 'SendItemRequest:#Exchange', SaveItemToFolder: true,
      ItemIds: [{ __type: 'ItemId:#Exchange', Id: draftId.Id, ChangeKey: draftId.ChangeKey }],
      SavedItemFolderId: { __type: 'TargetFolderId:#Exchange', BaseFolderId: distinguished('sentitems') } });
    mutationReceipt = { id: draftId.Id, changeKey: draftId.ChangeKey };
  }
  const summary = (item) => ({ messageId: locator(item), subject: item.Subject || '', sender: mailbox(item.From), receivedAt: item.DateTimeReceived || null,
    preview: item.Preview || null, hasAttachments: item.HasAttachments === true });
  let output;
  if (operation === 'list' || operation === 'search') {
    if (!Array.isArray(items) || items.length > 100) throw new Error('UPSTREAM_UNAVAILABLE');
    const root = result.RootFolder || {}; const more = root.IncludesLastItemInRange === false;
    output = { items: items.map(summary), nextCursor: more ? encodeCursor({ v: 1, a: request.accountId, o: root.IndexedPagingOffset, ...(operation === 'list' ? { f: request.folder } : { q: request.query }) }) : null };
  } else if (operation === 'get') {
    if (items.length !== 1) throw new Error('MESSAGE_NOT_FOUND'); const item = items[0]; const id = itemId(item);
    const sourceAttachments = item.Attachments || [];
    if (!Array.isArray(sourceAttachments) || sourceAttachments.length > 100) throw new Error('UPSTREAM_UNAVAILABLE');
    const attachments = sourceAttachments.filter((x) => x && x.AttachmentId).map((x) => ({ attachmentId: x.AttachmentId.Id, filename: x.Name || 'attachment', size: x.Size || 0, contentType: x.ContentType || null }));
    output = { ...summary(item), recipients: (item.ToRecipients || []).map(mailbox).filter(Boolean), text: item.Body?.BodyType === 'HTML' ? null : item.Body?.Value || null,
      html: item.Body?.BodyType === 'HTML' ? item.Body?.Value || null : null, attachments };
  } else if (operation === 'downloadAttachment') {
    const attachments = result.Attachments || []; if (attachments.length !== 1) throw new Error('ATTACHMENT_NOT_FOUND'); const item = attachments[0];
    output = { filename: item.Name || 'attachment', contentType: item.ContentType || null, contentBase64: item.Content || '' };
  } else if (operation === 'delete') {
    if (items.length !== 1) throw new Error('UPSTREAM_UNAVAILABLE'); output = { messageId: locator(items[0]), movedTo: 'trash' };
  } else if (operation === 'send' || operation === 'reply') {
    output = { messageId: mutationReceipt };
  } else {
    if (items.length !== 1) throw new Error('UPSTREAM_UNAVAILABLE'); output = { messageId: locator(items[0]) };
  }
  const inspect = (node, depth = 0) => {
    if (depth > 8) throw new Error('UPSTREAM_UNAVAILABLE');
    if (Array.isArray(node)) return node.forEach((entry) => inspect(entry, depth + 1));
    if (node && typeof node === 'object') for (const [key, entry] of Object.entries(node)) { if (forbidden.test(key)) throw new Error('UPSTREAM_UNAVAILABLE'); inspect(entry, depth + 1); }
  };
  inspect(output); return output;
}

for (const operation of ['probe', 'list', 'get', 'search', 'downloadAttachment', 'send', 'reply', 'delete']) {
  cli({
    site: SITE,
    name: operation,
    description: `Managed iWhaleCloud OWA ${operation}`,
    access: ['send', 'reply', 'delete'].includes(operation) ? 'write' : 'read',
    strategy: Strategy.COOKIE,
    browser: true,
    domain: 'mail.iwhalecloud.com',
    navigateBefore: 'https://mail.iwhalecloud.com/owa/',
    siteSession: 'persistent',
    defaultFormat: 'json',
    args: [{ name: 'input', type: 'string', required: true, help: 'Private managed request file' }],
    columns: operation === 'list' || operation === 'search' ? ['items', 'nextCursor'] : undefined,
    func: async (page, kwargs) => invokeOwa(page, operation, loadRequest(kwargs.input)),
  });
}
