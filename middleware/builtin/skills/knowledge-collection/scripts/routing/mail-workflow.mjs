import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execute } from '../../../mail/scripts/collection-facade.mjs';
import { createArtifactWriter } from '../enterprise/shared/artifact-writer.mjs';
import { removeSensitiveFields, sanitizeSensitive } from '../enterprise/shared/secret-sanitizer.mjs';
import { assertExternalSessionWriteAllowed } from '../probe-state.mjs';
import { fail, fingerprint, contextFingerprint, loadSession } from './plan-store.mjs';

function attachmentBytes(root, attachment) {
  if (typeof attachment.path !== 'string') fail('INVALID_ATTACHMENT');
  const target = path.resolve(attachment.path);
  if (!target.startsWith(`${root}${path.sep}`)) fail('UNSAFE_ATTACHMENT_PATH');
  let current = root;
  for (const segment of path.relative(root, target).split(path.sep)) {
    current = path.join(current, segment);
    if (fs.lstatSync(current).isSymbolicLink()) fail('UNSAFE_ATTACHMENT_PATH');
  }
  const handle = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(handle);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 25 * 1024 * 1024
      || stat.size !== attachment.size) fail('INVALID_ATTACHMENT');
    const bytes = fs.readFileSync(handle);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== attachment.sha256) fail('INVALID_ATTACHMENT');
    return bytes;
  } finally { fs.closeSync(handle); }
}

