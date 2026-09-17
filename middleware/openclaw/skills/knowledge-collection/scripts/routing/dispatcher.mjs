import { taskBudget, allocateBudget } from './budget.mjs';
import { artifactReceipt, validateArtifactReceipt } from './receipts.mjs';
import { registeredChannel } from './channels.mjs';
import { fail, fingerprint, loadSession, contextFingerprint, withRouteLock, readPlan, writePlan, routePlans } from './plan-store.mjs';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('INVALID_REQUEST');
}
function integer(value, fallback, max) {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < 1 || n > max) fail('INVALID_REQUEST');
  return n;
}
export function validateMailBindings(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) fail('INVALID_MAIL_BINDINGS');
  const refs = new Set();
  for (const binding of value) {
    keys(binding, ['ref', 'revision', 'kind', 'providerHint', 'accountId', 'capabilities', 'capabilityStatus']);
    if (!['browser', 'projected'].includes(binding.kind)) fail('INVALID_MAIL_BINDINGS');
    for (const field of ['ref', 'revision', ...(binding.kind === 'browser' ? ['providerHint'] : ['accountId'])]) {
      if (typeof binding[field] !== 'string' || !binding[field].trim() || binding[field].length > 256) fail('INVALID_MAIL_BINDINGS');
    }
    for (const field of ['providerHint', 'accountId']) if (binding[field] !== undefined
      && (typeof binding[field] !== 'string' || !binding[field].trim() || binding[field].length > 256)) fail('INVALID_MAIL_BINDINGS');
    if (binding.capabilities !== undefined && (!Array.isArray(binding.capabilities)
      || binding.capabilities.some(x => !['list', 'get', 'downloadAttachment'].includes(x)))) fail('INVALID_MAIL_BINDINGS');
    if (binding.capabilityStatus !== undefined) {
      keys(binding.capabilityStatus, ['list', 'get', 'downloadAttachment']);
      if (Object.values(binding.capabilityStatus).some(x => !['YES', 'NO', 'UNKNOWN', 'CONDITIONAL_AUTH', 'CONDITIONAL_PROVIDER'].includes(x))) fail('INVALID_MAIL_BINDINGS');
    }
    if (refs.has(binding.ref)) fail('INVALID_MAIL_BINDINGS');
    refs.add(binding.ref);
  }
  return structuredClone(value);
}
function normalize(request, session) {
  keys(request, ['schemaVersion', 'channel', 'operation', 'selector', 'criteria', 'budget', 'contentRequirement',
    'includeAttachments', 'candidateRefs', 'workflow', 'options', 'attempt', 'budgetMode']);
  for (const field of ['selector', 'criteria', 'budget', 'options']) {
    if (request[field] !== undefined && !object(request[field])) fail('INVALID_REQUEST');
  }
  if (request.schemaVersion !== 1 || !['discover', 'materialize', 'resource'].includes(request.operation)) fail('INVALID_REQUEST');
  registeredChannel(request.channel);
  if (!session.task.sourceScope?.includes(request.channel)) fail('SOURCE_NOT_AUTHORIZED');
  keys(request.selector || {}, ['accountContextRef', 'userSourceHint']);
  for (const value of Object.values(request.selector || {})) if (typeof value !== 'string' || value.length > 1024) fail('INVALID_REQUEST');
  keys(request.criteria || {}, ['query', 'timeRange', 'timezone']);
  const query = request.criteria?.query ?? session.task.query;
  if (typeof query !== 'string' || query.trim() !== session.task.query.trim()) fail('QUERY_CHANGED');
  if (request.criteria?.timeRange) {
    if (typeof request.criteria.timezone !== 'string' || !request.criteria.timezone) fail('INVALID_REQUEST');
    keys(request.criteria.timeRange, ['from', 'toExclusive']);
    const { from, toExclusive } = request.criteria.timeRange;
    if (typeof from !== 'string' || typeof toExclusive !== 'string'
      || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(toExclusive)) || Date.parse(from) >= Date.parse(toExclusive)) fail('INVALID_REQUEST');
  }
  if (request.criteria?.timezone !== undefined) {
    try { new Intl.DateTimeFormat('en', { timeZone: request.criteria.timezone }); } catch { fail('INVALID_REQUEST'); }
  }
  if (request.contentRequirement !== undefined && !['any', 'full-text'].includes(request.contentRequirement)) fail('INVALID_REQUEST');
  if (request.includeAttachments !== undefined && typeof request.includeAttachments !== 'boolean') fail('INVALID_REQUEST');
  if (request.attempt !== undefined && (typeof request.attempt !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(request.attempt))) fail('INVALID_REQUEST');
  keys(request.budget || {}, ['maxScannedItems', 'maxReturnedItems', 'timeoutMs', 'maxDownloadedBytes']);
  const budget = request.budget || {};
  const budgetMode = request.budgetMode || (request.channel === 'mail' ? 'strict' : 'workflow');
  if (!['strict', 'workflow'].includes(budgetMode) || (request.channel === 'mail' && budgetMode !== 'strict')
    || (request.channel !== 'mail' && request.budget !== undefined)) fail('UNSUPPORTED_BUDGET_CONTRACT');
  const normalized = { ...structuredClone(request), budgetMode, selector: request.selector || {}, criteria: { ...request.criteria, query },
    budget: { maxScannedItems: integer(budget.maxScannedItems, 200, 10000), maxReturnedItems: integer(budget.maxReturnedItems, 20, 500),
      timeoutMs: integer(budget.timeoutMs, 120000, 3600000), maxDownloadedBytes: integer(budget.maxDownloadedBytes, 100 * 1024 * 1024, 100 * 1024 * 1024) },
    contentRequirement: session.task.requiredContentGranularity === 'full-text' ? 'full-text' : request.contentRequirement || 'any',
    includeAttachments: request.includeAttachments === true };
  if (request.channel === 'mail') {
    if (request.workflow || request.options || request.operation === 'resource') fail('UNSUPPORTED_CAPABILITY');
    validateMailBindings(session.task.mailBindings);
    if (!session.task.mailBindings.some(b => b.ref === request.selector?.accountContextRef)) fail('ACCOUNT_SELECTION_REQUIRED');
  }
  if (request.operation === 'materialize') {
    if (!Array.isArray(request.candidateRefs) || !request.candidateRefs.length || request.candidateRefs.length > 500) fail('INVALID_REQUEST');
    const ids = new Set();
    for (const ref of request.candidateRefs) {
      keys(ref, ['skillItemId', 'revision']);
      if (typeof ref.skillItemId !== 'string' || typeof ref.revision !== 'string' || ids.has(ref.skillItemId)) fail('INVALID_REQUEST');
      ids.add(ref.skillItemId);
    }
  } else if (request.candidateRefs) fail('INVALID_REQUEST');
  return normalized;
}

