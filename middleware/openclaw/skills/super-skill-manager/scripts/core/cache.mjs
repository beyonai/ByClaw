import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { normalizeQuery } from './query.mjs';

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const SET_FILTER_KEYS = new Set(['sources', 'kinds', 'security', 'status', 'tags']);
const PRIVATE_PAYLOAD_KEY = /(?:rawauthenticatedresponse|(?:raw)?browser(?:payload|response|session|dom)|browsercontext|storagestate|(?:page|document|browser)?html|markup|domsnapshot)/u;
const PRIVATE_VALUE = /(?:\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_.=-]{8,}|\bsk-(?:proj-)?[\w-]{8,}|\bgh[pousr]_[\w-]{8,}|\bgithub_pat_[\w-]{8,}|-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----|https?:\/\/[^/\s:@]+:[^/\s@]+@|<html(?:\s|>))/iu;
const ROOT_FIELDS = new Set([
  'schemaVersion', 'query', 'filters', 'adapterVersion', 'results', 'rows', 'data', 'top', 'unverifiedCandidates',
  'excluded', 'sources', 'coverage', 'warnings', 'source', 'ok', 'elapsedMs', 'error',
  'manualLinks',
  'complete',
]);
const RECORD_FIELDS = new Set([
  'kind', 'name', 'description', 'author', 'repository', 'path', 'url', 'version', 'sources', 'metrics', 'updatedAt',
  'installCommands', 'security', 'provenance', 'relevance', 'sourceTrustClass', 'sourceEvidence', 'maintenance',
  'rankingReasons', 'deduplicationConfidence',
]);
const SOURCE_FIELDS = new Set([
  'source', 'provider', 'id', 'name', 'url', 'homepage', 'repository', 'path', 'ref', 'version', 'label', 'kind',
  'status', 'verified', 'trustClass', 'sourceTrustClass', 'retrievedAt', 'rawId', 'elapsedMs', 'resultCount', 'warning',
  'tags', 'labels', 'metrics',
]);
const EVIDENCE_FIELDS = new Set([
  'provider', 'source', 'url', 'retrievedAt', 'rawId', 'relevance', 'sourceTrustClass', 'updatedAt', 'status',
  'maintenance', 'metrics',
]);
const COVERAGE_FIELDS = new Set([
  'ok', 'source', 'provider', 'status', 'resultCount', 'elapsedMs', 'retrievedAt', 'attempted', 'warning', 'error',
]);
const FILTER_FIELDS = new Set([
  'source', 'sources', 'kind', 'kinds', 'type', 'security', 'status', 'tags', 'author', 'repository', 'updatedAfter',
  'updatedBefore', 'verified', 'limit', 'sourcePriority', 'preferredOrder',
]);

function plainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sensitiveFieldName(key) {
  const compact = key.replace(/[^a-z]/giu, '').toLowerCase();
  const words = key.replace(/([a-z0-9])([A-Z])/gu, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/gu, '$1 $2')
    .split(/[^A-Za-z0-9]+/gu).filter(Boolean).map((word) => word.toLowerCase());
  const wordSet = new Set(words);
  if (['env', 'environment', 'authorization', 'password', 'passwd', 'secret', 'credential', 'credentials', 'cookie',
    'cookies', 'session'].some((word) => wordSet.has(word))) return true;
  if (wordSet.has('jwt')) return true;
  if ((wordSet.has('api') || wordSet.has('private') || wordSet.has('ssh') || wordSet.has('access')) &&
    wordSet.has('key')) return true;
  const tokenIndex = words.indexOf('token');
  if (tokenIndex >= 0) {
    if (words.some((word) => ['access', 'refresh', 'auth', 'id', 'bearer', 'api', 'client'].includes(word))) return true;
    const publicMetricWords = new Set(['token', 'count', 'usage', 'limit', 'total', 'rate', 'quota', 'maximum', 'max',
      'minimum', 'min', 'average', 'avg']);
    if (words.length === 1 || words.some((word) => !publicMetricWords.has(word))) return true;
  }
  return ['env', 'environment', 'auth', 'apikey', 'privatekey', 'sshkey'].includes(compact) || PRIVATE_PAYLOAD_KEY.test(compact);
}

