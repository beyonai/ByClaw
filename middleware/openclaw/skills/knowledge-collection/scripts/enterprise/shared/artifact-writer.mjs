import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import { constants, lstatSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, extname, isAbsolute, parse, relative, resolve, sep } from 'node:path';
import { removeSensitiveFields, sanitizeSensitive } from './secret-sanitizer.mjs';
import {
  deriveCollectionStatus,
  normalizeContentGranularity,
  normalizeMediaState,
} from './status-model.mjs';
import {
  acquireSessionLock,
  loadSession,
  newSession,
  releaseSessionLock,
  sessionPaths,
} from '../../session.mjs';

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const REQUIRED_DIRECTORIES = ['raw', 'markdown', 'sanitized', 'sanitized/items'];
const CANONICAL_ITEM_KEYS = ['title', 'url', 'author', 'publishTime', 'markdown', 'fileName'];
const SOURCE_SCOPE = { dws: 'dingtalk', fws: 'feishu', wecom: 'wecom', ima: 'ima' };
const BUNDLE_BACKUP_DIRECTORY = '.kc-bundle-backup';
const BUNDLE_BACKUP_MANIFEST = 'manifest.json';
const BUNDLE_VIEWS = [
  { live: 'session.json', backup: 'session.json', required: true },
  { live: 'sanitized/metadata.json', backup: 'metadata.json', required: false },
  { live: 'collection-result.json', backup: 'collection-result.json', required: false },
];

function outsideRootError() {
  return new Error('path is outside output root');
}

function resolveInside(root, relativePath) {
  if (typeof relativePath !== 'string' || isAbsolute(relativePath)) {
    throw outsideRootError();
  }
  const target = resolve(root, relativePath);
  const fromRoot = relative(root, target);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw outsideRootError();
  }
  return target;
}

function resolveWorkCopyFile(root, relativePath) {
  const target = resolveInside(root, relativePath);
  const fromRoot = relative(root, target).split(sep).join('/');
  if (!fromRoot.startsWith('markdown/items/') && !fromRoot.startsWith('sanitized/items/')) {
    throw new Error('path is outside removable work-copy roots');
  }
  return target;
}

function isSameIdentity(entry, identity) {
  return !entry.isSymbolicLink()
    && entry.dev === identity.dev
    && entry.ino === identity.ino;
}

export function isTrustedParentDirectory(entry, effectiveUid = process.geteuid?.()) {
  const groupOrOtherWritable = (entry.mode & 0o022) !== 0;
  const sticky = (entry.mode & 0o1000) !== 0;
  if (!groupOrOtherWritable) return true;
  return sticky && (entry.uid === 0 || entry.uid === effectiveUid);
}

function assertSafeDirectoryMode(entry) {
  if (!isTrustedParentDirectory(entry)) {
    throw new Error('output root parent must not be group/other writable without sticky bit');
  }
}

function assertRootIdentitySync(root, identity) {
  let entry;
  try {
    entry = lstatSync(root);
  } catch {
    throw new Error('output root was replaced');
  }
  if (!entry.isDirectory() || !isSameIdentity(entry, identity)) {
    throw new Error('output root was replaced');
  }
}

async function assertRootIdentity(root, identity) {
  let entry;
  try {
    entry = await lstat(root);
  } catch {
    throw new Error('output root was replaced');
  }
  if (!entry.isDirectory() || !isSameIdentity(entry, identity)) {
    throw new Error('output root was replaced');
  }
}

async function rejectExistingSymlinks(root, target) {
  const fromRoot = relative(root, target);
  const segments = fromRoot ? fromRoot.split(sep) : [];
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) throw outsideRootError();
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }
}

function rejectExistingSymlinksSync(root, target) {
  const fromRoot = relative(root, target);
  const segments = fromRoot ? fromRoot.split(sep) : [];
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink()) throw outsideRootError();
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }
}

async function makePrivateParents(root, rootIdentity, target) {
  await assertRootIdentity(root, rootIdentity);
  const parent = dirname(target);
  const fromRoot = relative(root, parent);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw outsideRootError();
  }
  await rejectExistingSymlinks(root, parent);
  await mkdir(parent, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });

  const segments = fromRoot ? fromRoot.split(sep) : [];
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    const entry = await lstat(current);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw outsideRootError();
    await chmod(current, PRIVATE_DIRECTORY_MODE);
  }
  await assertRootIdentity(root, rootIdentity);
}

