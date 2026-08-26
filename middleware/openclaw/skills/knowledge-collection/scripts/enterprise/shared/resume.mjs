import { lstat, readFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

function artifactPath(root, artifact) {
  if (typeof artifact !== 'string' || !artifact || isAbsolute(artifact)) throw new Error('resume artifact path is unsafe');
  const path = resolve(root, artifact);
  const fromRoot = relative(root, path);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error('resume artifact path is unsafe');
  }
  return path;
}

function sameIdentity(entry, identity) {
  return entry.dev === identity.dev && entry.ino === identity.ino;
}

async function assertRootIdentity(root, identity) {
  const rootEntry = await lstat(root);
  if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink() || !sameIdentity(rootEntry, identity)) {
    throw new Error('resume session directory was replaced');
  }
}

async function safeRegularFile(root, identity, path) {
  const rootEntry = await lstat(root);
  if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) throw new Error('resume session directory is unsafe');
  if (!sameIdentity(rootEntry, identity)) throw new Error('resume session directory was replaced');
  const fromRoot = relative(root, path);
  const segments = fromRoot ? fromRoot.split(sep) : [];
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    const entry = await lstat(current);
    if (entry.isSymbolicLink()) throw new Error(`resume session file is unsafe: ${path}`);
    if (current !== path && !entry.isDirectory()) throw new Error(`resume session file is unsafe: ${path}`);
    if (current === path && !entry.isFile()) throw new Error(`resume session file is unsafe: ${path}`);
  }
}

export async function readResumeMetadata(sessionDir) {
  const root = resolve(sessionDir);
  const rootEntry = await lstat(root);
  if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) throw new Error('resume session directory is unsafe');
  const resumeIdentity = { dev: rootEntry.dev, ino: rootEntry.ino };
  const metadataPath = join(root, 'sanitized/metadata.json');
  await safeRegularFile(root, resumeIdentity, metadataPath);
  let metadata;
  try { metadata = JSON.parse(await readFile(metadataPath, 'utf8')); } catch { throw new Error('resume session metadata is invalid JSON'); }
  await assertRootIdentity(root, resumeIdentity);
  return { root, resumeIdentity, metadata };
}

export async function readResumeCandidates(sessionDir, source, itemIds) {
  const { root, resumeIdentity, metadata } = await readResumeMetadata(sessionDir);
  if (metadata?.sourceMetadata?.source !== source || metadata?.sourceMetadata?.metadataOnly !== true) {
    throw new Error(`resume session is not a metadata-only ${source} discovery`);
  }
  const inventory = Array.isArray(metadata?.collection?.items) ? metadata.collection.items : [];
  const selected = itemIds.map((itemId) => inventory.find((item) => item?.itemId === itemId));
  if (selected.some((item) => !item)) throw new Error('one or more --item-ids are not candidates in the resume session');
  if (selected.some((item) => item?.materialization?.status !== 'pending')) {
    throw new Error('only pending metadata-only candidates can be materialized');
  }
  return selected.map((item) => {
    const candidate = {
      itemId: item.itemId,
      sourceItemId: item.sourceItemId,
      sourceUrl: item.sourceUrl,
      title: item.title,
      type: typeof item.materializationType === 'string'
        ? item.materializationType
        : (source === 'dws' && item.sourceType === 'file' ? '' : (item.sourceType || '')),
      sourceType: item.sourceType || '',
      sourceRank: item.sourceRank,
      rawArtifacts: Array.isArray(item.rawArtifacts) ? item.rawArtifacts : [],
      collectionFilters: item.collectionFilters || {},
      resumeRoot: root,
    };
    if (source === 'ima') {
      candidate.kb = typeof item.kb === 'string' ? item.kb : '';
      candidate.materializationKb = typeof item.materializationKb === 'string' ? item.materializationKb : '';
      candidate.preview = typeof item.preview === 'string' ? item.preview : '';
      candidate.coverUrls = Array.isArray(item.coverUrls) ? item.coverUrls : [];
    }
    Object.defineProperty(candidate, 'resumeIdentity', { value: resumeIdentity });
    return candidate;
  });
}

export async function copyResumeArtifacts(writer, candidates) {
  return Promise.all(candidates.map(async (candidate) => {
    const copied = [];
    for (const artifact of candidate.rawArtifacts) {
      const source = artifactPath(candidate.resumeRoot, artifact);
      await safeRegularFile(candidate.resumeRoot, candidate.resumeIdentity, source);
      const target = `raw/discovery/${candidate.itemId}/${basename(artifact)}`;
      await writer.writeText(target, await readFile(source, 'utf8'));
      copied.push(target);
    }
    const { resumeRoot, resumeIdentity, ...result } = candidate;
    return { ...result, rawArtifacts: copied };
  }));
}
