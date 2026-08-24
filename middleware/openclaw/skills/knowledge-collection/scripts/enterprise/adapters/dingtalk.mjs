import crypto from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { createArtifactWriter } from '../shared/artifact-writer.mjs';
import { positiveEnv, runCli } from '../shared/cli-runner.mjs';
import { withRateLimitRetry } from '../shared/retry.mjs';
import { copyResumeArtifacts, readResumeCandidates } from '../shared/resume.mjs';
import { deriveCollectionStatus, SOURCE_IDENTITY, handledOutcome, inventoryCounts } from '../shared/status-model.mjs';

const identity = SOURCE_IDENTITY.dingtalk;
const MAX_SEARCH_PAGE_SIZE = 30;
const MAX_FOLDER_DEPTH = 3;
const MAX_FOLDER_PAGES = 50;
const MAX_MATERIALIZED_BYTES = 50 * 1024 * 1024;
const AUTH_FAILURE = /AUTH_TOKEN_EXPIRED|USER_TOKEN_ILLEGAL/i;
const NATIVE_DOCUMENT_TYPES = new Set(['doc', 'document', 'adoc', 'alidoc']);
const CONVERTIBLE_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']);
const DEFAULT_CONVERTER_SCRIPT = new URL('../../../../by-doc-to-markdown/scripts/by-doc-to-markdown.mjs', import.meta.url).pathname;

function reasonOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function responseData(value) {
  const outer = asObject(value) || {};
  return asObject(outer.data) || outer;
}

function records(value) {
  const data = responseData(value);
  for (const key of ['items', 'list', 'results', 'result', 'files', 'dentries']) {
    if (Array.isArray(data[key])) return data[key];
  }
  return [];
}

function nextToken(value) {
  const data = responseData(value);
  for (const key of ['nextPageToken', 'nextToken', 'nextCursor', 'next_cursor', 'pageToken', 'cursor']) {
    if (typeof data[key] === 'string' && data[key]) return data[key];
  }
  return null;
}

function stringValue(record, keys) {
  for (const key of keys) {
    if (typeof record?.[key] === 'string' && record[key].trim()) return record[key].trim();
  }
  return '';
}

function searchResult(record) {
  const sourceItemId = stringValue(record, ['id', 'nodeId', 'nodeUuid', 'fileId', 'dentryUuid', 'uuid']);
  const sourceUrl = stringValue(record, ['url', 'webUrl', 'link', 'sourceUrl']) || (sourceItemId ? `dingtalk://doc/${sourceItemId}` : '');
  if (!sourceItemId || !sourceUrl) return null;
  return {
    sourceItemId,
    sourceUrl,
    title: stringValue(record, ['name', 'title', 'fileName']) || sourceItemId,
    type: stringValue(record, ['type', 'dentryType', 'fileType', 'resourceType']).toLowerCase(),
  };
}

