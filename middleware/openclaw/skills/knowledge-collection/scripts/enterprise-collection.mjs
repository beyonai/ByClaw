#!/usr/bin/env node

import { createFeishuAdapter } from './enterprise/adapters/feishu.mjs';
import { createWecomAdapter } from './enterprise/adapters/wecom.mjs';
import { dispatchEnterprise, dispatchEnterpriseBatch, parseSearchBatchRequests } from './enterprise/dispatcher.mjs';
import { createArtifactWriter } from './enterprise/shared/artifact-writer.mjs';
import { loadSession, resolveSandboxPath, sessionPaths } from './session.mjs';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const values = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === 'help') {
      values.help = true;
      continue;
    }
    if (key === 'metadata-only') {
      const next = rest[index + 1];
      if (['true', 'false', '1', '0'].includes(next)) {
        values[key] = next;
        index += 1;
      } else {
        values[key] = true;
      }
      continue;
    }
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for --${key}`);
    values[key] = value;
    index += 1;
  }
  return { command, values };
}

function requireValue(values, key) {
  const value = values[key]?.trim();
  if (!value) throw new Error(`--${key} is required`);
  return value;
}

const EXTERNAL_PATHS_BY_COMMAND = {
  search: ['parent-session-dir', 'output-dir'],
  'search-all': ['parent-session-dir', 'output-root'],
  materialize: ['session-dir', 'output-dir'],
  resource: ['parent-session-dir', 'output-dir'],
  'resume-resource': ['session-dir', 'output-dir'],
  'wecom-smartpage': ['parent-session-dir', 'output-dir'],
  'feishu-minutes': ['parent-session-dir', 'output-dir'],
};

export function normalizeEnterprisePaths(command, values) {
  const pathKeys = EXTERNAL_PATHS_BY_COMMAND[command];
  if (!pathKeys) throw new Error(`unsupported enterprise command: ${command || '(missing)'}`);
  const normalized = { ...values };
  for (const key of pathKeys) {
    normalized[key] = resolveSandboxPath(requireValue(values, key), `--${key}`, {
      currentSessionRoot: values['session-root'],
    });
  }
  if (command === 'search') {
    normalized['output-dir'] = resolveEnterpriseOutputRoot(
      normalized['parent-session-dir'], normalized['output-dir'],
    );
  }
  return normalized;
}

export function resolveEnterpriseOutputRoot(parentSessionDir, requestedOutputDir) {
  if (!isAbsolute(parentSessionDir) || !isAbsolute(requestedOutputDir)) {
    throw new Error('enterprise session paths must be absolute');
  }
  const parent = resolve(parentSessionDir);
  const requested = resolve(requestedOutputDir);
  const rawRoot = resolve(parent, 'raw');
  const fromRaw = relative(rawRoot, requested);
  if (requested === parent
    || requested === rawRoot
    || (fromRaw && fromRaw !== '..' && !fromRaw.startsWith(`..${sep}`) && !isAbsolute(fromRaw))) {
    return parent;
  }
  return requested;
}

export function assertDistinctSessionTrees(firstSessionDir, secondSessionDir) {
  const first = resolve(firstSessionDir);
  const second = resolve(secondSessionDir);
  const secondFromFirst = relative(first, second);
  const firstFromSecond = relative(second, first);
  const nested = (candidate) => candidate
    && candidate !== '..'
    && !candidate.startsWith(`..${sep}`)
    && !isAbsolute(candidate);
  if (first === second || nested(secondFromFirst) || nested(firstFromSecond)) {
    throw new Error('parent and aggregate must use distinct, non-overlapping session trees');
  }
}

export function assertEnterpriseScope(parentSessionDir, requestedSources) {
  if (typeof parentSessionDir !== 'string' || !isAbsolute(parentSessionDir)) {
    throw new Error('--parent-session-dir must be an absolute initialized collection session');
  }
  const { session } = loadSession(sessionPaths(parentSessionDir), { persistMigration: false });
  const allowed = Array.isArray(session.task?.sourceScope) ? session.task.sourceScope : [];
  const denied = requestedSources.filter((source) => !allowed.includes(source));
  if (denied.length) {
    throw new Error(`session task.sourceScope 不允许企业来源: ${denied.join(', ')}`);
  }
  return session;
}

export function enterpriseChildTaskContract(session) {
  const task = session?.task || {};
  return {
    query: task.query,
    materializationTarget: task.materializationTarget || 'selected',
    requiredContentGranularity: task.requiredContentGranularity || 'any',
    deliveryRequested: task.deliveryRequested === true,
  };
}

export function assertImaParentContract(parentSessionDir, parentSession, query, outputDir = null) {
  const parentRoot = resolve(parentSessionDir);
  if (outputDir !== null && resolve(outputDir) !== parentRoot) {
    throw new Error('IMA search output must remain in the parent session');
  }
  const parentQuery = typeof parentSession?.task?.query === 'string'
    ? parentSession.task.query.trim()
    : '';
  if (!parentQuery || query.trim() !== parentQuery) {
    throw new Error('IMA search query must match the parent task query; query drift is not allowed');
  }
}

function relativeChildPath(sessionDir, relativePath, label) {
  const target = resolve(sessionDir, relativePath);
  const fromRoot = relative(resolve(sessionDir), target);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`${label} 越出来源会话`);
  }
  return target;
}

async function readChildFile(sessionDir, relativePath, label) {
  const rootEntry = await lstat(sessionDir);
  if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
    throw new Error(`${label} source session must be a regular directory`);
  }
  const target = relativeChildPath(sessionDir, relativePath, label);
  const entry = await lstat(target);
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new Error(`${label} must not be a symbolic link`);
  }
  const canonicalRoot = await realpath(sessionDir);
  const canonicalTarget = await realpath(target);
  const fromRoot = relative(canonicalRoot, canonicalTarget);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`${label} is outside source session`);
  }
  return readFile(target, 'utf8');
}

async function readChildBytes(sessionDir, relativePath, label) {
  const rootEntry = await lstat(sessionDir);
  if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
    throw new Error(`${label} source session must be a regular directory`);
  }
  const target = relativeChildPath(sessionDir, relativePath, label);
  const entry = await lstat(target);
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new Error(`${label} must not be a symbolic link`);
  }
  const canonicalRoot = await realpath(sessionDir);
  const canonicalTarget = await realpath(target);
  const fromRoot = relative(canonicalRoot, canonicalTarget);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`${label} is outside source session`);
  }
  return readFile(target);
}

async function childAssetFiles(sessionDir, assetRootRelative) {
  const root = resolve(sessionDir, assetRootRelative);
  let rootEntry;
  try {
    rootEntry = await lstat(root);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
    throw new Error('aggregate item assets must be a regular directory');
  }
  const canonicalSession = await realpath(sessionDir);
  const canonicalRoot = await realpath(root);
  const fromSession = relative(canonicalSession, canonicalRoot);
  if (!fromSession || fromSession === '..' || fromSession.startsWith(`..${sep}`) || isAbsolute(fromSession)) {
    throw new Error('aggregate item assets are outside source session');
  }
  const files = [];
  async function visit(directory, relativeDirectory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('aggregate item assets must not contain symbolic links');
      const relativePath = join(relativeDirectory, entry.name);
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolutePath, relativePath);
      else if (entry.isFile()) files.push(relativePath);
      else throw new Error('aggregate item assets must contain only regular files and directories');
    }
  }
  await visit(root, '');
  return files;
}

async function copyAggregateAssets({
  aggregateWriter, sessionDir, sourceSanitizedPath, sanitizedRelative, markdownRelative,
}) {
  const sourceMarkdown = resolve(sessionDir, sourceSanitizedPath);
  const sourceFromSanitizedItems = relative(resolve(sessionDir, 'sanitized/items'), sourceMarkdown);
  if (!sourceFromSanitizedItems
    || sourceFromSanitizedItems === '..'
    || sourceFromSanitizedItems.startsWith(`..${sep}`)
    || isAbsolute(sourceFromSanitizedItems)) {
    throw new Error('aggregate item assets must belong to sanitized/items');
  }
  const assetRootRelative = join(dirname(sourceSanitizedPath), 'assets');
  for (const assetRelative of await childAssetFiles(sessionDir, assetRootRelative)) {
    const sourceRelative = join(assetRootRelative, assetRelative).split(sep).join('/');
    const itemRelative = join('assets', assetRelative);
    const bytes = await readChildBytes(sessionDir, sourceRelative, 'aggregate item asset');
    await aggregateWriter.writeBytes(
      join(dirname(sanitizedRelative), itemRelative).split(sep).join('/'), bytes,
    );
    await aggregateWriter.writeBytes(
      join(dirname(markdownRelative), itemRelative).split(sep).join('/'), bytes,
    );
  }
}

export async function writeSearchAllAggregate({
  aggregateWriter, query, sources, metadataOnly, outcomes,
}) {
  const inventory = [];
  const canonicalItems = [];
  const sourceMetadata = { outcomes: [] };
  let successfulBundles = 0;
  let bundleFailures = 0;
  const copiedRawArtifacts = new Set();
  for (const result of outcomes) {
    const sourceOutcome = { source: result.source, outcome: result.outcome };
    sourceMetadata.outcomes.push(sourceOutcome);
    let metadata;
    let collectionResult;
    try {
      metadata = JSON.parse(await readChildFile(result.sessionDir, 'sanitized/metadata.json', 'metadata'));
      collectionResult = JSON.parse(await readChildFile(result.sessionDir, 'collection-result.json', 'collection result'));
    } catch {
      sourceOutcome.aggregateFailure = 'child bundle unavailable or invalid';
      bundleFailures += 1;
      continue;
    }
    if (metadata.collection?.status !== 'failed'
      && ['complete', 'partial'].includes(result.outcome?.status)) {
      successfulBundles += 1;
    }
    const canonicalByPath = new Map((collectionResult.items || []).map((item) => [item.fileName, item]));
    for (const item of metadata.collection?.items || []) {
      const prefix = result.source;
      const materialization = { ...item.materialization };
      if (materialization.status === 'materialized') {
        const markdownRelative = `markdown/${prefix}/${materialization.markdownPath.replace(/^markdown\//, '')}`;
        const sanitizedRelative = `sanitized/items/${prefix}/${materialization.sanitizedPath.replace(/^sanitized\/items\//, '')}`;
        const workMarkdown = await readChildFile(
          result.sessionDir, materialization.markdownPath, 'markdownPath',
        );
        const sanitizedMarkdown = await readChildFile(
          result.sessionDir, materialization.sanitizedPath, 'sanitizedPath',
        );
        await aggregateWriter.writeText(markdownRelative, workMarkdown);
        await aggregateWriter.writeText(sanitizedRelative, sanitizedMarkdown);
        await copyAggregateAssets({
          aggregateWriter,
          sessionDir: result.sessionDir,
          sourceSanitizedPath: materialization.sanitizedPath,
          sanitizedRelative,
          markdownRelative,
        });
        const canonical = canonicalByPath.get(materialization.sanitizedPath);
        if (!canonical) throw new Error(`来源 ${result.source} 的 materialized 条目缺少 canonical item`);
        canonicalItems.push({ ...canonical, markdown: sanitizedRelative, fileName: sanitizedRelative });
        materialization.markdownPath = markdownRelative;
        materialization.sanitizedPath = sanitizedRelative;
      }
      const rawArtifacts = [];
      for (const artifact of item.rawArtifacts || []) {
        if (typeof artifact !== 'string' || !artifact.startsWith('raw/')) {
          throw new Error(`来源 ${result.source} 的 raw artifact 不在 raw/ 中`);
        }
        const target = `raw/${prefix}/${artifact.slice('raw/'.length)}`;
        if (!copiedRawArtifacts.has(target)) {
          const bytes = await readChildBytes(result.sessionDir, artifact, 'aggregate raw artifact');
          if (bytes.length === 0) throw new Error('aggregate raw artifact must not be empty');
          await aggregateWriter.writeBytes(target, bytes);
          copiedRawArtifacts.add(target);
        }
        rawArtifacts.push(target);
      }
      inventory.push({
        ...item,
        itemId: `${prefix}:${item.itemId}`,
        duplicateOf: item.duplicateOf ? `${prefix}:${item.duplicateOf}` : null,
        rawArtifacts,
        materialization,
      });
    }
  }
  const anySucceeded = successfulBundles > 0;
  const anyIncomplete = bundleFailures > 0
    || outcomes.some((result) => result.outcome?.status !== 'complete');
  await aggregateWriter.writeJson('raw/search-all.json', { command: 'search-all', outcomes });
  await aggregateWriter.writeCollectionBundle({
    title: `Enterprise search: ${query}`,
    query,
    source: 'multi-source',
    backend: 'multi-source',
    url: `enterprise-search-all:${encodeURIComponent(query)}`,
    filters: { query, sources },
    inventory,
    canonicalItems,
    sourceMetadata,
    sourceScope: sources,
    materializationTarget: metadataOnly ? 'candidates' : 'all',
    metadataOnly,
    discoverySucceeded: anySucceeded,
    paginationFailed: anyIncomplete,
  });
  return { aggregatePath: 'raw/search-all.json', inventory: inventory.length };
}

