import crypto from 'node:crypto';
import { createArtifactWriter } from '../shared/artifact-writer.mjs';
import { positiveEnv, runCli } from '../shared/cli-runner.mjs';
import { readResumeMetadata } from '../shared/resume.mjs';
import { SOURCE_IDENTITY, handledOutcome } from '../shared/status-model.mjs';

const RESOURCE_BY_URL = [
  ['/smartsheet/', 'smartsheet'],
  ['/smartpage/', 'smartpage'],
  ['/sheet/', 'sheet'],
  ['/doc/', 'doc'],
];
const MAX_POLLS = 12;
const MAX_PAGES = 1000;
const identity = SOURCE_IDENTITY.wecom;

class PartialCollectionError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.context = context;
  }
}

class WecomCommandError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.context = context;
  }
}

function reasonOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function commandEnvironment(dependencies) {
  const env = { ...process.env, ...(dependencies.env || {}) };
  if (typeof env.WECOM_HOME !== 'string' || !env.WECOM_HOME.trim()) {
    throw new Error('WECOM_HOME is required for WeCom collection');
  }
  return { ...env, HOME: env.WECOM_HOME };
}

function contextOf(error) {
  return error instanceof Error && error.context ? error.context : {};
}

function positiveOption(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function safeText(value) {
  if (typeof value !== 'string') return '';
  try {
    return JSON.parse(value);
  } catch {
    return value.replace(/((?:token|cookie|secret|password|authorization|credential|device[_-]?code)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');
  }
}

function cliEvidence(result) {
  return {
    exitCode: result?.exitCode ?? null,
    stdout: safeText(result?.stdout),
    stderr: safeText(result?.stderr),
    failure: result?.failure ? {
      code: result.failure.code,
      message: safeText(result.failure.message),
    } : null,
  };
}

function titleFor(kind) {
  return kind === 'smartpage' ? 'Exported WeCom Smartpage' : `WeCom ${kind === 'smartsheet' ? 'Smartsheet' : 'Document'}`;
}

function resourceKindFor(request) {
  const url = typeof request?.url === 'string' ? request.url.trim() : '';
  if (!url) throw new Error('url is required');
  const fromUrl = RESOURCE_BY_URL.find(([fragment]) => url.includes(fragment))?.[1];
  if (!fromUrl) throw new Error('unsupported WeCom resource URL');
  if (request.resourceKind && request.resourceKind !== fromUrl) {
    throw new Error(`resourceKind ${request.resourceKind} conflicts with URL type ${fromUrl}`);
  }
  return { url, kind: request.resourceKind || fromUrl };
}

function markdown(content, { title, url }) {
  return `---\ntitle: ${JSON.stringify(title)}\nsource: "wecom"\nsource_url: ${JSON.stringify(url)}\ncollection_filters: {}\n---\n\n${content.trim()}\n`;
}

function parseEnvelope(stdout) {
  let outer;
  try {
    outer = JSON.parse(stdout);
  } catch {
    throw new Error('wecom-cli returned invalid JSON');
  }
  if (outer?.jsonrpc !== '2.0' || outer?.isError === true) {
    throw new Error('wecom-cli returned invalid JSON-RPC response');
  }
  const text = outer?.result?.content?.find((entry) => typeof entry?.text === 'string')?.text;
  if (!text) throw new Error('wecom-cli JSON-RPC response has no result.content[].text');
  let business;
  try {
    business = JSON.parse(text);
  } catch {
    throw new Error('wecom-cli result.content[].text is not valid business JSON');
  }
  if (!business || typeof business !== 'object' || Array.isArray(business)) {
    throw new Error('wecom-cli business response is malformed');
  }
  if (business.errcode !== 0) throw new Error(`wecom-cli business errcode ${business.errcode}`);
  return { outer, business };
}

function item({ itemId, title, url, sourceItemId, rawArtifacts, status, reason, markdownPath = null, sanitizedPath = null }) {
  return {
    itemId,
    title,
    sourceUrl: url,
    sourceItemId,
    sourceSkill: identity.sourceSkill,
    backend: identity.backend,
    collectionFilters: {},
    rawArtifacts,
    materialization: {
      status,
      markdownPath,
      sanitizedPath,
      pendingArtifactCleanup: [],
      reason,
    },
  };
}

function canonical({ title, url, path }) {
  return { title, url, author: '', publishTime: '', markdown: path, fileName: path };
}

async function persistBundle(writer, {
  title,
  url,
  inventory,
  canonicalItems,
  sourceMetadata,
  discoverySucceeded,
  collectionStatus,
  paginationFailed,
}) {
  await writer.writeCollectionBundle({
    title,
    source: identity.source,
    backend: identity.backend,
    url,
    filters: {},
    inventory,
    canonicalItems,
    sourceMetadata,
    discoverySucceeded,
    collectionStatus,
    paginationFailed,
  });
}

async function persistUnsupportedSearch({ query, outputDir }) {
  const writer = await createArtifactWriter(outputDir);
  await persistBundle(writer, {
    title: `WeCom search: ${typeof query === 'string' ? query : ''}` || 'WeCom search',
    url: 'wecom://search',
    inventory: [],
    canonicalItems: [],
    sourceMetadata: { connector: identity.connector, capability: 'search', unsupported: true },
    discoverySucceeded: false,
    collectionStatus: 'failed',
  });
  return handledOutcome(identity.connector, 'unsupported_capability', outputDir);
}

async function collectWecomResource(request, dependencies = {}) {
  const outputDir = request?.outputDir;
  let writer;
  try {
    writer = await createArtifactWriter(outputDir);
  } catch (error) {
    return { ...handledOutcome(identity.connector, 'failed', outputDir), reason: reasonOf(error) };
  }
  let resource;
  try {
    resource = resourceKindFor(request);
  } catch (error) {
    return persistFailure(writer, outputDir, request?.url || 'wecom://invalid', 'unknown', [], reasonOf(error));
  }
  const { url, kind } = resource;
  const rawArtifacts = [];
  const bin = dependencies.bin || 'wecom-cli';
  let env;
  try {
    env = commandEnvironment(dependencies);
  } catch (error) {
    return persistFailure(writer, outputDir, url, kind, rawArtifacts, reasonOf(error), { stage: 'authentication' });
  }
  const maxPolls = positiveOption(
    dependencies.maxPolls,
    positiveEnv('KNOWLEDGE_COLLECTION_MAX_WECOM_POLLS', MAX_POLLS, env),
  );
  const maxPages = positiveOption(
    dependencies.maxPages,
    positiveEnv('KNOWLEDGE_COLLECTION_MAX_WECOM_PAGES', MAX_PAGES, env),
  );

  const call = async (command, payload, artifact) => {
    let result;
    try {
      result = await runCli(bin, ['doc', command, JSON.stringify(payload)], { env });
    } catch (error) {
      throw new WecomCommandError(reasonOf(error), { stage: 'command', evidence: { command, error: reasonOf(error) } });
    }
    if (result.failure) {
      throw new WecomCommandError(`wecom-cli failed to start: ${result.failure.code || result.failure.message}`, {
        stage: 'command', evidence: { command, ...cliEvidence(result) },
      });
    }
    if (result.exitCode !== 0) {
      throw new WecomCommandError(`wecom-cli command failed with exit ${result.exitCode}`, {
        stage: 'command', evidence: { command, ...cliEvidence(result) },
      });
    }
    let parsed;
    try {
      parsed = parseEnvelope(result.stdout);
    } catch (error) {
      throw new WecomCommandError(reasonOf(error), {
        stage: 'response', evidence: { command, ...cliEvidence(result) },
      });
    }
    await writer.writeJson(artifact, parsed.outer);
    rawArtifacts.push(artifact);
    return parsed.business;
  };

  try {
    let result;
    if (kind === 'smartsheet') result = await collectSmartsheet(call, url, maxPages);
    else if (kind === 'smartpage') result = await collectSmartpage(call, url, maxPolls, request.resumeTaskId);
    else result = await collectDocument(call, url, maxPolls, request.resumeTaskId);
    const markdownPath = 'markdown/document.md';
    const sanitizedPath = 'sanitized/items/document.md';
    const title = titleFor(kind);
    const normalized = markdown(result.content, { title, url });
    await Promise.all([
      writer.writeText(markdownPath, normalized),
      writer.writeText(sanitizedPath, normalized),
      writer.writeJson('raw/metadata.json', { backend: identity.backend, resourceKind: kind, sourceItemId: result.sourceItemId }),
    ]);
    rawArtifacts.push('raw/metadata.json');
    const inventory = [item({
      itemId: `wecom-${kind}-${crypto.createHash('sha256').update(`${url}\n${result.sourceItemId}`).digest('hex').slice(0, 16)}`,
      title,
      url,
      sourceItemId: result.sourceItemId,
      rawArtifacts,
      status: 'materialized',
      reason: null,
      markdownPath,
      sanitizedPath,
    })];
    await persistBundle(writer, {
      title, url, inventory, canonicalItems: [canonical({ title, url, path: sanitizedPath })],
      sourceMetadata: {
        ...identity,
        resourceKind: kind,
        sourceItemId: result.sourceItemId,
        ...(request.legacyMode ? {
          backendCliVersion: env.WECOM_CLI_VERSION || 'unknown',
          scope: 'bot-visible',
        } : {}),
      },
    });
    return handledOutcome(identity.connector, 'complete', outputDir, { discovered: 1, materialized: 1 });
  } catch (error) {
    return persistFailure(writer, outputDir, url, kind, rawArtifacts, reasonOf(error), {
      partial: error instanceof PartialCollectionError,
      ...contextOf(error),
    });
  }
}

async function persistFailure(writer, outputDir, url, kind, rawArtifacts, reason, { partial = false, ...context } = {}) {
  const title = titleFor(kind);
  const { evidence, partialContent, ...metadataContext } = context;
  const artifacts = [...rawArtifacts];
  if (evidence) {
    const evidencePath = `raw/failed-${artifacts.length + 1}.json`;
    await writer.writeJson(evidencePath, evidence);
    artifacts.push(evidencePath);
  }
  artifacts.push('raw/metadata.json');
  await writer.writeJson('raw/metadata.json', {
    backend: identity.backend,
    resourceKind: kind,
    collectionStatus: partial ? 'partial' : 'failed',
    reason,
    rawArtifacts: artifacts,
    ...metadataContext,
  });
  const hasPartialContent = partial && typeof partialContent === 'string' && partialContent.trim();
  const markdownPath = hasPartialContent ? 'markdown/document.md' : null;
  const sanitizedPath = hasPartialContent ? 'sanitized/items/document.md' : null;
  if (hasPartialContent) {
    const normalized = markdown(partialContent, { title, url });
    await Promise.all([
      writer.writeText(markdownPath, normalized),
      writer.writeText(sanitizedPath, normalized),
    ]);
  }
  const inventory = [item({
    itemId: `wecom-${kind}-${crypto.createHash('sha256').update(url).digest('hex').slice(0, 16)}`,
    title,
    url,
    sourceItemId: metadataContext.taskId || url,
    rawArtifacts: artifacts,
    status: hasPartialContent ? 'materialized' : partial ? 'pending' : 'failed',
    reason,
    markdownPath,
    sanitizedPath,
  })];
  const sourceMetadata = { ...identity, resourceKind: kind, reason, ...metadataContext };
  await persistBundle(writer, {
    title,
    url,
    inventory,
    canonicalItems: hasPartialContent ? [canonical({ title, url, path: sanitizedPath })] : [],
    sourceMetadata,
    ...(partial ? { collectionStatus: 'partial' } : {}),
    ...(hasPartialContent ? { paginationFailed: true } : {}),
  });
  return {
    ...handledOutcome(identity.connector, partial ? 'partial' : 'failed', outputDir, {
      discovered: 1,
      [partial ? (hasPartialContent ? 'materialized' : 'pending') : 'failed']: 1,
    }),
    reason,
  };
}

async function collectDocument(call, url, maxPolls, resumeTaskId = null) {
  let response;
  let taskId = resumeTaskId;
  if (!taskId) {
    response = await call('get_doc_content', { url, type: 2 }, 'raw/get-doc-content.json');
    if (typeof response.content === 'string' && response.content.trim()) return { content: response.content, sourceItemId: url };
    taskId = response.task_id;
    if (typeof taskId !== 'string' || !taskId) throw new Error('wecom-cli document response has no content or task_id');
  }
  for (let poll = 1; poll <= maxPolls; poll += 1) {
    try {
      response = await call('get_doc_content', { url, type: 2, task_id: taskId }, `raw/poll-${poll}.json`);
    } catch (error) {
      throw new PartialCollectionError(reasonOf(error), { ...contextOf(error), stage: 'poll', taskId, lastPoll: poll });
    }
    if (response.task_done === true) {
      if (typeof response.content !== 'string' || !response.content.trim()) {
        throw new PartialCollectionError('wecom-cli completed document task has empty content', { stage: 'poll', taskId, lastPoll: poll });
      }
      return { content: response.content, sourceItemId: taskId };
    }
  }
  throw new PartialCollectionError(`wecom-cli document task did not finish after ${maxPolls} polls`, {
    stage: 'poll', taskId, lastPoll: maxPolls,
  });
}

async function collectSmartpage(call, url, maxPolls, resumeTaskId = null) {
  let taskId = resumeTaskId;
  if (!taskId) {
    const start = await call('smartpage_export_task', { url, content_type: 1 }, 'raw/export-task.json');
    taskId = start.task_id;
    if (typeof taskId !== 'string' || !taskId) throw new Error('wecom-cli export response has no task_id');
  }
  for (let poll = 1; poll <= maxPolls; poll += 1) {
    let response;
    try {
      response = await call('smartpage_get_export_result', { task_id: taskId }, `raw/poll-${poll}.json`);
    } catch (error) {
      throw new PartialCollectionError(reasonOf(error), { ...contextOf(error), stage: 'poll', taskId, lastPoll: poll });
    }
    if (response.task_done === true) {
      if (typeof response.content !== 'string' || !response.content.trim()) {
        throw new PartialCollectionError('wecom-cli completed export task has empty content', { stage: 'poll', taskId, lastPoll: poll });
      }
      return { content: response.content, sourceItemId: taskId };
    }
  }
  throw new PartialCollectionError(`wecom-cli export did not finish after ${maxPolls} polls`, {
    stage: 'poll', taskId, lastPoll: maxPolls,
  });
}

async function resumeWecomResource(request, dependencies) {
  const sessionDir = typeof request?.sessionDir === 'string' ? request.sessionDir.trim() : '';
  const outputDir = request?.outputDir;
  if (!sessionDir) return { ...handledOutcome(identity.connector, 'failed', outputDir), reason: 'sessionDir is required' };
  try {
    const { metadata } = await readResumeMetadata(sessionDir);
    const sourceMetadata = metadata?.sourceMetadata;
    const resourceKind = sourceMetadata?.resourceKind;
    const taskId = sourceMetadata?.taskId;
    const url = metadata?.collection?.items?.[0]?.sourceUrl;
    const resumableItem = metadata?.collection?.items?.find((item) => (
      item?.sourceUrl === url
      && item?.sourceItemId === taskId
      && item?.materialization?.status === 'pending'
    ));
    if (sourceMetadata?.source !== identity.source
      || metadata?.collection?.status !== 'partial'
      || !['doc', 'sheet', 'smartpage'].includes(resourceKind)
      || typeof taskId !== 'string'
      || !taskId
      || typeof url !== 'string'
      || !url
      || !resumableItem) {
      throw new Error('session is not a resumable WeCom document, sheet, or smartpage collection');
    }
    return collectWecomResource({ outputDir, url, resourceKind, resumeTaskId: taskId }, dependencies);
  } catch (error) {
    return { ...handledOutcome(identity.connector, 'failed', outputDir), reason: reasonOf(error) };
  }
}

function fieldsOf(response) {
  const fields = response.fields;
  if (!Array.isArray(fields)) throw new Error('wecom-cli fields response is malformed');
  return fields.map((field, index) => {
    const id = field?.field_id ?? field?.id;
    const title = field?.title ?? field?.name;
    if (typeof id !== 'string' || typeof title !== 'string') throw new Error(`wecom-cli field ${index} is malformed`);
    return { id, title };
  });
}

function sheetList(response) {
  const sheets = response.sheets ?? response.sheet_list;
  if (!Array.isArray(sheets) || sheets.length === 0) throw new Error('wecom-cli sheet response is malformed');
  return sheets.map((sheet, index) => {
    const id = sheet?.sheet_id ?? sheet?.id;
    if (typeof id !== 'string' || !id) throw new Error(`wecom-cli sheet ${index} is malformed`);
    return { id, title: typeof sheet.title === 'string' ? sheet.title : id };
  });
}

function display(value) {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value);
}

function sheetSection(sheet, fields, rows) {
  const header = `| ${fields.map((field) => field.title).join(' | ')} |`;
  const rule = `| ${fields.map(() => '---').join(' | ')} |`;
  const body = rows.map((record) => {
    const values = record?.values ?? record?.fields;
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('wecom-cli record is malformed');
    return `| ${fields.map((field) => display(values[field.id] ?? values[field.title]).replaceAll('|', '\\|')).join(' | ')} |`;
  });
  return `## ${sheet.title}\n\n${header}\n${rule}\n${body.join('\n')}`;
}

async function collectSmartsheet(call, url, maxPages) {
  const sheets = sheetList(await call('smartsheet_get_sheet', { url }, 'raw/get-sheet.json'));
  const sections = [];
  for (const sheet of sheets) {
    const fields = fieldsOf(await call('smartsheet_get_fields', { url, sheet_id: sheet.id }, `raw/fields-${sheet.id}.json`));
    const rows = [];
    const cursors = new Set();
    let cursor;
    let page = 1;
    do {
      const response = await call('smartsheet_get_records', { url, sheet_id: sheet.id, cursor, limit: 1000 }, `raw/records-${sheet.id}-${page}.json`);
      if (!Array.isArray(response.records)) throw new Error('wecom-cli records response is malformed');
      rows.push(...response.records);
      cursor = response.next_cursor;
      if (cursor !== undefined && cursor !== null && typeof cursor !== 'string') throw new Error('wecom-cli records cursor is malformed');
      if (cursor) {
        if (cursors.has(cursor)) throw new Error('wecom-cli records cursor repeated');
        cursors.add(cursor);
      }
      if (cursor && page >= maxPages) {
        throw new PartialCollectionError(`wecom-cli records reached page limit ${maxPages}`, {
          stage: 'records-pagination',
          pagesCollected: page,
          lastCursor: cursor,
          partialContent: [...sections, sheetSection(sheet, fields, rows)].join('\n\n'),
        });
      }
      page += 1;
    } while (cursor);
    sections.push(sheetSection(sheet, fields, rows));
  }
  return { content: sections.join('\n\n'), sourceItemId: url };
}

export function createWecomAdapter(dependencies = {}) {
  return {
    connector: 'wecom',
    capabilities: () => ({ search: false, resource: true }),
    search: (request) => persistUnsupportedSearch(request),
    collectResource: (request) => collectWecomResource(request, dependencies),
    resumeResource: (request) => resumeWecomResource(request, dependencies),
  };
}
