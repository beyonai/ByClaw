import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';

import { errorEnvelope, successEnvelope } from '../core/envelope.mjs';
import { assertContained } from '../core/paths.mjs';
import { runCommand } from '../core/process.mjs';
import { redactText } from '../adapters/_core.mjs';

const SOURCE = 'openclaw';
const STATE_DIRECTORY = '.super-skill-manager-state';
const RUNTIME_DIRECTORY = 'runtime';
const STATE_FILE = 'runtime-state.json';
const LOCK_FILE = '.runtime-state.lock';
const STATE_SCHEMA_VERSION = 1;
const PREVIEW_TTL_MS = 5 * 60_000;
const LOCK_TTL_MS = 30_000;
const LOCK_ATTEMPTS = 100;
const TOKEN = /^[a-f0-9]{64}$/;
const OPERATIONS = new Set(['install', 'enable', 'disable', 'reset', 'pin', 'unpin', 'upgrade', 'remove']);

function nameFromReference(reference) {
  if (typeof reference !== 'string' || !reference.trim()) throw new TypeError('Skill reference must be a non-empty string.');
  const parts = reference.trim().replace(/^@/, '').split('/');
  const name = parts.at(-1);
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) throw new TypeError('Skill reference is invalid.');
  return name;
}

function normalizedReference(reference) {
  if (typeof reference !== 'string' || reference !== reference.trim() || reference.length > 512 || /[\0\r\n]/u.test(reference)) {
    throw new TypeError('Skill reference is invalid.');
  }
  if (reference.replace(/^@/, '').split('/').some((part) => part === '.' || part === '..')) throw new TypeError('Skill reference is invalid.');
  nameFromReference(reference);
  return reference;
}

function resultError(code, message, elapsedMs = 0) {
  return errorEnvelope({ source: SOURCE, code, message, elapsedMs });
}

function parseJson(result) {
  if (!result.ok) return null;
  try { return JSON.parse(result.stdout); } catch { return undefined; }
}

const SENSITIVE_KEY = /token|session|secret|credential|password|authorization|api[_-]?key|cookie/i;
const RESPONSE_FIELDS = Object.freeze({
  inventory: ['name', 'source', 'installed', 'enabled', 'localDrift', 'drift', 'risk', 'riskLevel', 'trackedBy', 'version', 'description'],
  skill: ['name', 'source', 'installed', 'enabled', 'localDrift', 'drift', 'risk', 'riskLevel', 'trackedBy', 'version', 'description'],
  doctor: ['status', 'warnings', 'issues'],
  search: ['name', 'source', 'version', 'description'],
});
const DOCTOR_SUMMARY_FIELDS = new Set(['total', 'eligible', 'modelVisible', 'commandVisible', 'disabled', 'blocked', 'agentFiltered', 'notInjected', 'missingRequirements']);
const MAX_DOCTOR_COUNT = 1_000_000;
const AUDIT_SCHEMA = 'clawhub.skill.verify.v1';
const AUDIT_DECISION = /^[a-z][a-z0-9._-]{0,63}$/i;
const AUDIT_SLUG = /^[a-z0-9][a-z0-9._-]{0,255}$/i;

function sanitizeJson(value, depth = 0) {
  if (depth > 32) throw new TypeError('Runtime JSON is too deeply nested.');
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (value.length > 16_384) return '[TRUNCATED]';
    return redactText(value)
      .replace(/\b(?:sk|api)[_-][A-Za-z0-9_-]{8,}\b/giu, '[REDACTED]');
  }
  if (Array.isArray(value)) return value.slice(0, 1_000).map((item) => sanitizeJson(item, depth + 1));
  if (!isPlainObject(value)) throw new TypeError('Runtime JSON has an invalid shape.');
  const sanitized = {};
  for (const [key, item] of Object.entries(value)) sanitized[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeJson(item, depth + 1);
  return sanitized;
}

