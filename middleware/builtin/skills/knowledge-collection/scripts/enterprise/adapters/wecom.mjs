import crypto from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createArtifactWriter } from '../shared/artifact-writer.mjs';
import { positiveEnv, runCli } from '../shared/cli-runner.mjs';
import { readResumeMetadata } from '../shared/resume.mjs';
import { SOURCE_IDENTITY, handledOutcome } from '../shared/status-model.mjs';

const CLI_VERSION = '1.3.4';
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
  return {
    ...env,
    HOME: env.WECOM_HOME,
    WECOM_CLI_CONFIG_DIR: join(env.WECOM_HOME, '.config', 'wecom'),
    WECOM_CLI_ACCESS_TOKEN: '',
  };
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
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('unsupported WeCom resource URL'); }
  const match = parsed.pathname.match(/^\/(doc|sheet|smartsheet|smartpage)\/(?:p\/)?([^/]+)\/?$/);
  if (parsed.protocol !== 'https:' || !['doc.weixin.qq.com', 'page.weixin.qq.com'].includes(parsed.hostname)
    || parsed.username || parsed.password || parsed.port || !match
    || (parsed.hostname === 'page.weixin.qq.com' && match[1] !== 'smartpage')) {
    throw new Error('unsupported WeCom resource URL');
  }
  const kind = match[1];
  if (request.resourceKind && request.resourceKind !== kind) {
    throw new Error(`resourceKind ${request.resourceKind} conflicts with URL type ${kind}`);
  }
  return { url, kind, docid: decodeURIComponent(match[2]) };
}

function markdown(content, { title, url }) {
  return `---\ntitle: ${JSON.stringify(title)}\nsource: "wecom"\nsource_url: ${JSON.stringify(url)}\ncollection_filters: {}\n---\n\n${content.trim()}\n`;
}

function parseBusiness(stdout) {
  let business;
  try { business = JSON.parse(stdout); } catch { throw new Error('wecom-cli returned invalid JSON'); }
  if (!business || typeof business !== 'object' || Array.isArray(business) || business.jsonrpc) {
    throw new Error('wecom-cli business response is malformed; version 1.3.4 is required');
  }
  if (business.error || business.isError === true) throw new Error('wecom-cli returned a structured error');
  if (business.errcode !== undefined && business.errcode !== 0) {
    throw new Error(`wecom-cli business errcode ${business.errcode}`);
  }
  return business;
}

