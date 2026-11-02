import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, open, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, delimiter, dirname, join, resolve } from 'node:path';

const MAX_AGE_MS = 300_000;
const MAX_STATE_BYTES = 16 * 1024 * 1024;
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
export const stateIdentity = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function hotRequestIdentity(args) {
  return stateIdentity(Object.fromEntries(['query', 'dimensions', 'tiers', 'sources', 'limit',
    'adapter-timeout-ms', 'stop-after', 'minimum-attempts'].map((key) => [key, args[key] ?? null])));
}

// Local executable/package identity invalidates an in-run cache on replacement. Never run byCLI
// to validate a cache: doing so would reintroduce its startup cost for every source wave.
export async function bycliExecutableIdentity(environment = process.env) {
  for (const directory of String(environment.PATH || '').split(delimiter).filter(Boolean)) {
    try {
      const executable = await realpath(join(directory, 'bycli'));
      await access(executable, constants.X_OK);
      const info = await stat(executable);
      if (!info.isFile()) continue;
      let packageIdentity = null;
      let parent = dirname(executable);
      for (let depth = 0; depth < 8; depth++) {
        try { packageIdentity = stateIdentity(await readFile(join(parent, 'package.json'), 'utf8')); break; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (dirname(parent) === parent) break;
        parent = dirname(parent);
      }
      return stateIdentity({ executable, size: info.size, mtimeMs: info.mtimeMs,
        ctimeMs: info.ctimeMs, ino: info.ino, packageIdentity });
    } catch { /* Absent/unreadable executable disables cache reuse, not discovery. */ }
  }
  return null;
}

function catalogRows(runtime) {
  if (!(runtime?.catalog instanceof Map) || typeof runtime.version !== 'string'
    || !runtime.version || runtime.version.length > 500) return null;
  if (runtime.catalog.size > 10000) return null;
  const rows = [];
  for (const [key, meta] of runtime.catalog) {
    if (typeof key !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(key) || !record(meta)) return null;
    const [site, name] = key.split('/');
    if (meta.site !== undefined && meta.site !== site || meta.name !== undefined && meta.name !== name) return null;
    if (!Array.isArray(meta.columns) || meta.columns.some((column) => typeof column !== 'string' || column.length > 200)) return null;
    if (!Array.isArray(meta.args) || meta.args.some((arg) => !record(arg)
      || typeof arg.name !== 'string' || !/^[\w.-]+$/.test(arg.name)
      || arg.positional !== undefined && typeof arg.positional !== 'boolean')) return null;
    if (meta.browser !== undefined && typeof meta.browser !== 'boolean' && meta.browser !== 'conditional') return null;
    if (meta.strategy !== undefined && (typeof meta.strategy !== 'string' || meta.strategy.length > 100)) return null;
    rows.push({ site, name, columns: meta.columns, args: meta.args.map((arg) => ({
      name: arg.name, ...(arg.positional === undefined ? {} : { positional: arg.positional }),
    })), ...(meta.browser === undefined ? {} : { browser: meta.browser }),
    ...(meta.strategy === undefined ? {} : { strategy: meta.strategy }) });
  }
  return rows;
}

export async function createHotRuntimeState({ directory, runId, waveId, requestIdentity,
  declarationIdentity, executableIdentity, now = Date.now }) {
  for (const value of [runId, waveId]) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(value)) throw new Error('HOT_STATE_ID_INVALID');
  }
  const requestedRoot = resolve(directory);
  if (basename(requestedRoot) !== '.collection-inputs'
    || !(await lstat(requestedRoot)).isDirectory()) throw new Error('HOT_STATE_DIRECTORY_INVALID');
  const root = await realpath(requestedRoot);
  const runtimePath = join(root, `hot-runtime-${runId}.json`);
  const checkpointPath = join(root, `hot-wave-${waveId}.json`);
  const envelope = (kind, payload) => ({ schemaVersion: 1, kind, runId,
    ...(kind === 'checkpoint' ? { waveId, requestIdentity } : { declarationIdentity, executableIdentity }),
    generatedAt: now(), payload });
  const read = async (path, kind) => {
    let handle;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_STATE_BYTES) return null;
      const doc = JSON.parse(await handle.readFile('utf8'));
      if (doc.schemaVersion !== 1 || doc.kind !== kind || doc.runId !== runId) return null;
      if (kind === 'runtime') {
        const age = now() - doc.generatedAt;
        if (!executableIdentity || !declarationIdentity || !Number.isFinite(doc.generatedAt)
          || age < 0 || age > MAX_AGE_MS || doc.declarationIdentity !== declarationIdentity
          || doc.executableIdentity !== executableIdentity) return null;
      } else if (!requestIdentity || doc.waveId !== waveId || doc.requestIdentity !== requestIdentity) return null;
      return doc.payload;
    } catch { return null; }
    finally { await handle?.close(); }
  };
  const write = async (path, kind, payload) => {
    const temporary = join(root, `.hot-state-${randomUUID()}.tmp`);
    try {
      const serialized = JSON.stringify(envelope(kind, payload));
      if (Buffer.byteLength(serialized) > MAX_STATE_BYTES) return false;
      await writeFile(temporary, `${serialized}\n`, { flag: 'wx', mode: 0o600 });
      // rename replaces a symlink itself, never follows it to another file.
      await rename(temporary, path);
      return true;
    } catch { return false; }
    finally { await unlink(temporary).catch(() => {}); }
  };
  return {
    runtimePath, checkpointPath,
    async loadRuntime() {
      const cached = await read(runtimePath, 'runtime');
      if (!record(cached) || !Array.isArray(cached.rows)) return null;
      const runtime = { version: cached.version,
        catalog: new Map(cached.rows.filter(record).map((row) => [`${row.site}/${row.name}`, row])) };
      if (runtime.catalog.size !== cached.rows.length || !catalogRows(runtime)) return null;
      return runtime;
    },
    async saveRuntime(runtime) {
      const rows = catalogRows(runtime);
      if (!rows || !executableIdentity || !declarationIdentity) return false;
      return write(runtimePath, 'runtime', { version: runtime.version, rows });
    },
    async loadCheckpoint() {
      const document = await read(checkpointPath, 'checkpoint');
      return record(document) && document.channel === 'hot_discovery'
        && typeof document.query === 'string' && Array.isArray(document.candidates)
        && document.candidates.every((candidate) => record(candidate)
          && typeof candidate.url === 'string' && typeof candidate.title === 'string')
        && record(document.adapterStats) ? document : null;
    },
    saveCheckpoint: (document) => write(checkpointPath, 'checkpoint', document),
  };
}