function driveResult(record) {
  const sourceItemId = stringValue(record, ['dentryUuid', 'fileId', 'id', 'uuid']);
  if (!sourceItemId) return null;
  const type = stringValue(record, ['type', 'dentryType', 'fileType']).toLowerCase();
  const isFolder = type === 'folder' || record?.isFolder === true;
  return {
    sourceItemId,
    sourceUrl: stringValue(record, ['url', 'webUrl', 'link']) || `dingtalk://drive/${sourceItemId}`,
    title: stringValue(record, ['name', 'title', 'fileName']) || sourceItemId,
    isFolder,
    type: ['doc', 'document', 'adoc', 'alidoc', 'pdf', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(type) ? type : '',
    sourceType: type,
  };
}

function matchesRequestedExtension(result, extensions) {
  if (!Array.isArray(extensions) || extensions.length === 0) return true;
  const requested = new Set(extensions.map((extension) => extension.replace(/^\./, '').toLowerCase()));
  const fromTitle = extname(result.title || '').replace(/^\./, '').toLowerCase();
  const fromType = (result.type || '').replace(/^\./, '').toLowerCase();
  return requested.has(fromTitle || fromType);
}

function matchesRequestedQuery(result, query) {
  const normalized = typeof query === 'string' ? query.trim().toLocaleLowerCase() : '';
  return !normalized || (result.title || '').toLocaleLowerCase().includes(normalized);
}

function itemIdFor(result) {
  return `dws-${crypto.createHash('sha256').update(result.sourceItemId).digest('hex').slice(0, 16)}`;
}

function inventoryItem(result, rawArtifacts, filters, materialization = {}) {
  return {
    itemId: itemIdFor(result),
    title: result.title,
    sourceUrl: result.sourceUrl,
    sourceItemId: result.sourceItemId,
    sourceType: result.sourceType || result.type || '',
    materializationType: result.type || '',
    sourceRank: result.sourceRank || null,
    sourceSkill: identity.sourceSkill,
    backend: identity.backend,
    collectionFilters: filters,
    rawArtifacts,
    materialization: {
      status: materialization.status || 'pending',
      markdownPath: materialization.markdownPath || null,
      sanitizedPath: materialization.sanitizedPath || null,
      pendingArtifactCleanup: [],
      reason: materialization.reason || 'discovery only; materialization is deferred',
    },
  };
}

function filtersFor(request) {
  return {
    ...(Array.isArray(request.workspaceIds) ? { workspaceIds: request.workspaceIds } : {}),
    ...(Array.isArray(request.extensions) ? { extensions: request.extensions } : {}),
    ...(typeof request.folderId === 'string' && request.folderId ? { folderId: request.folderId } : {}),
  };
}

function collectionStatus(inventory, { discoverySucceeded = true, metadataOnly = false, paginationFailed = false } = {}) {
  return deriveCollectionStatus({
    discoverySucceeded,
    metadataOnly,
    paginationFailed,
    itemStates: inventory.map((item) => item.materialization.status),
  });
}

async function persist(writer, request, {
  inventory, canonicalItems, rawArtifacts, status, sourceMetadata, paginationFailed = false, discoverySucceeded = true,
}) {
  await writer.writeJson('raw/metadata.json', {
    ...identity, operation: request.folderId ? 'drive.list' : 'doc.search', rawArtifacts, status, sourceMetadata,
  });
  await writer.writeCollectionBundle({
    title: `DingTalk search: ${request.query}`,
    source: identity.source,
    backend: identity.backend,
    url: request.folderId ? `dingtalk://drive/${request.folderId}` : 'dingtalk://doc/search',
    filters: filtersFor(request),
    inventory,
    canonicalItems,
    sourceMetadata,
    metadataOnly: Boolean(request.metadataOnly),
    paginationFailed,
    discoverySucceeded,
  });
}

function parsedError(result) {
  for (const output of [result?.stderr, result?.stdout]) {
    try {
      const envelope = JSON.parse(output || '');
      const error = asObject(envelope?.error);
      if (error) return error;
    } catch {}
  }
  return null;
}

function cliFailure(result) {
  const output = `${result?.stdout || ''}\n${result?.stderr || ''}`;
  const error = parsedError(result);
  const structuredAuth = error?.category === 'auth' || error?.reason === 'auth_refresh_failed';
  if (structuredAuth || AUTH_FAILURE.test(output)) return { auth: true, reason: 'DWS authentication is required' };
  if (result?.failure) return { auth: false, reason: `dws failed to start: ${result.failure.code || result.failure.message}` };
  return { auth: false, reason: `dws command failed with exit ${result?.exitCode}` };
}

function rateLimit(result) {
  const error = parsedError(result);
  const output = `${result?.stdout || ''}\n${result?.stderr || ''}`;
  const explicit = ['rate_limit', 'rate-limited', 'rate_limited', 'throttled'].includes(error?.category)
    || Number(error?.code) === 429 || /\bHTTP\s*429\b/i.test(output);
  if (!explicit) return null;
  return { retryAfterMs: error?.retryAfterMs ?? error?.retry_after_ms ?? error?.retryAfter };
}

function cliEvidence(result) {
  return {
    exitCode: result?.exitCode ?? null,
    stdout: result?.stdout ?? '',
    stderr: result?.stderr ?? '',
    failure: result?.failure ? { code: result.failure.code, message: result.failure.message } : null,
  };
}

function withContext(message, context = {}) {
  return Object.assign(new Error(message), context);
}

function commandEnvironment(dependencies) {
  const env = { ...process.env, ...(dependencies.env || {}) };
  if (typeof env.DWS_HOME !== 'string' || !env.DWS_HOME) {
    throw withContext('DWS_HOME is required for DWS discovery', { fatal: true });
  }
  return { ...env, HOME: env.DWS_HOME };
}

async function callJson(writer, bin, env, args, artifact, dependencies = {}) {
  let result;
  try {
    const retried = await withRateLimitRetry(async () => {
      result = await runCli(bin, args, { env });
      const limited = rateLimit(result);
      return limited ? { rateLimited: true, ...limited } : { result };
    }, dependencies.rateLimitRetryDelay ? { delay: dependencies.rateLimitRetryDelay } : undefined);
    if (retried.exhausted) {
      throw withContext('DWS rate limit retry attempts exhausted', { evidence: { args, ...cliEvidence(result) } });
    }
    result = retried.result;
  } catch (error) {
    if (error?.evidence) throw error;
    throw withContext(reasonOf(error), { evidence: { args, error: reasonOf(error) } });
  }
  if (result.failure || result.exitCode !== 0) {
    const failure = cliFailure(result);
    throw withContext(failure.reason, { auth: failure.auth, fatal: Boolean(result.failure), evidence: { args, ...cliEvidence(result) } });
  }
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch {
    throw withContext('dws returned invalid JSON', { evidence: { args, ...cliEvidence(result) } });
  }
  await writer.writeJson(artifact, parsed);
  return parsed;
}

function itemSuffix(result) {
  return crypto.createHash('sha256').update(result.sourceItemId).digest('hex').slice(0, 16);
}

function materializationPaths(result) {
  const suffix = itemSuffix(result);
  return { markdownPath: `markdown/items/${suffix}.md`, sanitizedPath: `sanitized/items/${suffix}.md` };
}

function nativeMarkdown(response) {
  const data = responseData(response);
  for (const key of ['markdown', 'content', 'text']) {
    if (typeof data[key] === 'string' && data[key].trim()) return data[key];
  }
  throw new Error('dws doc read returned no Markdown content');
}

function fileExtension(result) {
  const fromTitle = extname(result.title || '').toLowerCase();
  if (CONVERTIBLE_EXTENSIONS.has(fromTitle)) return fromTitle;
  const fromType = result.type.startsWith('.') ? result.type : `.${result.type}`;
  return CONVERTIBLE_EXTENSIONS.has(fromType) ? fromType : '';
}

async function assertPrivateRegularFile(path, maxBytes, label) {
  const entry = await lstat(path);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
  if (entry.size <= 0) throw new Error(`${label} is empty`);
  if (entry.size > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes`);
}

function converterCommand(dependencies) {
  if (Object.hasOwn(dependencies, 'converterBin')) {
    if (typeof dependencies.converterBin !== 'string' || !dependencies.converterBin) {
      throw new Error('by-doc-to-markdown converter is unavailable');
    }
    return { bin: dependencies.converterBin, prefix: [] };
  }
  return { bin: process.execPath, prefix: [DEFAULT_CONVERTER_SCRIPT] };
}

function renderMarkdown(content, result, filters) {
  return `---\ntitle: ${JSON.stringify(result.title)}\nsource: "dws"\nsource_url: ${JSON.stringify(result.sourceUrl)}\ncollection_filters: ${JSON.stringify(filters)}\n---\n\n${content.trim()}\n`;
}

async function materializeOne(writer, result, filters, dependencies, bin, env, maxBytes) {
  const suffix = itemSuffix(result);
  const paths = materializationPaths(result);
  const rawArtifacts = [...result.rawArtifacts];
  try {
  if (NATIVE_DOCUMENT_TYPES.has(result.type) || (!result.type && !result.sourceType)) {
    const artifact = `raw/doc-read-${suffix}.json`;
    const response = await callJson(writer, bin, env, ['doc', 'read', '--node', result.sourceItemId, '--format', 'json'], artifact, dependencies);
    rawArtifacts.push(artifact);
    const content = nativeMarkdown(response);
    if (Buffer.byteLength(content, 'utf8') > maxBytes) throw new Error(`native Markdown exceeds ${maxBytes} bytes`);
    const rendered = renderMarkdown(content, result, filters);
    await Promise.all([writer.writeText(paths.markdownPath, rendered), writer.writeText(paths.sanitizedPath, rendered)]);
    return inventoryItem(result, rawArtifacts, filters, { status: 'materialized', ...paths, reason: null });
  }

  const extension = fileExtension(result);
  if (!extension) throw new Error(`unsupported binary document type: ${result.type || result.title}`);
  const rawPath = `raw/download-${suffix}${extension}`;
  const rawAbsolute = writer.absolute(rawPath);
  const downloadArtifact = `raw/drive-download-${suffix}.json`;
  await callJson(writer, bin, env, ['drive', 'download', '--node', result.sourceItemId, '--output', rawAbsolute, '--format', 'json'], downloadArtifact, dependencies);
  rawArtifacts.push(rawPath, downloadArtifact);
  await assertPrivateRegularFile(rawAbsolute, maxBytes, 'downloaded DWS file');
  const command = converterCommand(dependencies);
  const preflightArtifact = `raw/converter-preflight-${suffix}.json`;
  const preflight = await runCli(command.bin, [...command.prefix, 'convert', '--file-path', rawAbsolute, '--dry-run'], { env });
  await writer.writeJson(preflightArtifact, { args: ['convert', '--file-path', rawPath, '--dry-run'], ...cliEvidence(preflight) });
  rawArtifacts.push(preflightArtifact);
  if (preflight.failure || preflight.exitCode !== 0) {
    const failure = cliFailure(preflight);
    throw withContext(`by-doc-to-markdown preflight failed: ${failure.reason}`, { auth: failure.auth, evidence: { stage: 'converter-preflight', ...cliEvidence(preflight) } });
  }
  let conversion;
  try {
    conversion = await runCli(command.bin, [
      ...command.prefix, 'convert', '--file-path', rawAbsolute, '--output', writer.absolute(paths.markdownPath),
    ], { env });
  } catch (error) {
    throw withContext(reasonOf(error), { evidence: { stage: 'converter', error: reasonOf(error) } });
  }
  const converterArtifact = `raw/converter-${suffix}.json`;
  await writer.writeJson(converterArtifact, { args: ['convert', '--file-path', rawPath, '--output', paths.markdownPath], ...cliEvidence(conversion) });
  rawArtifacts.push(converterArtifact);
  if (conversion.failure || conversion.exitCode !== 0) {
    const failure = cliFailure(conversion);
    throw withContext(`by-doc-to-markdown failed: ${failure.reason}`, { auth: failure.auth, evidence: { stage: 'converter', ...cliEvidence(conversion) } });
  }
  const markdownAbsolute = writer.absolute(paths.markdownPath);
  await assertPrivateRegularFile(markdownAbsolute, maxBytes, 'converted Markdown');
  await writer.writeText(paths.sanitizedPath, await readFile(markdownAbsolute, 'utf8'));
  return inventoryItem(result, rawArtifacts, filters, { status: 'materialized', ...paths, reason: null });
  } catch (error) {
    if (!Array.isArray(error.rawArtifacts)) error.rawArtifacts = rawArtifacts;
    throw error;
  }
}

function materializationConcurrency(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 1;
}

async function materializeCandidates(writer, found, filters, dependencies, bin, env, concurrency) {
  const inventory = new Array(found.length);
  const maxBytes = positiveEnv('KNOWLEDGE_COLLECTION_MAX_MATERIALIZED_BYTES', MAX_MATERIALIZED_BYTES, env);
  let authError = null;
  const maxConcurrency = materializationConcurrency(concurrency);
  let nextIndex = 0;
  let stopped = false;

  async function worker() {
    while (!stopped) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= found.length) return;
      const result = found[index];
      try {
        inventory[index] = await materializeOne(writer, result, filters, dependencies, bin, env, maxBytes);
      } catch (error) {
      const failedArtifact = `raw/failed-${itemSuffix(result)}.json`;
      await writer.writeJson(failedArtifact, {
        sourceItemId: result.sourceItemId,
        stage: error?.evidence?.stage || 'materialization',
        reason: reasonOf(error),
        ...(error?.evidence ? { evidence: error.evidence } : {}),
      });
        inventory[index] = inventoryItem(result, [...(error.rawArtifacts || result.rawArtifacts), failedArtifact], filters, { status: 'failed', reason: reasonOf(error) });
        if (error.auth) {
          authError = error;
          stopped = true;
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(maxConcurrency, found.length) }, () => worker()));
  for (let index = nextIndex; index < found.length; index += 1) {
    const result = found[index];
    inventory[index] = inventoryItem(result, result.rawArtifacts, filters, { status: 'pending', reason: 'materialization stopped after DWS authentication failure' });
  }
  const canonicalItems = inventory.filter((item) => item?.materialization.status === 'materialized').map((item) => ({
    title: item.title, url: item.sourceUrl, author: '', publishTime: '', markdown: item.materialization.sanitizedPath, fileName: item.materialization.sanitizedPath,
  }));
  return { inventory, canonicalItems, authError };
}

async function discoverSearch(writer, request, bin, env) {
  const found = [];
  const seen = new Set();
  const rawArtifacts = [];
  const seenTokens = new Set();
  let pagesRequested = 0;
  let pagesCompleted = 0;
  let rawRecords = 0;
  let duplicateRecords = 0;
  let token = request.cursor || null;
  let lastSafeCursor = token;
  let pagination = null;
  for (let page = 1; found.length < request.limit; page += 1) {
    if (token && seenTokens.has(token)) {
      pagination = { reason: 'repeated DWS search pagination token', cursor: token };
      break;
    }
    if (token) seenTokens.add(token);
    const args = ['doc', 'search', '--query', request.query, '--limit', String(Math.min(MAX_SEARCH_PAGE_SIZE, request.limit - found.length))];
    if (token) args.push('--cursor', token);
    if (request.workspaceIds?.length) args.push('--workspace-ids', request.workspaceIds.join(','));
    if (request.extensions?.length) args.push('--extensions', request.extensions.join(','));
    args.push('--format', 'json');
    const artifact = `raw/doc-search-${page}.json`;
    let response;
    pagesRequested += 1;
    try {
      response = await callJson(writer, bin, env, args, artifact);
    } catch (error) {
      error.discovery = {
        found,
        rawArtifacts,
        pagination: { reason: reasonOf(error), cursor: token },
        discovery: { pagesRequested, pagesCompleted, rawRecords, duplicateRecords, uniqueRecords: found.length, limitReached: false, lastSafeCursor },
      };
      throw error;
    }
    rawArtifacts.push(artifact);
    pagesCompleted += 1;
    rawRecords += records(response).length;
    for (const record of records(response)) {
      const item = searchResult(record);
      if (item && !seen.has(item.sourceItemId)) {
        seen.add(item.sourceItemId);
        found.push({ ...item, sourceRank: found.length + 1, rawArtifacts: [artifact] });
        if (found.length === request.limit) break;
      } else if (item) {
        duplicateRecords += 1;
      }
    }
    token = nextToken(response);
    lastSafeCursor = token;
    if (!token) break;
  }
  return { found, rawArtifacts, pagination, discovery: { pagesRequested, pagesCompleted, rawRecords, duplicateRecords, uniqueRecords: found.length, limitReached: found.length === request.limit, lastSafeCursor } };
}

async function discoverFolder(writer, request, bin, env) {
  const found = [];
  const seenFiles = new Set();
  const seenFolders = new Set([request.folderId]);
  const rawArtifacts = [];
  const queue = [{ id: request.folderId, depth: 0 }];
  let pagesRequested = 0;
  let pagesCompleted = 0;
  let rawRecords = 0;
  let duplicateRecords = 0;
  let lastSafeCursor = null;
  let pagination = null;
  while (queue.length && found.length < request.limit && !pagination) {
    const folder = queue.shift();
    let token = null;
    const folderTokens = new Set();
    do {
      if (pagesRequested >= MAX_FOLDER_PAGES) { pagination = { reason: 'DWS drive traversal page limit reached', maxPages: MAX_FOLDER_PAGES }; break; }
      if (token && folderTokens.has(token)) { pagination = { reason: 'repeated DWS drive pagination token', cursor: token, folderId: folder.id }; break; }
      if (token) folderTokens.add(token);
      pagesRequested += 1;
      const args = ['drive', 'list', '--folder', folder.id, '--limit', String(Math.min(50, request.limit - found.length))];
      if (token) args.push('--cursor', token);
      args.push('--format', 'json');
      const artifact = `raw/drive-list-${pagesRequested}.json`;
      let response;
      try {
        response = await callJson(writer, bin, env, args, artifact);
      } catch (error) {
        error.discovery = {
          found,
          rawArtifacts,
          pagination: { reason: reasonOf(error), cursor: token, folderId: folder.id },
          discovery: { pagesRequested, pagesCompleted, rawRecords, duplicateRecords, uniqueRecords: found.length, limitReached: false, lastSafeCursor },
          traversal: { maxDepth: MAX_FOLDER_DEPTH, maxPages: MAX_FOLDER_PAGES, concurrency: request.concurrency },
        };
        throw error;
      }
      rawArtifacts.push(artifact);
      pagesCompleted += 1;
      rawRecords += records(response).length;
      for (const record of records(response)) {
        const item = driveResult(record);
        if (!item) continue;
        if (item.isFolder) {
          if (folder.depth < MAX_FOLDER_DEPTH && !seenFolders.has(item.sourceItemId)) {
            seenFolders.add(item.sourceItemId);
            queue.push({ id: item.sourceItemId, depth: folder.depth + 1 });
          }
        } else if (matchesRequestedQuery(item, request.query)
          && matchesRequestedExtension(item, request.extensions)
          && !seenFiles.has(item.sourceItemId)) {
          seenFiles.add(item.sourceItemId);
          found.push({ ...item, sourceRank: found.length + 1, rawArtifacts: [artifact] });
          if (found.length === request.limit) break;
        } else {
          duplicateRecords += 1;
        }
      }
      token = nextToken(response);
      lastSafeCursor = token;
    } while (token && found.length < request.limit && !pagination);
  }
  return { found, rawArtifacts, pagination, traversal: { maxDepth: MAX_FOLDER_DEPTH, maxPages: MAX_FOLDER_PAGES, concurrency: request.concurrency }, discovery: { pagesRequested, pagesCompleted, rawRecords, duplicateRecords, uniqueRecords: found.length, limitReached: found.length === request.limit, lastSafeCursor } };
}

async function search(request, dependencies) {
  const outputDir = request?.outputDir;
  const writer = await createArtifactWriter(outputDir);
  const normalized = { ...request, query: typeof request?.query === 'string' ? request.query : '', limit: request?.limit || 50 };
  let env;
  try {
    env = commandEnvironment(dependencies);
    const discovery = normalized.folderId
      ? await discoverFolder(writer, normalized, dependencies.bin || 'dws', env)
      : await discoverSearch(writer, normalized, dependencies.bin || 'dws', env);
    const materialized = normalized.metadataOnly
      ? { inventory: discovery.found.map((item) => inventoryItem(item, item.rawArtifacts, filtersFor(normalized))), canonicalItems: [], authError: null }
      : await materializeCandidates(writer, discovery.found, filtersFor(normalized), dependencies, dependencies.bin || 'dws', env, normalized.concurrency);
    const status = collectionStatus(materialized.inventory, {
      metadataOnly: normalized.metadataOnly,
      paginationFailed: Boolean(discovery.pagination),
    });
    await persist(writer, normalized, {
      inventory: materialized.inventory,
      canonicalItems: materialized.canonicalItems,
      rawArtifacts: discovery.rawArtifacts,
      status,
      paginationFailed: Boolean(discovery.pagination),
      sourceMetadata: {
        ...identity, operation: normalized.folderId ? 'drive.list' : 'doc.search', nativeOrdering: !normalized.folderId,
        metadataOnly: Boolean(normalized.metadataOnly), pagination: discovery.pagination, discovery: discovery.discovery, ...(discovery.traversal ? { traversal: discovery.traversal } : {}),
      },
    });
    if (materialized.authError) {
      return { ...handledOutcome(identity.connector, 'auth_required', outputDir, inventoryCounts(materialized.inventory)), reason: reasonOf(materialized.authError) };
    }
    return handledOutcome(identity.connector, status, outputDir, {
      discovered: materialized.inventory.length,
      materialized: materialized.canonicalItems.length,
      pending: materialized.inventory.filter((item) => item.materialization.status === 'pending').length,
      failed: materialized.inventory.filter((item) => item.materialization.status === 'failed').length,
    });
  } catch (error) {
    if (error.fatal) {
      await writer.abort();
      throw error;
    }
    if (error.discovery?.found?.length) {
      const materialized = normalized.metadataOnly
        ? { inventory: error.discovery.found.map((item) => inventoryItem(item, item.rawArtifacts, filtersFor(normalized))), canonicalItems: [], authError: null }
        : await materializeCandidates(writer, error.discovery.found, filtersFor(normalized), dependencies, dependencies.bin || 'dws', env, normalized.concurrency);
      const status = collectionStatus(materialized.inventory, {
        metadataOnly: normalized.metadataOnly,
        paginationFailed: true,
      });
      await persist(writer, normalized, {
        inventory: materialized.inventory,
        canonicalItems: materialized.canonicalItems,
        rawArtifacts: error.discovery.rawArtifacts,
        status,
        paginationFailed: true,
        sourceMetadata: {
          ...identity,
          operation: normalized.folderId ? 'drive.list' : 'doc.search',
          nativeOrdering: !normalized.folderId,
          metadataOnly: Boolean(normalized.metadataOnly),
          pagination: error.discovery.pagination,
          discovery: error.discovery.discovery,
          ...(error.discovery.traversal ? { traversal: error.discovery.traversal } : {}),
        },
      });
      if (materialized.authError) {
        return { ...handledOutcome(identity.connector, 'auth_required', outputDir, inventoryCounts(materialized.inventory)), reason: reasonOf(materialized.authError) };
      }
      return handledOutcome(identity.connector, status, outputDir, {
        discovered: materialized.inventory.length,
        materialized: materialized.canonicalItems.length,
        pending: materialized.inventory.filter((item) => item.materialization.status === 'pending').length,
        failed: materialized.inventory.filter((item) => item.materialization.status === 'failed').length,
      });
    }
    const status = error.auth ? 'auth_required' : 'failed';
    await persist(writer, normalized, {
      inventory: [], canonicalItems: [], rawArtifacts: [], status: 'failed', discoverySucceeded: false, sourceMetadata: { ...identity, operation: normalized.folderId ? 'drive.list' : 'doc.search', reason: reasonOf(error), authRequired: Boolean(error.auth) },
    });
    return { ...handledOutcome(identity.connector, status, outputDir), reason: reasonOf(error) };
  }
}

async function materializeSelection(request, dependencies) {
  const selected = await readResumeCandidates(request.sessionDir, identity.source, request.itemIds);
  const filters = selected[0]?.collectionFilters || {};
  if (selected.some((item) => JSON.stringify(item.collectionFilters) !== JSON.stringify(filters))) {
    throw new Error('selected candidates use incompatible collection filters');
  }
  const writer = await createArtifactWriter(request.outputDir);
  const normalized = {
    query: `selected candidates from ${request.sessionDir}`,
    concurrency: request.concurrency,
    workspaceIds: filters.workspaceIds,
    extensions: filters.extensions,
    folderId: filters.folderId,
    metadataOnly: false,
  };
  try {
    const env = commandEnvironment(dependencies);
    const found = await copyResumeArtifacts(writer, selected);
    const materialized = await materializeCandidates(writer, found, filtersFor(normalized), dependencies, dependencies.bin || 'dws', env, normalized.concurrency);
    const status = collectionStatus(materialized.inventory);
    await persist(writer, normalized, {
      inventory: materialized.inventory,
      canonicalItems: materialized.canonicalItems,
      rawArtifacts: found.flatMap((item) => item.rawArtifacts),
      status,
      sourceMetadata: {
        ...identity,
        operation: 'materialize.selection',
        metadataOnly: false,
        resumedFrom: request.sessionDir,
        selectedItemIds: request.itemIds,
      },
    });
    if (materialized.authError) {
      return { ...handledOutcome(identity.connector, 'auth_required', request.outputDir, inventoryCounts(materialized.inventory)), reason: reasonOf(materialized.authError) };
    }
    return handledOutcome(identity.connector, status, request.outputDir, {
      discovered: found.length,
      materialized: materialized.canonicalItems.length,
      pending: materialized.inventory.filter((item) => item.materialization.status === 'pending').length,
      failed: materialized.inventory.filter((item) => item.materialization.status === 'failed').length,
    });
  } catch (error) {
    await writer.abort();
    throw error;
  }
}

export function createDingtalkAdapter(dependencies = {}) {
  return {
    connector: identity.connector,
    capabilities: () => ({ search: true, resource: false }),
    search: (request) => search(request, dependencies),
    materialize: (request) => materializeSelection(request, dependencies),
  };
}