async function ensurePrivateParentDirectories(parent) {
  const filesystemRoot = parse(parent).root;
  const fromFilesystemRoot = relative(filesystemRoot, parent);
  const segments = fromFilesystemRoot ? fromFilesystemRoot.split(sep) : [];
  let current = filesystemRoot;

  for (const [index, segment] of segments.entries()) {
    current = resolve(current, segment);
    let entry;
    let created = false;
    try {
      entry = await lstat(current);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try {
        await mkdir(current, { mode: PRIVATE_DIRECTORY_MODE });
        created = true;
      } catch (mkdirError) {
        if (mkdirError.code !== 'EEXIST') throw mkdirError;
      }
      entry = await lstat(current);
    }

    if (entry.isSymbolicLink() && index === 0) {
      current = await realpath(current);
      entry = await lstat(current);
    }
    if (entry.isSymbolicLink()) {
      throw new Error('output root parent must not contain a symbolic link');
    }
    if (!entry.isDirectory()) {
      throw new Error('output root parent must be a directory');
    }
    assertSafeDirectoryMode(entry);
    if (created) await chmod(current, PRIVATE_DIRECTORY_MODE);
  }
}

async function parentIdentity(parent) {
  const realParent = await realpath(parent);
  const entry = await lstat(realParent);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error('output root parent must be a directory');
  }
  assertSafeDirectoryMode(entry);
  return { realParent, dev: entry.dev, ino: entry.ino };
}

async function assertParentIdentity(parent, identity) {
  let current;
  try {
    current = await parentIdentity(parent);
  } catch {
    throw new Error('output root parent was replaced');
  }
  if (current.realParent !== identity.realParent
    || current.dev !== identity.dev
    || current.ino !== identity.ino) {
    throw new Error('output root parent was replaced');
  }
}

