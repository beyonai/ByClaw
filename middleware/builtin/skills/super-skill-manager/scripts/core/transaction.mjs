import { createHash, randomBytes } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { assertContained, resolveSkillTarget, validateSkillName } from './paths.mjs';
import { loadRegistry, validateRegistryEntry, writeRegistryAtomic } from './registry.mjs';
import { securityReportDigest } from './security.mjs';

const SIDECAR_SUFFIX = '.manifest.json';
// Payload moves and sidecar creation are compensated while this process runs. They are not a
// crash-atomic pair or a crash-durability guarantee; restore requires a matching pair to exist.
const registryQueues = new Map();
const targetQueues = new Map();
const previews = new Map();
const PREVIEW_TTL_MS = 5 * 60 * 1000;
const MAX_PREVIEWS = 1024;

class LifecycleError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function concretePath(value, label) {
  if (typeof value !== 'string' || !value || /[\0*?{}$]/.test(value)) throw new TypeError(`${label} must be a concrete path.`);
  return value;
}

function operationResult(overrides = {}) {
  return { committed: false, rolledBack: false, trashPath: null, backup: { created: false, retained: false }, ...overrides };
}

async function attemptRecovery(failures, step, work) {
  try {
    await work();
  } catch (error) {
    failures.push({ step, code: error?.code ?? 'ERROR', message: error?.message ?? String(error) });
  }
}

async function observedPresence(target) {
  if (!target) return false;
  try { return await exists(target); } catch { return null; }
}

async function rollbackResult(code, message, failures, { target = null, backupPath = null, trashPath = null, registryRestored = true, ...overrides } = {}) {
  const targetPresent = await observedPresence(target);
  const backupPresent = await observedPresence(backupPath);
  const trashPresent = await observedPresence(trashPath);
  const fullyRecovered = failures.length === 0;
  return operationResult({
    rolledBack: fullyRecovered,
    code: fullyRecovered ? code : 'PARTIAL_RECOVERY',
    message: fullyRecovered ? message : 'The operation failed and recovery was incomplete.',
    recoveryState: fullyRecovered ? 'rolled_back' : 'partial',
    targetPresent,
    backupPath: backupPresent ? backupPath : null,
    trashPath: trashPresent ? trashPath : null,
    registryRestored,
    backup: { created: Boolean(backupPath), retained: backupPresent === true },
    recoveryFailures: failures.length ? failures : undefined,
    ...overrides,
  });
}

function confirmationRequested(options) {
  return options.confirmed === true;
}

function operationId(name) {
  return `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(6).toString('hex')}`;
}

async function exists(target) {
  try { await lstat(target); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

async function canonicalDirectory(target, label) {
  const entry = await lstat(target);
  if (entry.isSymbolicLink() || !entry.isDirectory()) throw new TypeError(`${label} must be a regular directory.`);
  return realpath(target);
}

async function hashDirectory(directory, { ignore = new Set() } = {}) {
  const hash = createHash('sha256');
  const frame = (value) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.length);
    hash.update(length);
    hash.update(bytes);
  };
  async function visit(current, relative = '') {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)))) {
      if (!relative && ignore.has(entry.name)) continue;
      const child = path.join(current, entry.name);
      const childRelative = [relative, entry.name].filter(Boolean).join('/');
      if (entry.isSymbolicLink()) throw new TypeError('Skill content may not contain symbolic links.');
      if (entry.isDirectory()) {
        frame('D');
        frame(childRelative);
        await visit(child, childRelative);
      } else if (entry.isFile()) {
        frame('F');
        frame(childRelative);
        frame(await readFile(child));
      } else throw new TypeError('Skill content contains an unsupported filesystem entry.');
    }
  }
  await visit(directory);
  return hash.digest('hex');
}

export async function hashSkillDirectory(directory) {
  return hashDirectory(directory);
}

function serialise(queue, key, work) {
  const previous = queue.get(key) ?? Promise.resolve();
  const next = previous.then(work);
  const tracked = next.catch(() => {}).finally(() => { if (queue.get(key) === tracked) queue.delete(key); });
  queue.set(key, tracked);
  return next;
}

