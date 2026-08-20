import { isAbsolute } from 'node:path';
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
  const known = new Set([...common, ...allowedOptions.keys(), 'help']);
  for (const key of Object.keys(values)) {
    if (SENSITIVE_KEY.test(key) && !allowedOptions.has(key)) throw new Error(`--${key} is not allowed`);
    if (!known.has(key)) throw new Error(`--${key} is not allowed for source ${source}`);
  }
  const options = {};
  for (const [flag, name] of allowedOptions) {
    if (values[flag] === undefined) continue;
    const value = requiredString(values, flag);
    options[name] = ['workspaceIds', 'extensions', 'fileTypes'].includes(name)
      ? value.split(',').map((item) => item.trim()).filter(Boolean)
      : value;
    if (Array.isArray(options[name]) && options[name].length === 0) throw new Error(`--${flag} is required`);
  }
  return options;
}

function absoluteOutputDir(values) {
  const outputDir = requiredString(values, 'output-dir');
  if (!isAbsolute(outputDir)) throw new Error('--output-dir must be an absolute path');
  return outputDir;
}

export function parseSearchRequest(values) {
  const source = parseSource(values);
  const sourceOptions = parseOptions(values, source, SEARCH_OPTIONS, [
    'source', 'query', 'output-dir', 'limit', 'concurrency', 'cursor', 'metadata-only',
  ]);
  const cursor = values.cursor === undefined ? null : requiredString(values, 'cursor');
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

export function parseResourceRequest(values) {
  const source = parseSource(values);
  const sourceOptions = parseOptions(values, source, RESOURCE_OPTIONS, ['source', 'output-dir', 'url']);
  const url = parseUrl(values);
  if (source === 'feishu' && !sourceOptions.minuteToken) throw new Error('--minute-token is required for source feishu');
  return { source, outputDir: absoluteOutputDir(values), url, sourceOptions };
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

export async function dispatchEnterprise(command, values, { adapters = defaultAdapters() } = {}) {
  const request = command === 'search' ? parseSearchRequest(values)
    : command === 'resource' ? parseResourceRequest(values)
      : (() => { throw new Error(`unsupported enterprise command: ${command || '(missing)'}`); })();
  const adapter = adapters[request.source];
  if (!adapter) return unavailable(request.source, request.outputDir);
  const method = command === 'search' ? adapter.search : adapter.collectResource;
  if (typeof method !== 'function') return unavailable(request.source, request.outputDir);
  try {
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
  } catch (error) {
    return {
      ...handledOutcome(adapter.connector || request.source, 'failed', request.outputDir, { failed: 1 }),
      reason: error instanceof Error ? error.message : String(error),
    };
  }
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
      results[index] = {
        source: session.source,
        sessionDir: session.sessionDir,
        outcome: await dispatchEnterprise(command, session.values, { adapters }),
      };
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, sessions.length) }, worker));
  return results;
}
