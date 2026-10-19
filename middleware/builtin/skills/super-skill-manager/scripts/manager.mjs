import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { realpath } from 'node:fs/promises';

import { PublicMetadataCache } from './core/cache.mjs';
import { errorEnvelope, successEnvelope, writeEnvelope } from './core/envelope.mjs';
import { runCommand } from './core/process.mjs';
import { searchCatalog } from './catalog.mjs';
import { createInstallPreview, screenSkillDirectory } from './core/security.mjs';
import { createBuiltinRepoProvider } from './providers/builtin-repo.mjs';
import { createByClawWorkspaceProvider } from './providers/byclaw-workspace.mjs';
import { createOpenClawProvider } from './providers/openclaw.mjs';

const COMMAND_SPEC = {
  create: {
    install: { operand: 'candidate', flags: ['provider', 'target', 'confirm'], mutating: true },
    scaffold: { operand: 'name', flags: ['provider', 'target', 'confirm'], mutating: true },
    import: { operand: 'path', flags: ['target', 'confirm'], mutating: true },
    restore: { operand: 'trashId', flags: ['confirm'], mutating: true },
  },
  read: {
    search: { operand: 'query', flags: ['type', 'source', 'limit', 'json', 'refresh', 'no-cache', 'query-alias'] },
    list: { flags: ['provider', 'json'] },
    show: { operand: 'name', flags: ['provider', 'json'] },
    audit: { operand: 'name', flags: ['provider', 'json'] },
    doctor: { flags: ['json'] },
  },
  update: {
    upgrade: { operand: 'name', flags: ['provider', 'confirm'], mutating: true },
    edit: { operand: 'name', flags: ['provider', 'confirm'], mutating: true },
    repair: { operand: 'name', flags: ['provider', 'confirm'], mutating: true },
    enable: { operand: 'name', flags: ['provider', 'confirm'], mutating: true },
    disable: { operand: 'name', flags: ['provider', 'confirm'], mutating: true },
    pin: { operand: 'name', flags: ['provider', 'confirm'], mutating: true },
    unpin: { operand: 'name', flags: ['provider', 'confirm'], mutating: true },
  },
  delete: {
    remove: { operand: 'name', flags: ['provider', 'confirm'], mutating: true },
    purge: { operand: 'name', flags: ['provider', 'confirm'], mutating: true },
  },
};

const FLAG_VALUES = new Set(['provider', 'target', 'type', 'source', 'limit', 'query-alias']);
const REPEATABLE_FLAGS = new Set(['query-alias']);
const UNIMPLEMENTED_COMMANDS = new Set(['create:import', 'create:restore', 'update:edit', 'delete:purge']);

for (const group of Object.values(COMMAND_SPEC)) {
  for (const command of Object.values(group)) if (command.mutating) command.flags.push('risk-confirm');
}
FLAG_VALUES.add('risk-confirm');

function invalid(message) {
  throw new Error(message);
}

function helpRequested(argv) {
  return Array.isArray(argv) && argv.includes('--help') || Array.isArray(argv) && argv.includes('-h')
    ? argv.every((argument) => ['--help', '-h', '--json'].includes(argument))
    : false;
}

function helpData() {
  return Object.entries(COMMAND_SPEC).flatMap(([group, actions]) => Object.entries(actions).map(([action, spec]) => ({
    group,
    action,
    status: UNIMPLEMENTED_COMMANDS.has(`${group}:${action}`) ? 'not-implemented' : 'implemented',
    mutating: spec.mutating === true,
  })));
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    invalid(`${flag} requires a value`);
  }
  return value;
}

function normalizeNonEmpty(value, label) {
  const normalized = value.trim();
  if (!normalized) invalid(`${label} must be non-empty`);
  return normalized;
}

