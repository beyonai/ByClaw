import { errorEnvelope, successEnvelope } from '../core/envelope.mjs';
import { validateSkillName } from '../core/paths.mjs';
import { redactText, safeMessage } from '../adapters/_core.mjs';

const SOURCE = 'byclaw-workspace';
const WORKSPACE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MUTATIONS = Object.freeze({
  install: 'installSkill',
  upgrade: 'updateSkill',
  reset: 'updateSkill',
  enable: 'updateSkill',
  disable: 'updateSkill',
  pin: 'updateSkill',
  unpin: 'updateSkill',
  remove: 'removeSkill',
  scaffold: 'scaffoldSkill',
});
const PREVIEW_OPERATIONS = new Set(Object.keys(MUTATIONS));
const SUCCESS_KEYS = new Set(['ok', 'source', 'data', 'warnings', 'elapsedMs']);
const ERROR_KEYS = new Set(['ok', 'source', 'data', 'error', 'elapsedMs']);
const PUBLIC_RECORD_FIELDS = new Set([
  'name', 'source', 'description', 'installed', 'enabled', 'localDrift', 'drift', 'risk', 'riskLevel', 'trackedBy', 'version',
  'status', 'summary', 'operation', 'requiresConfirmation', 'expiresAt', 'warnings', 'issues', 'eligible',
]);
const TOKEN_FIELDS = new Set(['confirmationToken', 'riskConfirmationToken']);
const MAX_PUBLIC_RECORDS = 100;

function workspaceName(workspace) {
  if (typeof workspace !== 'string' || !WORKSPACE.test(workspace)) throw new TypeError('Workspace must be a named workspace identifier.');
  return workspace;
}

