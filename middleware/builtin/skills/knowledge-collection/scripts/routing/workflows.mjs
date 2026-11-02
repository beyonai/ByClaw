import { fail, fingerprint, loadSession } from './plan-store.mjs';
import { parseSearchRequest, parseMaterializeRequest } from '../enterprise/dispatcher.mjs';

const publicOptions = {
  'public-discover': ['category', 'language', 'pageno', 'max-results', 'requested-count', 'timeout', 'time-range', 'tiers', 'limit'],
  'public-collect': ['fallback-query', 'requested-count', 'category', 'language', 'manual-policy'],
  'unified-search': ['project-id', 'cloud-resource-id', 'limit', 'concurrency'],
  'unified-materialize': ['concurrency'],
};

export function evaluateWorkflow(request, session) {
  // Existing workflows own limit, concurrency, timeout and usage. Do not falsely
  // promise the new strict budget contract for executors that cannot report it.
  if (request.budgetMode !== 'workflow') fail('UNSUPPORTED_BUDGET_CONTRACT');
  if (Object.keys(request.selector).length || request.criteria.timeRange || request.criteria.timezone
    || request.includeAttachments) fail('UNSUPPORTED_CAPABILITY');
  const options = Object.fromEntries(Object.entries(request.options || {}).map(([key, value]) => [key, typeof value === 'number' ? String(value) : value]));
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.values(options).some(v => !['string', 'number', 'boolean'].includes(typeof v))) fail('INVALID_REQUEST');
  if (request.channel === 'public-internet') {
    const allowed = publicOptions[request.workflow];
    if (!allowed || Object.keys(options).some(k => !allowed.includes(k))) fail('UNSUPPORTED_WORKFLOW');
    if ((request.operation === 'materialize') !== (request.workflow === 'unified-materialize')
      || request.operation === 'resource') fail('UNSUPPORTED_CAPABILITY');
    if (request.workflow.startsWith('unified-') && !session.task.sourceScope.includes('cloud-knowledge')) fail('SOURCE_NOT_AUTHORIZED');
    if (request.workflow === 'unified-search' && session.task.concurrency < 2) fail('UNSUPPORTED_CONCURRENCY');
    if (request.workflow === 'public-collect' && session.task.workflow !== 'public-collect') fail('WORKFLOW_OWNER_MISMATCH');
    if (session.task.workflow === 'public-collect' && request.workflow !== 'public-collect') fail('WORKFLOW_OWNER_MISMATCH');
    if (request.workflow === 'public-collect' && (!options['fallback-query'] || !options['requested-count'])) fail('INVALID_REQUEST');
  } else {
    if (request.workflow !== undefined || request.operation === 'resource') fail('UNSUPPORTED_CAPABILITY');
    if (['source', 'query', 'output-dir', 'session-dir', 'parent-session-dir', 'item-ids', 'cursor', 'help'].some(k => k in options)) fail('INVALID_REQUEST');
    const native = { ...options, source: request.channel, 'output-dir': '/placeholder', query: request.criteria.query };
    if (request.operation === 'discover') parseSearchRequest(native);
    else parseMaterializeRequest({ ...options, source: request.channel, 'session-dir': '/placeholder', 'output-dir': '/placeholder', 'item-ids': 'placeholder' });
  }
  if (options.concurrency !== undefined && Number(options.concurrency) > session.task.concurrency) fail('BUDGET_EXCEEDED');
  return { status: 'complete', budgetOwner: 'workflow', usage: 'unknown', transparentResume: 'unsupported' };
}

export async function executeRouteWorkflow(paths, plan, session, deps) {
  const request = plan.request;
  const options = { ...Object.fromEntries(Object.entries(request.options || {}).map(([key, value]) => [key, typeof value === 'number' ? String(value) : value])), query: request.criteria.query };
  const candidates = session.collection?.collection?.items || [];
  const ids = (request.candidateRefs || []).map(ref => {
    const candidate = candidates.find(item => item.itemId === ref.skillItemId);
    if (!candidate || fingerprint(candidate) !== ref.revision) fail('CANDIDATE_NOT_AUTHORIZED');
    return candidate.itemId;
  });
  let outcome;
  if (request.channel === 'public-internet') {
    const { executeWorkflowCommand } = await import('../command-router.mjs');
    outcome = await executeWorkflowCommand(request.workflow, { ...options, 'session-dir': paths.root,
      ...(ids.length ? { 'item-ids': ids.join(',') } : {}) });
  } else {
    const { executeEnterpriseWorkflow } = await import('../enterprise-collection.mjs');
    if (options.concurrency === undefined) options.concurrency = String(session.task.concurrency || 2);
    if (request.operation === 'materialize') delete options.query;
    outcome = await executeEnterpriseWorkflow(request.operation === 'discover' ? 'search' : 'materialize', {
      ...options, source: request.channel, 'output-dir': paths.root,
      ...(request.operation === 'discover' ? { 'parent-session-dir': paths.root } : { 'session-dir': paths.root }),
      ...(ids.length ? { 'item-ids': ids.join(',') } : {}),
    }, deps.enterpriseOptions || {});
  }
  const current = loadSession(paths);
  const status = outcome?.status || current.collection?.collection?.status;
  const mapped = normalizeWorkflowStatus(outcome, status);
  return { status: mapped, workflowResult: outcome, usage: 'unknown', budgetOwner: 'workflow',
    publicationFingerprint: fingerprint(current.collection),
    candidates: (current.collection?.collection?.items || []).map(item => ({ skillItemId: item.itemId, revision: fingerprint(item) })) };
}

export function normalizeWorkflowStatus(outcome, fallback) {
  const status = outcome?.status || fallback;
  if (['complete', 'partial', 'failed', 'needs-user-action'].includes(status)) return outcome?.ok === false && status === 'complete' ? 'failed' : status;
  if (['paused-user-action', 'infrastructure-blocked'].includes(status)) return 'needs-user-action';
  if (['unsupported', 'unavailable', 'auth-required', 'permission-denied'].includes(status) || outcome?.ok === false) return 'failed';
  return 'partial';
}