export function parseArgs(argv) {
  if (!Array.isArray(argv)) invalid('argv must be an array');
  const [group, action, ...rest] = argv;
  const groupSpec = COMMAND_SPEC[group];
  if (!groupSpec) invalid(`unknown command group: ${group ?? ''}`);
  const commandSpec = groupSpec[action];
  if (!commandSpec) invalid(`unknown ${group} action: ${action ?? ''}`);

  const allowedFlags = new Set(commandSpec.flags);
  const result = {
    group,
    action,
    type: 'all',
    sources: [],
    limit: 10,
    json: false,
    refresh: false,
    noCache: false,
    confirmed: false,
    queryAliases: [],
    provider: null,
    target: null,
    riskConfirmationToken: null,
  };
  const positionals = [];
  const seenFlags = new Set();

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const flag = token.slice(2);
    if (!allowedFlags.has(flag)) invalid(`--${flag} is not valid for ${group} ${action}`);
    if (seenFlags.has(flag) && !REPEATABLE_FLAGS.has(flag)) invalid(`--${flag} may only be specified once`);
    seenFlags.add(flag);

    if (FLAG_VALUES.has(flag)) {
      const value = requireValue(rest, index, `--${flag}`);
      index += 1;
      if (flag === 'provider' || flag === 'target') result[flag] = normalizeNonEmpty(value, `--${flag}`);
      if (flag === 'type') {
        if (!['skill', 'mcp', 'all'].includes(value)) invalid('--type must be skill, mcp, or all');
        result.type = value;
      }
      if (flag === 'source') {
        const sources = value.split(',').map((source) => normalizeNonEmpty(source, '--source'));
        result.sources = [...new Set(sources)];
      }
      if (flag === 'limit') {
        if (!/^[1-9]\d*$/.test(value)) invalid('--limit must be a positive integer');
        const limit = Number(value);
        if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 10) invalid('--limit must be between 1 and 10');
        result.limit = limit;
      }
      if (flag === 'query-alias') {
        result.queryAliases.push(normalizeNonEmpty(value, '--query-alias'));
        if (result.queryAliases.length > 3) invalid('--query-alias may be used at most three times');
      }
      if (flag === 'risk-confirm') result.riskConfirmationToken = normalizeNonEmpty(value, '--risk-confirm');
      continue;
    }

    if (flag === 'json') result.json = true;
    if (flag === 'refresh') result.refresh = true;
    if (flag === 'no-cache') result.noCache = true;
    if (flag === 'confirm') {
      result.confirmed = true;
      if (rest[index + 1] !== undefined && !rest[index + 1].startsWith('--')) {
        result.confirmationToken = normalizeNonEmpty(rest[index + 1], '--confirm');
        index += 1;
      }
    }
  }

  const operandName = commandSpec.operand;
  if (operandName) {
    if (positionals.length === 0) invalid(`${operandName} is required`);
    if (positionals.length > 1) invalid(`unexpected positional argument: ${positionals[1]}`);
    result[operandName] = normalizeNonEmpty(positionals[0], operandName);
  } else if (positionals.length > 0) {
    invalid(`unexpected positional argument: ${positionals[0]}`);
  }

  return result;
}

function isMutation(group, action) {
  return COMMAND_SPEC[group][action].mutating === true;
}

async function trackedByFor(provider, providerId, name) {
  if (providerId !== 'openclaw' || typeof provider?.list !== 'function') return providerId === 'openclaw' ? null : providerId;
  try {
    const inventory = await provider.list();
    if (!inventory?.ok || !Array.isArray(inventory.data)) return null;
    const skill = inventory.data.find((item) => item?.name === name || item?.source === name);
    // Only the runtime's explicit ClawHub tracking marker may opt into ClawHub lifecycle commands.
    return skill?.trackedBy === 'clawhub' ? 'clawhub' : null;
  } catch {
    return null;
  }
}

