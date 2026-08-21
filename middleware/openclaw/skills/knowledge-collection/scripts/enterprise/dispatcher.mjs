import { isAbsolute, join } from 'node:path';
import { createDingtalkAdapter } from './adapters/dingtalk.mjs';
import { createFwsAdapter } from './adapters/fws.mjs';
import { createWecomAdapter } from './adapters/wecom.mjs';
import { handledOutcome } from './shared/status-model.mjs';

const SOURCES = new Set(['dingtalk', 'feishu', 'wecom']);
const SENSITIVE_KEY = /(token|cookie|secret|password|authorization|credential|device[_-]?code)/i;
const SEARCH_OPTIONS = {
  dingtalk: new Map([['workspace-ids', 'workspaceIds'], ['extensions', 'extensions'], ['folder-id', 'folderId']]),
  feishu: new Map([['space-id', 'spaceId'], ['file-types', 'fileTypes']]),
  wecom: new Map(),
};
const RESOURCE_OPTIONS = {
  dingtalk: new Map(),
  feishu: new Map([['minute-token', 'minuteToken']]),
  wecom: new Map(),
};

function requiredString(values, key) {
  const value = typeof values?.[key] === 'string' ? values[key].trim() : '';
  if (!value) throw new Error(`--${key} is required`);
  return value;
}

function parseInteger(values, key, fallback, minimum, maximum) {
  if (values[key] === undefined) return fallback;
  const raw = values[key];
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) throw new Error(`--${key} must be an integer between ${minimum} and ${maximum}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`--${key} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function parseBoolean(values, key, fallback) {
  if (values[key] === undefined) return fallback;
  if (values[key] === true || values[key] === 'true' || values[key] === '1') return true;
  if (values[key] === false || values[key] === 'false' || values[key] === '0') return false;
  throw new Error(`--${key} must be true or false`);
}

function parseSource(values) {
  const source = requiredString(values, 'source');
  if (!SOURCES.has(source)) throw new Error(`--source must be one of: ${[...SOURCES].join(', ')}`);
  return source;
}

function parseUrl(values) {
  const url = requiredString(values, 'url');
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid protocol');
  } catch {
    throw new Error('--url must be an absolute http(s) URL');
  }
  return url;
}

function parseOptions(values, source, allowed, common) {
  const allowedOptions = allowed[source];
  const known = new Set([...common, ...allowedOptions.keys(), 'source-options', 'help']);
  for (const key of Object.keys(values)) {
    if (SENSITIVE_KEY.test(key) && !allowedOptions.has(key)) throw new Error(`--${key} is not allowed`);
    if (!known.has(key)) throw new Error(`--${key} is not allowed for source ${source}`);
  }
  const options = {};
  const names = new Map([...allowedOptions].map(([flag, name]) => [name, flag]));
  const listNames = new Set(['workspaceIds', 'extensions', 'fileTypes']);
  const assign = (name, value, label) => {
    if (!names.has(name)) throw new Error(`${label} is not allowed for source ${source}`);
    if (Object.hasOwn(options, name)) throw new Error(`${label} duplicates source option ${name}`);
    if (listNames.has(name)) {
      if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || !item.trim())) {
        throw new Error(`${label} must be a non-empty array of strings`);
      }
      options[name] = value.map((item) => item.trim());
    } else {
      if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
      options[name] = value.trim();
    }
  };
  if (values['source-options'] !== undefined) {
    const raw = requiredString(values, 'source-options');
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw new Error('--source-options must be a JSON object'); }
    if (!asPlainObject(parsed)) throw new Error('--source-options must be a JSON object');
    for (const [name, value] of Object.entries(parsed)) {
      if (SENSITIVE_KEY.test(name) && !names.has(name)) throw new Error(`--source-options.${name} is not allowed`);
      assign(name, value, `--source-options.${name}`);
    }
  }
  for (const [flag, name] of allowedOptions) {
    if (values[flag] === undefined) continue;
    const value = requiredString(values, flag);
    assign(name, listNames.has(name) ? value.split(',').map((item) => item.trim()).filter(Boolean) : value, `--${flag}`);
  }
  return options;
}

function asPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function absoluteOutputDir(values) {
  const outputDir = requiredString(values, 'output-dir');
  if (!isAbsolute(outputDir)) throw new Error('--output-dir must be an absolute path');
  return outputDir;
}

function absoluteSessionDir(values) {
  const sessionDir = requiredString(values, 'session-dir');
  if (!isAbsolute(sessionDir)) throw new Error('--session-dir must be an absolute path');
  return sessionDir;
}

export function parseMaterializeRequest(values) {
  const source = parseSource(values);
  if (source === 'wecom') throw new Error('source wecom does not support search materialization');
  const allowed = new Set(['source', 'session-dir', 'output-dir', 'item-ids', 'concurrency', 'help']);
  for (const key of Object.keys(values)) {
    if (!allowed.has(key) || SENSITIVE_KEY.test(key)) throw new Error(`--${key} is not allowed for materialize`);
  }
  const itemIds = requiredString(values, 'item-ids').split(',').map((item) => item.trim()).filter(Boolean);
  if (!itemIds.length || new Set(itemIds).size !== itemIds.length) {
    throw new Error('--item-ids must be a comma-separated list of distinct candidate IDs');
  }
  return {
    source,
    sessionDir: absoluteSessionDir(values),
    outputDir: absoluteOutputDir(values),
    itemIds,
    concurrency: parseInteger(values, 'concurrency', 4, 1, 16),
  };
}

export function parseSearchRequest(values) {
  const source = parseSource(values);
  const sourceOptions = parseOptions(values, source, SEARCH_OPTIONS, [
    'source', 'query', 'output-dir', 'limit', 'concurrency', 'cursor', 'metadata-only',
  ]);
  const cursor = values.cursor === undefined ? null : requiredString(values, 'cursor');
  if (source === 'dingtalk' && sourceOptions.folderId && sourceOptions.workspaceIds) {
    throw new Error('--workspace-ids cannot be combined with --folder-id');
  }
  return {
    source,
    query: requiredString(values, 'query'),
    outputDir: absoluteOutputDir(values),
    limit: parseInteger(values, 'limit', 50, 1, 500),
    concurrency: parseInteger(values, 'concurrency', 4, 1, 16),
    cursor,
    metadataOnly: parseBoolean(values, 'metadata-only', false),
    sourceOptions,
  };
}

export function parseSearchBatchRequests(values) {
  const allowed = new Set(['sources', 'query', 'output-root', 'limit', 'concurrency', 'metadata-only', 'help']);
  for (const key of Object.keys(values)) {
    if (!allowed.has(key) || SENSITIVE_KEY.test(key)) throw new Error(`--${key} is not allowed for search-all`);
  }
  const outputRoot = requiredString(values, 'output-root');
  if (!isAbsolute(outputRoot)) throw new Error('--output-root must be an absolute path');
  const sourceList = values.sources === undefined ? [...SOURCES].join(',') : requiredString(values, 'sources');
  const sources = sourceList.split(',').map((source) => source.trim()).filter(Boolean);
  if (!sources.length || new Set(sources).size !== sources.length || sources.some((source) => !SOURCES.has(source))) {
    throw new Error(`--sources must be a comma-separated list of distinct values: ${[...SOURCES].join(', ')}`);
  }
  return sources.map((source) => ({
    source,
    query: requiredString(values, 'query'),
    'output-dir': join(outputRoot, source),
    ...(values.limit === undefined ? {} : { limit: values.limit }),
    ...(values.concurrency === undefined ? {} : { concurrency: values.concurrency }),
    'metadata-only': values['metadata-only'] ?? true,
  }));
}

export function parseResourceRequest(values) {
  const source = parseSource(values);
  const sourceOptions = parseOptions(values, source, RESOURCE_OPTIONS, ['source', 'output-dir', 'url']);
  const url = parseUrl(values);
  if (source === 'feishu' && !sourceOptions.minuteToken) throw new Error('--minute-token is required for source feishu');
  return { source, outputDir: absoluteOutputDir(values), url, sourceOptions };
}