function normalizeRecord(value, fields, required = []) {
  if (!isPlainObject(value)) throw new TypeError('Runtime JSON has an invalid shape.');
  const record = {};
  for (const field of fields) {
    const item = value[field];
    if (item === undefined) continue;
    if (['installed', 'enabled', 'localDrift', 'drift', 'risk', 'ready'].includes(field)) {
      if (typeof item !== 'boolean') throw new TypeError('Runtime JSON has an invalid shape.');
      record[field] = item;
      continue;
    }
    if (['warnings', 'issues'].includes(field)) {
      if (!Array.isArray(item) || item.length > 100 || !item.every((entry) => typeof entry === 'string')) throw new TypeError('Runtime JSON has an invalid shape.');
      record[field] = item.map((entry) => sanitizeJson(entry));
      continue;
    }
    if (typeof item !== 'string') throw new TypeError('Runtime JSON has an invalid shape.');
    record[field] = sanitizeJson(item);
  }
  if (required.some((field) => !(field in record))) throw new TypeError('Runtime JSON has an invalid shape.');
  return record;
}

function unwrapRecords(value, response) {
  if (Array.isArray(value)) return value;
  if (!isPlainObject(value) || !Array.isArray(value.skills)) throw new TypeError('Runtime JSON has an invalid shape.');
  return value.skills;
}

function normalizeDoctorSummary(value) {
  if (!isPlainObject(value) || !Number.isSafeInteger(value.total) || value.total < 0 || value.total > MAX_DOCTOR_COUNT) {
    throw new TypeError('Runtime JSON has an invalid shape.');
  }
  const summary = {};
  for (const [key, count] of Object.entries(value)) {
    if (!DOCTOR_SUMMARY_FIELDS.has(key)) continue;
    if (!Number.isSafeInteger(count) || count < 0 || count > MAX_DOCTOR_COUNT) throw new TypeError('Runtime JSON has an invalid shape.');
    summary[key] = count;
  }
  return summary;
}

function normalizeDoctorEligible(value) {
  if (!Array.isArray(value) || value.length > 1_000) throw new TypeError('Runtime JSON has an invalid shape.');
  return value.map((entry) => {
    if (typeof entry === 'string' && entry.length > 0 && entry.length <= 256) {
      if (!/^[a-z0-9][a-z0-9._-]*$/i.test(entry)) throw new TypeError('Runtime JSON has an invalid shape.');
      return sanitizeJson(entry);
    }
    return normalizeRecord(entry, RESPONSE_FIELDS.inventory, ['name']);
  });
}

function normalizeDoctor(value) {
  if (!isPlainObject(value)) throw new TypeError('Runtime JSON has an invalid shape.');
  const record = normalizeRecord(value, RESPONSE_FIELDS.doctor);
  if (typeof value.summary === 'string') record.summary = sanitizeJson(value.summary);
  else if (value.summary !== undefined) record.summary = normalizeDoctorSummary(value.summary);
  if (value.eligible !== undefined) record.eligible = normalizeDoctorEligible(value.eligible);
  if (!('status' in record) && !('summary' in record)) throw new TypeError('Runtime JSON has an invalid shape.');
  return record;
}

function normalizeAuditText(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 16_384) throw new TypeError('Runtime JSON has an invalid shape.');
  return sanitizeJson(value);
}

function normalizeAuditReasons(value) {
  if (!Array.isArray(value) || value.length > 100) throw new TypeError('Runtime JSON has an invalid shape.');
  return value.map((reason) => normalizeAuditText(reason));
}

function normalizeAuditSecurity(value) {
  if (!isPlainObject(value)) throw new TypeError('Runtime JSON has an invalid shape.');
  const status = normalizeAuditText(value.status);
  if (!AUDIT_DECISION.test(status)) throw new TypeError('Runtime JSON has an invalid shape.');
  const security = { status };
  if (value.reasons !== undefined) security.reasons = normalizeAuditReasons(value.reasons);
  return security;
}

function normalizeAudit(value) {
  if (!isPlainObject(value) || value.schema !== AUDIT_SCHEMA || typeof value.ok !== 'boolean') {
    throw new TypeError('Runtime JSON has an invalid shape.');
  }
  const decision = normalizeAuditText(value.decision);
  if (!AUDIT_DECISION.test(decision)) throw new TypeError('Runtime JSON has an invalid shape.');
  if (!isPlainObject(value.skill) || typeof value.skill.slug !== 'string' || !AUDIT_SLUG.test(value.skill.slug)) {
    throw new TypeError('Runtime JSON has an invalid shape.');
  }
  const skill = { slug: sanitizeJson(value.skill.slug) };
  if (value.skill.displayName !== undefined) skill.displayName = normalizeAuditText(value.skill.displayName);
  const record = { schema: AUDIT_SCHEMA, ok: value.ok, decision, reasons: normalizeAuditReasons(value.reasons), skill };
  if (value.security !== undefined && value.security !== null) record.security = normalizeAuditSecurity(value.security);
  return record;
}

