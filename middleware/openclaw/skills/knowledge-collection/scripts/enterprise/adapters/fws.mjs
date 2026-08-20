import crypto from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { createFeishuAdapter } from './feishu.mjs';
import { createArtifactWriter } from '../shared/artifact-writer.mjs';
import { positiveEnv, runCli } from '../shared/cli-runner.mjs';
import { SOURCE_IDENTITY, handledOutcome } from '../shared/status-model.mjs';

const identity = SOURCE_IDENTITY.feishu;
const AUTH_FAILURE = /\b(?:401|403)\b|missing_scope|permission_violations|auth(?:entication)? (?:is )?required/i;
const MAX_MATERIALIZED_BYTES = 50 * 1024 * 1024;
const NATIVE_DOCUMENT_TYPES = new Set(['doc', 'docx', 'document']);
const CONVERTIBLE_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']);
const DEFAULT_CONVERTER_SCRIPT = new URL('../../../../by-doc-to-markdown/scripts/by-doc-to-markdown.mjs', import.meta.url).pathname;

function reasonOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function dataOf(value) {
  const outer = asObject(value) || {};
  return asObject(outer.data) || outer;
}

function stringValue(value, keys) {
  for (const key of keys) {
    if (typeof value?.[key] === 'string' && value[key].trim()) return value[key].trim();
  }
  return '';
}

function records(value) {
  const data = dataOf(value);
  for (const key of ['docs', 'items', 'list', 'results', 'files']) {
    if (Array.isArray(data[key])) return data[key];
  }
  return [];
}

function nextToken(value) {
  const data = dataOf(value);
  return stringValue(data, ['page_token', 'next_page_token', 'nextPageToken', 'pageToken']) || null;
}

function canonicalUrl(url, type, token) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}/${type}/${token}`;
  } catch {
    return `https://feishu.cn/${type}/${token}`;
  }
}

function candidate(record) {
  const sourceItemId = stringValue(record, ['token', 'obj_token', 'document_token', 'doc_token', 'id']);
  const type = stringValue(record, ['type', 'doc_type', 'obj_type']).toLowerCase();
  const sourceUrl = stringValue(record, ['url', 'web_url', 'link']) || (sourceItemId && type ? canonicalUrl('', type, sourceItemId) : '');
  if (!sourceItemId || !type || !sourceUrl) return null;
  return { sourceItemId, sourceUrl, type, title: stringValue(record, ['title', 'name']) || sourceItemId };
}

function isWiki(result) {
  return result.type === 'wiki' || /\/wiki\//.test(result.sourceUrl);
}

function itemIdFor(result) {
  return `fws-${crypto.createHash('sha256').update(result.sourceItemId).digest('hex').slice(0, 16)}`;
}

function suffix(result) {
  return crypto.createHash('sha256').update(result.sourceItemId).digest('hex').slice(0, 16);
}

function filtersFor(request) {
  return {
    ...(typeof request.spaceId === 'string' && request.spaceId ? { spaceId: request.spaceId } : {}),
    ...(Array.isArray(request.fileTypes) ? { fileTypes: request.fileTypes } : {}),
  };
}

function inventoryItem(result, filters, materialization = {}) {
  return {
    itemId: itemIdFor(result),
    title: result.title,
    sourceUrl: result.sourceUrl,
    sourceItemId: result.sourceItemId,
    sourceType: result.type,
    sourceSkill: identity.sourceSkill,
    backend: identity.backend,
    collectionFilters: filters,
    rawArtifacts: result.rawArtifacts,
    materialization: {
      status: materialization.status || 'pending',
      markdownPath: materialization.markdownPath || null,
      sanitizedPath: materialization.sanitizedPath || null,
      pendingArtifactCleanup: [],
      reason: materialization.reason || 'discovery only; materialization is deferred',
    },
  };
}

function cliEvidence(result) {
  return {
    exitCode: result?.exitCode ?? null,
    stdout: result?.stdout ?? '',
    stderr: result?.stderr ?? '',
    failure: result?.failure ? { code: result.failure.code, message: result.failure.message } : null,
  };
}

function commandEnvironment(dependencies) {
  const env = { ...process.env, ...(dependencies.env || {}) };
  if (typeof env.LARK_HOME !== 'string' || !env.LARK_HOME) throw new Error('LARK_HOME is required for FWS discovery');
  return { ...env, HOME: env.LARK_HOME };
}

function withContext(message, context = {}) {
  return Object.assign(new Error(message), context);
}

