import {
  chmod,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import { constants, lstatSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, extname, isAbsolute, parse, relative, resolve, sep } from 'node:path';
import { removeSensitiveFields, sanitizeSensitive } from './secret-sanitizer.mjs';
import { deriveCollectionStatus } from './status-model.mjs';

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const REQUIRED_DIRECTORIES = ['raw', 'markdown', 'sanitized', 'sanitized/items'];
const CANONICAL_ITEM_KEYS = ['title', 'url', 'author', 'publishTime', 'markdown', 'fileName'];

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
      rawArtifacts: [...item.rawArtifacts],
      materialization: {
        ...item.materialization,
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

export async function createArtifactWriter(root) {
  if (!isAbsolute(root)) {
    throw new TypeError('output root must be an absolute path');
  }
  const normalizedRoot = resolve(root);
  const rootIdentity = await createPrivateRoot(normalizedRoot);
  let publicationState = 'open';

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

    async abort() {
      if (publicationState === 'committed') {
        throw new Error('cannot abort a committed collection bundle');
      }
      if (publicationState === 'publishing') {
        throw new Error('cannot abort a collection bundle publication in progress');
      }
      await removeOwnedPath(normalizedRoot, rootIdentity, true);
      publicationState = 'aborted';
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
        await writePersistedJson(normalizedRoot, rootIdentity, 'sanitized/metadata.json', {
          schemaVersion: '1.0',
          storage: { fallback: false },
          collection: { status, items: inventory },
          retention: { auditRequired: false, userRequested: false },
          postProcessing: { runs: [] },
          sourceMetadata,
        });
        // collection-result.json is the commit marker; metadata alone is an uncommitted bundle.
        await writePersistedJson(normalizedRoot, rootIdentity, 'collection-result.json', {
          schemaVersion: '1.0',
          title,
          source,
          backend,
          url,
          filters,
          items: canonicalItems,
        });
        publicationState = 'committed';
        await assertRootIdentity(normalizedRoot, rootIdentity);
      } catch (error) {
        if (publicationState !== 'committed') publicationState = 'open';
        throw error;
      }
    },
  };

  return writer;
}