async function removeOwnedPath(path, identity, recursive) {
  if (!identity) return;
  try {
    const entry = await lstat(path);
    if (isSameIdentity(entry, identity)) {
      await rm(path, { recursive, force: true });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function createPrivateLayout(root) {
  await chmod(root, PRIVATE_DIRECTORY_MODE);
  for (const directory of REQUIRED_DIRECTORIES) {
    const target = resolve(root, directory);
    await mkdir(target, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
    await chmod(target, PRIVATE_DIRECTORY_MODE);
  }
}

async function writePrivateFile(root, rootIdentity, relativePath, content) {
  await assertRootIdentity(root, rootIdentity);
  const target = resolveInside(root, relativePath);
  await makePrivateParents(root, rootIdentity, target);
  const temporary = resolve(
    dirname(target),
    `.kc-tmp-${randomUUID()}`,
  );
  let handle;
  let temporaryIdentity;
  let published = false;
  try {
    handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      PRIVATE_FILE_MODE,
    );
    temporaryIdentity = await lstat(temporary);
    await handle.writeFile(content, { encoding: 'utf8' });
    await handle.chmod(PRIVATE_FILE_MODE);
    await handle.close();
    handle = undefined;
    await assertRootIdentity(root, rootIdentity);
    await rename(temporary, target);
    published = true;
    await assertRootIdentity(root, rootIdentity);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (!published) await removeOwnedPath(temporary, temporaryIdentity, false);
    throw error;
  }
  return target;
}

async function createPrivateRoot(normalizedRoot) {
  const parent = dirname(normalizedRoot);
  await ensurePrivateParentDirectories(parent);
  const initialParentIdentity = await parentIdentity(parent);
  try {
    await lstat(normalizedRoot);
    throw new Error('output root must not already exist');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const staging = resolve(parent, `.kc-stage-${randomUUID()}`);
  let stagingIdentity;
  let claimIdentity;
  let published = false;
  try {
    await mkdir(staging, { mode: PRIVATE_DIRECTORY_MODE });
    stagingIdentity = await lstat(staging);
    await createPrivateLayout(staging);
    await assertParentIdentity(parent, initialParentIdentity);
    try {
      await mkdir(normalizedRoot, { mode: PRIVATE_DIRECTORY_MODE });
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error('output root must not already exist');
      throw error;
    }
    claimIdentity = await lstat(normalizedRoot);
    await assertParentIdentity(parent, initialParentIdentity);
    await rename(staging, normalizedRoot);
    published = true;
    const rootIdentity = await lstat(normalizedRoot);
    if (!isSameIdentity(rootIdentity, stagingIdentity) || !rootIdentity.isDirectory()) {
      throw new Error('output root publication failed identity check');
    }
    return { dev: rootIdentity.dev, ino: rootIdentity.ino };
  } catch (error) {
    if (!published) {
      await removeOwnedPath(staging, stagingIdentity, true);
      await removeOwnedPath(normalizedRoot, claimIdentity, true);
    }
    throw error;
  }
}

async function openInitializedSessionRoot(normalizedRoot, { allowCollected = false, allowFailed = false } = {}) {
  let rootEntry;
  try {
    rootEntry = await lstat(normalizedRoot);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
  const rejectExisting = () => new Error('output root must not already exist unless it is an empty initialized collection session');
  if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) throw rejectExisting();
  assertSafeDirectoryMode(rootEntry);
  await recoverInterruptedBundle(normalizedRoot, { dev: rootEntry.dev, ino: rootEntry.ino });
  let session;
  try {
    session = loadSession(sessionPaths(normalizedRoot), { persistMigration: false }).session;
  } catch {
    throw rejectExisting();
  }
  const emptyInitialized = session.task?.status === 'initialized'
    && !session.task?.publicationStatus
    && Array.isArray(session.collection?.collection?.items)
    && session.collection.collection.items.length === 0;
  const committedCollection = allowCollected
    && session.task?.status === 'collected'
    && session.task?.publicationStatus === 'committed'
    && Array.isArray(session.collection?.collection?.items);
  const failedCollection = allowFailed
    && session.task?.status === 'failed'
    && session.task?.publicationStatus === 'committed'
    && Array.isArray(session.collection?.collection?.items);
  if (!emptyInitialized && !committedCollection && !failedCollection) {
    throw rejectExisting();
  }
  for (const relativePath of REQUIRED_DIRECTORIES) {
    const entry = await lstat(resolve(normalizedRoot, relativePath));
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw rejectExisting();
  }
  return {
    rootIdentity: { dev: rootEntry.dev, ino: rootEntry.ino },
    session: structuredClone(session),
    replaceable: committedCollection || failedCollection,
  };
}

async function removeBundleBackup(root, rootIdentity) {
  const backupDir = resolveInside(root, BUNDLE_BACKUP_DIRECTORY);
  let entry;
  try {
    entry = await lstat(backupDir);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error('collection bundle backup is unsafe');
  }
  await assertRootIdentity(root, rootIdentity);
  await removeOwnedPath(backupDir, entry, true);
}

async function readBundleBackup(root, relativePath) {
  const target = resolveInside(root, `${BUNDLE_BACKUP_DIRECTORY}/${relativePath}`);
  await rejectExistingSymlinks(root, target);
  const entry = await lstat(target);
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new Error('collection bundle backup is incomplete');
  }
  const content = await readFile(target, 'utf8');
  JSON.parse(content);
  return content;
}

async function readLiveBundleFile(root, relativePath) {
  const target = resolveInside(root, relativePath);
  await rejectExistingSymlinks(root, target);
  const entry = await lstat(target);
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new Error('collection bundle file must be a regular file');
  }
  const content = await readFile(target, 'utf8');
  JSON.parse(content);
  return content;
}

async function removeLiveBundleFile(root, rootIdentity, relativePath) {
  const target = resolveInside(root, relativePath);
  await rejectExistingSymlinks(root, target);
  let entry;
  try {
    entry = await lstat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new Error('collection bundle file must be a regular file');
  }
  await assertRootIdentity(root, rootIdentity);
  await removeOwnedPath(target, entry, false);
}

async function backupManifest(root) {
  try {
    const manifest = JSON.parse(await readBundleBackup(root, BUNDLE_BACKUP_MANIFEST));
    const allowed = new Set(BUNDLE_VIEWS.map((view) => view.backup));
    if (manifest?.schemaVersion !== 1
      || !Array.isArray(manifest.present)
      || !manifest.present.includes('session.json')
      || manifest.present.some((entry) => typeof entry !== 'string' || !allowed.has(entry))) {
      throw new Error('collection bundle backup manifest is invalid');
    }
    return new Set(manifest.present);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return new Set(BUNDLE_VIEWS.map((view) => view.backup));
    }
    throw error;
  }
}

async function recoverInterruptedBundle(root, rootIdentity) {
  let current;
  try {
    current = JSON.parse(await readLiveBundleFile(root, 'session.json'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return;
    throw error;
  }
  if (current?.task?.publicationStatus !== 'uncommitted') return;
  const present = await backupManifest(root);
  const restored = new Map();
  for (const view of BUNDLE_VIEWS) {
    if (present.has(view.backup)) {
      restored.set(view.live, await readBundleBackup(root, view.backup));
    }
  }
  const session = restored.get('session.json');
  const committed = JSON.parse(session);
  const validCommitted = committed?.task?.publicationStatus === 'committed';
  const validInitialized = committed?.task?.status === 'initialized'
    && committed?.task?.publicationStatus === undefined;
  if (!validCommitted && !validInitialized) {
    throw new Error('collection bundle backup is not a recoverable session');
  }
  for (const view of BUNDLE_VIEWS.filter((entry) => entry.live !== 'session.json')) {
    if (restored.has(view.live)) {
      await writePrivateFile(root, rootIdentity, view.live, restored.get(view.live));
    } else {
      await removeLiveBundleFile(root, rootIdentity, view.live);
    }
  }
  await writePrivateFile(root, rootIdentity, 'session.json', session);
  await removeBundleBackup(root, rootIdentity);
}

async function prepareBundleBackup(root, rootIdentity) {
  await removeBundleBackup(root, rootIdentity);
  const present = [];
  for (const view of BUNDLE_VIEWS) {
    let content;
    try {
      content = await readLiveBundleFile(root, view.live);
    } catch (error) {
      if (error.code === 'ENOENT' && !view.required) continue;
      throw error;
    }
    await writePrivateFile(root, rootIdentity, `${BUNDLE_BACKUP_DIRECTORY}/${view.backup}`, content);
    present.push(view.backup);
  }
  await writePrivateFile(
    root,
    rootIdentity,
    `${BUNDLE_BACKUP_DIRECTORY}/${BUNDLE_BACKUP_MANIFEST}`,
    `${JSON.stringify({ schemaVersion: 1, present }, null, 2)}\n`,
  );
}

/*
 * Threat model: private/sticky parent checks, inode identity checks, sibling staging,
 * and atomic renames protect against different-user path replacement. Node's path APIs
 * cannot fully eliminate malicious same-UID races without openat2-style native support.
 */
async function validateCanonicalItems(root, canonicalItems) {
  const canonicalRoot = resolve(root, 'sanitized/items');
  for (const item of canonicalItems) {
    if (typeof item?.markdown !== 'string'
      || item.markdown !== item.fileName) {
      throw new Error('invalid canonical item path');
    }
    const target = resolveInside(root, item.markdown);
    const fromCanonicalRoot = relative(canonicalRoot, target);
    if (!fromCanonicalRoot
      || fromCanonicalRoot === '..'
      || fromCanonicalRoot.startsWith(`..${sep}`)
      || isAbsolute(fromCanonicalRoot)) {
      throw new Error('invalid canonical item path');
    }
    await rejectExistingSymlinks(root, target);
    let entry;
    try {
      entry = await lstat(target);
    } catch {
      throw new Error('invalid canonical item file');
    }
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error('invalid canonical item file');
    }
  }
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeInitialTaskContract(value) {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) throw new TypeError('initial task contract must be a plain object');
  const allowed = new Set([
    'query', 'materializationTarget', 'requiredContentGranularity', 'deliveryRequested',
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`initial task contract field is not allowed: ${key}`);
  }
  if (typeof value.query !== 'string' || !value.query.trim()) {
    throw new TypeError('initial task contract query must be a non-empty string');
  }
  if (!['candidates', 'selected', 'all'].includes(value.materializationTarget)) {
    throw new TypeError('initial task contract materializationTarget is invalid');
  }
  if (!['any', 'full-text'].includes(value.requiredContentGranularity)) {
    throw new TypeError('initial task contract requiredContentGranularity is invalid');
  }
  if (typeof value.deliveryRequested !== 'boolean') {
    throw new TypeError('initial task contract deliveryRequested must be a boolean');
  }
  return { ...value, query: value.query.trim() };
}

function isStrictlyInside(directory, target) {
  const fromDirectory = relative(directory, target);
  return Boolean(fromDirectory)
    && fromDirectory !== '..'
    && !fromDirectory.startsWith(`..${sep}`)
    && !isAbsolute(fromDirectory);
}

function resolveWorkCopyPath(root, relativePath, label) {
  requireNonEmptyString(relativePath, label);
  if (!['.md', '.markdown'].includes(extname(relativePath).toLowerCase())) {
    throw new TypeError(`${label} must be a Markdown work-copy path`);
  }
  const target = resolveInside(root, relativePath);
  const markdownRoot = resolve(root, 'markdown');
  const sanitizedRoot = resolve(root, 'sanitized/items');
  if (!isStrictlyInside(markdownRoot, target) && !isStrictlyInside(sanitizedRoot, target)) {
    throw new TypeError(`${label} must be a safe work-copy path`);
  }
  return target;
}

function resolveScopedWorkCopyPath(root, relativePath, directory, label) {
  const target = resolveWorkCopyPath(root, relativePath, label);
  if (!isStrictlyInside(resolve(root, directory), target)) {
    throw new TypeError(`${label} must be inside ${directory}/`);
  }
  return target;
}

function normalizeCanonicalItems(canonicalItems) {
  if (!Array.isArray(canonicalItems)) throw new TypeError('canonical items must be an array');
  return canonicalItems.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError(`canonical item ${index} must be an object`);
    }
    for (const key of ['title', 'url', 'markdown', 'fileName']) {
      requireNonEmptyString(item[key], `canonical item ${index}.${key}`);
    }
    for (const key of ['author', 'publishTime']) {
      if (item[key] !== undefined && typeof item[key] !== 'string') {
        throw new TypeError(`canonical item ${index}.${key} must be a string`);
      }
    }
    return Object.fromEntries(CANONICAL_ITEM_KEYS
      .filter((key) => item[key] !== undefined)
      .map((key) => [key, item[key]]));
  });
}