export async function withSearchAllAggregateWriter(outputRoot, taskContract, operation) {
  const aggregateWriter = await createArtifactWriter(outputRoot, {
    initialTaskContract: taskContract,
  });
  try {
    return await operation(aggregateWriter);
  } catch (error) {
    try {
      await aggregateWriter.abort();
    } catch (abortError) {
      error.abortError = abortError;
    }
    throw error;
  }
}

function render(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function help() {
  return {
    ok: true,
    name: 'knowledge-collection-enterprise',
    usage: 'knowledge-collection.mjs enterprise search|search-all|materialize|resource|resume-resource [options]',
    defaults: 'search defaults: limit 50, concurrency 4, cursor null, metadata-only false; search-all defaults: sources dingtalk,feishu,wecom,ima, limit 50, concurrency 4, metadata-only true',
    commands: {
      search: '--session-root </by/.sessions/sessionId> --parent-session-dir <sandbox-path> --source dingtalk|feishu|wecom|ima --query <query> --output-dir <sandbox-path; same resolved path as parent-session-dir> [--limit 1..500] [--concurrency 1..16] [--cursor <cursor>] [--metadata-only [true|false]] [--source-options <json>]',
      searchAll: '--session-root </by/.sessions/sessionId> --parent-session-dir <sandbox-path> [--sources dingtalk,feishu,wecom,ima] --query <query> --output-root <sandbox-path> [--limit 1..500] [--concurrency 1..16] [--metadata-only [true|false]]; defaults to all sources and metadata-only; continues after a connector auth failure',
      materialize: '--session-root </by/.sessions/sessionId> --source dingtalk|feishu|ima --session-dir <sandbox-path> --item-ids <id[,id...]> --output-dir <sandbox-path; for ima, same resolved path as session-dir> [--concurrency 1..16]',
      resource: '--session-root </by/.sessions/sessionId> --parent-session-dir <sandbox-path> --source dingtalk|feishu|wecom|ima --url <http(s)-url> --output-dir <sandbox-path> [--minute-token <token> for feishu]',
      resumeResource: '--session-root </by/.sessions/sessionId> --source wecom --session-dir <sandbox-path> --output-dir <sandbox-path>',
      legacy: 'wecom-smartpage and feishu-minutes remain supported and require --parent-session-dir',
    },
  };
}

function commandSchema() {
  const source = { type: 'string', enum: ['dingtalk', 'feishu', 'wecom', 'ima'] };
  const absolutePath = { type: 'string', format: 'absolute-path' };
  const sandboxPath = { type: 'string', format: 'sandbox-path' };
  const parentSession = { 'parent-session-dir': sandboxPath };
  const currentSession = { 'session-root': absolutePath };
  const positiveLimit = { type: 'integer', minimum: 1, maximum: 500, default: 50 };
  const concurrency = { type: 'integer', minimum: 1, maximum: 16, default: 4 };
  return {
    ok: true,
    name: 'knowledge-collection-enterprise',
    schemaVersion: '1.0',
    cli: { flagStyle: '--kebab-case', commaSeparatedArrays: ['sources', 'item-ids'] },
    commands: {
      search: {
        type: 'object', additionalProperties: false, required: ['parent-session-dir', 'source', 'query', 'output-dir'],
        properties: { ...parentSession, ...currentSession, source, query: { type: 'string', minLength: 1 }, 'output-dir': sandboxPath, limit: positiveLimit, concurrency, cursor: { type: 'string' }, 'metadata-only': { type: 'boolean', default: false }, 'source-options': { type: 'object', cliEncoding: 'json' } },
      },
      'search-all': {
        type: 'object', additionalProperties: false, required: ['parent-session-dir', 'query', 'output-root'],
        properties: { ...parentSession, ...currentSession, sources: { type: 'array', items: source, minItems: 1, uniqueItems: true, cliEncoding: 'comma-separated', default: ['dingtalk', 'feishu', 'wecom', 'ima'] }, query: { type: 'string', minLength: 1 }, 'output-root': sandboxPath, limit: positiveLimit, concurrency, 'metadata-only': { type: 'boolean', default: true } },
      },
      materialize: {
        type: 'object', additionalProperties: false, required: ['source', 'session-dir', 'item-ids', 'output-dir'],
        properties: { ...currentSession, source: { ...source, enum: ['dingtalk', 'feishu', 'ima'] }, 'session-dir': sandboxPath, 'item-ids': { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', minLength: 1 }, cliEncoding: 'comma-separated' }, 'output-dir': sandboxPath, concurrency },
      },
      resource: {
        type: 'object', additionalProperties: false, required: ['parent-session-dir', 'source', 'url', 'output-dir'],
        properties: { ...parentSession, ...currentSession, source, url: { type: 'string', format: 'http-url' }, 'output-dir': sandboxPath, 'minute-token': { type: 'string', minLength: 1 } },
      },
      'resume-resource': {
        type: 'object', additionalProperties: false, required: ['source', 'session-dir', 'output-dir'],
        properties: { ...currentSession, source: { type: 'string', enum: ['wecom'] }, 'session-dir': sandboxPath, 'output-dir': sandboxPath },
      },
    },
  };
}

async function main() {
  const { command, values } = parseArgs(process.argv.slice(2));
  if (!command || command === 'help' || command === '--help' || values.help === true || values.help === 'true') {
    render(help());
    return;
  }
  if (command === 'command-schema') {
    render(commandSchema());
    return;
  }
  if (command === 'wecom-smartpage') {
    const normalizedValues = normalizeEnterprisePaths(command, values);
    const parentSessionDir = normalizedValues['parent-session-dir'];
    assertEnterpriseScope(parentSessionDir, ['wecom']);
    const url = requireValue(values, 'url');
    const outputDir = normalizedValues['output-dir'];
    const outcome = await createWecomAdapter({
      bin: process.env.WECOM_CLI_BIN || 'wecom-cli',
      env: process.env,
    }).collectResource({ url, outputDir, resourceKind: 'smartpage', legacyMode: true });
    if (outcome.status !== 'complete') throw new Error(outcome.reason || outcome.status);
    return;
  }
  if (command === 'feishu-minutes') {
    const normalizedValues = normalizeEnterprisePaths(command, values);
    const parentSessionDir = normalizedValues['parent-session-dir'];
    assertEnterpriseScope(parentSessionDir, ['feishu']);
    const minuteToken = requireValue(values, 'minute-token');
    const url = requireValue(values, 'url');
    const outputDir = normalizedValues['output-dir'];
    const outcome = await createFeishuAdapter({
      bin: process.env.LARK_CLI_BIN || 'lark-cli',
      env: process.env,
    }).collectResource({ resourceKind: 'minutes', minuteToken, url, outputDir, legacyMode: true });
    if (outcome.status !== 'complete') throw new Error(outcome.reason || outcome.status);
    return;
  }
  if (command === 'search' || command === 'materialize' || command === 'resource' || command === 'resume-resource') {
    const normalizedValues = normalizeEnterprisePaths(command, values);
    const scopeSessionDir = command === 'search' || command === 'resource'
      ? normalizedValues['parent-session-dir'] : normalizedValues['session-dir'];
    const source = requireValue(values, 'source');
    const parentSession = assertEnterpriseScope(scopeSessionDir, [source]);
    let dispatchOptions = {};
    if (command === 'search' && source === 'ima') {
      assertImaParentContract(
        scopeSessionDir,
        parentSession,
        requireValue(values, 'query'),
        normalizedValues['output-dir'],
      );
      dispatchOptions = { taskContract: enterpriseChildTaskContract(parentSession) };
    }
    const { ['parent-session-dir']: _parentSessionDir, ['session-root']: _sessionRoot, ...dispatchValues } = normalizedValues;
    render(await dispatchEnterprise(command, dispatchValues, dispatchOptions));
    return;
  }
  if (command === 'search-all') {
    const normalizedValues = normalizeEnterprisePaths(command, values);
    const { ['parent-session-dir']: _parentSessionDir, ['session-root']: _sessionRoot, ...batchValues } = normalizedValues;
    const requests = parseSearchBatchRequests(batchValues);
    const sources = requests.map((request) => request.source);
    const parentSession = assertEnterpriseScope(normalizedValues['parent-session-dir'], sources);
    const outputRoot = normalizedValues['output-root'];
    assertDistinctSessionTrees(normalizedValues['parent-session-dir'], outputRoot);
    const query = requireValue(values, 'query');
    if (sources.includes('ima')) {
      assertImaParentContract(normalizedValues['parent-session-dir'], parentSession, query);
    }
    const taskContract = enterpriseChildTaskContract(parentSession);
    const result = await withSearchAllAggregateWriter(outputRoot, taskContract, async (aggregateWriter) => {
      const outcomes = await dispatchEnterpriseBatch('search', requests, {
        concurrency: Number(values.concurrency) || 4,
        taskContract,
      });
      const aggregate = await writeSearchAllAggregate({
        aggregateWriter,
        query,
        sources,
        metadataOnly: values['metadata-only'] !== false && values['metadata-only'] !== 'false' && values['metadata-only'] !== '0',
        outcomes,
      });
      return { outputDir: outputRoot, ...aggregate, outcomes };
    });
    render(result);
    return;
  }
  throw new Error(`unsupported command: ${command || '(missing)'}`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
