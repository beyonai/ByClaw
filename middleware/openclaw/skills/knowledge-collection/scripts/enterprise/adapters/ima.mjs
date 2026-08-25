import crypto from 'node:crypto';
import { createArtifactWriter } from '../shared/artifact-writer.mjs';
import { runCli } from '../shared/cli-runner.mjs';
import { copyResumeArtifacts, readResumeCandidates } from '../shared/resume.mjs';
import { deriveCollectionStatus, SOURCE_IDENTITY, handledOutcome, inventoryCounts } from '../shared/status-model.mjs';

const identity = SOURCE_IDENTITY.ima;
const MAX_CONTENT_BYTES = 50 * 1024 * 1024;

function reasonOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function stringValue(value, keys) {
  for (const key of keys) {
    if (typeof value?.[key] === 'string' && value[key].trim()) return value[key].trim();
  }
  return '';
}

function records(value) {
  const root = objectValue(value) || {};
  for (const key of ['items', 'results', 'notes', 'documents', 'list', 'data']) {
    if (Array.isArray(root[key])) return root[key];
    if (Array.isArray(root[key]?.items)) return root[key].items;
  }
  if (Array.isArray(value)) return value;
  return [];
}

function contentOf(value) {
  const root = objectValue(value);
  if (!root) return '';
  for (const key of ['markdown', 'content', 'text', 'body', 'noteContent']) {
    if (typeof root[key] === 'string' && root[key].trim()) return root[key].trim();
  }
  for (const key of ['data', 'result', 'note', 'document']) {
    const nested = contentOf(root[key]);
    if (nested) return nested;
  }
  return '';
}

function itemFromRecord(record, sourceType, kb = '', materializationKb = '') {
  const sourceItemId = stringValue(record, ['mediaId', 'doc_id', 'docId', 'documentId', 'id', 'uuid', 'fileId']);
  if (!sourceItemId) return null;
  const title = stringValue(record, ['title', 'name', 'fileName', 'subject']) || sourceItemId;
  const sourceUrl = stringValue(record, ['url', 'sourceUrl', 'link']) || `ima://${sourceType}/${sourceItemId}`;
  return {
    sourceItemId,
    sourceUrl,
    title,
    sourceType,
    kb,
    materializationKb,
    preview: contentOf(record) || stringValue(record, ['abstract', 'introduction']),
  };
}

function knowledgeBaseId(value, name) {
  const bases = Array.isArray(value?.knowledge_bases) ? value.knowledge_bases : [];
  const match = bases.find((base) => base?.name === name) || bases[0];
  return stringValue(match, ['id']);
}

function itemIdFor(item) {
  return `ima-${crypto.createHash('sha256').update(`${item.sourceType}\n${item.sourceItemId}`).digest('hex').slice(0, 16)}`;
}

function materializationPaths(item) {
  const suffix = crypto.createHash('sha256').update(`${item.sourceType}\n${item.sourceItemId}`).digest('hex').slice(0, 16);
  return { markdownPath: `markdown/items/${suffix}.md`, sanitizedPath: `sanitized/items/${suffix}.md` };
}

