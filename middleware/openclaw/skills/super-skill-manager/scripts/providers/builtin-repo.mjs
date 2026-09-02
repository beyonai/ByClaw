import path from 'node:path';
import { readdir, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { errorEnvelope, successEnvelope } from '../core/envelope.mjs';
import { resolveManagedRoot, resolveSkillTarget, validateSkillName } from '../core/paths.mjs';
import { createInstallPreview, screenSkillDirectory } from '../core/security.mjs';
import { createSkillLifecycle } from '../core/transaction.mjs';

const SOURCE = 'builtin-repo';
const MUTATIONS = new Set(['install', 'remove', 'restore']);

function error(code, message) {
  return errorEnvelope({ source: SOURCE, code, message });
}

function lifecycleResult(result) {
  if (result.committed) return successEnvelope({ source: SOURCE, data: [result] });
  return errorEnvelope({
    source: SOURCE,
    code: result.code ?? 'TRANSACTION_FAILED',
    message: result.message ?? 'Builtin repository transaction did not complete.',
    data: [result],
  });
}

function localCandidate(name) {
  return {
    name,
    source: 'https://builtin.invalid/middleware/openclaw/skills',
    ref: 'builtin',
    trustedAudit: 'pass',
    repositoryAgeDays: 365,
  };
}

function configuredRoots(repositoryRoot) {
  if (typeof repositoryRoot !== 'string' || !path.isAbsolute(repositoryRoot) || /[\0*?{}$]/u.test(repositoryRoot)) {
    throw new TypeError('Repository root must be an absolute concrete path.');
  }
  const repository = path.resolve(repositoryRoot);
  const openclawRoot = path.join(repository, 'middleware', 'openclaw');
  return {
    openclawRoot,
    skillsRoot: path.join(openclawRoot, 'skills'),
    registryPath: path.join(openclawRoot, 'skills-registry.json'),
  };
}

async function regularSkillNames(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const names = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    try { validateSkillName(entry.name); } catch { continue; }
    names.push(entry.name);
  }
  return names.sort((left, right) => left.localeCompare(right));
}

export function createBuiltinRepoProvider({ repositoryRoot = path.resolve(fileURLToPath(new URL('../../../../../../', import.meta.url))), lifecycle: suppliedLifecycle } = {}) {
  const configured = configuredRoots(repositoryRoot);
  const lifecycle = suppliedLifecycle ?? createSkillLifecycle({
    managedRoot: configured.skillsRoot,
    openclawRoot: configured.openclawRoot,
    registryPath: configured.registryPath,
  });

  async function root() {
    const canonical = await resolveManagedRoot(configured.skillsRoot);
    if (path.dirname(canonical) !== await realpath(configured.openclawRoot)) {
      throw new TypeError('Builtin skills root must be the canonical middleware/openclaw/skills directory.');
    }
    return canonical;
  }

  async function resolve(name, options) {
    return resolveSkillTarget(await root(), name, options);
  }

  async function resolveRead(name) {
    return resolveSkillTarget(await root(), name, { allowMissing: false, allowProtectedRead: true });
  }

  async function preview({ operation, name, skillDirectory, trashPath } = {}) {
    if (!MUTATIONS.has(operation)) throw new TypeError('Builtin repository operation is invalid.');
    await resolve(name, { allowMissing: operation === 'install' || operation === 'restore' });
    if (operation === 'install') {
      if (typeof skillDirectory !== 'string') throw new TypeError('A concrete skill directory is required for an install preview.');
      const installPreview = await createInstallPreview({ candidate: localCandidate(name), skillDirectory });
      if (installPreview.security.status === 'malicious') {
        return error('SECURITY_DENIED', 'Candidate was denied by local security screening.');
      }
      const confirmationToken = await lifecycle.issuePreview({
        operation,
        name,
        sourceHash: installPreview.sourceHash,
        securityDigest: installPreview.securityDigest,
      });
      return successEnvelope({ source: SOURCE, data: [{ ...installPreview, confirmationToken }] });
    }
    const confirmationToken = await lifecycle.issuePreview({ operation, name, trashPath });
    return successEnvelope({ source: SOURCE, data: [{ operation, name, confirmationToken, requiresConfirmation: true }] });
  }

  async function install({ name, confirmationToken, preparedSource, stage, entry } = {}) {
    await resolve(name);
    if (typeof confirmationToken !== 'string' || !confirmationToken) return error('INVALID_CONFIRMATION', 'A preview confirmation token is required.');
    return lifecycleResult(await lifecycle.install({
      name,
      confirmed: true,
      confirmationToken,
      previewToken: confirmationToken,
      preparedSource,
      stage,
      entry: entry ?? { sourceType: 'scaffold', source: SOURCE, ref: null, dependencies: [] },
      inspectStage: screenSkillDirectory,
    }));
  }

  async function remove({ name, confirmationToken } = {}) {
    await resolve(name, { allowMissing: false });
    if (typeof confirmationToken !== 'string' || !confirmationToken) return error('INVALID_CONFIRMATION', 'A preview confirmation token is required.');
    return lifecycleResult(await lifecycle.remove({ name, confirmed: true, confirmationToken, previewToken: confirmationToken }));
  }

  async function restore({ name, trashPath, confirmationToken } = {}) {
    await resolve(name);
    if (typeof confirmationToken !== 'string' || !confirmationToken) return error('INVALID_CONFIRMATION', 'A preview confirmation token is required.');
    return lifecycleResult(await lifecycle.restore({ name, trashPath, confirmed: true, confirmationToken, previewToken: confirmationToken }));
  }

  return {
    async list() {
      const skillsRoot = await root();
      return successEnvelope({ source: SOURCE, data: (await regularSkillNames(skillsRoot)).map((name) => ({ name, source: SOURCE, installed: true })) });
    },
    async show(name) {
      await resolveRead(name);
      return successEnvelope({ source: SOURCE, data: [{ name, source: SOURCE, installed: true }] });
    },
    async audit(name) {
      const target = await resolveRead(name);
      return successEnvelope({ source: SOURCE, data: [await screenSkillDirectory(target)] });
    },
    async doctor() {
      await root();
      return successEnvelope({ source: SOURCE, data: [{ status: 'ok' }] });
    },
    resolve,
    preview,
    install,
    remove,
    restore,
  };
}