function publicValue(value, location = 'value', seen = new Set()) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (PRIVATE_VALUE.test(value)) throw new TypeError(`public metadata ${location} contains sensitive credential or browser data`);
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError(`public metadata ${location} must be acyclic JSON`);
    seen.add(value);
    const result = value.map((item, index) => publicValue(item, `${location}[${index}]`, seen));
    seen.delete(value);
    return result;
  }
  if (!plainObject(value) || seen.has(value)) throw new TypeError(`public metadata ${location} must be acyclic JSON`);
  seen.add(value);
  if (value.authenticated === true) throw new TypeError(`public metadata ${location} contains sensitive authenticated data`);
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (sensitiveFieldName(key)) {
      throw new TypeError(`public metadata ${location}.${key} is sensitive`);
    }
    if (value[key] === undefined) throw new TypeError(`public metadata ${location}.${key} is not JSON`);
    result[key] = publicValue(value[key], `${location}.${key}`, seen);
  }
  seen.delete(value);
  return result;
}

function stableStringify(value) {
  return JSON.stringify(publicValue(value));
}

function schemaError(location, message) {
  throw new TypeError(`public metadata schema ${location} ${message}`);
}

function allowedObject(value, allowed, location) {
  if (!plainObject(value)) schemaError(location, 'must be an object');
  for (const key of Object.keys(value)) if (!allowed.has(key)) schemaError(`${location}.${key}`, 'is unknown');
}

function primitive(value) {
  return value === null || typeof value === 'string' || typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value));
}

function requirePrimitive(value, location) {
  if (!primitive(value)) schemaError(location, 'must be a JSON primitive');
}

function requireStringArray(value, location) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) schemaError(location, 'must be a string array');
}

function safePublicKey(key) {
  return /^[A-Za-z][A-Za-z0-9._-]{0,63}$/u.test(key) && !sensitiveFieldName(key);
}

function requireMetricPrimitive(value, location) {
  if (typeof value === 'string' && value.length <= 512) return;
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
  schemaError(location, 'must be a finite public metric primitive');
}

function validateMetrics(metrics, location, platformMap = true) {
  if (!plainObject(metrics)) schemaError(location, 'must be an object');
  if (platformMap) {
    for (const [platform, values] of Object.entries(metrics)) {
      if (!safePublicKey(platform)) schemaError(`${location}.${platform}`, 'is not a safe public platform name');
      validateMetrics(values, `${location}.${platform}`, false);
    }
    return;
  }
  for (const [key, value] of Object.entries(metrics)) {
    if (!safePublicKey(key)) schemaError(`${location}.${key}`, 'is not a safe public metric name');
    requireMetricPrimitive(value, `${location}.${key}`);
  }
}

function validateMaintenance(maintenance, location) {
  const allowed = new Set(['status', 'updatedAt', 'recencyBucket', 'reasons']);
  allowedObject(maintenance, allowed, location);
  for (const [key, value] of Object.entries(maintenance)) {
    if (key === 'reasons') requireStringArray(value, `${location}.${key}`);
    else requirePrimitive(value, `${location}.${key}`);
  }
}

function validateEvidence(evidence, location) {
  allowedObject(evidence, EVIDENCE_FIELDS, location);
  for (const [key, value] of Object.entries(evidence)) {
    if (key === 'metrics') validateMetrics(value, `${location}.metrics`, false);
    else if (key === 'maintenance') validateMaintenance(value, `${location}.maintenance`);
    else requirePrimitive(value, `${location}.${key}`);
  }
}

function validateSource(source, location) {
  allowedObject(source, SOURCE_FIELDS, location);
  for (const [key, value] of Object.entries(source)) {
    if (key === 'metrics') validateMetrics(value, `${location}.metrics`, false);
    else if (key === 'tags' || key === 'labels') requireStringArray(value, `${location}.${key}`);
    else requirePrimitive(value, `${location}.${key}`);
  }
}

function validateSecurity(security, location) {
  allowedObject(security, new Set(['status', 'reasons']), location);
  if (Object.hasOwn(security, 'status') && !['pass', 'caution', 'unknown', 'malicious'].includes(security.status)) {
    schemaError(`${location}.status`, 'must be pass, caution, unknown, or malicious');
  }
  if (Object.hasOwn(security, 'reasons')) requireStringArray(security.reasons, `${location}.reasons`);
}