export async function evaluateRoute(request, session, deps = {}) {
  const normalized = normalize(request, session);
  let capabilities;
  if (normalized.channel === 'mail') {
    capabilities = await registeredChannel(normalized.channel).describe(normalized, session, deps);
    if (capabilities.status !== 'complete') fail(capabilities.reasonCode || 'UNSUPPORTED_CAPABILITY');
    const required = normalized.operation === 'discover' ? ['list', 'boundedLocalScan', 'readFullText'] : ['readFullText'];
    if (normalized.contentRequirement === 'full-text') required.push('readFullText');
    if (normalized.includeAttachments) required.push('downloadAttachment');
    if (normalized.criteria.timeRange) required.push('timeFilter');
    if (required.some(key => capabilities.capabilities[key] !== 'supported')) fail('UNSUPPORTED_CAPABILITY');
  } else {
    capabilities = await registeredChannel(normalized.channel).describe(normalized, session, deps);
  }
  return { channel: normalized.channel, owner: registeredChannel(normalized.channel).owner,
    publicationOwner: registeredChannel(normalized.channel).publicationOwner, capabilities, request: normalized,
    contextFingerprint: contextFingerprint(session) };
}

function candidatesFor(paths, request, context) {
  if (request.operation !== 'materialize') return [];
  const plans = routePlans(paths).filter(p => p.contextFingerprint === context && p.request.channel === request.channel
    && p.request.operation === 'discover' && ['complete', 'partial'].includes(p.state)
    && fingerprint(p.request.selector) === fingerprint(request.selector) && fingerprint(p.request.criteria) === fingerprint(request.criteria));
  return request.candidateRefs.map(ref => {
    const sourcePlan = plans.find(p => (p.result?.candidates || []).some(item => item.skillItemId === ref.skillItemId && item.revision === ref.revision));
    if (sourcePlan) validateArtifactReceipt(paths, Object.fromEntries(Object.entries(sourcePlan.result.artifactHashes || {}).filter(([name]) => name.startsWith('raw/'))));
    const found = sourcePlan?.result.candidates.find(item => item.skillItemId === ref.skillItemId && item.revision === ref.revision);
    if (!found) fail('CANDIDATE_NOT_AUTHORIZED');
    return found;
  });
}