function normalizeInventory(root, inventory) {
  if (!Array.isArray(inventory)) throw new TypeError('inventory must be an array');
  const seenItemIds = new Set();
  const seenSourceIdentities = new Set();
  return inventory.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || !item.materialization || typeof item.materialization !== 'object'
      || Array.isArray(item.materialization)) {
      throw new TypeError(`inventory item ${index} materialization must be an object`);
    }
    for (const key of ['itemId', 'sourceSkill', 'sourceUrl']) {
      requireNonEmptyString(item[key], `inventory item ${index}.${key}`);
    }
    if (seenItemIds.has(item.itemId)) {
      throw new TypeError(`inventory itemId is duplicated: ${item.itemId}`);
    }
    seenItemIds.add(item.itemId);
    const sourceIdentity = `${item.sourceSkill}\n${item.sourceUrl}`;
    if (seenSourceIdentities.has(sourceIdentity)) {
      throw new TypeError(`inventory sourceSkill + sourceUrl is duplicated: ${item.sourceSkill} / ${item.sourceUrl}`);
    }
    seenSourceIdentities.add(sourceIdentity);
    if (!Array.isArray(item.rawArtifacts)
      || item.rawArtifacts.some((artifact) => typeof artifact !== 'string')) {
      throw new TypeError(`inventory item ${index} rawArtifacts must be a string array`);
    }
    const { status, markdownPath, sanitizedPath } = item.materialization;
    if (!['materialized', 'pending', 'failed'].includes(status)) {
      throw new TypeError(`inventory item ${index} materialization status is invalid`);
    }
    if (status === 'materialized') {
      requireNonEmptyString(markdownPath, `inventory item ${index} materialization.markdownPath`);
      requireNonEmptyString(sanitizedPath, `inventory item ${index} materialization.sanitizedPath`);
      resolveScopedWorkCopyPath(
        root,
        markdownPath,
        'markdown',
        `inventory item ${index} materialization.markdownPath`,
      );
      resolveScopedWorkCopyPath(
        root,
        sanitizedPath,
        'sanitized/items',
        `inventory item ${index} materialization.sanitizedPath`,
      );
    } else if (markdownPath !== null || sanitizedPath !== null) {
      throw new TypeError(`inventory item ${index} materialization status and paths are inconsistent`);
    }
    const pendingArtifactCleanup = item.materialization.pendingArtifactCleanup ?? [];
    if (!Array.isArray(pendingArtifactCleanup)
      || pendingArtifactCleanup.some((artifact) => typeof artifact !== 'string')) {
      throw new TypeError(`inventory item ${index} cleanup paths must be a string array`);
    }
    const currentTargets = new Set([markdownPath, sanitizedPath]
      .filter(Boolean)
      .map((artifact, currentIndex) => resolveWorkCopyPath(
        root,
        artifact,
        `inventory item ${index} current work-copy path ${currentIndex}`,
      )));
    for (const [cleanupIndex, artifact] of pendingArtifactCleanup.entries()) {
      const cleanupTarget = resolveWorkCopyPath(
        root,
        artifact,
        `inventory item ${index} cleanup path ${cleanupIndex}`,
      );
      if (currentTargets.has(cleanupTarget)) {
        throw new TypeError(`inventory item ${index} cleanup path points at a current work copy`);
      }
    }
    return {
      ...item,
      media: normalizeMediaState(item.media, { strict: true, coverUrls: item.coverUrls }),
      rawArtifacts: [...new Set(item.rawArtifacts)],
      materialization: {
        ...item.materialization,
        contentGranularity: normalizeContentGranularity(
          item.materialization.contentGranularity,
          { strict: true },
        ),
        pendingArtifactCleanup: [...pendingArtifactCleanup],
      },
    };
  });
}

