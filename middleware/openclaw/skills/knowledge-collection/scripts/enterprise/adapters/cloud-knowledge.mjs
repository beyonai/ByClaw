import crypto from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { createArtifactWriter } from '../shared/artifact-writer.mjs';
import { runCli, positiveEnv } from '../shared/cli-runner.mjs';
import { deriveCollectionStatus, SOURCE_IDENTITY, handledOutcome, inventoryCounts } from '../shared/status-model.mjs';
import { readResumeCandidates } from '../shared/resume.mjs';

const identity = SOURCE_IDENTITY['cloud-knowledge'];
const MAX_MATERIALIZED_BYTES = 50 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set(['md', 'markdown', 'txt', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']);
const CONVERTIBLE_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']);
const SHA256 = /^[a-f0-9]{64}$/;

function reasonOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function objectOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function asString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function asInteger(value) {
  return Number.isSafeInteger(value) ? value : Number.isSafeInteger(Number(value)) ? Number(value) : null;
}

function metadataValue(metadata, key) {
  const value = metadata?.[key];
  if (objectOf(value) && Object.hasOwn(value, 'value')) return value.value;
  return value;
}

function validateCloudRemotePath(filePath) {
  if (typeof filePath !== 'string' || !filePath.startsWith('/') || filePath.includes('\\') || /[\u0000-\u001f]/u.test(filePath)) {
    throw new Error(`invalid cloud filePath: ${String(filePath)}`);
  }
  const parts = filePath.split('/');
  if (parts.length < 2 || parts.slice(1).some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`invalid cloud filePath: ${filePath}`);
  }
  return filePath;
}

function isAuthorizedCloudPath(scope, resourceId, filePath) {
  validateCloudRemotePath(filePath);
  const resource = scope.resources.find((entry) => entry.resourceId === resourceId);
  if (!resource) return false;
  const prefix = resource.directoryPath === '/' ? '/' : resource.directoryPath.replace(/\/+$/u, '');
  return prefix === '/' || filePath === prefix || filePath.startsWith(`${prefix}/`);
}

function safeItemId(resourceId, filePath) {
  return `cloud-${crypto.createHash('sha256').update(`${resourceId}\n${filePath}`).digest('hex').slice(0, 16)}`;
}

function originalFileName(filePath) {
  const name = filePath.slice(filePath.lastIndexOf('/') + 1);
  if (!name || name === '.' || name === '..' || /[\\/\u0000-\u001f]/u.test(name)) {
    throw new Error(`invalid cloud file name: ${filePath}`);
  }
  return name;
}

function extensionFor(fileType, filePath) {
  const normalized = asString(fileType).toLowerCase().replace(/^\./u, '');
  if (SUPPORTED_EXTENSIONS.has(normalized)) return normalized;
  return '';
}

function duplicateGroup(fileSignature, itemId) {
  if (fileSignature) return `sha256:${fileSignature}`;
  return `source:${identity.sourceSkill}\n${itemId}`;
}

function cloudCandidateFromRecord(record, scope) {
  const value = objectOf(record) || {};
  const metadata = objectOf(value.metadata) || {};
  const resourceId = asInteger(value.resourceId);
  const filePath = asString(value.filePath);
  if (!resourceId || !filePath || !isAuthorizedCloudPath(scope, resourceId, filePath)) return null;
  const type = extensionFor(metadataValue(metadata, 'fileType'), filePath);
  const fileSize = asInteger(metadataValue(metadata, 'fileSize'));
  const fileSignature = asString(metadataValue(metadata, 'fileSignature')).toLowerCase();
  if (!type || fileSize === null || fileSize < 0 || (fileSignature && !SHA256.test(fileSignature))) {
    const error = new Error(`cloud candidate metadata is invalid: ${filePath}`);
    error.reasonCode = 'INVALID_RESPONSE';
    throw error;
  }
  const itemId = safeItemId(resourceId, filePath);
  const title = originalFileName(filePath);
  return {
    itemId,
    resourceId,
    filePath,
    originalFileName: title,
    fileType: type,
    fileSize,
    ...(fileSignature ? { fileSignature } : {}),
    duplicateGroupKey: duplicateGroup(fileSignature, itemId),
    duplicateGroupProvisional: !fileSignature,
    title,
    sourceUrl: `cloud-knowledge://${resourceId}${filePath}`,
    sourceItemId: `${resourceId}:${filePath}`,
    sourceType: 'file',
    materializationType: type,
  };
}

function inventoryItem(candidate, rawArtifacts, materialization = {}) {
  return {
    ...candidate,
    sourceSkill: identity.sourceSkill,
    backend: identity.backend,
    collectionFilters: { resourceId: candidate.resourceId, directoryPath: candidate.filePath.slice(0, candidate.filePath.lastIndexOf('/')) || '/' },
    rawArtifacts,
    media: { coverStatus: 'not-present', coverCount: 0, materializedCoverCount: 0, reason: null },
    materialization: {
      status: materialization.status || 'pending',
      markdownPath: materialization.markdownPath || null,
      sanitizedPath: materialization.sanitizedPath || null,
      pendingArtifactCleanup: [],
      reason: materialization.reason || 'discovery only; materialization is deferred',
      contentGranularity: materialization.contentGranularity || 'unknown',
    },
  };
}

function responseRecords(value) {
  const root = objectOf(value) || {};
  const data = objectOf(root.data) || root;
  if (Array.isArray(root.data)) return root.data;
  return Array.isArray(data.items) ? data.items : [];
}

function sanitizedReason(error, fallback) {
  const message = reasonOf(error)
    .replace(/Bearer\s+[^\s]+/giu, 'Bearer [REDACTED]')
    .replace(/(?:token|cookie|authorization|password|secret)\s*[:=]\s*[^\s,;]+/giu, '$1=[REDACTED]')
    .replace(/[\r\n]+/gu, ' ')
    .slice(0, 240);
  return `${fallback}: ${message || fallback}`;
}

function cliArgsResult(result) {
  return {
    exitCode: result?.exitCode ?? null,
    failure: result?.failure ? { code: result.failure.code || 'start-failed' } : null,
  };
}

async function callJson(writer, python, script, args, artifact, env) {
  const result = await runCli(python, [script, ...args], { env });
  if (result.failure || result.exitCode !== 0) {
    const error = new Error(`project-cloud-knowledge command failed with exit ${result.exitCode ?? 'unknown'}`);
    error.auth = /401|403|auth|required|login|登录/iu.test(`${result.stdout}\n${result.stderr}`);
    error.reasonCode = error.auth ? 'AUTH_REQUIRED' : 'SOURCE_FAILED';
    error.evidence = cliArgsResult(result);
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    const error = new Error('project-cloud-knowledge returned invalid JSON');
    error.reasonCode = 'INVALID_RESPONSE';
    throw error;
  }
  if (parsed?.ok === false) {
    const error = new Error('project-cloud-knowledge returned an unsuccessful response');
    error.reasonCode = 'SOURCE_FAILED';
    throw error;
  }
  await writer.writeJson(artifact, parsed);
  return parsed;
}

async function readCloudScope(sessionDir) {
  const session = JSON.parse(await readFile(join(resolve(sessionDir), 'session.json'), 'utf8'));
  const scope = session?.task?.cloudDiscoveryScope;
  if (!scope || scope.schemaVersion !== '1.0' || !Array.isArray(scope.resources) || scope.resources.length === 0) {
    throw new Error('cloudDiscoveryScope is required for cloud-knowledge collection');
  }
  return scope;
}

function whereFor(directoryPath) {
  const clauses = [{ in: { fieldName: 'fileType', value: [...SUPPORTED_EXTENSIONS] } }];
  if (directoryPath !== '/') clauses.unshift({ prefix: { fieldName: 'filePath', value: directoryPath } });
  return clauses.length === 1 ? clauses[0] : { and: clauses };
}

function sortCandidates(items) {
  return [...items].sort((a, b) => {
    const score = Number(b.score || 0) - Number(a.score || 0);
    if (score) return score;
    return a.resourceId - b.resourceId || a.filePath.localeCompare(b.filePath) || a.itemId.localeCompare(b.itemId);
  });
}

function materializationPaths(candidate) {
  const directory = `cloud-${candidate.itemId}`;
  return {
    markdownPath: `markdown/items/${directory}/index.md`,
    sanitizedPath: `sanitized/items/${directory}/index.md`,
  };
}

async function assertRegularFile(target, maxBytes) {
  const entry = await lstat(target);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('downloaded cloud file is not a regular file');
  if (entry.size <= 0) throw new Error('downloaded cloud file is empty');
  if (entry.size > maxBytes) throw new Error(`downloaded cloud file exceeds ${maxBytes} bytes`);
}

function converterCommand(dependencies) {
  if (Object.hasOwn(dependencies, 'converterBin')) return { bin: dependencies.converterBin, prefix: [] };
  return {
    bin: process.execPath,
    prefix: [new URL('../../../../by-doc-to-markdown/scripts/by-doc-to-markdown.mjs', import.meta.url).pathname],
  };
}

async function materializeOne(writer, candidate, dependencies, env) {
  const maxBytes = positiveEnv('KNOWLEDGE_COLLECTION_MAX_MATERIALIZED_BYTES', MAX_MATERIALIZED_BYTES, env);
  const paths = materializationPaths(candidate);
  const extension = `.${candidate.fileType}`;
  const rawRelative = `raw/download/${candidate.itemId}/download-${candidate.itemId}${extension}`;
  const rawAbsolute = writer.absolute(rawRelative);
  await callJson(writer, dependencies.python, dependencies.script, [
    'download', '--resource-id', String(candidate.resourceId), '--file-path', candidate.filePath, '--output', rawAbsolute,
  ], `raw/download-${candidate.itemId}.json`, env);
  await assertRegularFile(rawAbsolute, maxBytes);
  if (['md', 'markdown', 'txt'].includes(candidate.fileType)) {
    const content = await readFile(rawAbsolute, 'utf8');
    if (!content.trim()) throw new Error('downloaded cloud text is empty');
    const rendered = `---\ntitle: ${JSON.stringify(candidate.title)}\nsource: "cloud-knowledge"\nsource_url: ${JSON.stringify(candidate.sourceUrl)}\n---\n\n${content.trim()}\n`;
    await Promise.all([writer.writeText(paths.markdownPath, rendered), writer.writeText(paths.sanitizedPath, rendered)]);
    return inventoryItem(candidate, [...candidate.rawArtifacts, rawRelative, `raw/download-${candidate.itemId}.json`], {
      status: 'materialized', ...paths, reason: null, contentGranularity: 'full-text',
    });
  }
  if (!CONVERTIBLE_EXTENSIONS.has(extension)) throw new Error(`unsupported cloud format: ${candidate.fileType}`);
  const converter = converterCommand(dependencies);
  if (!converter.bin) throw new Error('by-doc-to-markdown converter is unavailable');
  const result = await runCli(converter.bin, [...converter.prefix, 'convert', '--file-path', rawAbsolute, '--output', writer.absolute(paths.markdownPath)], { env });
  if (result.failure || result.exitCode !== 0) throw new Error(`cloud document conversion failed with exit ${result.exitCode ?? 'unknown'}`);
  await assertRegularFile(writer.absolute(paths.markdownPath), maxBytes);
  await writer.writeText(paths.sanitizedPath, await readFile(writer.absolute(paths.markdownPath), 'utf8'));
  return inventoryItem(candidate, [...candidate.rawArtifacts, rawRelative, `raw/download-${candidate.itemId}.json`], {
    status: 'materialized', ...paths, reason: null, contentGranularity: 'full-text',
  });
}

export function createCloudKnowledgeAdapter(dependencies = {}) {
  const env = dependencies.env || process.env;
  const python = dependencies.python || process.execPath;
  const script = dependencies.script || new URL('../../../../project-cloud-knowledge/scripts/project_cloud_knowledge.py', import.meta.url).pathname;

  async function search(request = {}) {
    const scope = await readCloudScope(request.outputDir);
    const writer = await createArtifactWriter(request.outputDir);
    try {
    const groups = [...new Map(scope.resources.map((resource) => [resource.directoryPath, resource])).values()]
      .sort((a, b) => (a.directoryPath === '/' ? 1 : b.directoryPath === '/' ? -1 : a.directoryPath.localeCompare(b.directoryPath)));
    const allCandidates = [];
    const failures = [];
    const rawArtifacts = [];
    for (const [index, group] of groups.entries()) {
      const artifact = `raw/search-file-${index + 1}.json`;
      try {
        const result = await callJson(writer, python, script, [
          'search-file', ...scope.resources.filter((resource) => resource.directoryPath === group.directoryPath)
            .flatMap((resource) => ['--resource-id', String(resource.resourceId)]),
          '--query', request.query, '--where-json', JSON.stringify(whereFor(group.directoryPath)),
          '--metadata-field', 'fileType', '--metadata-field', 'fileSize', '--metadata-field', 'fileSignature',
          '--metadata-field', 'updatedAt', '--top-k', String(request.limit),
        ], artifact, env);
        rawArtifacts.push(artifact);
        for (const record of responseRecords(result)) {
          try {
            const candidate = cloudCandidateFromRecord(record, scope);
            if (candidate) allCandidates.push({ ...candidate, sourceRank: allCandidates.length + 1, rawArtifacts: [artifact], score: Number(record.score || 0) });
          } catch (error) {
            failures.push({ directoryPath: group.directoryPath, reason: sanitizedReason(error, error.reasonCode || 'INVALID_RESPONSE') });
          }
        }
      } catch (error) {
        await writer.writeJson(artifact, {
          operation: 'search-file',
          directoryPath: group.directoryPath,
          status: 'failed',
          reasonCode: error.reasonCode || 'SOURCE_FAILED',
          reason: sanitizedReason(error, error.reasonCode || 'SOURCE_FAILED'),
        });
        rawArtifacts.push(artifact);
        failures.push({
          directoryPath: group.directoryPath,
          reasonCode: error.reasonCode || 'SOURCE_FAILED',
          reason: sanitizedReason(error, error.reasonCode || 'SOURCE_FAILED'),
        });
      }
    }
    const unique = [...new Map(allCandidates.map((item) => [`${item.resourceId}\n${item.filePath}`, item])).values()];
    const found = sortCandidates(unique).slice(0, request.limit);
    const inventory = found.map((candidate) => inventoryItem(candidate, candidate.rawArtifacts));
    const discoverySucceeded = groups.length === 0 || failures.length < groups.length;
    const status = deriveCollectionStatus({
      discoverySucceeded,
      metadataOnly: true,
      paginationFailed: failures.length > 0,
      itemStates: inventory.map((item) => item.materialization.status),
    });
    const terminal = failures.length > 0 ? {
      status: failures.every((failure) => failure.reasonCode === 'AUTH_REQUIRED') ? 'auth_required' : 'failed',
      reasonCode: failures.every((failure) => failure.reasonCode === 'AUTH_REQUIRED') ? 'AUTH_REQUIRED' : 'SOURCE_FAILED',
      reason: failures.map((failure) => failure.reason).join('; ').slice(0, 240),
    } : null;
    const sourceMetadata = {
      ...identity, operation: 'search', metadataOnly: true,
      discovery: { groupsRequested: groups.length, groupsSucceeded: groups.length - failures.length, groupsFailed: failures, rawMatches: allCandidates.length, uniqueMatches: unique.length, returnedMatches: found.length, limitReached: found.length === request.limit },
      ...(terminal ? { terminal } : {}),
    };
    await writer.writeJson('raw/metadata.json', {
      ...identity, operation: 'search', rawArtifacts, status,
      sourceMetadata,
    });
    await writer.writeCollectionBundle({
      title: `Cloud knowledge search: ${request.query}`, source: identity.source, backend: identity.backend,
      url: 'cloud-knowledge://search', filters: { query: request.query }, inventory, canonicalItems: [],
      sourceMetadata,
      metadataOnly: true, paginationFailed: failures.length > 0, discoverySucceeded,
    });
    return {
      ...handledOutcome(identity.connector, terminal?.status || status, request.outputDir, inventoryCounts(inventory)),
      ...(terminal ? { reasonCode: terminal.reasonCode, reason: terminal.reason } : {}),
    };
    } catch (error) {
      await writer.abort().catch(() => {});
      throw error;
    }
  }

  async function materialize(request = {}) {
    const scope = await readCloudScope(request.sessionDir);
    if (resolve(request.sessionDir) !== resolve(request.outputDir)) throw new Error('cloud-knowledge materialization must use the discovery session');
    const candidates = await readResumeCandidates(request.sessionDir, identity.source, request.itemIds || []);
    const authorizationFailures = [];
    const validCandidates = [];
    for (const candidate of candidates) {
      let authorized = false;
      try {
        authorized = Number.isSafeInteger(candidate.resourceId)
          && typeof candidate.filePath === 'string'
          && isAuthorizedCloudPath(scope, candidate.resourceId, candidate.filePath);
      } catch {
        authorized = false;
      }
      if (!authorized) {
        authorizationFailures.push(inventoryItem(candidate, candidate.rawArtifacts, {
          status: 'failed',
          reason: `SOURCE_NOT_AUTHORIZED_BY_DISCOVERY: ${candidate.itemId}`,
        }));
        continue;
      }
      if (!SUPPORTED_EXTENSIONS.has(candidate.fileType) || !Number.isSafeInteger(candidate.fileSize) || candidate.fileSize < 0) {
        throw new Error(`cloud candidate preflight rejected ${candidate.itemId}: unsupported format or invalid fileSize`);
      }
      validCandidates.push(candidate);
    }
    const writer = await createArtifactWriter(request.outputDir, { allowExistingSession: true });
    try {
      const inventory = [...authorizationFailures];
      for (const candidate of validCandidates) {
        try {
          inventory.push(await materializeOne(writer, candidate, { ...dependencies, python, script }, env));
        } catch (error) {
          const failedArtifact = `raw/failed-${candidate.itemId}.json`;
          await writer.writeJson(failedArtifact, { itemId: candidate.itemId, stage: 'materialization', reason: sanitizedReason(error, 'SOURCE_DOWNLOAD_FAILED') });
          inventory.push(inventoryItem(candidate, [...candidate.rawArtifacts, failedArtifact], { status: 'failed', reason: sanitizedReason(error, error.message?.includes('unsupported') ? 'UNSUPPORTED_FORMAT' : 'SOURCE_DOWNLOAD_FAILED') }));
        }
      }
      const canonicalItems = inventory.filter((item) => item.materialization.status === 'materialized').map((item) => ({
        title: item.title, url: item.sourceUrl, author: '', publishTime: '', markdown: item.materialization.sanitizedPath, fileName: item.materialization.sanitizedPath,
      }));
      const status = deriveCollectionStatus({ itemStates: inventory.map((item) => item.materialization.status) });
      await writer.writeCollectionBundle({
        title: 'Cloud knowledge materialized collection', source: identity.source, backend: identity.backend,
        url: 'cloud-knowledge://materialize', filters: {}, inventory, canonicalItems,
        sourceMetadata: { ...identity, operation: 'materialize', metadataOnly: false, selectedItemIds: request.itemIds },
        metadataOnly: false,
      });
      return handledOutcome(identity.connector, status, request.outputDir, inventoryCounts(inventory));
    } catch (error) {
      await writer.abort().catch(() => {});
      throw error;
    }
  }

  return { ...identity, search, materialize };
}
