import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { validateSkillName } from './paths.mjs';

export const EMPTY_REGISTRY = Object.freeze({ schemaVersion: 1, skills: Object.freeze({}) });
const SOURCE_TYPES = new Set(['git', 'local', 'scaffold']);
const SECRET_KEY_PART = /(?:token|password|passwd|secret|apikey|privatekey|credential|cookie|session)/i;
const SECRET_VALUE = /(?:\bsk-(?:proj-)?[\w-]{8,}\b|\bsk_(?:live|test)_[\w-]{8,}\b|\bBearer\s+[\w.-]{8,}\b|-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----|\bgh[pousr]_[\w-]{8,}\b|\bgithub_pat_[\w-]{8,}\b|https?:\/\/[^/\s:@]+:[^/\s@]+@)/i;

function plainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fail(message) {
  throw new TypeError(`Invalid skills registry: ${message}`);
}

function validateNoSecrets(value, location = 'registry') {
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) fail(`${location} contains a secret-like value`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateNoSecrets(item, `${location}[${index}]`));
    return;
  }
  if (plainObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      if (SECRET_KEY_PART.test(key.replace(/[^a-z0-9]/gi, ''))) fail(`${location}.${key} is not allowed`);
      validateNoSecrets(nested, `${location}.${key}`);
    }
  }
}

function validIso(value) {
  if (typeof value !== 'string') return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function safeGitSource(value) {
  try {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && Boolean(url.hostname) &&
      !url.pathname.includes('//') && parts.length >= 2 && parts.length <= 5 && parts.every((part) => /^[a-z0-9][a-z0-9._-]*$/i.test(part)) && !/\s/.test(value);
  } catch {
    return /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*){1,4}$/i.test(value);
  }
}

function portableSource(value) {
  return /^[a-z0-9][a-z0-9._/-]{0,127}$/i.test(value) && !value.endsWith('/') && !value.includes('..') && !value.includes('//') && !value.includes('://');
}

function validRef(value) {
  return value === null || (typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(value) &&
    !value.endsWith('/') && !value.includes('//') && !value.includes('..'));
}

export function validateRegistryEntry(key, entry) {
  if (!plainObject(entry)) fail(`skills.${key} must be an object`);
  validateNoSecrets(entry, `skills.${key}`);
  const allowed = new Set(['name', 'sourceType', 'source', 'ref', 'contentHash', 'installedAt', 'updatedAt', 'dependencies']);
  for (const field of Object.keys(entry)) if (!allowed.has(field)) fail(`skills.${key}.${field} is unexpected`);
  try {
    validateSkillName(key);
    validateSkillName(entry.name);
  } catch {
    fail(`skills.${key}.name is invalid`);
  }
  if (entry.name !== key) fail(`skills.${key}.name must match its key`);
  if (!SOURCE_TYPES.has(entry.sourceType)) fail(`skills.${key}.sourceType is invalid`);
  if (typeof entry.source !== 'string' || !entry.source || path.isAbsolute(entry.source) || path.win32.isAbsolute(entry.source) ||
    (entry.sourceType === 'git' ? !safeGitSource(entry.source) : !portableSource(entry.source))) fail(`skills.${key}.source is invalid`);
  if (!validRef(entry.ref)) fail(`skills.${key}.ref is invalid`);
  if (typeof entry.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.contentHash)) {
    fail(`skills.${key}.contentHash must be a sha256 hex digest`);
  }
  if (!validIso(entry.installedAt) || !validIso(entry.updatedAt)) fail(`skills.${key} timestamps are invalid`);
  if (!Array.isArray(entry.dependencies)) fail(`skills.${key}.dependencies must be an array`);
  const dependencies = new Set();
  for (const dependency of entry.dependencies) {
    try {
      validateSkillName(dependency);
    } catch {
      fail(`skills.${key}.dependencies contains an invalid skill name`);
    }
    if (dependencies.has(dependency)) fail(`skills.${key}.dependencies contains duplicates`);
    dependencies.add(dependency);
  }
}

export function validateRegistry(registry) {
  if (!plainObject(registry)) fail('must be an object');
  validateNoSecrets(registry);
  const keys = Object.keys(registry);
  if (keys.length !== 2 || !keys.includes('schemaVersion') || !keys.includes('skills')) fail('contains unexpected fields');
  if (registry.schemaVersion !== 1) fail('schemaVersion must be 1');
  if (!plainObject(registry.skills)) fail('skills must be an object');
  for (const [key, entry] of Object.entries(registry.skills)) validateRegistryEntry(key, entry);
  return registry;
}

export async function loadRegistry(registryPath) {
  try {
    return validateRegistry(JSON.parse(await readFile(registryPath, 'utf8')));
  } catch (error) {
    if (error?.code === 'ENOENT') return { schemaVersion: 1, skills: {} };
    if (error instanceof SyntaxError) fail('is not valid JSON');
    throw error;
  }
}

function stableRegistry(registry) {
  const skills = {};
  for (const name of Object.keys(registry.skills).sort()) {
    const entry = Object.hasOwn(registry.skills, name) ? registry.skills[name] : null;
    skills[name] = {
      name: entry.name,
      sourceType: entry.sourceType,
      source: entry.source,
      ref: entry.ref,
      contentHash: entry.contentHash,
      installedAt: entry.installedAt,
      updatedAt: entry.updatedAt,
      dependencies: [...entry.dependencies],
    };
  }
  return { schemaVersion: 1, skills };
}

export async function writeRegistryAtomic(registryPath, registry, { filesystem = {} } = {}) {
  validateRegistry(registry);
  if (filesystem === null || typeof filesystem !== 'object' || Array.isArray(filesystem)) throw new TypeError('filesystem must be an object');
  const operations = { mkdir, open, rename, rm, ...filesystem };
  const directory = path.dirname(registryPath);
  await operations.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(registryPath)}.${randomBytes(12).toString('hex')}.tmp`);
  let renamed = false;
  try {
    const handle = await operations.open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(stableRegistry(registry), null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await operations.rename(temporary, registryPath);
    renamed = true;
    try {
      const parent = await operations.open(directory, 'r');
      try { await parent.sync(); } finally { await parent.close(); }
    } catch (error) {
      if (!['EINVAL', 'ENOTSUP', 'EPERM'].includes(error?.code)) throw error;
    }
  } catch (error) {
    await operations.rm(temporary, { force: true });
    if (renamed && error !== null && typeof error === 'object') error.registryCommitted = true;
    throw error;
  }
}