async function validateInventoryPaths(root, inventory) {
  for (const [index, item] of inventory.entries()) {
    const materialization = item.materialization;
    const paths = materialization.status === 'materialized'
      ? [materialization.markdownPath, materialization.sanitizedPath]
      : [];
    for (const [pathIndex, relativePath] of paths.entries()) {
      const target = resolveWorkCopyPath(root, relativePath, `inventory item ${index} materialization path ${pathIndex}`);
      await rejectExistingSymlinks(root, target);
      let entry;
      try {
        entry = await lstat(target);
      } catch {
        throw new TypeError(`inventory item ${index} materialization path must point to a file`);
      }
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new TypeError(`inventory item ${index} materialization path must point to a regular file`);
      }
    }
    for (const [cleanupIndex, relativePath] of materialization.pendingArtifactCleanup.entries()) {
      const target = resolveWorkCopyPath(root, relativePath, `inventory item ${index} cleanup path ${cleanupIndex}`);
      await rejectExistingSymlinks(root, target);
    }
    for (const [artifactIndex, relativePath] of item.rawArtifacts.entries()) {
      const label = `inventory item ${index} raw artifact ${artifactIndex}`;
      if (!relativePath.startsWith('raw/')) {
        throw new TypeError(`${label} must be inside raw/`);
      }
      const target = resolveInside(root, relativePath);
      if (!isStrictlyInside(resolve(root, 'raw'), target)) {
        throw new TypeError(`${label} must be inside raw/`);
      }
      await rejectExistingSymlinks(root, target);
      let entry;
      try {
        entry = await lstat(target);
      } catch {
        throw new TypeError(`${label} must point to a regular file`);
      }
      if (!entry.isFile() || entry.isSymbolicLink() || entry.size <= 0) {
        throw new TypeError(`${label} must point to a non-empty regular file`);
      }
      try {
        await readFile(target);
      } catch {
        throw new TypeError(`${label} must be readable`);
      }
    }
  }
}