async function callJson(writer, bin, env, args, artifact) {
  let result;
  try {
    result = await runCli(bin, args, { env });
  } catch (error) {
    throw withContext(reasonOf(error), { evidence: { args, error: reasonOf(error) } });
  }
  if (result.failure || result.exitCode !== 0) {
    const output = `${result.stdout}\n${result.stderr}`;
    const reason = result.failure
      ? `lark-cli failed to start: ${result.failure.code || result.failure.message}`
      : `lark-cli command failed with exit ${result.exitCode}`;
    throw withContext(reason, { auth: AUTH_FAILURE.test(output), evidence: { args, ...cliEvidence(result) } });
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw withContext('lark-cli returned invalid JSON', { evidence: { args, ...cliEvidence(result) } });
  }
  if (parsed?.ok !== true) {
    const errorText = JSON.stringify(parsed?.error || parsed);
    throw withContext('lark-cli did not report success', { auth: AUTH_FAILURE.test(errorText), evidence: { args, response: parsed } });
  }
  await writer.writeJson(artifact, parsed);
  return parsed;
}

async function resolveWiki(writer, result, request, bin, env, artifact) {
  const args = ['wiki', '+node-get', '--node-token', result.sourceItemId];
  if (request.spaceId) args.push('--space-id', request.spaceId);
  args.push('--as', 'user', '--format', 'json');
  const response = await callJson(writer, bin, env, args, artifact);
  const node = asObject(dataOf(response).node) || dataOf(response);
  const sourceItemId = stringValue(node, ['obj_token', 'object_token', 'token']);
  const type = stringValue(node, ['obj_type', 'object_type', 'type']).toLowerCase();
  if (!sourceItemId || !type || type === 'wiki') throw new Error('wiki node did not resolve a final document token and type');
  return {
    sourceItemId,
    type,
    title: stringValue(node, ['title', 'name']) || result.title,
    sourceUrl: canonicalUrl(result.sourceUrl, type, sourceItemId),
    rawArtifacts: [...result.rawArtifacts, artifact],
  };
}

async function discover(writer, request, bin, env) {
  const found = [];
  const seen = new Set();
  const rawArtifacts = [];
  const seenTokens = new Set();
  let token = request.cursor || null;
  let pagination = null;
  for (let page = 1; found.length < request.limit; page += 1) {
    if (token && seenTokens.has(token)) {
      pagination = { reason: 'repeated FWS search pagination token', cursor: token };
      break;
    }
    if (token) seenTokens.add(token);
    const args = ['drive', '+search', '--query', request.query, '--page-size', String(Math.min(20, request.limit - found.length))];
    if (token) args.push('--page-token', token);
    if (request.spaceId) args.push('--space-ids', request.spaceId);
    if (request.fileTypes?.length) args.push('--doc-types', request.fileTypes.join(','));
    args.push('--as', 'user', '--format', 'json');
    const artifact = `raw/drive-search-${page}.json`;
    let response;
    try {
      response = await callJson(writer, bin, env, args, artifact);
    } catch (error) {
      error.discovery = { found, rawArtifacts, pagination: { reason: reasonOf(error), cursor: token } };
      throw error;
    }
    rawArtifacts.push(artifact);
    for (const record of records(response)) {
      let result = candidate(record);
      if (!result) continue;
      result = { ...result, rawArtifacts: [artifact] };
      if (isWiki(result)) {
        const wikiArtifact = `raw/wiki-resolve-${suffix(result)}.json`;
        try {
          result = await resolveWiki(writer, result, request, bin, env, wikiArtifact);
          rawArtifacts.push(wikiArtifact);
        } catch (error) {
          if (error.auth) {
            error.discovery = { found, rawArtifacts, pagination: { reason: reasonOf(error), cursor: token } };
            throw error;
          }
          pagination ||= { reason: `Wiki resolve failed: ${reasonOf(error)}`, cursor: token };
          continue;
        }
      }
      if (!seen.has(result.sourceItemId)) {
        seen.add(result.sourceItemId);
        found.push(result);
        if (found.length === request.limit) break;
      }
    }
    token = nextToken(response);
    if (!token || pagination) break;
  }
  return { found, rawArtifacts, pagination };
}

function markdown(content, result, filters) {
  return `---\ntitle: ${JSON.stringify(result.title)}\nsource: "fws"\nsource_url: ${JSON.stringify(result.sourceUrl)}\ncollection_filters: ${JSON.stringify(filters)}\n---\n\n${content.trim()}\n`;
}

function markdownContent(response) {
  const data = dataOf(response);
  for (const key of ['content', 'markdown', 'text']) {
    if (typeof data[key] === 'string' && data[key].trim()) return data[key];
  }
  throw new Error('lark-cli document fetch returned no Markdown content');
}