function inventoryItem(item, rawArtifacts, materialization = {}) {
  return {
    itemId: itemIdFor(item),
    title: item.title,
    sourceUrl: item.sourceUrl,
    sourceItemId: item.sourceItemId,
    sourceType: item.sourceType,
    materializationType: 'markdown',
    sourceSkill: identity.sourceSkill,
    backend: identity.backend,
    collectionFilters: item.kb ? { kb: item.kb } : {},
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

function renderedMarkdown(content, item) {
  return `---\ntitle: ${JSON.stringify(item.title)}\nsource: "ima"\nsource_url: ${JSON.stringify(item.sourceUrl)}\ncollection_filters: ${JSON.stringify(item.kb ? { kb: item.kb } : {})}\n---\n\n${content.trim()}\n`;
}

function cliReason(result) {
  const output = `${result?.stdout || ''}\n${result?.stderr || ''}`;
  if (/IMA_CREDENTIALS_UNAVAILABLE|auth|credential|unauthorized|401|403/i.test(output)) return 'IMA 连接尚未配置或已失效';
  if (result?.failure) return `ima failed to start: ${result.failure.code || result.failure.message}`;
  return `ima command failed with exit ${result?.exitCode}`;
}

async function authCheck(bin, env) {
  const result = await runCli(bin, ['auth', 'check', '--test', '--json'], { env });
  if (result.failure || result.exitCode !== 0) throw Object.assign(new Error(cliReason(result)), { auth: true });
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch { throw Object.assign(new Error('ima auth check returned invalid JSON'), { auth: true }); }
  if (parsed?.checks?.token_fetch !== true) {
    throw Object.assign(new Error('IMA 连接尚未配置或已失效'), { auth: true });
  }
  return parsed;
}

async function callJson(writer, bin, env, args, artifact) {
  const result = await runCli(bin, args, { env });
  if (result.failure || result.exitCode !== 0) throw Object.assign(new Error(cliReason(result)), { auth: /auth|credential|401|403/i.test(`${result.stdout}\n${result.stderr}`) });
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch { throw new Error('ima returned invalid JSON'); }
  await writer.writeJson(artifact, parsed);
  return parsed;
}

async function bycliKnowledgeList(writer, bycliBin, env, kb) {
  const result = await runCli(bycliBin, ['ima', 'knowledge', kb, '-f', 'json'], { env });
  if (result.failure || result.exitCode !== 0) {
    throw new Error(`bycli ima knowledge failed: ${cliReason(result)}`);
  }
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch { throw new Error('bycli ima knowledge returned invalid JSON'); }
  if (!Array.isArray(parsed) && !objectValue(parsed)) {
    throw new Error('bycli ima knowledge returned an unsupported JSON shape');
  }
  await writer.writeJson('raw/bycli-knowledge.json', parsed);
  return parsed;
}

async function discover(writer, request, bin, bycliBin, env) {
  const found = [];
  const seenSourceItems = new Set();
  const seenSourceUrls = new Set();
  const rawArtifacts = [];
  const fallbackReasons = [];
  let materializationKb = request.kb;
  const runDiscovery = async (sourceType, artifact, load) => {
    const response = await load();
    rawArtifacts.push(artifact);
    for (const record of records(response)) {
      const item = itemFromRecord(record, sourceType, request.kb);
      const sourceItemKey = item && `${sourceType}:${item.sourceItemId}`;
      if (!item || seenSourceItems.has(sourceItemKey) || seenSourceUrls.has(item.sourceUrl)) continue;
      seenSourceItems.add(sourceItemKey);
      seenSourceUrls.add(item.sourceUrl);
      found.push({ ...item, materializationKb, sourceRank: found.length + 1, rawArtifacts: [artifact] });
      if (found.length >= request.limit) break;
    }
  };
  if (request.kb) {
    const baseSearch = await callJson(writer, bin, env, ['wiki', 'search-base', request.kb, '--json'], 'raw/wiki-search-base.json');
    materializationKb = knowledgeBaseId(baseSearch, request.kb);
    if (!materializationKb) throw new Error(`ima knowledge base not found: ${request.kb}`);
    try {
      await runDiscovery('wiki', 'raw/bycli-knowledge.json', () => bycliKnowledgeList(writer, bycliBin, env, request.kb));
    } catch (error) {
      fallbackReasons.push(reasonOf(error));
      try {
        await runDiscovery('wiki', 'raw/wiki-search.json', () => callJson(
          writer,
          bin,
          env,
          ['wiki', 'search', request.query, '--kb', materializationKb, '--json'],
          'raw/wiki-search.json',
        ));
      } catch (fallbackError) {
        throw new Error(`IMA knowledge listing failed: bycli=${fallbackReasons.join('; ')}; wiki=${reasonOf(fallbackError)}`);
      }
    }
    return { found: found.slice(0, request.limit), rawArtifacts, fallbackReasons };
  }
  const noteArgs = ['note', 'search', '--content', request.query, '--start', '0', '--end', String(request.limit), '--json'];
  if (request.noteMode === 'title') {
    noteArgs.splice(2, 2, '--title', request.query);
  }
  await runDiscovery('note', 'raw/note-search.json', () => callJson(writer, bin, env, noteArgs, 'raw/note-search.json'));
  if (found.length < request.limit) {
    const wikiArgs = ['wiki', 'search', request.query, ...(request.kb ? ['--kb', request.kb] : []), '--json'];
    try {
      await runDiscovery('wiki', 'raw/wiki-search.json', () => callJson(writer, bin, env, wikiArgs, 'raw/wiki-search.json'));
    } catch (error) {
      if (fallbackReasons.length) {
        throw new Error(`IMA knowledge listing failed: bycli=${fallbackReasons.join('; ')}; wiki=${reasonOf(error)}`);
      }
      throw error;
    }
  }
  return { found: found.slice(0, request.limit), rawArtifacts, fallbackReasons };
}

async function materializeOne(writer, item, bin, env) {
  const suffix = crypto.createHash('sha256').update(`${item.sourceType}\n${item.sourceItemId}`).digest('hex').slice(0, 16);
  const artifact = `raw/${item.sourceType}-get-${suffix}.json`;
  const args = item.sourceType === 'note'
    ? ['note', 'get', item.sourceItemId, '--format', '0', '--json']
    : ['wiki', 'search', item.title, ...(item.materializationKb ? ['--kb', item.materializationKb] : []), '--json'];
  const response = await callJson(writer, bin, env, args, artifact);
  const content = contentOf(response) || item.preview;
  if (!content) throw new Error(`ima ${item.sourceType} returned no content`);
  if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) throw new Error('IMA content exceeds materialization limit');
  const paths = materializationPaths(item);
  const markdown = renderedMarkdown(content, item);
  await Promise.all([writer.writeText(paths.markdownPath, markdown), writer.writeText(paths.sanitizedPath, markdown)]);
  return inventoryItem(item, [...item.rawArtifacts, artifact], { status: 'materialized', ...paths, reason: null });
}

async function persistSearch(writer, request, inventory, canonicalItems, rawArtifacts, status, discovery) {
  await writer.writeJson('raw/metadata.json', {
    ...identity,
    operation: 'search',
    rawArtifacts,
    status,
    sourceMetadata: { ...identity, operation: 'search', metadataOnly: Boolean(request.metadataOnly), discovery },
  });
  await writer.writeCollectionBundle({
    title: `IMA search: ${request.query}`,
    source: identity.source,
    backend: identity.backend,
    url: 'ima://search',
    filters: request.kb ? { kb: request.kb } : {},
    inventory,
    canonicalItems,
    sourceMetadata: { ...identity, operation: 'search', metadataOnly: Boolean(request.metadataOnly), discovery },
    metadataOnly: Boolean(request.metadataOnly),
  });
}

export function createImaAdapter(dependencies = {}) {
  const bin = dependencies.bin || 'ima';
  const bycliBin = dependencies.bycliBin || 'bycli';
  const env = dependencies.env || process.env;

  async function search(request = {}) {
    const outputDir = request.outputDir;
    const writer = await createArtifactWriter(outputDir);
    const normalized = {
      ...request,
      query: typeof request.query === 'string' ? request.query.trim() : '',
      limit: request.limit || 50,
    };
    try {
      await authCheck(bin, env);
      const discovery = await discover(writer, normalized, bin, bycliBin, env);
      const inventory = normalized.metadataOnly ? discovery.found.map((item) => inventoryItem(item, item.rawArtifacts)) : [];
      const materialized = [];
      if (!normalized.metadataOnly) {
        for (const item of discovery.found) {
          try { materialized.push(await materializeOne(writer, item, bin, env)); }
          catch (error) { materialized.push(inventoryItem(item, item.rawArtifacts, { status: 'failed', reason: reasonOf(error) })); }
        }
      }
      const finalInventory = normalized.metadataOnly ? inventory : materialized;
      const canonicalItems = finalInventory.filter((item) => item.materialization.status === 'materialized').map((item) => ({
        title: item.title, url: item.sourceUrl, author: '', publishTime: '', markdown: item.materialization.sanitizedPath, fileName: item.materialization.sanitizedPath,
      }));
      const status = deriveCollectionStatus({ metadataOnly: normalized.metadataOnly, itemStates: finalInventory.map((item) => item.materialization.status) });
      await persistSearch(writer, normalized, finalInventory, canonicalItems, discovery.rawArtifacts, status, {
        discovered: finalInventory.length,
        fallbackReasons: discovery.fallbackReasons,
      });
      return handledOutcome(identity.connector, status, outputDir, inventoryCounts(finalInventory));
    } catch (error) {
      if (error.auth) return handledOutcome(identity.connector, 'auth_required', outputDir, { failed: 0 });
      throw error;
    }
  }

  async function collectResource(request = {}) {
    return handledOutcome(identity.connector, 'unsupported_capability', request.outputDir);
  }

  async function materialize(request = {}) {
    const writer = await createArtifactWriter(request.outputDir);
    await authCheck(bin, env);
    const candidates = await copyResumeArtifacts(writer, await readResumeCandidates(request.sessionDir, identity.source, request.itemIds || []));
    const inventory = [];
    for (const item of candidates) {
      try { inventory.push(await materializeOne(writer, item, bin, env)); }
      catch (error) { inventory.push(inventoryItem(item, item.rawArtifacts, { status: 'failed', reason: reasonOf(error) })); }
    }
    const canonicalItems = inventory.filter((item) => item.materialization.status === 'materialized').map((item) => ({ title: item.title, url: item.sourceUrl, author: '', publishTime: '', markdown: item.materialization.sanitizedPath, fileName: item.materialization.sanitizedPath }));
    const status = deriveCollectionStatus({ itemStates: inventory.map((item) => item.materialization.status) });
    await writer.writeCollectionBundle({ title: 'IMA materialized collection', source: identity.source, backend: identity.backend, url: 'ima://materialize', filters: {}, inventory, canonicalItems, sourceMetadata: { ...identity, operation: 'materialize' }, metadataOnly: false });
    return handledOutcome(identity.connector, status, request.outputDir, inventoryCounts(inventory));
  }

  return { ...identity, search, collectResource, materialize };
}