function validateBundleHeader(bundle) {
  if (!isPlainObject(bundle)) throw new TypeError('bundle must be a plain object');
  for (const key of ['title', 'source', 'backend', 'url']) {
    requireNonEmptyString(bundle[key], `bundle.${key}`);
  }
  if (!isPlainObject(bundle.filters)) {
    throw new TypeError('bundle.filters must be a plain object');
  }
}

function collectionStatusFor(bundle, inventory) {
  if (bundle.discoverySucceeded !== undefined && typeof bundle.discoverySucceeded !== 'boolean') {
    throw new TypeError('bundle.discoverySucceeded must be a boolean');
  }
  if (bundle.paginationFailed !== undefined && typeof bundle.paginationFailed !== 'boolean') {
    throw new TypeError('bundle.paginationFailed must be a boolean');
  }
  const derived = deriveCollectionStatus({
    discoverySucceeded: bundle.discoverySucceeded !== false,
    metadataOnly: bundle.metadataOnly === true,
    paginationFailed: bundle.paginationFailed === true,
    itemStates: inventory.map((item) => item?.materialization?.status),
  });
  if (bundle.collectionStatus === undefined) return derived;
  if (!['complete', 'partial', 'failed'].includes(bundle.collectionStatus)) {
    throw new TypeError('bundle.collectionStatus must be complete, partial, or failed');
  }
  if (bundle.collectionStatus === derived) return derived;
  if (bundle.collectionStatus === 'partial'
    && derived === 'failed'
    && inventory.length > 0
    && inventory.every((item) => item.materialization.status === 'pending')) {
    return 'partial';
  }
  throw new TypeError('bundle.collectionStatus override contradicts inventory');
}

