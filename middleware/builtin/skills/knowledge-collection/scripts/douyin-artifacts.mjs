import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isInside } from './session.mjs';

export const digest = data => crypto.createHash('sha256').update(data).digest('hex');
export function sourceUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('DOUYIN_SOURCE_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || !['v.douyin.com', 'www.douyin.com', 'douyin.com'].includes(url.hostname)
    || !(/^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) && url.hostname === 'v.douyin.com'
      || /^\/(?:video|note)\/\d+\/?$/.test(url.pathname))) throw new Error('DOUYIN_SOURCE_INVALID');
  if ([...url.searchParams.keys()].some(key => /token|cookie|session|auth|secret|password/i.test(key))) {
    throw new Error('DOUYIN_SOURCE_INVALID');
  }
  url.hash = '';
  return url.href;
}
export function workUrl(id) {
  if (typeof id !== 'string' || !/^\d{1,30}$/.test(id)) throw new Error('DOUYIN_WORK_ID_INVALID');
  return `https://www.douyin.com/video/${id}`;
}
export function assertPolicy(session) {
  if (!session.task?.sourceScope?.includes('public-internet')) throw new Error('SOURCE_SCOPE_DENIED');
  if (session.task.workflow === 'public-collect' || session.task.activeOrchestrationRunId) {
    throw new Error('SESSION_OWNED_BY_PUBLIC_COLLECT');
  }
  if (session.task.requiredContentGranularity !== 'any') throw new Error('DOUYIN_ARCHIVE_REQUIRES_ANY');
  if (session.task.materializationTarget === 'candidates') throw new Error('DOUYIN_ARCHIVE_REQUIRES_MATERIALIZATION');
}
function safePath(root, filename, allowMissing = false) {
  const base = path.resolve(root), absolute = path.resolve(base, filename);
  if (!isInside(base, absolute) || base === absolute || fs.lstatSync(base).isSymbolicLink()) {
    throw new Error('DOUYIN_PATH_INVALID');
  }
  let current = base;
  for (const segment of path.relative(base, absolute).split(path.sep)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) {
      if (allowMissing && !fs.lstatSync(path.dirname(current)).isSymbolicLink()) return absolute;
      throw new Error('DOUYIN_PATH_INVALID');
    }
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('DOUYIN_PATH_INVALID');
  }
  return absolute;
}
export function safeFile(root, filename) {
  const absolute = safePath(root, filename);
  if (!fs.statSync(absolute).isFile() || !isInside(fs.realpathSync(root), fs.realpathSync(absolute))) {
    throw new Error('DOUYIN_PATH_INVALID');
  }
  return absolute;
}
export function ensureDirectory(root, relative) {
  const absolute = path.resolve(root, relative);
  safePath(root, absolute, true);
  let current = path.resolve(root);
  for (const part of path.relative(root, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) fs.mkdirSync(current, { mode: 0o700 });
    if (fs.lstatSync(current).isSymbolicLink() || !fs.statSync(current).isDirectory()) throw new Error('DOUYIN_PATH_INVALID');
  }
  return absolute;
}
export function fileEntry(root, filename, kind) {
  const absolute = safeFile(root, filename), fd = fs.openSync(absolute, 'r');
  const hash = crypto.createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
  let size = 0;
  try {
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, count)); size += count;
    }
  } finally { fs.closeSync(fd); }
  if (!size) throw new Error('DOUYIN_EMPTY_ARTIFACT');
  return { kind, artifact: path.relative(root, absolute).split(path.sep).join('/'), size, sha256: hash.digest('hex') };
}