function failure(code, message) {
  return errorEnvelope({ source: SOURCE, code, message });
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function safeText(value) {
  if (typeof value !== 'string' || value.length > 16_384) throw new TypeError('ByClaw workspace endpoint returned an invalid response.');
  return redactText(value);
}

function normalizeList(value) {
  if (!Array.isArray(value) || value.length > 1_000 || !value.every((item) => typeof item === 'string' && item.length <= 256)) {
    throw new TypeError('ByClaw workspace endpoint returned an invalid response.');
  }
  return value.map((item) => redactText(item));
}

function normalizeRecord(record) {
  if (!plain(record)) throw new TypeError('ByClaw workspace endpoint returned an invalid response.');
  const output = {};
  for (const [field, value] of Object.entries(record)) {
    if (!PUBLIC_RECORD_FIELDS.has(field) || TOKEN_FIELDS.has(field)) continue;
    if (field === 'name') {
      output.name = validateSkillName(value);
      continue;
    }
    if (field === 'source') {
      if (value === SOURCE) output.source = SOURCE;
      continue;
    }
    if (['installed', 'enabled', 'localDrift', 'drift', 'risk', 'requiresConfirmation'].includes(field)) {
      if (typeof value !== 'boolean') throw new TypeError('ByClaw workspace endpoint returned an invalid response.');
      output[field] = value;
      continue;
    }
    if (field === 'expiresAt') {
      if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('ByClaw workspace endpoint returned an invalid response.');
      output[field] = value;
      continue;
    }
    if (['warnings', 'issues', 'eligible'].includes(field)) {
      output[field] = normalizeList(value);
      continue;
    }
    output[field] = safeText(value);
  }
  return output;
}

function normalizePreviewRecord(record, request) {
  if (!plain(record) || typeof record.confirmationToken !== 'string' || !record.confirmationToken || record.confirmationToken.length > 512) {
    throw new TypeError('ByClaw workspace endpoint returned an invalid response.');
  }
  const name = skillName(request.name ?? request.candidate);
  const output = {
    operation: safeText(request.operation),
    name,
    requiresConfirmation: true,
    confirmationToken: record.confirmationToken,
  };
  if (record.riskConfirmationToken !== undefined) {
    if (typeof record.riskConfirmationToken !== 'string' || !record.riskConfirmationToken || record.riskConfirmationToken.length > 512) {
      throw new TypeError('ByClaw workspace endpoint returned an invalid response.');
    }
    output.riskConfirmationToken = record.riskConfirmationToken;
  }
  for (const field of ['localDrift', 'riskRequired']) {
    if (record[field] !== undefined) {
      if (typeof record[field] !== 'boolean') throw new TypeError('ByClaw workspace endpoint returned an invalid response.');
      output[field] = record[field];
    }
  }
  if (record.expiresAt !== undefined) {
    if (!Number.isSafeInteger(record.expiresAt) || record.expiresAt < 0) throw new TypeError('ByClaw workspace endpoint returned an invalid response.');
    output.expiresAt = record.expiresAt;
  }
  return output;
}

function normalizeResponse(response, { method, request }) {
  if (!plain(response) || typeof response.ok !== 'boolean' || response.source !== SOURCE) {
    throw new TypeError('ByClaw workspace endpoint returned an invalid response.');
  }
  const allowedKeys = response.ok ? SUCCESS_KEYS : ERROR_KEYS;
  if (Object.keys(response).some((key) => !allowedKeys.has(key)) || !Array.isArray(response.data) || response.data.length > MAX_PUBLIC_RECORDS) {
    throw new TypeError('ByClaw workspace endpoint returned an invalid response.');
  }
  const elapsedMs = Number.isSafeInteger(response.elapsedMs) && response.elapsedMs >= 0 ? response.elapsedMs : 0;
  if (response.ok) {
    if (!Array.isArray(response.warnings) || !response.warnings.every((warning) => typeof warning === 'string' && warning.length <= 1_024)) {
      throw new TypeError('ByClaw workspace endpoint returned an invalid response.');
    }
    if (method === 'previewSkill' && response.data.length !== 1) {
      throw new TypeError('ByClaw workspace endpoint returned an invalid response.');
    }
    const data = method === 'previewSkill'
      ? response.data.map((record) => normalizePreviewRecord(record, request))
      : response.data.map(normalizeRecord);
    return successEnvelope({ source: SOURCE, data, warnings: response.warnings.map((warning) => redactText(warning)), elapsedMs });
  }
  if (!plain(response.error) || typeof response.error.code !== 'string' || !/^[A-Z][A-Z0-9_]{1,63}$/.test(response.error.code) || typeof response.error.message !== 'string') {
    throw new TypeError('ByClaw workspace endpoint returned an invalid response.');
  }
  return errorEnvelope({ source: SOURCE, code: response.error.code, message: safeMessage(response.error.message), elapsedMs });
}

function skillName(name) {
  return validateSkillName(name);
}

export function createByClawWorkspaceProvider({ workspace, client } = {}) {
  const namedWorkspace = workspaceName(workspace);
  if (!client || typeof client !== 'object' || Array.isArray(client)) throw new TypeError('ByClaw workspace client is required.');

  async function endpoint(method, request) {
    if (typeof client[method] !== 'function') return failure('BYCLAW_ENDPOINT_UNAVAILABLE', 'The requested ByClaw workspace endpoint is unavailable.');
    let response;
    try {
      response = await client[method]({ workspace: namedWorkspace, ...request });
    } catch (cause) {
      return failure('BYCLAW_ENDPOINT_FAILED', safeMessage(cause instanceof Error ? cause.message : cause));
    }
    try {
      return normalizeResponse(response, { method, request });
    } catch {
      return failure('BYCLAW_ENDPOINT_INVALID', 'The ByClaw workspace endpoint returned an invalid response.');
    }
  }

  function mutation(operation) {
    const method = MUTATIONS[operation];
    return async ({ name, candidate, confirmationToken, riskConfirmationToken } = {}) => {
      const target = skillName(candidate ?? name);
      if (typeof confirmationToken !== 'string' || !confirmationToken.trim()) {
        return failure('INVALID_CONFIRMATION', 'A preview confirmation token is required.');
      }
      return endpoint(method, {
        ...(candidate === undefined ? { name: target } : { candidate: target }),
        confirmationToken,
        riskConfirmationToken,
        ...(operation === 'reset' ? { operation: 'reset' } : {}),
        ...(operation === 'enable' || operation === 'disable' || operation === 'pin' || operation === 'unpin' ? { operation } : {}),
      });
    };
  }

  return {
    list: () => endpoint('listSkills', {}),
    show: async (name) => endpoint('getSkill', { name: skillName(name) }),
    audit: async (name) => endpoint('auditSkill', { name: skillName(name) }),
    doctor: () => endpoint('doctorSkills', {}),
    search: (query) => endpoint('searchSkills', { query }),
    preview: async ({ operation, name, candidate } = {}) => {
      if (!PREVIEW_OPERATIONS.has(operation)) return failure('INVALID_OPERATION', 'The requested ByClaw workspace preview operation is invalid.');
      const target = skillName(candidate ?? name);
      return endpoint('previewSkill', { operation, ...(candidate === undefined ? { name: target } : { candidate: target }) });
    },
    install: mutation('install'),
    upgrade: mutation('upgrade'),
    reset: mutation('reset'),
    enable: mutation('enable'),
    disable: mutation('disable'),
    pin: mutation('pin'),
    unpin: mutation('unpin'),
    remove: mutation('remove'),
    scaffold: mutation('scaffold'),
  };
}