function validateCanonicalCorrespondence(inventory, canonicalItems) {
  const materializedByPath = new Map();
  for (const [index, item] of inventory.entries()) {
    if (item.materialization.status !== 'materialized') continue;
    const path = item.materialization.sanitizedPath;
    if (typeof path !== 'string' || !path) {
      throw new Error(`inventory item ${index} materialized sanitized path is invalid`);
    }
    if (materializedByPath.has(path)) {
      throw new Error(`inventory materialized sanitized path is duplicated: ${path}`);
    }
    materializedByPath.set(path, item);
  }

  const seenPaths = new Set();
  for (const item of canonicalItems) {
    const inventoryItem = materializedByPath.get(item.fileName);
    if (!inventoryItem) throw new Error('canonical item has no materialized inventory');
    if (seenPaths.has(item.fileName)) throw new Error('canonical item path is duplicated');
    if (inventoryItem.sourceUrl !== item.url) throw new Error('canonical item URL does not match inventory');
    seenPaths.add(item.fileName);
  }
  if ([...materializedByPath.keys()].some((path) => !seenPaths.has(path))) {
    throw new Error('materialized inventory has no canonical item');
  }
}

async function writePersistedJson(root, rootIdentity, relativePath, value) {
  return writePrivateFile(
    root,
    rootIdentity,
    relativePath,
    `${JSON.stringify(removeSensitiveFields(value), null, 2)}\n`,
  );
}