export function parseResumeResourceRequest(values) {
  const allowed = new Set(['source', 'session-dir', 'output-dir', 'help']);
  for (const key of Object.keys(values)) {
    if (!allowed.has(key) || SENSITIVE_KEY.test(key)) throw new Error(`--${key} is not allowed for resume-resource`);
  }
  const source = parseSource(values);
  if (source !== 'wecom') throw new Error('resume-resource currently supports only source wecom');
  return { source, sessionDir: absoluteSessionDir(values), outputDir: absoluteOutputDir(values) };
}

function defaultAdapters() {
  return {
    dingtalk: createDingtalkAdapter({ bin: process.env.DWS_CLI_BIN || 'dws', env: process.env }),
    feishu: createFwsAdapter({ bin: process.env.LARK_CLI_BIN || 'lark-cli', env: process.env }),
    wecom: createWecomAdapter({ bin: process.env.WECOM_CLI_BIN || 'wecom-cli', env: process.env }),
  };
}

function unavailable(source, outputDir) {
  return handledOutcome(source, 'unsupported_capability', outputDir);
}

function reasonOf(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function dispatchEnterprise(command, values, { adapters = defaultAdapters() } = {}) {
  const request = command === 'search' ? parseSearchRequest(values)
    : command === 'resource' ? parseResourceRequest(values)
      : command === 'materialize' ? parseMaterializeRequest(values)
        : command === 'resume-resource' ? parseResumeResourceRequest(values)
      : (() => { throw new Error(`unsupported enterprise command: ${command || '(missing)'}`); })();
  const adapter = adapters[request.source];
  if (!adapter) return unavailable(request.source, request.outputDir);
  const method = command === 'search' ? adapter.search
    : command === 'resource' ? adapter.collectResource
      : command === 'materialize' ? adapter.materialize
        : adapter.resumeResource;
  if (typeof method !== 'function') return unavailable(request.source, request.outputDir);
  const outcome = await method({
    ...request,
    ...request.sourceOptions,
    ...(command === 'resource' && request.source === 'feishu' ? { resourceKind: 'minutes' } : {}),
  });
  if (!outcome || typeof outcome !== 'object') throw new Error('connector returned an invalid outcome');
  return {
    ...handledOutcome(adapter.connector || request.source, 'failed', request.outputDir),
    ...outcome,
    connector: outcome.connector || adapter.connector || request.source,
    outputDir: outcome.outputDir || request.outputDir,
    continuable: true,
  };
}

export async function dispatchEnterpriseBatch(command, requests, { adapters = defaultAdapters(), concurrency = 4 } = {}) {
  if (!Array.isArray(requests) || requests.length === 0) {
    throw new Error('enterprise batch requests must be a non-empty array');
  }
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new Error('enterprise batch concurrency must be an integer between 1 and 16');
  }
  const parser = command === 'search' ? parseSearchRequest
    : command === 'resource' ? parseResourceRequest
      : command === 'materialize' ? parseMaterializeRequest
        : command === 'resume-resource' ? parseResumeResourceRequest
      : (() => { throw new Error(`unsupported enterprise command: ${command || '(missing)'}`); })();
  const sessions = requests.map((values) => {
    const request = parser(values);
    return { source: request.source, sessionDir: request.outputDir, values };
  });
  if (new Set(sessions.map((session) => session.sessionDir)).size !== sessions.length) {
    throw new Error('enterprise connector sessions must use distinct output directories');
  }

  const results = new Array(sessions.length);
  let next = 0;
  const worker = async () => {
    while (next < sessions.length) {
      const index = next;
      next += 1;
      const session = sessions[index];
      let outcome;
      try {
        outcome = await dispatchEnterprise(command, session.values, { adapters });
      } catch (error) {
        outcome = {
          ...handledOutcome(session.source, 'failed', session.sessionDir),
          reason: reasonOf(error),
        };
      }
      results[index] = {
        source: session.source,
        sessionDir: session.sessionDir,
        outcome,
      };
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, sessions.length) }, worker));
  return results;
}
