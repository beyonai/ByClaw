#!/usr/bin/env node

import { createFeishuAdapter } from './enterprise/adapters/feishu.mjs';
import { createWecomAdapter } from './enterprise/adapters/wecom.mjs';
import { dispatchEnterprise, dispatchEnterpriseBatch, parseSearchBatchRequests } from './enterprise/dispatcher.mjs';
import { createArtifactWriter } from './enterprise/shared/artifact-writer.mjs';
import { assertSandboxSessionPath, loadSession, sessionPaths } from './session.mjs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

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

function requireAbsoluteOutputDir(values, currentSessionRoot, { enforceSandbox = true } = {}) {
  const outputDir = requireValue(values, 'output-dir');
  if (!isAbsolute(outputDir)) throw new Error('--output-dir must be an absolute path');
  return enforceSandbox
    ? assertSandboxSessionPath(outputDir, '--output-dir', { currentSessionRoot })
    : resolve(outputDir);
}

function requireAbsoluteOutputRoot(values, currentSessionRoot) {
  const outputRoot = requireValue(values, 'output-root');
  if (!isAbsolute(outputRoot)) throw new Error('--output-root must be an absolute path');
  return assertSandboxSessionPath(outputRoot, '--output-root', { currentSessionRoot });
}

function resolveCurrentSessionRoot(values) {
  return values['session-root'];
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

export async function writeSearchAllAggregate({
  aggregateWriter, query, sources, metadataOnly, outcomes,
}) {
  const inventory = [];
  const canonicalItems = [];
  const sourceMetadata = { outcomes: [] };
  let loadedBundles = 0;
  let bundleFailures = 0;
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
    loadedBundles += 1;
    const canonicalByPath = new Map((collectionResult.items || []).map((item) => [item.fileName, item]));
    for (const item of metadata.collection?.items || []) {
      const prefix = result.source;
      const materialization = { ...item.materialization };
      if (materialization.status === 'materialized') {
        const markdownRelative = `markdown/${prefix}/${materialization.markdownPath.replace(/^markdown\//, '')}`;
        const sanitizedRelative = `sanitized/items/${prefix}/${materialization.sanitizedPath.replace(/^sanitized\/items\//, '')}`;
        await aggregateWriter.writeText(markdownRelative, await readChildFile(
          result.sessionDir, materialization.markdownPath, 'markdownPath',
        ));
        await aggregateWriter.writeText(sanitizedRelative, await readChildFile(
          result.sessionDir, materialization.sanitizedPath, 'sanitizedPath',
        ));
        const canonical = canonicalByPath.get(materialization.sanitizedPath);
        if (!canonical) throw new Error(`来源 ${result.source} 的 materialized 条目缺少 canonical item`);
        canonicalItems.push({ ...canonical, markdown: sanitizedRelative, fileName: sanitizedRelative });
        materialization.markdownPath = markdownRelative;
        materialization.sanitizedPath = sanitizedRelative;
      }
      inventory.push({
        ...item,
        itemId: `${prefix}:${item.itemId}`,
        duplicateOf: item.duplicateOf ? `${prefix}:${item.duplicateOf}` : null,
        rawArtifacts: (item.rawArtifacts || []).map((artifact) => `${prefix}/${artifact}`),
        materialization,
      });
    }
  }
  const anySucceeded = loadedBundles > 0;
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
      search: '--parent-session-dir <absolute-path> --source dingtalk|feishu|wecom|ima --query <query> --output-dir <same path as parent-session-dir> [--limit 1..500] [--concurrency 1..16] [--cursor <cursor>] [--metadata-only [true|false]] [--source-options <json>]',
      searchAll: '--parent-session-dir <absolute-path> [--sources dingtalk,feishu,wecom,ima] --query <query> --output-root <absolute-path> [--limit 1..500] [--concurrency 1..16] [--metadata-only [true|false]]; defaults to all sources and metadata-only; continues after a connector auth failure',
      materialize: '--source dingtalk|feishu|ima --session-dir <metadata-only-session> --item-ids <id[,id...]> --output-dir <new-absolute-path> [--concurrency 1..16]',
      resource: '--parent-session-dir <absolute-path> --source dingtalk|feishu|wecom|ima --url <http(s)-url> --output-dir <absolute-path> [--minute-token <token> for feishu]',
      resumeResource: '--source wecom --session-dir <partial-session> --output-dir <new-absolute-path>',
      legacy: 'wecom-smartpage and feishu-minutes remain supported and require --parent-session-dir',
    },
  };
}