export async function resolveRoute(paths, request, deps = {}) {
  const session = loadSession(paths);
  const evaluated = await evaluateRoute(request, session, deps);
  const candidateItems = candidatesFor(paths, evaluated.request, evaluated.contextFingerprint);
  const planId = fingerprint({ request: evaluated.request, context: evaluated.contextFingerprint });
  return withRouteLock(paths, () => {
    if (contextFingerprint(loadSession(paths)) !== evaluated.contextFingerprint) fail('CONTEXT_CHANGED');
    const existing = routePlans(paths).find(p => p.planId === planId);
    if (existing) return existing;
    const now = Date.now();
    const taskDeadline = session.task.deadlineMinutes ? Date.parse(session.task.startedAt) + session.task.deadlineMinutes * 60000 : Infinity;
    const deadlineAt = new Date(Math.min(now + evaluated.request.budget.timeoutMs, taskDeadline)).toISOString();
    const sharedBudget = taskBudget(paths, evaluated.request, deadlineAt);
    const plan = { ...evaluated, planId, routeContractVersion: 1, state: 'planned', candidateItems, authorizationChannel: evaluated.channel, budgetOwner: evaluated.channel === 'mail' ? 'mail' : 'workflow',
      createdAt: new Date(now).toISOString(), deadlineAt: sharedBudget ? (Date.parse(sharedBudget.deadlineAt) < Date.parse(deadlineAt) ? sharedBudget.deadlineAt : deadlineAt) : deadlineAt };
    writePlan(paths, plan);
    return plan;
  });
}

export async function dispatchRoute(paths, planId, deps = {}) {
  if (!/^[a-f0-9]{64}$/.test(planId || '')) fail('INVALID_PLAN_ID');
  let session;
  const plan = withRouteLock(paths, () => {
    const current = reconcilePlan(paths, readPlan(paths, planId));
    session = loadSession(paths);
    if (contextFingerprint(session) !== current.contextFingerprint) fail('CONTEXT_CHANGED');
    if (fingerprint({ request: current.request, context: current.contextFingerprint }) !== planId
      || current.channel !== current.request.channel || current.authorizationChannel !== current.request.channel) fail('INVALID_PLAN');
    if (['complete', 'partial', 'failed', 'waiting-user'].includes(current.state)) return current;
    if (current.state === 'running') fail('ROUTE_IN_PROGRESS');
    if (routePlans(paths).some(p => p.planId !== planId && ['running', 'interrupted'].includes(p.state))) fail('SESSION_EXECUTION_ACTIVE');
    if (current.state === 'interrupted') fail('ROUTE_INTERRUPTED');
    if (Date.now() >= Date.parse(current.deadlineAt)) fail('ROUTE_DEADLINE_EXCEEDED');
    candidatesFor(paths, current.request, current.contextFingerprint);
    current.allocatedBudget = allocateBudget(paths, current);
    current.state = 'running'; current.executionRef = planId; current.pid = process.pid;
    writePlan(paths, current);
    return current;
  });
  if (plan.state !== 'running' || plan.result) {
    validateArtifactReceipt(paths, plan.result?.artifactHashes);
    if (deps.validateReceipt) await deps.validateReceipt(plan.result);
    if (plan.result?.publicationFingerprint
      && fingerprint(loadSession(paths).collection) !== plan.result.publicationFingerprint) fail('ROUTE_RECEIPT_STALE');
    return plan.result;
  }
  let result;
  try {
    const execute = deps.execute || registeredChannel(plan.channel).execute;
    result = await execute(paths, plan, session, deps);
    if (!object(result) || !['complete', 'partial', 'failed', 'needs-user-action'].includes(result.status)) fail('INVALID_EXECUTOR_RESPONSE');
    if (result.publicationFingerprint) result.artifactHashes = artifactReceipt(paths, loadSession(paths));
  } catch {
    result = { ok: false, status: 'interrupted', errors: [{ code: 'EXECUTION_INTERRUPTED' }], executionRef: plan.executionRef };
  }
  return withRouteLock(paths, () => {
    const current = readPlan(paths, planId);
    if (current.state !== 'running') fail('ROUTE_STATE_CONFLICT');
    current.state = result.status === 'needs-user-action' ? 'waiting-user' : result.status;
    current.result = result;
    current.finishedAt = new Date().toISOString();
    writePlan(paths, current);
    return result;
  });
}

export function reconcilePlan(paths, plan) {
  if (plan.state !== 'running' || !Number.isSafeInteger(plan.pid) || plan.pid < 1) return plan;
  try { process.kill(plan.pid, 0); }
  catch (error) {
    if (error.code === 'ESRCH') {
      plan.state = 'interrupted';
      plan.result = { status: 'interrupted', executionRef: plan.executionRef, errors: [{ code: 'EXECUTION_OWNER_EXITED' }] };
      writePlan(paths, plan);
    }
  }
  return plan;
}

export function routeStatus(paths, planId) {
  return withRouteLock(paths, () => reconcilePlan(paths, readPlan(paths, planId)));
}