function withRegistryLock(registryPath, work) {
  return serialise(registryQueues, path.resolve(registryPath), work);
}

function withTargetLock(root, name, work) {
  return serialise(targetQueues, `${root}\0${name}`, work);
}

function manifestFor({ trashId, name, root, contentHash, registryEntry }) {
  return {
    schemaVersion: 1,
    trashId,
    name,
    managedRoot: root,
    targetName: name,
    trashedAt: new Date().toISOString(),
    contentHash,
    registryEntry: registryEntry ? copyRegistryEntry(registryEntry) : null,
  };
}

function immutableSnapshot(value) {
  if (Array.isArray(value)) return Object.freeze(value.map((item) => immutableSnapshot(item)));
  if (value !== null && typeof value === 'object') {
    const copy = {};
    for (const [key, item] of Object.entries(value)) copy[key] = immutableSnapshot(item);
    return Object.freeze(copy);
  }
  return value;
}

function copyRegistryEntry(entry) {
  return {
    name: entry.name,
    sourceType: entry.sourceType,
    source: entry.source,
    ref: entry.ref,
    contentHash: entry.contentHash,
    installedAt: entry.installedAt,
    updatedAt: entry.updatedAt,
    dependencies: [...entry.dependencies],
  };
}

function registryEntryFromPlan(name, plannedEntry, contentHash, installedAt, updatedAt) {
  return {
    name,
    sourceType: plannedEntry.sourceType,
    source: plannedEntry.source,
    ref: plannedEntry.ref,
    contentHash,
    installedAt,
    updatedAt,
    dependencies: [...plannedEntry.dependencies],
  };
}

function validateManifest(manifest, { name, root }) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new TypeError('Trash manifest is invalid.');
  const keys = Object.keys(manifest).sort();
  const expected = ['contentHash', 'managedRoot', 'name', 'registryEntry', 'schemaVersion', 'targetName', 'trashId', 'trashedAt'];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new TypeError('Trash manifest is invalid.');
  if (manifest.schemaVersion !== 1 || typeof manifest.trashId !== 'string' || !manifest.trashId || manifest.name !== name || manifest.targetName !== name || manifest.managedRoot !== root) {
    throw new TypeError('Trash manifest does not match the requested skill.');
  }
  if (!/^[a-f0-9]{64}$/.test(manifest.contentHash) || new Date(manifest.trashedAt).toISOString() !== manifest.trashedAt) {
    throw new TypeError('Trash manifest is invalid.');
  }
  if (manifest.registryEntry !== null) {
    validateRegistryEntry(name, manifest.registryEntry);
    if (manifest.registryEntry.contentHash !== manifest.contentHash) throw new TypeError('Trash manifest is invalid.');
  }
  return manifest;
}

function preflightInstallEntry(name, entry) {
  const source = entry ?? {};
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return null;
  if (Object.getPrototypeOf(source) !== Object.prototype && Object.getPrototypeOf(source) !== null) return null;
  const allowed = new Set(['sourceType', 'source', 'ref', 'dependencies']);
  if (Object.keys(source).some((key) => !allowed.has(key))) return null;
  const planned = {
    sourceType: source.sourceType ?? 'scaffold',
    source: source.source ?? 'staged',
    ref: source.ref ?? null,
    dependencies: source.dependencies ?? [],
  };
  const now = new Date().toISOString();
  try {
    validateRegistryEntry(name, { name, ...planned, contentHash: '0'.repeat(64), installedAt: now, updatedAt: now });
    return immutableSnapshot({ ...planned, dependencies: [...planned.dependencies] });
  } catch {
    return null;
  }
}