function commandSchema() {
  const source = { type: 'string', enum: ['dingtalk', 'feishu', 'wecom', 'ima'] };
  const absolutePath = { type: 'string', format: 'absolute-path' };
  const parentSession = { 'parent-session-dir': absolutePath };
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
        properties: { ...parentSession, ...currentSession, source, query: { type: 'string', minLength: 1 }, 'output-dir': absolutePath, limit: positiveLimit, concurrency, cursor: { type: 'string' }, 'metadata-only': { type: 'boolean', default: false }, 'source-options': { type: 'object', cliEncoding: 'json' } },
      },
      'search-all': {
        type: 'object', additionalProperties: false, required: ['parent-session-dir', 'query', 'output-root'],
        properties: { ...parentSession, ...currentSession, sources: { type: 'array', items: source, minItems: 1, uniqueItems: true, cliEncoding: 'comma-separated', default: ['dingtalk', 'feishu', 'wecom', 'ima'] }, query: { type: 'string', minLength: 1 }, 'output-root': absolutePath, limit: positiveLimit, concurrency, 'metadata-only': { type: 'boolean', default: true } },
      },
      materialize: {
        type: 'object', additionalProperties: false, required: ['source', 'session-dir', 'item-ids', 'output-dir'],
        properties: { ...currentSession, source: { ...source, enum: ['dingtalk', 'feishu', 'ima'] }, 'session-dir': absolutePath, 'item-ids': { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', minLength: 1 }, cliEncoding: 'comma-separated' }, 'output-dir': absolutePath, concurrency },
      },
      resource: {
        type: 'object', additionalProperties: false, required: ['parent-session-dir', 'source', 'url', 'output-dir'],
        properties: { ...parentSession, ...currentSession, source, url: { type: 'string', format: 'http-url' }, 'output-dir': absolutePath, 'minute-token': { type: 'string', minLength: 1 } },
      },
      'resume-resource': {
        type: 'object', additionalProperties: false, required: ['source', 'session-dir', 'output-dir'],
        properties: { ...currentSession, source: { type: 'string', enum: ['wecom'] }, 'session-dir': absolutePath, 'output-dir': absolutePath },
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
    const parentSessionDir = requireValue(values, 'parent-session-dir');
    assertEnterpriseScope(parentSessionDir, ['wecom']);
    const url = requireValue(values, 'url');
    const outputDir = requireAbsoluteOutputDir(values, resolveCurrentSessionRoot(values));
    const outcome = await createWecomAdapter({
      bin: process.env.WECOM_CLI_BIN || 'wecom-cli',
      env: process.env,
    }).collectResource({ url, outputDir, resourceKind: 'smartpage', legacyMode: true });
    if (outcome.status !== 'complete') throw new Error(outcome.reason || outcome.status);
    return;
  }
  if (command === 'feishu-minutes') {
    const parentSessionDir = requireValue(values, 'parent-session-dir');
    assertEnterpriseScope(parentSessionDir, ['feishu']);
    const minuteToken = requireValue(values, 'minute-token');
    const url = requireValue(values, 'url');
    const outputDir = requireAbsoluteOutputDir(values, resolveCurrentSessionRoot(values));
    const outcome = await createFeishuAdapter({
      bin: process.env.LARK_CLI_BIN || 'lark-cli',
      env: process.env,
    }).collectResource({ resourceKind: 'minutes', minuteToken, url, outputDir, legacyMode: true });
    if (outcome.status !== 'complete') throw new Error(outcome.reason || outcome.status);
    return;
  }
  if (command === 'search' || command === 'materialize' || command === 'resource' || command === 'resume-resource') {
    const scopeSessionDir = command === 'search' || command === 'resource'
      ? requireValue(values, 'parent-session-dir') : requireValue(values, 'session-dir');
    assertEnterpriseScope(scopeSessionDir, [requireValue(values, 'source')]);
    const { ['parent-session-dir']: _parentSessionDir, ['session-root']: _sessionRoot, ...dispatchValues } = values;
    const currentSessionRoot = resolveCurrentSessionRoot(values);
    if (command === 'search') {
      dispatchValues['output-dir'] = assertSandboxSessionPath(
        resolveEnterpriseOutputRoot(
          scopeSessionDir,
          requireAbsoluteOutputDir(values, currentSessionRoot, { enforceSandbox: false }),
        ),
        '--output-dir',
        { currentSessionRoot },
      );
    } else {
      dispatchValues['output-dir'] = requireAbsoluteOutputDir(values, currentSessionRoot);
    }
    render(await dispatchEnterprise(command, dispatchValues));
    return;
  }
  if (command === 'search-all') {
    const { ['parent-session-dir']: _parentSessionDir, ['session-root']: _sessionRoot, ...batchValues } = values;
    const requests = parseSearchBatchRequests(batchValues);
    const sources = requests.map((request) => request.source);
    assertEnterpriseScope(requireValue(values, 'parent-session-dir'), sources);
    const outputRoot = requireAbsoluteOutputRoot(
      values,
      resolveCurrentSessionRoot(values),
    );
    const aggregateWriter = await createArtifactWriter(outputRoot);
    const outcomes = await dispatchEnterpriseBatch('search', requests, { concurrency: Number(values.concurrency) || 4 });
    const aggregate = await writeSearchAllAggregate({
      aggregateWriter,
      query: requireValue(values, 'query'),
      sources,
      metadataOnly: values['metadata-only'] !== false && values['metadata-only'] !== 'false' && values['metadata-only'] !== '0',
      outcomes,
    });
    render({ outputDir: outputRoot, ...aggregate, outcomes });
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
