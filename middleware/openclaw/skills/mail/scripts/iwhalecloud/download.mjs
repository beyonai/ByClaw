import { lstat, mkdir, mkdtemp, readdir, realpath, link, rm, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const within = (root, path) => { const r = relative(root, path); return !r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r); };

async function safeDirectory(path) {
  const parts = [];
  for (let p = path; ; p = dirname(p)) {
    parts.push(p);
    if (p === dirname(p)) break;
  }
  for (const part of parts.reverse()) {
    const stat = await lstat(part);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('INVALID_REQUEST');
  }
  return realpath(path);
}

async function directoryBytes(path) {
  let total = 0;
  for (const name of await readdir(path)) {
    const stat = await lstat(join(path, name));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail('INVALID_RESPONSE');
    total += stat.size;
  }
  return total;
}

export async function download(request, { call, roots, maxFileBytes = 25 * 1024 * 1024, maxSessionBytes = 100 * 1024 * 1024 }) {
  const session = request.sessionDir;
  if (typeof session !== 'string' || !isAbsolute(session) || resolve(session) !== session
    || !roots.some(root => within(root, session))) fail('INVALID_REQUEST');
  await safeDirectory(session);
  const sessionStat = await lstat(session);
  if ((sessionStat.mode & 0o077) !== 0 || (process.getuid && sessionStat.uid !== process.getuid())) fail('INVALID_REQUEST');
  const dest = join(session, 'mail-attachments');
  await mkdir(dest, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  await safeDirectory(dest);
  const destStat = await lstat(dest);
  if ((destStat.mode & 0o077) !== 0 || (process.getuid && destStat.uid !== process.getuid())) fail('INVALID_REQUEST');
  const lock = join(session, '.mail-download.lock');
  try { await mkdir(lock, { mode: 0o700 }); } catch { fail('DOWNLOAD_BUSY'); }
  let staging;
  try {
    const used = await directoryBytes(dest);
    const items = await call('read', [request.message]);
    const item = items[0];
    if (items.length !== 1 || item?.emailId !== request.message || !Array.isArray(item.attachments)) fail('INVALID_RESPONSE');
    const matches = item.attachments.filter(a => a.attachmentId === request.attachment);
    if (!matches.length) fail('ATTACHMENT_NOT_FOUND');
    if (matches.length !== 1) fail('INVALID_RESPONSE');
    const attachment = matches[0];
    if (attachment.kind !== 'FileAttachment') fail('UNSUPPORTED');
    if (!Number.isSafeInteger(attachment.size) || attachment.size < 0) fail('INVALID_RESPONSE');
    if (attachment.size > maxFileBytes || used + attachment.size > maxSessionBytes) fail('DOWNLOAD_LIMIT');
    staging = await mkdtemp(join(session, '.mail-download-'));
    const monitor = async () => {
      const size = await directoryBytes(staging);
      if (size > maxFileBytes || size + used > maxSessionBytes) fail('DOWNLOAD_LIMIT');
    };
    const rows = await call('download', [request.message, '--attachment', request.attachment, '--output', staging], { monitor });
    await monitor();
    if (rows.length !== 1 || rows[0].emailId !== request.message || rows[0].attachmentId !== request.attachment
      || typeof rows[0].path !== 'string' || dirname(rows[0].path) !== staging) fail('INVALID_RESPONSE');
    const path = rows[0].path;
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || rows[0].size !== stat.size || attachment.size !== stat.size) fail('INVALID_RESPONSE');
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await file.stat();
      if (opened.ino !== stat.ino || opened.dev !== stat.dev) fail('INVALID_RESPONSE');
      await file.chmod(0o600);
    } finally { await file.close(); }
    await safeDirectory(session);
    await safeDirectory(dest);
    const name = String(attachment.name || 'attachment').replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 60);
    const published = join(dest, `${randomUUID()}-${name}`);
    // Hard linking into a private directory publishes atomically without overwriting.
    await link(path, published);
    return [{ emailId: request.message, attachmentId: request.attachment, name, path: published,
      size: stat.size, contentType: String(attachment.contentType || 'application/octet-stream') }];
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}