function materializationPaths(result) {
  const key = suffix(result);
  return { markdownPath: `markdown/items/${key}.md`, sanitizedPath: `sanitized/items/${key}.md` };
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

async function materializeOne(writer, result, request, dependencies, bin, env, maxBytes) {
  const key = suffix(result);
  const paths = materializationPaths(result);
  const rawArtifacts = [...result.rawArtifacts];
  if (NATIVE_DOCUMENT_TYPES.has(result.type)) {
    const artifact = `raw/docs-fetch-${key}.json`;
    const response = await callJson(writer, bin, env, [
      'docs', '+fetch', '--doc', result.sourceUrl, '--doc-format', 'markdown', '--as', 'user', '--format', 'json',
    ], artifact);
    rawArtifacts.push(artifact);
    const content = markdownContent(response);
    if (Buffer.byteLength(content, 'utf8') > maxBytes) throw new Error(`native Markdown exceeds ${maxBytes} bytes`);
    const rendered = markdown(content, result, filtersFor(request));
    await Promise.all([writer.writeText(paths.markdownPath, rendered), writer.writeText(paths.sanitizedPath, rendered)]);
    return inventoryItem({ ...result, rawArtifacts }, filtersFor(request), { status: 'materialized', ...paths, reason: null });
  }

  const extension = fileExtension(result);
  if (!extension) throw new Error(`unsupported binary document type: ${result.type || result.title}`);
  const rawPath = `raw/download-${key}${extension}`;
  const rawAbsolute = writer.absolute(rawPath);
  const downloadArtifact = `raw/drive-download-${key}.json`;
  await callJson(writer, bin, env, [
    'drive', '+download', '--file-token', result.sourceItemId, '--output', rawAbsolute, '--as', 'user', '--format', 'json',
  ], downloadArtifact);
  rawArtifacts.push(rawPath, downloadArtifact);
  await assertPrivateRegularFile(rawAbsolute, maxBytes, 'downloaded FWS file');
  let command;
  try {
    command = converterCommand(dependencies);
  } catch (error) {
    throw withContext(reasonOf(error), { rawArtifacts });
  }
  let conversion;
  try {
    conversion = await runCli(command.bin, [
      ...command.prefix, 'convert', '--file-path', rawAbsolute, '--output', writer.absolute(paths.markdownPath),
    ], { env });
  } catch (error) {
    throw withContext(reasonOf(error), { rawArtifacts, evidence: { stage: 'converter', error: reasonOf(error) } });
  }
  const converterArtifact = `raw/converter-${key}.json`;
  await writer.writeJson(converterArtifact, { args: ['convert', '--file-path', rawPath, '--output', paths.markdownPath], ...cliEvidence(conversion) });
  rawArtifacts.push(converterArtifact);
  if (conversion.failure || conversion.exitCode !== 0) {
    const output = `${conversion.stdout}\n${conversion.stderr}`;
    const reason = conversion.failure
      ? `by-doc-to-markdown failed to start: ${conversion.failure.code || conversion.failure.message}`
      : `by-doc-to-markdown command failed with exit ${conversion.exitCode}`;
    throw withContext(reason, { auth: AUTH_FAILURE.test(output), rawArtifacts, evidence: { stage: 'converter', ...cliEvidence(conversion) } });
  }
  const markdownAbsolute = writer.absolute(paths.markdownPath);
  await assertPrivateRegularFile(markdownAbsolute, maxBytes, 'converted Markdown');
  await writer.writeText(paths.sanitizedPath, await readFile(markdownAbsolute, 'utf8'));
  return inventoryItem({ ...result, rawArtifacts }, filtersFor(request), { status: 'materialized', ...paths, reason: null });
}

async function materialize(writer, found, request, dependencies, bin, env) {
  const inventory = [];
  const canonicalItems = [];
  const maxBytes = positiveEnv('KNOWLEDGE_COLLECTION_MAX_MATERIALIZED_BYTES', MAX_MATERIALIZED_BYTES, env);
  let authError = null;
  for (const result of found) {
    if (authError) {
      inventory.push(inventoryItem(result, filtersFor(request), { status: 'pending', reason: 'materialization stopped after FWS authentication failure' }));
      continue;
    }
    try {
      const item = await materializeOne(writer, result, request, dependencies, bin, env, maxBytes);
      inventory.push(item);
      canonicalItems.push({ title: item.title, url: item.sourceUrl, author: '', publishTime: '', markdown: item.materialization.sanitizedPath, fileName: item.materialization.sanitizedPath });
    } catch (error) {
      const artifact = `raw/failed-${suffix(result)}.json`;
      await writer.writeJson(artifact, { sourceItemId: result.sourceItemId, stage: 'materialization', reason: reasonOf(error), evidence: error.evidence });
      const rawArtifacts = Array.isArray(error.rawArtifacts) ? error.rawArtifacts : result.rawArtifacts;
      inventory.push(inventoryItem({ ...result, rawArtifacts: [...rawArtifacts, artifact] }, filtersFor(request), { status: 'failed', reason: reasonOf(error) }));
      if (error.auth) authError = error;
    }
  }
  return { inventory, canonicalItems, authError };
}

async function persist(writer, request, discovery, materialized, { discoverySucceeded = true } = {}) {
  const inventory = materialized.inventory;
  const paginationFailed = Boolean(discovery.pagination);
  await writer.writeJson('raw/metadata.json', {
    ...identity, operation: 'drive.search', rawArtifacts: discovery.rawArtifacts, pagination: discovery.pagination,
  });
  await writer.writeCollectionBundle({
    title: `Feishu search: ${request.query}`,
    source: identity.source,
    backend: identity.backend,
    url: 'feishu://drive/search',
    filters: filtersFor(request),
    inventory,
    canonicalItems: materialized.canonicalItems,
    metadataOnly: Boolean(request.metadataOnly),
    paginationFailed,
    discoverySucceeded,
    sourceMetadata: {
      ...identity, operation: 'drive.search', nativeOrdering: true, metadataOnly: Boolean(request.metadataOnly), pagination: discovery.pagination,
    },
  });
}

async function search(request, dependencies) {
  const outputDir = request?.outputDir;
  let writer;
  try {
    writer = await createArtifactWriter(outputDir);
  } catch (error) {
    return { ...handledOutcome(identity.connector, 'failed', outputDir), reason: reasonOf(error) };
  }
  const normalized = { ...request, query: typeof request?.query === 'string' ? request.query : '', limit: request?.limit || 50 };
  let env;
  try {
    env = commandEnvironment(dependencies);
    const discovery = await discover(writer, normalized, dependencies.bin || 'lark-cli', env);
    const materialized = normalized.metadataOnly
      ? { inventory: discovery.found.map((result) => inventoryItem(result, filtersFor(normalized))), canonicalItems: [], authError: null }
      : await materialize(writer, discovery.found, normalized, dependencies, dependencies.bin || 'lark-cli', env);
    await persist(writer, normalized, discovery, materialized);
    if (materialized.authError) return { ...handledOutcome(identity.connector, 'auth_required', outputDir, { discovered: materialized.inventory.length, materialized: materialized.canonicalItems.length, failed: 1 }), reason: reasonOf(materialized.authError) };
    const partial = Boolean(discovery.pagination) || materialized.inventory.some((item) => item.materialization.status !== 'materialized') && !normalized.metadataOnly;
    return handledOutcome(identity.connector, partial ? 'partial' : 'complete', outputDir, {
      discovered: materialized.inventory.length,
      materialized: materialized.canonicalItems.length,
      pending: materialized.inventory.filter((item) => item.materialization.status === 'pending').length,
      failed: materialized.inventory.filter((item) => item.materialization.status === 'failed').length,
    });
  } catch (error) {
    const discovery = error.discovery || { found: [], rawArtifacts: [], pagination: { reason: reasonOf(error), cursor: normalized.cursor || null } };
    const materialized = normalized.metadataOnly
      ? { inventory: discovery.found.map((result) => inventoryItem(result, filtersFor(normalized))), canonicalItems: [], authError: null }
      : await materialize(writer, discovery.found, normalized, dependencies, dependencies.bin || 'lark-cli', env || process.env);
    await persist(writer, normalized, discovery, materialized, { discoverySucceeded: Boolean(discovery.found.length) });
    const status = error.auth || materialized.authError ? 'auth_required' : discovery.found.length ? 'partial' : 'failed';
    return { ...handledOutcome(identity.connector, status, outputDir, {
      discovered: materialized.inventory.length,
      materialized: materialized.canonicalItems.length,
      pending: materialized.inventory.filter((item) => item.materialization.status === 'pending').length,
      failed: materialized.inventory.filter((item) => item.materialization.status === 'failed').length,
    }), reason: reasonOf(error) };
  }
}

export function createFwsAdapter(dependencies = {}) {
  const resourceAdapter = createFeishuAdapter(dependencies);
  return {
    connector: identity.connector,
    capabilities: () => ({ search: true, resource: true }),
    search: (request) => search(request, dependencies),
    collectResource: (request) => resourceAdapter.collectResource(request),
  };
}
