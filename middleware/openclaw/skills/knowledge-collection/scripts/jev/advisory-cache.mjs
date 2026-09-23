import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { jevGate } from './safe-call.mjs';
import { transportDependencies } from './transport-identity.mjs';

const FILE = '.jev-advisory-cache.json';
const TTL_MS = 60_000;
const MAX_BYTES = 64 * 1024;
const MAX_ENTRIES = 8;
const hash = (value) => createHash('sha256').update(value).digest('hex');

function cacheKey(kind, session, items, options, extra) {
  const environment = options.environment || process.env;
  return hash(JSON.stringify({ version: 1, kind, session, items, extra,
    purpose: options.purpose, context: options.context, policy: options.cachePolicy,
    privateData: options.privateData === true,
    model: environment.TYPESAFE_MODEL || 'jev-latest',
    credentialDigest: hash(String(environment.TYPESAFE_API_KEY || '')),
    enterpriseEnabled: environment.TYPESAFE_ENTERPRISE_ENABLED || '',
    ...transportDependencies(options),
  }));
}

function validPermutation(indices, count) {
  return Array.isArray(indices) && indices.length === count
    && indices.every((index) => Number.isSafeInteger(index) && index >= 0 && index < count)
    && new Set(indices).size === count;
}

function sidecarPath(paths) {
  const root = path.resolve(paths.root);
  // sessionPaths accepts a symlinked directory; optional cache I/O must not.
  return fs.lstatSync(root).isDirectory() ? path.join(root, FILE) : null;
}

function readSidecar(filename) {
  try {
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > MAX_BYTES) return { entries: [], writable: false };
    const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const opened = fs.fstatSync(fd);
      if (!opened.isFile() || (opened.mode & 0o077) !== 0 || opened.size > MAX_BYTES) return { entries: [], writable: false };
      const parsed = JSON.parse(fs.readFileSync(fd, 'utf8'));
      if (parsed?.version !== 1 || !Array.isArray(parsed.entries) || parsed.entries.length > MAX_ENTRIES) {
        return { entries: [], writable: true };
      }
      if (!parsed.entries.every((entry) => entry && Object.keys(entry).length === 3
        && typeof entry.key === 'string' && /^[a-f0-9]{64}$/.test(entry.key)
        && Number.isSafeInteger(entry.at) && validPermutation(entry.indices, entry.indices?.length))) {
        return { entries: [], writable: true };
      }
      return { entries: parsed.entries, writable: true };
    } finally { fs.closeSync(fd); }
  } catch (error) {
    return { entries: [], writable: error?.code === 'ENOENT' || error instanceof SyntaxError };
  }
}

function writeSidecar(filename, entries) {
  const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}-${randomUUID()}.tmp`);
  let fd;
  try {
    const contents = JSON.stringify({ version: 1, entries });
    if (Buffer.byteLength(contents) > MAX_BYTES) return;
    fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
      | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(fd, contents);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, filename);
  } catch {
    // Optional advice must never break the canonical workflow.
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* best effort */ }
    try { fs.unlinkSync(temporary); } catch { /* already renamed or inaccessible */ }
  }
}

// A sidecar contains only a context hash, an exact index permutation and a timestamp.
// Every hit passes the current safe-call gate; all storage failures become misses.
export async function withAdvisoryCache(paths, kind, session, items, options, compute, extra = null, unchanged = () => true) {
  let key;
  let sidecar;
  let filename;
  try {
    const gateOptions = { ...options, remainingBudgetMs: () => Math.min(2000, options.budgetMs ?? 2000,
      options.remainingBudgetMs ? options.remainingBudgetMs() : 2000) };
    filename = sidecarPath(paths);
    if (!filename) throw new Error('UNSAFE_ADVISORY_CACHE_ROOT');
    const gate = jevGate(gateOptions);
    if (gate.code && options.privateData) {
      const previous = sidecarPath(paths) === filename ? readSidecar(filename) : null;
      if (previous?.writable && previous.entries.length && sidecarPath(paths) === filename) writeSidecar(filename, []);
    }
    if (!gate.code) {
      key = cacheKey(kind, session, items, options, extra);
      sidecar = sidecarPath(paths) === filename ? readSidecar(filename) : null;
      if (!sidecar) throw new Error('UNSAFE_ADVISORY_CACHE_ROOT');
      const entry = sidecar.entries.find((row) => row?.key === key);
      const age = Date.now() - entry?.at;
      if (entry && Number.isSafeInteger(entry.at) && age >= 0 && age < TTL_MS
        && validPermutation(entry.indices, items.length) && sidecarPath(paths) === filename
        && !jevGate(gateOptions).code) {
        return { items: entry.indices.map((index) => items[index]),
          diagnostic: { status: 'used', code: 'JEV_ADVISORY_CACHE_HIT', count: items.length } };
      }
    }
  } catch { /* cache gate/key/read failures fall through to the normal advisory */ }
  let result;
  try { result = await compute(); }
  catch { return { items, diagnostic: { status: 'fallback', code: 'SELECTION_FAILED' } }; }
  if (key && sidecar?.writable && result.diagnostic?.status === 'used') {
    try {
      if (sidecarPath(paths) !== filename) return result;
      if (!unchanged()) return result;
      const locations = new Map(items.map((item, index) => [item, index]));
      const indices = result.items.map((item) => locations.get(item));
      if (!validPermutation(indices, items.length)) return result;
      const at = Date.now();
      const entries = sidecar.entries.filter((row) => row?.key !== key && Number.isSafeInteger(row?.at)
        && at - row.at >= 0 && at - row.at < TTL_MS).slice(-(MAX_ENTRIES - 1));
      entries.push({ key, at, indices });
      if (sidecarPath(paths) === filename) writeSidecar(filename, entries);
    } catch { /* cache writes are advisory only */ }
  }
  return result;
}