export async function createArtifactWriter(root, {
  allowExistingSession = false, allowFailed = false, initialTaskContract = null, beforeCompatibilityPublish = null,
} = {}) {
  if (!isAbsolute(root)) {
    throw new TypeError('output root must be an absolute path');
  }
  const normalizedRoot = resolve(root);
  if (beforeCompatibilityPublish !== null && typeof beforeCompatibilityPublish !== 'function') {
    throw new TypeError('beforeCompatibilityPublish must be a function');
  }
  const initialTask = normalizeInitialTaskContract(initialTaskContract);
  const lockPaths = { lock: resolve(normalizedRoot, '.knowledge-collection.lock') };
  let sessionLock = null;
  let existingRoot = false;
  try {
    const entry = await lstat(normalizedRoot);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error('existing output root must be a regular directory');
    }
    assertSafeDirectoryMode(entry);
    existingRoot = true;
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    if (allowExistingSession) throw error;
  }
  if (existingRoot) {
    sessionLock = acquireSessionLock(
      lockPaths,
      allowExistingSession ? 'enterprise-replace' : 'enterprise-write',
    );
  }
  let initializedRoot;
  try {
    initializedRoot = await openInitializedSessionRoot(normalizedRoot, {
      allowCollected: allowExistingSession,
      allowFailed,
    });
  } catch (error) {
    releaseSessionLock(lockPaths, sessionLock);
    throw error;
  }
  const rootIdentity = initializedRoot?.rootIdentity || await createPrivateRoot(normalizedRoot);
  const ownsRoot = !initializedRoot;
  let publicationState = 'open';
  let lockReleased = false;
  const releaseWriterLock = () => {
    if (lockReleased) return;
    releaseSessionLock(lockPaths, sessionLock);
    lockReleased = true;
  };

  const writer = {
    absolute(relativePath) {
      assertRootIdentitySync(normalizedRoot, rootIdentity);
      const target = resolveInside(normalizedRoot, relativePath);
      rejectExistingSymlinksSync(normalizedRoot, target);
      assertRootIdentitySync(normalizedRoot, rootIdentity);
      return target;
    },

    async writeJson(relativePath, value) {
      return writePrivateFile(
        normalizedRoot,
        rootIdentity,
        relativePath,
        `${JSON.stringify(sanitizeSensitive(value), null, 2)}\n`,
      );
    },

    async writeText(relativePath, content) {
      return writePrivateFile(normalizedRoot, rootIdentity, relativePath, content);
    },

    async writeBytes(relativePath, content) {
      if (!Buffer.isBuffer(content)) throw new TypeError('binary artifact must be a Buffer');
      return writePrivateFile(normalizedRoot, rootIdentity, relativePath, content);
    },

    async removeFiles(relativePaths) {
      if (!Array.isArray(relativePaths)
        || relativePaths.some((relativePath) => typeof relativePath !== 'string')) {
        throw new TypeError('work-copy paths must be a string array');
      }
      await assertRootIdentity(normalizedRoot, rootIdentity);
      for (const relativePath of relativePaths) {
        const target = resolveWorkCopyFile(normalizedRoot, relativePath);
        await rejectExistingSymlinks(normalizedRoot, target);
        let identity;
        try {
          const entry = await lstat(target);
          if (!entry.isFile() || entry.isSymbolicLink()) {
            throw new Error('work-copy cleanup target must be a regular file');
          }
          identity = entry;
        } catch (error) {
          if (error.code === 'ENOENT') continue;
          throw error;
        }
        await assertRootIdentity(normalizedRoot, rootIdentity);
        await removeOwnedPath(target, identity, false);
      }
      await assertRootIdentity(normalizedRoot, rootIdentity);
    },

    async abort() {
      if (publicationState === 'committed') {
        throw new Error('cannot abort a committed collection bundle');
      }
      if (publicationState === 'publishing') {
        throw new Error('cannot abort a collection bundle publication in progress');
      }
      if (ownsRoot) await removeOwnedPath(normalizedRoot, rootIdentity, true);
      publicationState = 'aborted';
      releaseWriterLock();
    },

    async writeCollectionBundle(bundle) {
      if (publicationState !== 'open') {
        throw new Error(publicationState === 'committed'
          ? 'collection bundle is already committed; publication is one-shot'
          : publicationState === 'aborted'
            ? 'collection bundle writer was aborted'
            : 'collection bundle publication is already in progress');
      }
      publicationState = 'publishing';
      try {
        await assertRootIdentity(normalizedRoot, rootIdentity);
        validateBundleHeader(bundle);
        const {
          title,
          source,
          backend,
          url,
          filters,
          inventory: rawInventory,
          sourceMetadata,
          canonicalItems: rawCanonicalItems,
        } = bundle;
        const inventory = normalizeInventory(normalizedRoot, rawInventory);
        const canonicalItems = normalizeCanonicalItems(rawCanonicalItems);
        await validateCanonicalItems(normalizedRoot, canonicalItems);
        validateCanonicalCorrespondence(inventory, canonicalItems);
        await validateInventoryPaths(normalizedRoot, inventory);
        const status = collectionStatusFor(bundle, inventory);
        const metadata = {
          schemaVersion: '1.0',
          storage: { fallback: false },
          collection: { status, items: inventory },
          sourceMetadata,
        };
        const sourceScope = bundle.sourceScope ?? [SOURCE_SCOPE[source] || source];
        if (!Array.isArray(sourceScope) || sourceScope.length === 0
          || sourceScope.some((entry) => typeof entry !== 'string' || !entry.trim())) {
          throw new TypeError('bundle.sourceScope must be a non-empty string array');
        }
        const materializationTarget = bundle.materializationTarget
          ?? (bundle.metadataOnly === true ? 'candidates' : 'all');
        if (!['candidates', 'selected', 'all'].includes(materializationTarget)) {
          throw new TypeError('bundle.materializationTarget is invalid');
        }
        const session = initializedRoot
          ? structuredClone(initializedRoot.session)
          : newSession({
            ...initialTask,
            query: initialTask.query || bundle.query || title,
            sourceScope: [...new Set(sourceScope)],
            materializationTarget: initialTask.materializationTarget || materializationTarget,
          });
        if (initializedRoot) {
          const allowed = new Set(session.task.sourceScope || []);
          const denied = sourceScope.filter((entry) => !allowed.has(entry));
          if (denied.length) throw new Error(`initialized session sourceScope does not allow: ${denied.join(', ')}`);
        }
        if (initializedRoot) {
          await prepareBundleBackup(normalizedRoot, rootIdentity);
        }
        session.task.status = status === 'failed' ? 'failed' : 'collected';
        session.task.publicationStatus = 'uncommitted';
        session.collection = metadata;
        await writePersistedJson(normalizedRoot, rootIdentity, 'session.json', session);
        // Readers reject the session until both compatibility views have been published.
        if (beforeCompatibilityPublish) await beforeCompatibilityPublish();
        await writePersistedJson(normalizedRoot, rootIdentity, 'sanitized/metadata.json', metadata);
        await writePersistedJson(normalizedRoot, rootIdentity, 'collection-result.json', {
          schemaVersion: '1.0',
          title,
          source,
          backend,
          url,
          filters,
          items: canonicalItems,
        });
        session.task.publicationStatus = 'committed';
        await writePersistedJson(normalizedRoot, rootIdentity, 'session.json', session);
        if (initializedRoot) {
          await removeBundleBackup(normalizedRoot, rootIdentity);
        }
        publicationState = 'committed';
        releaseWriterLock();
        await assertRootIdentity(normalizedRoot, rootIdentity);
      } catch (error) {
        if (initializedRoot) {
          try { await recoverInterruptedBundle(normalizedRoot, rootIdentity); } catch {}
        }
        if (publicationState !== 'committed') publicationState = 'open';
        throw error;
      }
    },
  };

  return writer;
}