function normalizeRuntimeJson(value, response) {
  const fields = RESPONSE_FIELDS[response];
  if (!fields && response !== 'audit') throw new TypeError('Runtime response type is invalid.');
  if (response === 'doctor') {
    return [normalizeDoctor(value)];
  }
  if (response === 'skill') {
    if (!isPlainObject(value)) throw new TypeError('Runtime JSON has an invalid shape.');
    return [normalizeRecord(value, fields, ['name'])];
  }
  if (response === 'audit') {
    return [normalizeAudit(value)];
  }
  const records = unwrapRecords(value, response);
  if (records.length > 1_000) throw new TypeError('Runtime JSON is too large.');
  return records.map((record) => normalizeRecord(record, fields, ['name']));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function hasOnlyKeys(value, keys) {
  return isPlainObject(value) && Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function emptyState() {
  return { schemaVersion: STATE_SCHEMA_VERSION, previews: {}, pins: [] };
}

function validPreview(preview) {
  if (!hasOnlyKeys(preview, ['operation', 'name', 'riskRequired', 'riskConfirmationToken', 'localDrift', 'inventoryHash', 'expiresAt'])) return false;
  try { normalizedReference(preview.name); } catch { return false; }
  return OPERATIONS.has(preview.operation) && typeof preview.riskRequired === 'boolean' && typeof preview.localDrift === 'boolean' &&
    TOKEN.test(preview.inventoryHash) && Number.isSafeInteger(preview.expiresAt) && preview.expiresAt > 0 &&
    (preview.riskRequired ? TOKEN.test(preview.riskConfirmationToken) : preview.riskConfirmationToken === null);
}

function validateState(state) {
  if (!hasOnlyKeys(state, ['schemaVersion', 'previews', 'pins']) || state.schemaVersion !== STATE_SCHEMA_VERSION || !isPlainObject(state.previews) || !Array.isArray(state.pins)) {
    throw new TypeError('Runtime state is invalid.');
  }
  for (const [token, preview] of Object.entries(state.previews)) {
    if (!TOKEN.test(token) || !validPreview(preview)) throw new TypeError('Runtime state is invalid.');
  }
  if (!state.pins.every((pin) => typeof pin === 'string' && pin === nameFromReference(pin)) || new Set(state.pins).size !== state.pins.length ||
    state.pins.some((pin, index) => index > 0 && state.pins[index - 1].localeCompare(pin) >= 0)) throw new TypeError('Runtime state is invalid.');
  return state;
}

function assertSecureEntry(entry, label, mode) {
  if ((entry.mode & 0o777) !== mode) throw new TypeError(`${label} permissions must be ${mode.toString(8)}.`);
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (uid !== null && entry.uid !== uid) throw new TypeError(`${label} must be owned by the current user.`);
}

async function regularDirectory(target, label, { secure = false } = {}) {
  const entry = await lstat(target);
  if (entry.isSymbolicLink() || !entry.isDirectory()) throw new TypeError(`${label} must be a regular directory.`);
  if (secure) assertSecureEntry(entry, label, 0o700);
  return realpath(target);
}

async function maybeRegularFile(target, label = 'Runtime state file') {
  try {
    const entry = await lstat(target);
    if (entry.isSymbolicLink() || !entry.isFile()) throw new TypeError(`${label} must be a regular file.`);
    assertSecureEntry(entry, label, 0o600);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function inventorySnapshot(records, reference, pins) {
  const name = nameFromReference(reference);
  const skill = records.find((item) => item?.name === name || item?.source === reference) ?? null;
  return {
    exists: skill !== null,
    name,
    source: typeof skill?.source === 'string' ? skill.source : null,
    trackedBy: typeof skill?.trackedBy === 'string' ? skill.trackedBy : null,
    localDrift: skill?.localDrift === true || skill?.drift === true,
    riskRequired: skill?.risk === true || skill?.riskLevel === 'high',
    pinned: pins.includes(name),
  };
}

function inventoryHash(snapshot) {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

export function createOpenClawProvider({ runner, workspace = process.cwd(), openclawRoot = workspace, timeoutMs = 8_000, now = () => Date.now(), previewTtlMs = PREVIEW_TTL_MS } = {}) {
  const execute = runner ?? ((command, args) => runCommand({ command, args, timeoutMs }));
  if (typeof execute !== 'function') throw new TypeError('runner must be a function.');
  if (typeof now !== 'function' || !Number.isSafeInteger(previewTtlMs) || previewTtlMs <= 0 || previewTtlMs > PREVIEW_TTL_MS) throw new TypeError('Runtime preview settings are invalid.');
  const resolvedWorkspace = path.resolve(workspace);

  async function runtimeRoot() {
    const openclaw = await regularDirectory(openclawRoot, 'OpenClaw root');
    const stateRoot = path.join(openclaw, STATE_DIRECTORY);
    assertContained(openclaw, stateRoot);
    try { await mkdir(stateRoot, { mode: 0o700 }); } catch (error) { if (error?.code !== 'EEXIST') throw error; }
    const canonicalStateRoot = await regularDirectory(stateRoot, 'Runtime state root', { secure: true });
    assertContained(openclaw, canonicalStateRoot);
    if (path.dirname(canonicalStateRoot) !== openclaw) throw new TypeError('Runtime state root must be a direct child of OpenClaw root.');
    const root = path.join(canonicalStateRoot, RUNTIME_DIRECTORY);
    assertContained(canonicalStateRoot, root);
    try { await mkdir(root, { mode: 0o700 }); } catch (error) { if (error?.code !== 'EEXIST') throw error; }
    const canonicalRuntimeRoot = await regularDirectory(root, 'Runtime state directory', { secure: true });
    assertContained(canonicalStateRoot, canonicalRuntimeRoot);
    if (path.dirname(canonicalRuntimeRoot) !== canonicalStateRoot) throw new TypeError('Runtime state directory must be a direct child of the state root.');
    return canonicalRuntimeRoot;
  }

  async function acquireLock(root) {
    const lockPath = path.join(root, LOCK_FILE);
    assertContained(root, lockPath);
    const lockId = randomBytes(32).toString('hex');
    for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
      try {
        const handle = await open(lockPath, 'wx', 0o600);
        await maybeRegularFile(lockPath, 'Runtime state lock');
        await handle.writeFile(JSON.stringify({ schemaVersion: 1, lockId, expiresAt: now() + LOCK_TTL_MS }));
        await handle.sync();
        return async () => {
          await handle.close();
          try {
            if (await maybeRegularFile(lockPath, 'Runtime state lock')) {
              const lock = JSON.parse(await readFile(lockPath, 'utf8'));
              if (isPlainObject(lock) && lock.lockId === lockId) await rm(lockPath, { force: true });
            }
          } catch { /* A replaced or unreadable lock is safer to leave in place. */ }
        };
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        if (!(await maybeRegularFile(lockPath, 'Runtime state lock'))) continue;
        try {
          const lock = JSON.parse(await readFile(lockPath, 'utf8'));
          if (isPlainObject(lock) && Number.isSafeInteger(lock.expiresAt) && lock.expiresAt < now()) await rm(lockPath, { force: true });
        } catch { throw new TypeError('Runtime state lock is invalid.'); }
        await wait(10);
      }
    }
    throw new TypeError('Runtime state is busy.');
  }

  async function readState(root) {
    const statePath = path.join(root, STATE_FILE);
    assertContained(root, statePath);
    if (!(await maybeRegularFile(statePath, 'Runtime state file'))) return emptyState();
    try { return validateState(JSON.parse(await readFile(statePath, 'utf8'))); } catch (error) {
      if (error instanceof TypeError && error.message === 'Runtime state is invalid.') throw error;
      throw new TypeError('Runtime state is invalid.');
    }
  }

  async function writeState(root, state) {
    validateState(state);
    const statePath = path.join(root, STATE_FILE);
    const temporaryPath = path.join(root, `.${STATE_FILE}.${randomBytes(16).toString('hex')}.tmp`);
    assertContained(root, statePath);
    assertContained(root, temporaryPath);
    await maybeRegularFile(statePath, 'Runtime state file');
    try {
      const handle = await open(temporaryPath, 'wx', 0o600);
      await maybeRegularFile(temporaryPath, 'Runtime state temporary file');
      await handle.writeFile(`${JSON.stringify(state)}\n`);
      await handle.sync();
      await handle.close();
      await rename(temporaryPath, statePath);
      await maybeRegularFile(statePath, 'Runtime state file');
      const directory = await open(root, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  async function withState(work) {
    const root = await runtimeRoot();
    const release = await acquireLock(root);
    try {
      if (await runtimeRoot() !== root) throw new TypeError('Runtime state directory changed while acquiring its lock.');
      const state = await readState(root);
      const result = await work(state);
      if (result.write) await writeState(root, state);
      return result.value;
    } finally {
      await release();
    }
  }

  async function command(args, { commandName = 'openclaw', json = false, response = null } = {}) {
    let result;
    try { result = await execute(commandName, args, { timeoutMs }); } catch { return resultError('RUNTIME_COMMAND_FAILED', 'OpenClaw command failed.'); }
    const elapsedMs = Number.isFinite(result?.elapsedMs) ? result.elapsedMs : 0;
    if (!result?.ok) return resultError('RUNTIME_COMMAND_FAILED', 'OpenClaw command failed.', elapsedMs);
    if (!json) return successEnvelope({ source: SOURCE, elapsedMs });
    const data = parseJson(result);
    if (data === undefined) return resultError('INVALID_RUNTIME_JSON', 'OpenClaw returned invalid JSON.', elapsedMs);
    try {
      return successEnvelope({ source: SOURCE, data: normalizeRuntimeJson(data, response), elapsedMs });
    } catch { return resultError('PARSE_ERROR', 'OpenClaw returned malformed JSON.', elapsedMs); }
  }

  async function issuePreview(operation, name) {
    if (!OPERATIONS.has(operation)) throw new TypeError('Runtime preview operation is invalid.');
    const reference = normalizedReference(name);
    await runtimeRoot();
    const inventory = await command(['skills', 'list', '--json'], { json: true, response: 'inventory' });
    if (!inventory.ok) return inventory;
    const token = randomBytes(32).toString('hex');
    const expiresAt = now() + previewTtlMs;
    const preview = await withState((state) => {
      for (const [savedToken, preview] of Object.entries(state.previews)) if (preview.expiresAt <= now()) delete state.previews[savedToken];
      const snapshot = inventorySnapshot(inventory.data, reference, state.pins);
      const riskConfirmationToken = snapshot.riskRequired ? randomBytes(32).toString('hex') : null;
      state.previews[token] = { operation, name: reference, riskRequired: snapshot.riskRequired, riskConfirmationToken, localDrift: snapshot.localDrift, inventoryHash: inventoryHash(snapshot), expiresAt };
      return { write: true, value: { riskConfirmationToken, localDrift: snapshot.localDrift, riskRequired: snapshot.riskRequired } };
    });
    return successEnvelope({ source: SOURCE, data: [{ operation, name: reference, confirmationToken: token, riskConfirmationToken: preview.riskConfirmationToken, localDrift: preview.localDrift, riskRequired: preview.riskRequired, expiresAt, requiresConfirmation: true }] });
  }

  async function consumePreview({ operation, name, confirmationToken, riskConfirmationToken, updateState = null, requireUnpinned = false }) {
    const reference = normalizedReference(name);
    const reserved = await withState((state) => {
      const preview = typeof confirmationToken === 'string' ? state.previews[confirmationToken] : null;
      const write = Boolean(preview);
      if (preview) delete state.previews[confirmationToken];
      if (!preview || preview.expiresAt <= now() || preview.operation !== operation || preview.name !== reference) {
        return { write, value: resultError('INVALID_CONFIRMATION', 'A matching preview confirmation is required.') };
      }
      return { write: true, value: preview };
    });
    if (reserved?.ok === false) return reserved;
    const inventory = await command(['skills', 'list', '--json'], { json: true, response: 'inventory' });
    if (!inventory.ok) return inventory;
    return withState((state) => {
      const snapshot = inventorySnapshot(inventory.data, reference, state.pins);
      if (inventoryHash(snapshot) !== reserved.inventoryHash) return { write: false, value: resultError('PREVIEW_STALE', 'Runtime skill state changed after preview.') };
      if (snapshot.riskRequired && riskConfirmationToken !== reserved.riskConfirmationToken) {
        return { write: false, value: resultError('RISK_AUTHORIZATION_REQUIRED', 'A separate risk confirmation is required.') };
      }
      if (snapshot.localDrift) return { write: false, value: resultError('LOCAL_DRIFT', 'Resolve local drift before changing the skill.') };
      if (requireUnpinned && snapshot.pinned) return { write: false, value: resultError('PINNED', 'Unpin the skill in a separate confirmed operation before upgrading.') };
      if (updateState) updateState(state);
      return { write: Boolean(updateState), value: null };
    });
  }

  async function setEnabled(options, enabled, operation) {
    const { name: reference, confirmationToken, riskConfirmationToken } = typeof options === 'string' ? { name: options } : options ?? {};
    const blocked = await consumePreview({ operation, name: reference, confirmationToken, riskConfirmationToken });
    if (blocked) return blocked;
    const name = nameFromReference(reference);
    const changed = await command(['config', 'set', `skills.entries.${name}.enabled`, String(enabled), '--strict-json']);
    if (!changed.ok) return changed;
    return command(['skills', 'check', '--json'], { json: true, response: 'doctor' });
  }

  return {
    list: () => command(['skills', 'list', '--json'], { json: true, response: 'inventory' }),
    show: (name) => command(['skills', 'info', nameFromReference(name), '--json'], { json: true, response: 'skill' }),
    audit: (reference) => command(['skills', 'verify', reference], { json: true, response: 'audit' }),
    doctor: () => command(['skills', 'check', '--json'], { json: true, response: 'doctor' }),
    search: (query) => command(['skills', 'search', query, '--json'], { json: true, response: 'search' }),
    preview: ({ operation, name }) => issuePreview(operation, name),
    async install(options) {
      const { candidate, confirmationToken, riskConfirmationToken } = typeof options === 'string' ? { candidate: options } : options ?? {};
      const blocked = await consumePreview({ operation: 'install', name: candidate, confirmationToken, riskConfirmationToken });
      return blocked ?? command(['skills', 'install', candidate]);
    },
    enable: (options) => setEnabled(options, true, 'enable'),
    disable: (options) => setEnabled(options, false, 'disable'),
    reset: (options) => setEnabled(options, null, 'reset'),
    async pin(options) {
      const { name: reference, confirmationToken, riskConfirmationToken } = typeof options === 'string' ? { name: options } : options ?? {};
      const name = nameFromReference(reference);
      const blocked = await consumePreview({ operation: 'pin', name: reference, confirmationToken, riskConfirmationToken, updateState: (state) => {
        state.pins = [...new Set([...state.pins, name])].sort((left, right) => left.localeCompare(right));
      } });
      return blocked ?? successEnvelope({ source: SOURCE });
    },
    async unpin(options) {
      const { name: reference, confirmationToken, riskConfirmationToken } = typeof options === 'string' ? { name: options } : options ?? {};
      const name = nameFromReference(reference);
      const blocked = await consumePreview({ operation: 'unpin', name: reference, confirmationToken, riskConfirmationToken, updateState: (state) => {
        state.pins = state.pins.filter((pin) => pin !== name);
      } });
      return blocked ?? successEnvelope({ source: SOURCE });
    },
    async upgrade({ name, trackedBy, pinned = false, localDrift = false, confirmationToken, riskConfirmationToken } = {}) {
      const pinName = nameFromReference(name);
      const persistedPin = await withState((state) => ({ write: false, value: state.pins.includes(pinName) }));
      if (pinned || persistedPin) return resultError('PINNED', 'Unpin the skill in a separate confirmed operation before upgrading.');
      if (localDrift) return resultError('LOCAL_DRIFT', 'Resolve local drift before upgrading.');
      if (trackedBy !== 'clawhub') return resultError('CUSTOM_TRANSACTION_REQUIRED', 'Git and local skills must be upgraded by their transaction provider.');
      const blocked = await consumePreview({ operation: 'upgrade', name, confirmationToken, riskConfirmationToken, requireUnpinned: true });
      return blocked ?? command(['skills', 'update', name]);
    },
    async remove({ name, trackedBy, localDrift = false, confirmationToken, riskConfirmationToken } = {}) {
      if (localDrift) return resultError('LOCAL_DRIFT', 'Resolve local drift before removing the skill.');
      if (trackedBy !== 'clawhub') return resultError('CUSTOM_TRANSACTION_REQUIRED', 'Git and local skills must be removed by their transaction provider.');
      const blocked = await consumePreview({ operation: 'remove', name, confirmationToken, riskConfirmationToken });
      return blocked ?? command(['--workdir', resolvedWorkspace, 'uninstall', name], { commandName: 'clawhub' });
    },
  };
}