function validateProvenance(provenance, location) {
  allowedObject(provenance, new Set(['provider', 'retrievedAt', 'rawId']), location);
  for (const [key, value] of Object.entries(provenance)) requirePrimitive(value, `${location}.${key}`);
}

function pureEnvironmentPlaceholder(value) {
  let candidate = value;
  if ((candidate.startsWith('"') && candidate.endsWith('"')) ||
    (candidate.startsWith("'") && candidate.endsWith("'"))) candidate = candidate.slice(1, -1);
  return /^\$(?:[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\})$/u.test(candidate);
}

function validateCredentialArgument(name, value, location) {
  if (!sensitiveFieldName(name)) return;
  if (!value || !pureEnvironmentPlaceholder(value)) {
    schemaError(location, `contains an actual credential for ${name}`);
  }
}

function sensitiveUrlParameterName(name) {
  if (sensitiveFieldName(name)) return true;
  const words = name.replace(/([a-z0-9])([A-Z])/gu, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/gu, '$1 $2')
    .split(/[^A-Za-z0-9]+/gu).filter(Boolean).map((word) => word.toLowerCase());
  return words.includes('sig') || words.includes('signature');
}

function tokenizeInstallCommand(command, location) {
  if (/[\r\n]/u.test(command)) schemaError(location, 'contains shell control operators');
  const tokens = [];
  let token = '';
  let quote = null;
  let escaped = false;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (character === '`' || (character === '$' && command[index + 1] === '(')) {
      schemaError(location, 'contains shell command substitution');
    }
    if (escaped) {
      token += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else token += character;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if ([';', '|', '&', '<', '>'].includes(character)) {
      schemaError(location, 'contains shell control operators');
    } else if (/\s/u.test(character)) {
      if (token) tokens.push(token);
      token = '';
    } else {
      token += character;
    }
  }
  if (quote || escaped) schemaError(location, 'contains an unterminated shell quote or escape');
  if (token) tokens.push(token);
  for (const parsedToken of tokens) {
    if (/[(){}]/u.test(parsedToken) && !pureEnvironmentPlaceholder(parsedToken)) {
      schemaError(location, 'contains shell control or grouping tokens');
    }
  }
  return tokens;
}

function tokenContainsSensitiveIdentifier(token) {
  if (pureEnvironmentPlaceholder(token)) return false;
  const identifiers = token.match(/[A-Za-z][A-Za-z0-9_-]*/gu) ?? [];
  return identifiers.some((identifier) => sensitiveFieldName(identifier));
}

function validateSensitiveHeader(value, location) {
  const separator = value.indexOf(':');
  if (separator > 0 && sensitiveFieldName(value.slice(0, separator))) {
    schemaError(location, `contains a sensitive transport header ${value.slice(0, separator)}`);
  }
}

function validateInstallTokens(tokens, location) {
  const forbiddenTransportFlags = new Set([
    'user', 'password', 'passwd', 'http-user', 'http-password', 'proxy-user', 'proxy-password',
  ]);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (/^\$?env:/iu.test(token)) schemaError(location, 'contains PowerShell environment mutation syntax');
    if (tokenContainsSensitiveIdentifier(token)) schemaError(location, `contains a sensitive identifier in ${token}`);
    const powershellAssignment = /^\$env:([A-Za-z_][A-Za-z0-9_-]*)=(.*)$/iu.exec(token);
    const assignment = /^([A-Za-z_][A-Za-z0-9_-]*)=(.*)$/u.exec(token);
    if (powershellAssignment) validateCredentialArgument(powershellAssignment[1], powershellAssignment[2], location);
    else if (assignment) validateCredentialArgument(assignment[1], assignment[2], location);

    if (token === '-u' || token.startsWith('-u=')) schemaError(location, 'contains an explicit user credential flag');
    if (token.startsWith('-u') && token.length > 2) schemaError(location, 'contains an explicit user credential flag');
    if (token === '-H' || token.startsWith('-H')) {
      const header = token === '-H' ? tokens[index + 1] : token.slice(2);
      if (!header) schemaError(location, 'contains an incomplete transport header flag');
      validateSensitiveHeader(header, location);
      if (token === '-H') index += 1;
      continue;
    }
    if (!token.startsWith('--')) continue;
    const equals = token.indexOf('=');
    const name = token.slice(2, equals < 0 ? undefined : equals);
    const inlineValue = equals < 0 ? undefined : token.slice(equals + 1);
    if (name === 'header') {
      const header = inlineValue ?? tokens[index + 1];
      if (!header) schemaError(location, 'contains an incomplete transport header flag');
      validateSensitiveHeader(header, location);
      if (inlineValue === undefined) index += 1;
    } else if (forbiddenTransportFlags.has(name.toLowerCase())) {
      schemaError(location, `contains an explicit credential transport flag ${name}`);
    } else {
      const value = inlineValue ?? tokens[index + 1];
      validateCredentialArgument(name, value, location);
      if (inlineValue === undefined && sensitiveFieldName(name)) index += 1;
    }
  }
}