export async function main(argv = process.argv.slice(2), {
  stdout = process.stdout, stderr = process.stderr, cache, lifecycle, resolveInstallCandidate,
  openclawProvider, builtinRepoProvider, byclawWorkspaceProvider, byclawClient, byclawWorkspace,
  repositoryRoot, runner, workspace, openclawRoot,
} = {}) {
  const startedAt = performance.now();
  let parsed;
  try {
    if (helpRequested(argv)) {
      writeEnvelope(successEnvelope({ source: 'manager', data: helpData(), elapsedMs: Math.round(performance.now() - startedAt) }), stdout);
      return 0;
    }
    parsed = parseArgs(argv);
    const runtime = openclawProvider ?? createOpenClawProvider({ runner, workspace, openclawRoot });
    const providers = {
      openclaw: runtime,
      'builtin-repo': builtinRepoProvider ?? createBuiltinRepoProvider({ repositoryRoot }),
      'byclaw-workspace': byclawWorkspaceProvider ?? (byclawClient && byclawWorkspace
        ? createByClawWorkspaceProvider({ client: byclawClient, workspace: byclawWorkspace })
        : null),
    };
    const selectedProvider = () => parsed.provider === null ? runtime : providers[parsed.provider];
    if (parsed.provider !== null && !selectedProvider()) {
      writeEnvelope(errorEnvelope({
        source: 'manager',
        code: 'PROVIDER_UNAVAILABLE',
        message: 'The explicitly selected provider is unavailable.',
        elapsedMs: Math.round(performance.now() - startedAt),
      }), stdout);
      return 1;
    }
    if (parsed.group === 'read' && parsed.action === 'search') {
      if (parsed.sources.length === 1 && parsed.sources[0] === 'openclaw' && typeof runtime.search === 'function') {
        const result = await runtime.search(parsed.query);
        writeEnvelope(result, stdout);
        return result.ok ? 0 : 1;
      }
      const request = { query: parsed.query, filters: { sources: parsed.sources, type: parsed.type, limit: parsed.limit, aliases: parsed.queryAliases }, adapterVersion: 'bycli-first-2' };
      const metadataCache = cache ?? new PublicMetadataCache({ cacheRoot: path.join(await realpath(tmpdir()), 'super-skill-manager-cache') });
      let sourceStops = [];
      const result = await metadataCache.getOrLoad(request, async () => {
        const catalog = await searchCatalog({
          queries: [parsed.query, ...parsed.queryAliases], limit: parsed.limit, sourceIds: parsed.sources, type: parsed.type,
          runner: (command, args, { timeoutMs, signal }) => runCommand({ command, args, timeoutMs, signal }),
        });
        const { sourceStops: stops, ...publicEnvelope } = catalog;
        sourceStops = stops;
        return publicEnvelope;
      }, { refresh: parsed.refresh, noCache: parsed.noCache });
      writeEnvelope(sourceStops.length ? { ...result, sourceStops } : result, stdout);
      return 0;
    }
    if (parsed.group === 'create' && parsed.action === 'install') {
      if (parsed.provider) {
        const provider = selectedProvider();
        if (!provider || typeof provider.preview !== 'function' || typeof provider.install !== 'function') {
          writeEnvelope(errorEnvelope({ source: 'manager', code: 'PROVIDER_UNAVAILABLE', message: 'The explicitly selected provider is unavailable.', elapsedMs: Math.round(performance.now() - startedAt) }), stdout);
          return 1;
        }
        if (!parsed.confirmed) {
          const preview = await provider.preview({
            operation: 'install',
            name: parsed.candidate,
            candidate: parsed.candidate,
            skillDirectory: parsed.target,
          });
          writeEnvelope(preview, stdout);
          return preview.ok ? 0 : 1;
        }
        if (!parsed.confirmationToken) {
          writeEnvelope(errorEnvelope({ source: 'manager', code: 'INVALID_CONFIRMATION', message: 'A preview confirmation token is required.', elapsedMs: Math.round(performance.now() - startedAt) }), stdout);
          return 1;
        }
        const result = await provider.install({
          candidate: parsed.candidate,
          name: parsed.candidate,
          preparedSource: parsed.target,
          confirmationToken: parsed.confirmationToken,
          riskConfirmationToken: parsed.riskConfirmationToken,
        });
        writeEnvelope(result, stdout);
        return result.ok ? 0 : 1;
      }
      if (typeof resolveInstallCandidate !== 'function') {
        writeEnvelope(errorEnvelope({ source: 'manager', code: 'CANDIDATE_UNAVAILABLE', message: 'A concrete local candidate source is required for secure install preview.', elapsedMs: Math.round(performance.now() - startedAt) }), stdout);
        return 1;
      }
      let resolved; let preview;
      try {
        resolved = await resolveInstallCandidate(parsed.candidate);
        preview = await createInstallPreview({ candidate: resolved?.candidate, skillDirectory: resolved?.skillDirectory });
      } catch {
        writeEnvelope(errorEnvelope({ source: 'manager', code: 'INSTALL_PREVIEW_FAILED', message: 'Install preview could not be created safely.', elapsedMs: Math.round(performance.now() - startedAt) }), stdout);
        return 1;
      }
      if (preview.security.status === 'malicious') {
        writeEnvelope(errorEnvelope({ source: 'manager', code: 'SECURITY_DENIED', message: 'Candidate was denied by local security screening.', data: [{ security: preview.security }], elapsedMs: Math.round(performance.now() - startedAt) }), stdout);
        return 1;
      }
      if (!parsed.confirmed) {
        if (!lifecycle?.issuePreview) {
          writeEnvelope(errorEnvelope({ source: 'manager', code: 'PREVIEW_UNAVAILABLE', message: 'Secure install lifecycle is unavailable.', elapsedMs: Math.round(performance.now() - startedAt) }), stdout);
          return 1;
        }
        const confirmationToken = await lifecycle.issuePreview({ operation: 'install', name: preview.target.name, id: preview.previewId, previewDigest: preview.previewId, sourceHash: preview.sourceHash, securityDigest: preview.securityDigest });
        writeEnvelope({ ok: true, source: 'manager', data: [{ ...preview, confirmationToken }], warnings: [], elapsedMs: Math.round(performance.now() - startedAt) }, stdout);
        return 0;
      }
      if (!lifecycle?.install || !parsed.confirmationToken) {
        writeEnvelope(errorEnvelope({ source: 'manager', code: 'INVALID_CONFIRMATION', message: 'A preview confirmation token is required.', elapsedMs: Math.round(performance.now() - startedAt) }), stdout);
        return 1;
      }
      const result = await lifecycle.install({
        name: preview.target.name, confirmed: true, previewToken: parsed.confirmationToken, confirmationToken: parsed.confirmationToken,
        previewId: preview.previewId, previewDigest: preview.previewId, sourceHash: preview.sourceHash, stage: resolved.stage, preparedSource: resolved.preparedSource, entry: resolved.entry,
        inspectStage: screenSkillDirectory,
      });
      writeEnvelope(result.committed ? { ok: true, source: 'manager', data: [result], warnings: [], elapsedMs: Math.round(performance.now() - startedAt) } : errorEnvelope({ source: 'manager', code: result.code ?? 'INSTALL_FAILED', message: result.message ?? 'Install did not complete.', data: [result], elapsedMs: Math.round(performance.now() - startedAt) }), stdout);
      return result.committed ? 0 : 1;
    }
    {
      const provider = selectedProvider();
      const method = {
        'create:scaffold': 'scaffold',
        'read:list': 'list', 'read:show': 'show', 'read:audit': 'audit', 'read:doctor': 'doctor',
        'update:upgrade': 'upgrade', 'update:repair': 'reset', 'update:enable': 'enable', 'update:disable': 'disable', 'update:pin': 'pin', 'update:unpin': 'unpin', 'delete:remove': 'remove',
      }[`${parsed.group}:${parsed.action}`];
      if (method && typeof provider?.[method] === 'function') {
        if (isMutation(parsed.group, parsed.action) && !parsed.confirmed) {
          if (typeof provider.preview !== 'function') {
            writeEnvelope(errorEnvelope({ source: 'manager', code: 'CONFIRMATION_REQUIRED', message: 'Mutating commands require --confirm.', elapsedMs: Math.round(performance.now() - startedAt) }), stdout);
            return 1;
          }
          const preview = await provider.preview({ operation: method, name: parsed.name });
          writeEnvelope(preview, stdout);
          return preview.ok ? 0 : 1;
        }
        const argument = isMutation(parsed.group, parsed.action)
          ? {
            name: parsed.name,
            trackedBy: await trackedByFor(provider, parsed.provider ?? 'openclaw', parsed.name),
            confirmationToken: parsed.confirmationToken,
            riskConfirmationToken: parsed.riskConfirmationToken,
          }
          : parsed.name;
        const result = await provider[method](argument);
        writeEnvelope(result, stdout);
        return result.ok ? 0 : 1;
      }
    }
    const elapsedMs = Math.round(performance.now() - startedAt);
    if (isMutation(parsed.group, parsed.action) && !parsed.confirmed) {
      writeEnvelope(
        errorEnvelope({
          source: 'manager',
          code: 'CONFIRMATION_REQUIRED',
          message: 'Mutating commands require --confirm.',
          elapsedMs,
        }),
        stdout,
      );
      return 1;
    }
    writeEnvelope(
      errorEnvelope({
        source: 'manager',
        code: 'NOT_IMPLEMENTED',
        message: 'Command parsing completed; operation execution is not implemented yet.',
        elapsedMs,
      }),
      stdout,
    );
    return 1;
  } catch (error) {
    const installPreviewFailure = parsed?.group === 'create' && parsed.action === 'install';
    writeEnvelope(
      errorEnvelope({
        source: 'manager',
        code: installPreviewFailure ? 'INSTALL_PREVIEW_FAILED' : 'INVALID_ARGUMENTS',
        message: installPreviewFailure ? 'Install preview could not be created safely.' : (error instanceof Error ? error.message : 'Invalid arguments.'),
        elapsedMs: Math.round(performance.now() - startedAt),
      }),
      stderr,
    );
    return 1;
  }
}

async function invokedAsMain() {
  if (!process.argv[1]) return false;
  try {
    const [entrypoint, modulePath] = await Promise.all([realpath(path.resolve(process.argv[1])), realpath(fileURLToPath(import.meta.url))]);
    return entrypoint === modulePath;
  } catch {
    return false;
  }
}

if (await invokedAsMain()) {
  main().then((code) => { process.exitCode = code; });
}