async function readCliFile(writer, outputDir, commandDir, filePath, maxBytes) {
  if (typeof filePath !== 'string' || !filePath) throw new Error('wecom-cli file_path is malformed');
  const candidate = resolve(outputDir, filePath);
  const local = relative(commandDir, candidate);
  if (!local || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) {
    throw new Error('wecom-cli file_path is outside the command output directory');
  }
  // The artifact writer rejects every symlink component and verifies the session root.
  writer.absolute(relative(outputDir, candidate));
  const actual = await realpath(candidate);
  if (actual !== candidate) throw new Error('wecom-cli file_path contains a symbolic link');
  const handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes) {
      throw new Error('wecom-cli output file is not a bounded regular file');
    }
    await handle.chmod(0o600);
    return await handle.readFile('utf8');
  } finally { await handle.close(); }
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
  const { url, kind, docid } = resource;
  const rawArtifacts = [];
  const bin = dependencies.bin || 'wecom-cli';
  let env;
  try {
    env = commandEnvironment(dependencies);
  } catch (error) {
    return persistFailure(writer, outputDir, url, kind, rawArtifacts, reasonOf(error), { stage: 'authentication' });
  }
  const maxPages = positiveOption(
    dependencies.maxPages,
    positiveEnv('KNOWLEDGE_COLLECTION_MAX_WECOM_PAGES', MAX_PAGES, env),
  );

  const cliWorkingDir = await realpath(outputDir);
  let commandIndex = 0;
  const call = async (command, payload, artifact) => {
    const requestedDir = writer.absolute(`raw/cli-output-${++commandIndex}`);
    await mkdir(requestedDir, { mode: 0o700 });
    const commandDir = await realpath(requestedDir);
    let result;
    try {
      result = await runCli(bin, [...command.split(' '), '--json', JSON.stringify(payload), '--output-dir', commandDir], { env, cwd: cliWorkingDir });
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
      parsed = parseBusiness(result.stdout);
      const maxBytes = positiveEnv('KNOWLEDGE_COLLECTION_MAX_CLI_OUTPUT_BYTES', 10 * 1024 * 1024, env);
      if (parsed.file_path) {
        const text = await readCliFile(writer, cliWorkingDir, commandDir, parsed.file_path, maxBytes);
        if (command === 'doc contents get' || command === 'sheet ranges get') parsed.content = text;
        else parsed = parseBusiness(text);
      }
      if (command === 'smartpage pages get' && Array.isArray(parsed.pages)) {
        for (const page of parsed.pages) {
          if (page.file_path) page.content_file_inner = await readCliFile(writer, cliWorkingDir, commandDir, page.file_path, maxBytes);
        }
      }
    } catch (error) {
      throw new WecomCommandError(reasonOf(error), {
        stage: 'response', evidence: { command, ...cliEvidence(result) },
      });
    }
    await writer.writeJson(artifact, parsed);
    rawArtifacts.push(artifact);
    return parsed;
  };

  try {
    let result;
    if (kind === 'smartsheet') result = await collectSmartsheet(call, docid, maxPages);
    else if (kind === 'smartpage') result = await collectSmartpage(call, docid, maxPages);
    else if (kind === 'sheet') result = await collectSheet(call, docid, maxPages);
    else result = await collectDocument(call, docid);
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
        backendCliVersion: CLI_VERSION,
        resourceKind: kind,
        sourceItemId: result.sourceItemId,
        ...(request.legacyMode ? {
          backendCliVersion: CLI_VERSION,
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
  const sourceMetadata = { ...identity, backendCliVersion: CLI_VERSION, resourceKind: kind, reason, ...metadataContext };
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

async function collectDocument(call, docid) {
  const response = await call('doc contents get', { docid, content_type: 'markdown' }, 'raw/get-doc-content.json');
  if (typeof response.content !== 'string' || !response.content.trim()) {
    throw new Error('wecom-cli document response has empty content');
  }
  return { content: response.content, sourceItemId: docid };
}

async function collectSmartpage(call, docid, maxPages) {
  const structure = await call('smartpage pages get', { docid }, 'raw/get-pages.json');
  if (!Array.isArray(structure.pages) || !structure.pages.length) throw new Error('wecom-cli pages response is malformed');
  const sections = [];
  const ids = new Set();
  for (const [index, page] of structure.pages.entries()) {
    try {
      if (index >= maxPages) throw new Error(`wecom-cli pages reached page limit ${maxPages}`);
      if (typeof page.page_id !== 'string' || !page.page_id || ids.has(page.page_id)) {
        throw new Error('wecom-cli page ID is missing or repeated');
      }
      ids.add(page.page_id);
      const response = await call('smartpage pages get', {
        docid, page_id: page.page_id, content_type: 'markdown',
      }, `raw/page-${index + 1}.json`);
      const detail = response.pages?.find((entry) => entry?.page_id === page.page_id);
      if (typeof detail?.content_file_inner !== 'string') throw new Error('wecom-cli page has no content');
      sections.push(`## ${page.page_title || page.page_id}\n\n${detail.content_file_inner}`);
    } catch (error) {
      throw new PartialCollectionError(reasonOf(error), {
        ...contextOf(error), stage: 'pages', pagesCollected: sections.length, partialContent: sections.join('\n\n'),
      });
    }
  }
  return { content: sections.join('\n\n'), sourceItemId: docid };
}

async function collectSheet(call, docid, maxPages) {
  const response = await call('sheet get', { docid }, 'raw/get-sheet.json');
  const sheets = sheetList(response);
  const sections = [];
  for (const [index, sheet] of sheets.entries()) {
    try {
      if (index >= maxPages) throw new Error(`wecom-cli sheets reached page limit ${maxPages}`);
      const data = await call('sheet ranges get', { docid, sheet_id: sheet.id, mode: 'csv' }, `raw/sheet-${index + 1}.json`);
      if (typeof data.content !== 'string') throw new Error('wecom-cli sheet has no CSV content');
      const fence = '`'.repeat(Math.max(3, ...(data.content.match(/`+/g) || []).map((value) => value.length + 1)));
      sections.push(`## ${sheet.title}\n\n${fence}csv\n${data.content}\n${fence}`);
    } catch (error) {
      throw new PartialCollectionError(reasonOf(error), {
        ...contextOf(error), stage: 'sheets', pagesCollected: sections.length, partialContent: sections.join('\n\n'),
      });
    }
  }
  return { content: sections.join('\n\n'), sourceItemId: docid };
}

async function resumeWecomResource(request, dependencies) {
  const sessionDir = typeof request?.sessionDir === 'string' ? request.sessionDir.trim() : '';
  const outputDir = request?.outputDir;
  if (!sessionDir) return { ...handledOutcome(identity.connector, 'failed', outputDir), reason: 'sessionDir is required' };
  try {
    const { metadata } = await readResumeMetadata(sessionDir);
    const sourceMetadata = metadata?.sourceMetadata;
    if (sourceMetadata?.taskId || sourceMetadata?.backendCliVersion !== CLI_VERSION) {
      throw new Error('legacy WeCom tasks cannot resume in 1.3.4; recollect the original resource URL');
    }
    const resourceKind = sourceMetadata?.resourceKind;
    const url = metadata?.collection?.items?.[0]?.sourceUrl;
    if (sourceMetadata?.source !== identity.source || metadata?.collection?.status !== 'partial'
      || !['doc', 'sheet', 'smartpage', 'smartsheet'].includes(resourceKind) || typeof url !== 'string' || !url) {
      throw new Error('session is not a resumable WeCom collection');
    }
    // Reads are idempotent; refresh the resource instead of reusing deleted 0.x task IDs.
    return collectWecomResource({ outputDir, url, resourceKind }, dependencies);
  } catch (error) {
    return { ...handledOutcome(identity.connector, 'failed', outputDir), reason: reasonOf(error) };
  }
}

function fieldsOf(response) {
  const fields = response.fields;
  if (!Array.isArray(fields)) throw new Error('wecom-cli fields response is malformed');
  return fields.map((field, index) => {
    const title = field?.field_title ?? field?.title ?? field?.name;
    const id = field?.field_id ?? field?.id ?? title;
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
    return { id, title: typeof sheet.title === 'string' ? sheet.title : id, type: sheet.type };
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

async function collectSmartsheet(call, docid, maxPages) {
  const sheets = sheetList(await call('smartsheet sheets list', { docid }, 'raw/get-sheet.json'))
    .filter((sheet) => sheet.type !== 'dashboard');
  const sections = [];
  for (const [sheetIndex, sheet] of sheets.entries()) {
    const fields = [];
    const rows = [];
    try {
      for (const [resource, output] of [['fields', fields], ['records', rows]]) {
        const cursors = new Set();
        let cursor;
        for (let page = 1; ; page += 1) {
          const limit = resource === 'fields' ? 1000 : Math.min(1000, Math.floor(9999 / Math.max(fields.length, 1)));
          if (limit < 1) throw new Error('wecom-cli sheet exceeds the record cell limit');
          const response = await call(`smartsheet ${resource} list`, {
            docid, sheet_title: sheet.title, cursor, limit,
          }, `raw/${resource}-${sheetIndex + 1}-${page}.json`);
          const values = resource === 'fields' ? fieldsOf(response) : response.records;
          if (!Array.isArray(values)) throw new Error(`wecom-cli ${resource} response is malformed`);
          output.push(...values);
          if (response.has_more !== undefined && typeof response.has_more !== 'boolean') {
            throw new Error(`wecom-cli ${resource} has_more is malformed`);
          }
          // The service can return a terminal cursor even when pagination is complete.
          if (response.has_more === false) break;
          cursor = response.next_cursor;
          if (cursor !== undefined && cursor !== null && typeof cursor !== 'string') {
            throw new Error(`wecom-cli ${resource} cursor is malformed`);
          }
          if (!cursor) {
            if (response.has_more === true) throw new Error(`wecom-cli ${resource} continuation is missing`);
            break;
          }
          if (cursors.has(cursor)) throw new Error(`wecom-cli ${resource} cursor repeated`);
          cursors.add(cursor);
          if (page >= maxPages) throw new Error(`wecom-cli ${resource} reached page limit ${maxPages}`);
        }
      }
      sections.push(sheetSection(sheet, fields, rows));
    } catch (error) {
      throw new PartialCollectionError(reasonOf(error), {
        ...contextOf(error), stage: 'smartsheet-pagination',
        partialContent: [...sections, ...(rows.length ? [sheetSection(sheet, fields, rows)] : [])].join('\n\n'),
      });
    }
  }
  if (!sections.length) throw new Error('wecom-cli smartsheet has no data sheets');
  return { content: sections.join('\n\n'), sourceItemId: docid };
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