function validateInstallUrls(command, location) {
  for (const match of command.matchAll(/[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'`<>]+/gu)) {
    let parsed;
    try {
      parsed = new URL(match[0]);
    } catch {
      schemaError(location, 'contains an invalid URL');
    }
    const publicGitSsh = ['ssh:', 'git+ssh:'].includes(parsed.protocol) && parsed.username === 'git' && !parsed.password;
    if ((parsed.username || parsed.password) && !publicGitSsh) schemaError(location, 'contains URL userinfo credentials');
    for (const [name] of parsed.searchParams) {
      if (sensitiveUrlParameterName(name)) schemaError(location, `contains a sensitive URL parameter ${name}`);
    }
    const fragment = parsed.hash.slice(1);
    if (fragment) {
      for (const [name] of new URLSearchParams(fragment)) {
        if (sensitiveUrlParameterName(name)) schemaError(location, `contains a sensitive URL fragment parameter ${name}`);
      }
    }
  }
}

function validateInstallCommands(commands, location) {
  if (!plainObject(commands)) schemaError(location, 'must be an object');
  for (const [context, command] of Object.entries(commands)) {
    if (typeof command !== 'string') schemaError(`${location}.${context}`, 'must be a string');
    validateInstallTokens(tokenizeInstallCommand(command, `${location}.${context}`), `${location}.${context}`);
    validateInstallUrls(command, `${location}.${context}`);
    const masked = command.replace(/\$(?:[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\})/gu, 'SAFE_ENV');
    const patterns = [
      /(?:_?authToken|accessToken|password|passwd|secret|apiKey)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/giu,
      /--(?:token|password|passwd|secret|api[-_]?key)(?:\s+|=)("[^"]*"|'[^']*'|[^\s]+)/giu,
      /authorization\s*:\s*(?:(?:Bearer|Basic)\s+)?("[^"]*"|'[^']*'|[^\s"]+)/giu,
    ];
    for (const pattern of patterns) {
      for (const match of masked.matchAll(pattern)) {
        if (match[1].replace(/^['"]|['"]$/gu, '') !== 'SAFE_ENV') {
          schemaError(`${location}.${context}`, 'contains an actual credential');
        }
      }
    }
    if (/--(?:token|password|passwd|secret|api[-_]?key)(?:\s*$|\s+--)/iu.test(masked)) {
      schemaError(`${location}.${context}`, 'contains an incomplete credential flag');
    }
  }
}

function validateRecord(record, location) {
  allowedObject(record, RECORD_FIELDS, location);
  if (!['skill', 'mcp'].includes(record.kind)) schemaError(`${location}.kind`, 'must be skill or mcp');
  if (typeof record.name !== 'string' || !record.name) schemaError(`${location}.name`, 'is required');
  for (const [key, value] of Object.entries(record)) {
    if (key === 'sources') {
      if (!Array.isArray(value)) schemaError(`${location}.sources`, 'must be an array');
      value.forEach((source, index) => validateSource(source, `${location}.sources[${index}]`));
    } else if (key === 'metrics') validateMetrics(value, `${location}.metrics`);
    else if (key === 'security') validateSecurity(value, `${location}.security`);
    else if (key === 'provenance') validateProvenance(value, `${location}.provenance`);
    else if (key === 'sourceEvidence') {
      if (!Array.isArray(value)) schemaError(`${location}.sourceEvidence`, 'must be an array');
      value.forEach((evidence, index) => validateEvidence(evidence, `${location}.sourceEvidence[${index}]`));
    } else if (key === 'maintenance') validateMaintenance(value, `${location}.maintenance`);
    else if (key === 'rankingReasons') requireStringArray(value, `${location}.rankingReasons`);
    else if (key === 'installCommands') validateInstallCommands(value, `${location}.installCommands`);
    else requirePrimitive(value, `${location}.${key}`);
  }
}

function validateFilters(filters, location) {
  allowedObject(filters, FILTER_FIELDS, location);
  for (const [key, value] of Object.entries(filters)) {
    if (key === 'security' && plainObject(value)) validateFilters(value, `${location}.security`);
    else if (Array.isArray(value)) value.forEach((item, index) => requirePrimitive(item, `${location}.${key}[${index}]`));
    else requirePrimitive(value, `${location}.${key}`);
  }
}

function validateWarning(warning, location) {
  if (typeof warning === 'string') return;
  allowedObject(warning, new Set(['code', 'message', 'source', 'provider']), location);
  for (const [key, value] of Object.entries(warning)) requirePrimitive(value, `${location}.${key}`);
}

function validateError(error, location) {
  allowedObject(error, new Set(['code', 'message', 'source']), location);
  for (const [field, detail] of Object.entries(error)) requirePrimitive(detail, `${location}.${field}`);
}

function validateCoverage(summary, location) {
  allowedObject(summary, COVERAGE_FIELDS, location);
  for (const [key, value] of Object.entries(summary)) {
    if (key === 'error') validateError(value, `${location}.error`);
    else requirePrimitive(value, `${location}.${key}`);
  }
}

function validateRoot(root, location = 'value') {
  if (Array.isArray(root)) {
    root.forEach((record, index) => validateRecord(record, `${location}[${index}]`));
    return;
  }
  if (plainObject(root) && (Object.hasOwn(root, 'kind') || Object.hasOwn(root, 'name'))) {
    validateRecord(root, location);
    return;
  }
  allowedObject(root, ROOT_FIELDS, location);
  for (const [key, value] of Object.entries(root)) {
    if (['results', 'rows', 'data', 'top', 'unverifiedCandidates', 'excluded'].includes(key)) {
      if (!Array.isArray(value)) schemaError(`${location}.${key}`, 'must be an array');
      value.forEach((record, index) => validateRecord(record, `${location}.${key}[${index}]`));
    } else if (key === 'sources') {
      if (!Array.isArray(value)) schemaError(`${location}.sources`, 'must be an array');
      value.forEach((source, index) => validateSource(source, `${location}.sources[${index}]`));
    } else if (key === 'coverage') {
      if (!plainObject(value)) schemaError(`${location}.coverage`, 'must be an object');
      for (const [source, summary] of Object.entries(value)) validateCoverage(summary, `${location}.coverage.${source}`);
    } else if (key === 'warnings') {
      if (!Array.isArray(value)) schemaError(`${location}.warnings`, 'must be an array');
      value.forEach((warning, index) => validateWarning(warning, `${location}.warnings[${index}]`));
    } else if (key === 'manualLinks') {
      if (!Array.isArray(value)) schemaError(`${location}.manualLinks`, 'must be an array');
      value.forEach((link, index) => {
        allowedObject(link, new Set(['source', 'route', 'url', 'instructions']), `${location}.manualLinks[${index}]`);
        if (typeof link.source !== 'string' || typeof link.route !== 'string' || typeof link.url !== 'string' ||
          (link.instructions !== undefined && typeof link.instructions !== 'string')) schemaError(`${location}.manualLinks[${index}]`, 'is malformed');
      });
    } else if (key === 'complete') {
      allowedObject(value, new Set(['sourcesAttempted', 'sourcesSucceeded', 'sourcesFailed']), `${location}.complete`);
      for (const [name, sources] of Object.entries(value)) {
        if (!Array.isArray(sources) || !sources.every((source) => typeof source === 'string')) schemaError(`${location}.complete.${name}`, 'must be a string array');
      }
    } else if (key === 'filters') validateFilters(value, `${location}.filters`);
    else if (key === 'error') {
      validateError(value, `${location}.error`);
    } else requirePrimitive(value, `${location}.${key}`);
  }
}

function normalizedCacheValue(value) {
  const normalized = publicValue(value);
  validateRoot(normalized);
  return normalized;
}

function byteCompare(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function normalizeFilters(value, key = null) {
  if (Array.isArray(value)) {
    if (!SET_FILTER_KEYS.has(key)) return value.map((item) => normalizeFilters(item));
    if (value.some((item) => typeof item !== 'string')) throw new TypeError(`cache filter ${key} must contain strings`);
    return [...new Set(value)].sort(byteCompare);
  }
  if (!plainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((nestedKey) => [
    nestedKey,
    normalizeFilters(value[nestedKey], nestedKey.toLowerCase()),
  ]));
}

function validateRequest(request) {
  if (!plainObject(request)) throw new TypeError('cache request must be an object');
  const query = normalizeQuery(request.query);
  if (!plainObject(request.filters)) throw new TypeError('cache filters must be an object');
  if (typeof request.adapterVersion !== 'string' || !request.adapterVersion) throw new TypeError('adapter version is required');
  const filters = publicValue(request.filters, 'filters');
  return { query, filters: normalizeFilters(filters), adapterVersion: request.adapterVersion };
}

export function createCacheKey(request) {
  return createHash('sha256').update(stableStringify(validateRequest(request))).digest('hex');
}

async function missingOrSymlink(target) {
  try {
    const stats = await lstat(target);
    return stats.isSymbolicLink() ? 'symlink' : false;
  } catch (error) {
    if (error?.code === 'ENOENT') return 'missing';
    throw error;
  }
}

const IN_FLIGHT = new Map();
const GENERATIONS = new Map();
const WRITE_LOCKS = new Map();

async function withWriteLock(cacheKey, operation) {
  const previous = WRITE_LOCKS.get(cacheKey) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  WRITE_LOCKS.set(cacheKey, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (WRITE_LOCKS.get(cacheKey) === current) WRITE_LOCKS.delete(cacheKey);
  }
}

async function assertNoSymlinkAncestors(target) {
  const resolved = path.resolve(target);
  const root = path.parse(resolved).root;
  let current = root;
  for (const segment of path.relative(root, resolved).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`cache containment rejects symlink ancestor ${current}`);
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
  }
}

export class PublicMetadataCache {
  constructor({ cacheRoot, ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
    if (typeof cacheRoot !== 'string' || !path.isAbsolute(cacheRoot)) throw new TypeError('cacheRoot must be an absolute path');
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError('ttlMs must be positive');
    if (typeof now !== 'function') throw new TypeError('now must be a function');
    this.cacheRoot = path.resolve(cacheRoot);
    this.ttlMs = ttlMs;
    this.now = now;
  }

  async ensureRoot() {
    await assertNoSymlinkAncestors(this.cacheRoot);
    const state = await missingOrSymlink(this.cacheRoot);
    if (state === 'symlink') throw new Error('cache containment rejects a symlink root');
    if (state === 'missing') await mkdir(this.cacheRoot, { recursive: true, mode: 0o700 });
    await assertNoSymlinkAncestors(this.cacheRoot);
    if (await realpath(this.cacheRoot) !== this.cacheRoot) throw new Error('cache containment requires a canonical cache root');
    const handle = await open(this.cacheRoot, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!(await handle.stat()).isDirectory()) throw new Error('cache root must be a directory');
    } finally { await handle.close(); }
  }

  filePath(request) {
    return path.join(this.cacheRoot, `${createCacheKey(request)}.json`);
  }

  async get(request) {
    await this.ensureRoot();
    const target = this.filePath(request);
    if (await missingOrSymlink(target) === 'symlink') throw new Error('cache containment rejects a symlink entry');
    try {
      const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      let text;
      try { text = await handle.readFile('utf8'); } finally { await handle.close(); }
      const envelope = JSON.parse(text);
      if (!plainObject(envelope) || envelope.schemaVersion !== 1 || !Number.isFinite(envelope.cachedAt) ||
        this.now() - envelope.cachedAt >= this.ttlMs || this.now() < envelope.cachedAt) return null;
      return structuredClone(normalizedCacheValue(envelope.value));
    } catch (error) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async set(request, value, { expectedGeneration, refreshGeneration } = {}) {
    const normalizedValue = normalizedCacheValue(value);
    const cacheKey = `${this.cacheRoot}\u0000${createCacheKey(request)}`;
    return withWriteLock(cacheKey, async () => {
      if (expectedGeneration !== undefined && (GENERATIONS.get(cacheKey) ?? 0) !== expectedGeneration) {
        return structuredClone(normalizedValue);
      }
      try {
        return await this.writeValue(request, normalizedValue);
      } finally {
        if (refreshGeneration !== undefined && GENERATIONS.get(cacheKey) === refreshGeneration) {
          GENERATIONS.set(cacheKey, refreshGeneration + 1);
        }
      }
    });
  }

  async writeValue(request, normalizedValue) {
    await this.ensureRoot();
    const target = this.filePath(request);
    if (await missingOrSymlink(target) === 'symlink') throw new Error('cache containment rejects a symlink entry');
    const temporary = path.join(this.cacheRoot, `.${path.basename(target)}.${randomBytes(12).toString('hex')}.tmp`);
    const envelope = { schemaVersion: 1, cachedAt: this.now(), value: normalizedValue };
    let handle;
    try {
      handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await handle.writeFile(`${JSON.stringify(envelope)}\n`, 'utf8');
      await handle.sync();
      await handle.close(); handle = undefined;
      await this.ensureRoot();
      if (await missingOrSymlink(target) === 'symlink') throw new Error('cache containment rejects a symlink entry');
      await rename(temporary, target);
      const parent = await open(this.cacheRoot, 'r');
      try { await parent.sync(); } catch (error) {
        if (!['EINVAL', 'ENOTSUP', 'EPERM'].includes(error?.code)) throw error;
      } finally { await parent.close(); }
    } catch (error) {
      if (handle) await handle.close();
      await rm(temporary, { force: true });
      throw error;
    }
    return structuredClone(normalizedValue);
  }

  async getOrLoad(request, loader, { refresh = false, noCache = false } = {}) {
    if (typeof loader !== 'function') throw new TypeError('loader must be a function');
    if (noCache) return structuredClone(normalizedCacheValue(await loader()));
    const cacheKey = `${this.cacheRoot}\u0000${createCacheKey(request)}`;
    const flightKey = `${cacheKey}\u0000${refresh ? 'refresh' : 'default'}`;
    if (!IN_FLIGHT.has(flightKey)) {
      const generation = refresh ? undefined : GENERATIONS.get(cacheKey) ?? 0;
      const operation = (async () => {
        if (refresh) {
          const refreshGeneration = await withWriteLock(cacheKey, () => {
            const next = (GENERATIONS.get(cacheKey) ?? 0) + 1;
            GENERATIONS.set(cacheKey, next);
            return next;
          });
          try {
            return await this.set(request, await loader(), { refreshGeneration });
          } catch (error) {
            await withWriteLock(cacheKey, () => {
              if (GENERATIONS.get(cacheKey) === refreshGeneration) GENERATIONS.set(cacheKey, refreshGeneration + 1);
            });
            throw error;
          }
        }
        const cached = await this.get(request);
        if (cached !== null) return cached;
        const loaded = await loader();
        return this.set(request, loaded, { expectedGeneration: generation });
      })();
      IN_FLIGHT.set(flightKey, operation);
      operation.finally(() => {
        if (IN_FLIGHT.get(flightKey) === operation) IN_FLIGHT.delete(flightKey);
        if (!IN_FLIGHT.has(`${cacheKey}\u0000default`) && !IN_FLIGHT.has(`${cacheKey}\u0000refresh`)) {
          GENERATIONS.delete(cacheKey);
        }
      }).catch(() => {});
    }
    return structuredClone(await IN_FLIGHT.get(flightKey));
  }
}