export async function runMailWorkflow(paths, plan, session, deps = {}) {
  assertExternalSessionWriteAllowed(paths, 'route-mail');
  const before = fingerprint(session.collection);
  const downloadRoot = path.join(paths.root, '.routing', 'mail-downloads');
  const { attempt: _attempt, budgetMode: _budgetMode, ...request } = plan.request;
  request.budget = plan.allocatedBudget || request.budget;
  const envelope = removeSensitiveFields(await (deps.executeMail || execute)(request, {
    sessionDir: paths.root, downloadRoot, mailBindings: session.task.mailBindings,
    candidates: plan.candidateItems, deadlineAt: plan.deadlineAt,
  }, deps.mailDependencies || {}));
  if (envelope?.channel !== 'mail' || envelope.sourceSkill !== 'mail' || envelope.operation !== request.operation
    || !['complete', 'partial', 'failed', 'needs-user-action'].includes(envelope.status)
    || !Array.isArray(envelope.items)) fail('INVALID_EXECUTOR_RESPONSE');
  const current = loadSession(paths);
  if (contextFingerprint(current) !== plan.contextFingerprint || fingerprint(current.collection) !== before) fail('CONTEXT_CHANGED');
  const writer = await createArtifactWriter(paths.root, { allowExistingSession: true, allowFailed: true });
  try {
    const rawPath = `raw/mail/${plan.planId}.json`;
    await writer.writeJson(rawPath, envelope);
    const oldItems = current.collection?.collection?.items || [];
    // Selected materialization narrows the current mail selection; original
    // discovery evidence and candidate grants remain in their route receipt.
    let inventory = oldItems.filter(item => !(request.operation === 'materialize'
      && session.task.materializationTarget === 'selected' && item.sourceSkill === 'mail'
      && item.accountContextRef === request.selector.accountContextRef && item.materialization.status !== 'materialized'));
    const priorCanonical = fs.existsSync(paths.collectionResult)
      ? JSON.parse(fs.readFileSync(paths.collectionResult, 'utf8')).items || [] : [];
    const canonical = new Map(priorCanonical.map(item => [item.fileName, item]));
    let incompleteAttachments = false;
    for (const item of envelope.items) {
      if (!/^[a-f0-9]{64}$/.test(item.skillItemId) || item.accountContextRef !== request.selector.accountContextRef
        || typeof item.revision !== 'string') fail('INVALID_EXECUTOR_RESPONSE');
      const itemId = `mail-${item.skillItemId.slice(0, 48)}`;
      const existing = inventory.find(row => row.itemId === itemId);
      if (existing?.materialization.sanitizedPath) canonical.delete(existing.materialization.sanitizedPath);
      inventory = inventory.filter(row => row.itemId !== itemId);
      const base = `items/${itemId}/${plan.planId.slice(0, 16)}`;
      const full = item.bodyStatus === 'complete' && item.contentGranularity === 'full-text' && typeof item.body === 'string' && item.body.trim();
      const attachments = [];
      for (const [index, attachment] of (item.attachments || []).entries()) {
        const record = { ...attachment, parsingStatus: 'not-requested' };
        delete record.path;
        if (request.includeAttachments && attachment.status === 'complete') {
          try {
            const bytes = attachmentBytes(downloadRoot, attachment);
            const relative = `sanitized/${base}/assets/attachments/${index}.bin`;
            await writer.writeBytes(relative, bytes);
            record.localPath = relative;
          } catch {
            record.status = 'failed'; record.error = { code: 'ATTACHMENT_VALIDATION_FAILED' }; incompleteAttachments = true;
          }
        } else if (request.includeAttachments) incompleteAttachments = true;
        attachments.push(record);
      }
      const markdownPath = full ? `markdown/${base}/index.md` : null;
      const sanitizedPath = full ? `sanitized/${base}/index.md` : null;
      if (full) {
        // Mail is untrusted content: keep it as inert text, never follow its links.
        const text = sanitizeSensitive(item.body);
        let fenceLength = 3;
        for (const match of text.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, match[0].length + 1);
        const fence = '`'.repeat(fenceLength);
        const body = `${fence}text\n${text}\n${fence}\n`;
        await writer.writeText(markdownPath, body);
        await writer.writeText(sanitizedPath, body);
        canonical.set(sanitizedPath, { title: item.title || '(无主题)', url: item.sourceUrl, author: item.from || '',
          publishTime: item.date || '', markdown: sanitizedPath, fileName: sanitizedPath });
      }
      inventory.push({ itemId, title: item.title || '(无主题)', sourceSkill: 'mail', sourceUrl: item.sourceUrl,
        accountContextRef: item.accountContextRef, skillItemId: item.skillItemId, revision: item.revision,
        provenance: { provider: item.provider, backend: item.backend, identityVerified: item.identityVerified },
        attachmentsRequested: request.includeAttachments, attachments, rawArtifacts: [rawPath],
        media: { coverStatus: 'not-present', coverCount: 0, materializedCoverCount: 0, reason: null },
        materialization: { status: full ? 'materialized' : item.bodyStatus === 'failed' ? 'failed' : 'pending',
          markdownPath, sanitizedPath, contentGranularity: full ? 'full-text' : 'unknown' } });
    }
    const failed = ['failed', 'needs-user-action'].includes(envelope.status);
    const outcomes = (current.collection?.sourceMetadata?.mail?.outcomes || []).filter(outcome =>
      outcome.accountContextRef !== request.selector.accountContextRef || outcome.operation !== request.operation);
    outcomes.push({ accountContextRef: request.selector.accountContextRef, operation: request.operation,
      status: envelope.status,
      coverage: envelope.coverage, errors: envelope.errors, executionRef: plan.planId });
    const inheritedStatus = current.collection?.sourceMetadata?.mail?.inheritedStatus
      || (current.task.publicationStatus === 'committed' && current.task.status !== 'initialized' && !current.collection?.sourceMetadata?.mail
        ? current.collection?.collection?.status : null);
    const unresolved = outcomes.some(outcome => outcome.status !== 'complete')
      || Boolean(inheritedStatus && inheritedStatus !== 'complete');
    await writer.writeCollectionBundle({ title: session.task.query, source: 'mail', backend: 'mail', url: 'mail://collection',
      filters: request.criteria, sourceScope: ['mail'], materializationTarget: session.task.materializationTarget,
      metadataOnly: request.operation === 'discover' && session.task.materializationTarget === 'candidates',
      discoverySucceeded: !failed || inventory.some(item => item.materialization.status === 'materialized'),
      paginationFailed: unresolved || inventory.some(item => item.attachmentsRequested
        && (item.attachments || []).some(attachment => attachment.status !== 'complete')),
      inventory, canonicalItems: [...canonical.values()].filter(row => inventory.some(item => item.materialization.sanitizedPath === row.fileName)),
      sourceMetadata: { ...current.collection?.sourceMetadata, mail: { outcomes, inheritedStatus, coverage: envelope.coverage, errors: envelope.errors,
        operation: request.operation, status: envelope.status, executionRef: plan.planId, attachmentsComplete: !incompleteAttachments } },
    });
    const published = loadSession(paths);
    return { status: incompleteAttachments && envelope.status === 'complete' ? 'partial' : envelope.status,
      channel: 'mail', candidates: envelope.items, coverage: envelope.coverage, errors: envelope.errors, usage: envelope.usage,
      executionRef: plan.planId, publicationFingerprint: fingerprint(published.collection) };
  } catch (error) { await writer.abort(); throw error; }
}
