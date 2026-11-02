import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fail } from './plan-store.mjs';

function hashFile(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) fail('INVALID_RECEIPT');
  const target = path.resolve(root, relative);
  if (!target.startsWith(`${root}${path.sep}`)) fail('INVALID_RECEIPT');
  let current = root;
  for (const part of path.relative(root, target).split(path.sep)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) fail('INVALID_RECEIPT');
  }
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.size > 100 * 1024 * 1024) fail('INVALID_RECEIPT');
  return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}
export function artifactReceipt(paths, session) {
  const files = new Set();
  for (const item of session.collection?.collection?.items || []) {
    for (const name of [...(item.rawArtifacts || []), item.materialization?.markdownPath,
      item.materialization?.sanitizedPath, ...(item.attachments || []).map(a => a.localPath)].filter(Boolean)) files.add(name);
  }
  for (const name of ['collection-result.json', 'sanitized/metadata.json']) if (fs.existsSync(path.join(paths.root, name))) files.add(name);
  return Object.fromEntries([...files].map(name => [name, hashFile(paths.root, name)]));
}
export function validateArtifactReceipt(paths, hashes) {
  if (!hashes) return;
  try {
    for (const [name, expected] of Object.entries(hashes)) if (hashFile(paths.root, name) !== expected) fail('ROUTE_RECEIPT_STALE');
  } catch { fail('ROUTE_RECEIPT_STALE'); }
}