export function createSkillLifecycle({
  managedRoot,
  registryPath,
  openclawRoot = path.dirname(managedRoot),
  deviceProbe = async (target) => (await stat(target)).dev,
  filesystem = {},
  registryWriter = writeRegistryAtomic,
} = {}) {
  concretePath(managedRoot, 'Managed root');
  concretePath(registryPath, 'Registry path');
  concretePath(openclawRoot, 'OpenClaw root');
  const configuredRegistryPath = registryPath;
  if (typeof deviceProbe !== 'function') throw new TypeError('deviceProbe must be a function.');
  if (typeof registryWriter !== 'function') throw new TypeError('registryWriter must be a function.');
  if (filesystem === null || typeof filesystem !== 'object' || Array.isArray(filesystem) ||
    (filesystem.exists !== undefined && typeof filesystem.exists !== 'function')) throw new TypeError('filesystem.exists must be a function.');
  const filesystemExists = filesystem.exists ?? exists;
  async function roots() {
    const configuredExpectedRegistry = path.join(path.normalize(openclawRoot), 'skills-registry.json');
    if (path.normalize(configuredRegistryPath) !== configuredExpectedRegistry || configuredRegistryPath.split(path.sep).includes('..')) {
      throw new TypeError('Registry path must be the canonical OpenClaw skills-registry.json file.');
    }
    const root = await canonicalDirectory(managedRoot, 'Managed root');
    const openclaw = await canonicalDirectory(openclawRoot, 'OpenClaw root');
    assertContained(openclaw, root);
    const registryParent = await canonicalDirectory(path.dirname(registryPath), 'Registry parent');
    const expectedRegistry = path.join(openclaw, 'skills-registry.json');
    if (registryParent !== openclaw || path.basename(registryPath) !== 'skills-registry.json') {
      throw new TypeError('Registry path must be the canonical OpenClaw skills-registry.json file.');
    }
    try {
      const entry = await lstat(expectedRegistry);
      if (entry.isSymbolicLink() || !entry.isFile()) throw new TypeError('Registry path must be a regular file.');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    registryPath = expectedRegistry;
    return { root, openclaw, registryPath };
  }

  function prunePreviews(now = Date.now()) {
    for (const [token, preview] of previews) if (preview.expiresAt <= now) previews.delete(token);
    while (previews.size >= MAX_PREVIEWS) previews.delete(previews.keys().next().value);
  }

  async function currentHash(target) {
    return (await exists(target)) ? hashDirectory(target) : null;
  }

  async function previewTrashHash(openclaw, trashPath) {
    if (!trashPath) return null;
    concretePath(trashPath, 'Trash path');
    const trashRoot = await canonicalDirectory(path.join(openclaw, '.skills-trash'), 'Trash root');
    const entry = await lstat(trashPath);
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new TypeError('Trash entry must be a regular directory.');
    const canonicalTrash = await realpath(trashPath);
    assertContained(trashRoot, canonicalTrash);
    if (path.dirname(canonicalTrash) !== trashRoot) throw new TypeError('Trash path is not an owned lifecycle directory.');
    return hashDirectory(canonicalTrash);
  }

  async function issuePreview({ operation, name, trashPath = null, id = null, previewDigest = null, sourceHash = null, candidateSourceHash = null, securityDigest = null, expiresAt = Date.now() + PREVIEW_TTL_MS } = {}) {
    if (!['install', 'remove', 'restore'].includes(operation)) throw new TypeError('Preview operation is invalid.');
    validateSkillName(name);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new TypeError('Preview expiry is invalid.');
    const { root, openclaw } = await roots();
    if (id !== null && (typeof id !== 'string' || !id)) throw new TypeError('Preview id is invalid.');
    if (previewDigest !== null && (typeof previewDigest !== 'string' || !/^[a-f0-9]{64}$/.test(previewDigest) || id !== previewDigest)) {
      throw new TypeError('Preview digest must be a SHA-256 hash equal to its preview id.');
    }
    const expectedSourceHash = candidateSourceHash ?? sourceHash;
    if (expectedSourceHash !== null && !/^[a-f0-9]{64}$/.test(expectedSourceHash)) throw new TypeError('Preview source hash is invalid.');
    if (securityDigest !== null && (typeof securityDigest !== 'string' || !/^[a-f0-9]{64}$/.test(securityDigest))) throw new TypeError('Preview security digest is invalid.');
    const target = await resolveSkillTarget(root, name, { allowMissing: true });
    const token = randomBytes(32).toString('hex');
    prunePreviews();
    previews.set(token, {
      operation,
      root,
      name,
      trashPath: trashPath ? path.resolve(trashPath) : null,
      id,
      previewDigest,
      sourceHash: expectedSourceHash,
      securityDigest,
      targetHash: await currentHash(target),
      trashHash: await previewTrashHash(openclaw, trashPath),
      expiresAt,
    });
    return token;
  }

  function lookupPreview(options, operation, root, name, trashPath = null) {
    if (!confirmationRequested(options) || typeof options.confirmationToken !== 'string' || !options.confirmationToken.trim() || options.previewToken !== options.confirmationToken) {
      return { code: 'INVALID_CONFIRMATION' };
    }
    prunePreviews();
    const preview = previews.get(options.confirmationToken);
    if (!preview || preview.expiresAt < Date.now() || preview.operation !== operation || preview.root !== root || preview.name !== name ||
      preview.trashPath !== (trashPath ? path.resolve(trashPath) : null)) return { code: 'INVALID_CONFIRMATION' };
    const suppliedSourceHash = options.candidateSourceHash ?? options.sourceHash ?? null;
    if (suppliedSourceHash !== null && suppliedSourceHash !== preview.sourceHash) return { code: 'PREVIEW_STALE' };
    if (preview.id !== (options.previewId ?? options.id ?? null) || preview.previewDigest !== (options.previewDigest ?? null)) return { code: 'INVALID_CONFIRMATION' };
    return { preview };
  }

  function previewStateCode(preview, { targetHash = null, trashHash = null, sourceHash = null } = {}) {
    if (preview.expiresAt <= Date.now()) return 'INVALID_CONFIRMATION';
    if (preview.targetHash !== targetHash || preview.trashHash !== trashHash || (preview.sourceHash !== null && preview.sourceHash !== sourceHash)) {
      return 'PREVIEW_STALE';
    }
    return null;
  }

  function reservePreview(options, operation, root, name, trashPath = null) {
    const result = lookupPreview(options, operation, root, name, trashPath);
    if (result.code) return result;
    previews.delete(options.confirmationToken);
    return result;
  }

  async function consumePreview(options, operation, root, name, { trashPath = null, targetHash = null, trashHash = null, sourceHash = null } = {}) {
    const result = lookupPreview(options, operation, root, name, trashPath);
    if (result.code) return result.code;
    const code = previewStateCode(result.preview, { targetHash, trashHash, sourceHash });
    previews.delete(options.confirmationToken);
    return code;
  }

  async function stateDirectories(root, openclaw) {
    const stateRoot = path.join(openclaw, '.super-skill-manager-state');
    const stagingRoot = path.join(stateRoot, 'staging');
    const backupRoot = path.join(stateRoot, 'backups');
    const trashRoot = path.join(openclaw, '.skills-trash');
    try { await lstat(stateRoot); } catch (error) { if (error?.code === 'ENOENT') await mkdir(stateRoot, { mode: 0o700 }); else throw error; }
    const canonicalStateRoot = await canonicalDirectory(stateRoot, 'Lifecycle state root');
    assertContained(openclaw, canonicalStateRoot);
    if (path.dirname(canonicalStateRoot) !== openclaw) throw new TypeError('Lifecycle state root is not a direct child of OpenClaw root.');
    const rootDevice = await deviceProbe(root);
    if ((await deviceProbe(canonicalStateRoot)) !== rootDevice) throw new LifecycleError('FILESYSTEM_MISMATCH', 'Lifecycle state is on a different filesystem.');
    for (const directory of [stagingRoot, backupRoot, trashRoot]) await mkdir(directory, { recursive: true, mode: 0o700 });
    const canonical = {};
    for (const [key, directory] of Object.entries({ stagingRoot, backupRoot, trashRoot })) {
      canonical[key] = await canonicalDirectory(directory, key);
      assertContained(openclaw, canonical[key]);
    }
    for (const directory of Object.values(canonical)) {
      if ((await deviceProbe(directory)) !== rootDevice) throw new LifecycleError('FILESYSTEM_MISMATCH', 'Lifecycle state is on a different filesystem.');
    }
    return canonical;
  }

  async function ownedChild(base, name) {
    const candidate = path.resolve(base, name);
    assertContained(base, candidate);
    if (path.dirname(candidate) !== base) throw new TypeError('Path is not an owned lifecycle directory.');
    return candidate;
  }

  async function safeStage(stagePath, stagingRoot) {
    const stageEntry = await lstat(stagePath);
    if (stageEntry.isSymbolicLink() || !stageEntry.isDirectory()) throw new TypeError('Staged skill must be a regular directory.');
    const canonicalStage = await realpath(stagePath);
    assertContained(stagingRoot, canonicalStage);
    if (path.dirname(canonicalStage) !== stagingRoot) throw new TypeError('Staged skill is outside the owned staging directory.');
    const skillPath = path.join(canonicalStage, 'SKILL.md');
    const skillEntry = await lstat(skillPath);
    if (skillEntry.isSymbolicLink() || !skillEntry.isFile()) throw new TypeError('Staged skill must contain a regular root SKILL.md file.');
    const canonicalSkill = await realpath(skillPath);
    assertContained(canonicalStage, canonicalSkill);
    if (path.dirname(canonicalSkill) !== canonicalStage) throw new TypeError('Staged SKILL.md is outside the staged skill.');
    return canonicalStage;
  }

  async function prepareStage(stagingRoot, name, { stage, preparedSource, validateStage }) {
    const stagePath = await ownedChild(stagingRoot, operationId(name));
    await mkdir(stagePath, { mode: 0o700 });
    try {
      if (typeof stage === 'function') await stage(stagePath);
      else if (preparedSource) await cp(preparedSource, stagePath, { recursive: true, dereference: false });
      else throw new TypeError('A stage callback or prepared source is required.');
      const canonicalStage = await safeStage(stagePath, stagingRoot);
      if (validateStage && (await validateStage(canonicalStage)) === false) throw new TypeError('Staged skill validation failed.');
      await safeStage(stagePath, stagingRoot);
      await hashDirectory(stagePath);
      return stagePath;
    } catch (error) {
      await rm(stagePath, { recursive: true, force: true });
      throw error;
    }
  }

  async function moveToOwned(source, base, name) {
    const destination = await ownedChild(base, operationId(name));
    await rename(source, destination);
    return destination;
  }

  async function readTrashManifest(trashPath, trashRoot, { name, root }) {
    const resolved = path.resolve(trashPath);
    const entry = await lstat(resolved);
    if (entry.isSymbolicLink()) throw new TypeError('Trash entry must not be a symlink.');
    if (!entry.isDirectory()) throw new TypeError('Trash entry must be a regular directory.');
    const canonicalTrash = await realpath(resolved);
    assertContained(trashRoot, canonicalTrash);
    if (path.dirname(canonicalTrash) !== trashRoot) throw new TypeError('Trash path is not an owned lifecycle directory.');
    const trashId = path.basename(canonicalTrash);
    const manifestPath = path.join(trashRoot, `${trashId}${SIDECAR_SUFFIX}`);
    let manifestEntry;
    try { manifestEntry = await lstat(manifestPath); } catch { throw new TypeError('Trash manifest is missing or invalid.'); }
    if (manifestEntry.isSymbolicLink()) throw new TypeError('Trash manifest must not be a symlink.');
    if (!manifestEntry.isFile()) throw new TypeError('Trash manifest must be a regular file.');
    const canonicalManifest = await realpath(manifestPath);
    assertContained(trashRoot, canonicalManifest);
    if (path.dirname(canonicalManifest) !== trashRoot) throw new TypeError('Trash manifest is outside the owned trash root.');
    let manifest;
    try { manifest = validateManifest(JSON.parse(await readFile(canonicalManifest, 'utf8')), { name, root }); } catch { throw new TypeError('Trash manifest is invalid.'); }
    if (manifest.trashId !== trashId) throw new TypeError('Trash manifest does not match its payload.');
    if ((await hashDirectory(canonicalTrash)) !== manifest.contentHash) {
      throw new TypeError('Trash content does not match its manifest.');
    }
    return { trashPath: canonicalTrash, manifestPath: canonicalManifest, manifest };
  }

  async function install(options = {}) {
    const { name } = options;
    validateSkillName(name);
    if (!confirmationRequested(options)) return operationResult({ code: 'CONFIRMATION_REQUIRED', message: 'A matching preview confirmation is required.' });
    const plannedEntry = preflightInstallEntry(name, options.entry);
    if (!plannedEntry) return operationResult({ code: 'INVALID_REGISTRY_ENTRY', message: 'Skill provenance is invalid.' });
    const rootsResult = await roots();
    return withTargetLock(rootsResult.root, name, async () => {
      let root; let state; let target;
      try {
        root = rootsResult.root;
        state = await stateDirectories(root, rootsResult.openclaw);
        target = await resolveSkillTarget(root, name);
      } catch (error) {
        if (error?.code === 'FILESYSTEM_MISMATCH') return operationResult({ code: error.code, message: error.message });
        throw error;
      }
      const reservation = reservePreview(options, 'install', root, name);
      if (reservation.code) return operationResult({ code: reservation.code, message: 'A valid preview confirmation is required.' });
      let stagePath;
      try {
        try { stagePath = await prepareStage(state.stagingRoot, name, options); } catch (error) { return operationResult({ code: 'STAGE_INVALID', message: 'Stage preparation failed.' }); }
        if (reservation.preview.securityDigest !== null) {
          let report;
          try { report = await options.inspectStage?.(stagePath); } catch { return operationResult({ code: 'STAGE_INVALID', message: 'Staged skill inspection failed.' }); }
          if (!report || securityReportDigest(report) !== reservation.preview.securityDigest) {
            const code = report?.status === 'malicious' ? 'SECURITY_DENIED' : 'PREVIEW_STALE';
            return operationResult({ code, message: code === 'SECURITY_DENIED' ? 'Staged skill was denied by local security screening.' : 'The preview is invalid or stale.' });
          }
        }
        const previewCode = previewStateCode(reservation.preview, {
          targetHash: await currentHash(target),
          sourceHash: await hashDirectory(stagePath),
        });
        if (previewCode) return operationResult({ code: previewCode, message: 'The preview is invalid or stale.' });
        let backupPath = null; let failedPath = null; let installed = false; let registryCommitted = false; let previousEntry = null; let registryExisted = false;
        try {
          if (await filesystemExists(target)) backupPath = await moveToOwned(target, state.backupRoot, name);
          await safeStage(stagePath, state.stagingRoot);
          await rename(stagePath, target);
          installed = true;
          if (options.readinessCheck && (await options.readinessCheck(target)) === false) throw new TypeError('Skill readiness check failed.');
          const contentHash = await hashDirectory(target);
          await withRegistryLock(registryPath, async () => {
            registryExisted = await filesystemExists(registryPath);
            const registry = await loadRegistry(registryPath);
            previousEntry = Object.hasOwn(registry.skills, name) ? registry.skills[name] : null;
            const now = new Date().toISOString();
            registry.skills[name] = registryEntryFromPlan(name, plannedEntry, contentHash, previousEntry?.installedAt ?? now, now);
            try {
              await registryWriter(registryPath, registry);
              registryCommitted = true;
            } catch (error) {
              registryCommitted = error?.registryCommitted === true;
              throw error;
            }
          });
          try { if (backupPath) await rm(backupPath, { recursive: true, force: true }); } catch { return operationResult({ committed: true, backup: { created: true, retained: true }, code: 'BACKUP_RETAINED' }); }
          return operationResult({ committed: true, backup: { created: Boolean(backupPath), retained: false } });
        } catch (error) {
          const recoveryFailures = [];
          let registryRestored = !registryCommitted;
          await attemptRecovery(recoveryFailures, 'quarantine failed target', async () => {
            if (installed && (await filesystemExists(target))) {
              failedPath = await moveToOwned(target, state.trashRoot, name);
              if (!backupPath) {
                const contentHash = await hashDirectory(failedPath);
                const now = new Date().toISOString();
                const recoveryEntry = registryEntryFromPlan(name, plannedEntry, contentHash, now, now);
                const trashId = path.basename(failedPath);
                await writeFile(path.join(state.trashRoot, `${trashId}${SIDECAR_SUFFIX}`), `${JSON.stringify(manifestFor({ trashId, name, root, contentHash, registryEntry: recoveryEntry }))}\n`, { mode: 0o600, flag: 'wx' });
              }
            }
          });
          await attemptRecovery(recoveryFailures, 'restore backup', async () => {
            if (backupPath && (await filesystemExists(backupPath))) await rename(backupPath, target);
          });
          await attemptRecovery(recoveryFailures, 'restore registry', async () => {
            if (registryCommitted) await withRegistryLock(registryPath, async () => {
              if (!registryExisted && !previousEntry) await rm(registryPath, { force: true });
              else {
                const registry = await loadRegistry(registryPath);
                if (previousEntry) registry.skills[name] = previousEntry;
                else delete registry.skills[name];
                await registryWriter(registryPath, registry);
              }
            });
            registryRestored = true;
          });
          return rollbackResult('INSTALL_ROLLED_BACK', 'Installation failed and was rolled back.', recoveryFailures, {
            target,
            backupPath,
            trashPath: failedPath,
            registryRestored,
          });
        }
      } finally { if (stagePath) await rm(stagePath, { recursive: true, force: true }); }
    });
  }

  async function remove(options = {}) {
    const { name } = options;
    validateSkillName(name);
    if (!confirmationRequested(options)) return operationResult({ code: 'CONFIRMATION_REQUIRED', message: 'A matching preview confirmation is required.' });
    const rootsResult = await roots();
    return withTargetLock(rootsResult.root, name, async () => {
      let root; let state; let target;
      try { root = rootsResult.root; state = await stateDirectories(root, rootsResult.openclaw); target = await resolveSkillTarget(root, name, { allowMissing: false }); }
      catch (error) { if (error?.code === 'FILESYSTEM_MISMATCH') return operationResult({ code: error.code, message: error.message }); throw error; }
      const contentHash = await hashDirectory(target);
      const previewCode = await consumePreview(options, 'remove', root, name, { targetHash: contentHash });
      if (previewCode) return operationResult({ code: previewCode, message: 'The preview is invalid or stale.' });
      const oldEntry = await withRegistryLock(registryPath, async () => {
        const registry = await loadRegistry(registryPath);
        return Object.hasOwn(registry.skills, name) ? registry.skills[name] : null;
      });
      const trashPath = await moveToOwned(target, state.trashRoot, name);
      const trashId = path.basename(trashPath);
      const manifestPath = path.join(state.trashRoot, `${trashId}${SIDECAR_SUFFIX}`);
      let manifestCreated = false;
      let registryCommitted = false;
      try {
        const snapshot = oldEntry ? { ...copyRegistryEntry(oldEntry), contentHash } : null;
        await writeFile(manifestPath, `${JSON.stringify(manifestFor({ trashId, name, root, contentHash, registryEntry: snapshot }))}\n`, { mode: 0o600, flag: 'wx' });
        manifestCreated = true;
        await withRegistryLock(registryPath, async () => {
          const registry = await loadRegistry(registryPath);
          delete registry.skills[name];
          try {
            await registryWriter(registryPath, registry);
            registryCommitted = true;
          } catch (error) {
            registryCommitted = error?.registryCommitted === true;
            throw error;
          }
        });
        return operationResult({ committed: true, trashPath });
      } catch (error) {
        const recoveryFailures = [];
        let registryRestored = !registryCommitted;
        if (manifestCreated) await attemptRecovery(recoveryFailures, 'remove sidecar manifest', () => rm(manifestPath, { force: true }));
        await attemptRecovery(recoveryFailures, 'restore registry', async () => {
          if (registryCommitted) await withRegistryLock(registryPath, async () => {
            const registry = await loadRegistry(registryPath);
            if (oldEntry) registry.skills[name] = oldEntry;
            else delete registry.skills[name];
            await registryWriter(registryPath, registry);
          });
          registryRestored = true;
        });
        await attemptRecovery(recoveryFailures, 'restore target', async () => {
          if (await filesystemExists(trashPath)) await rename(trashPath, target);
        });
        return rollbackResult('REMOVE_ROLLED_BACK', 'Removal failed and was rolled back.', recoveryFailures, {
          target,
          trashPath,
          registryRestored,
        });
      }
    });
  }

  async function restore(options = {}) {
    const { name, trashPath } = options;
    validateSkillName(name);
    if (!confirmationRequested(options)) return operationResult({ code: 'CONFIRMATION_REQUIRED', message: 'A matching preview confirmation is required.' });
    const rootsResult = await roots();
    return withTargetLock(rootsResult.root, name, async () => {
      concretePath(trashPath, 'Trash path');
      let root; let state;
      try { root = rootsResult.root; state = await stateDirectories(root, rootsResult.openclaw); }
      catch (error) { if (error?.code === 'FILESYSTEM_MISMATCH') return operationResult({ code: error.code, message: error.message }); throw error; }
      const target = await resolveSkillTarget(root, name);
      if (await filesystemExists(target)) throw new TypeError('Cannot restore over an existing skill.');
      const previewCode = await consumePreview(options, 'restore', root, name, {
        trashPath,
        targetHash: null,
        trashHash: await previewTrashHash(rootsResult.openclaw, trashPath),
      });
      if (previewCode) return operationResult({ code: previewCode, message: 'The preview is invalid or stale.' });
      const trash = await readTrashManifest(trashPath, state.trashRoot, { name, root });
      await rename(trash.trashPath, target);
      let registryCommitted = false;
      let previousEntry = null;
      try {
        if (options.readinessCheck && (await options.readinessCheck(target)) === false) throw new TypeError('Skill readiness check failed.');
        await withRegistryLock(registryPath, async () => {
          const registry = await loadRegistry(registryPath);
          previousEntry = Object.hasOwn(registry.skills, name) ? copyRegistryEntry(registry.skills[name]) : null;
          const now = new Date().toISOString();
          registry.skills[name] = trash.manifest.registryEntry
            ? { ...copyRegistryEntry(trash.manifest.registryEntry), contentHash: trash.manifest.contentHash }
            : { name, sourceType: 'scaffold', source: 'restored', ref: null, contentHash: trash.manifest.contentHash, installedAt: now, updatedAt: now, dependencies: [] };
            try {
              await registryWriter(registryPath, registry);
              registryCommitted = true;
            } catch (error) {
              registryCommitted = error?.registryCommitted === true;
              throw error;
            }
        });
        await unlink(trash.manifestPath);
        return operationResult({ committed: true });
      } catch (error) {
        const recoveryFailures = [];
        let registryRestored = !registryCommitted;
        await attemptRecovery(recoveryFailures, 'restore registry', async () => {
          if (registryCommitted) await withRegistryLock(registryPath, async () => {
            const registry = await loadRegistry(registryPath);
            if (previousEntry) registry.skills[name] = previousEntry;
            else delete registry.skills[name];
            await registryWriter(registryPath, registry);
          });
          registryRestored = true;
        });
        await attemptRecovery(recoveryFailures, 'return target to trash', () => rename(target, trash.trashPath));
        return rollbackResult('RESTORE_ROLLED_BACK', 'Restore failed and was rolled back.', recoveryFailures, {
          target,
          trashPath: trash.trashPath,
          registryRestored,
        });
      }
    });
  }

  return { install, remove, restore, issuePreview };
}
