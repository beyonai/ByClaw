import { POST } from '@/service/common/request';
import { getAuthSnapshot, isCurrentAuthSnapshot } from '@/utils/auth';

export const MODEL_HEALTH_EVENT = 'byclaw:model-health';
export const MODEL_HEALTH_OPEN_EVENT = 'byclaw:model-health:open';

export type ModelHealthItem = {
  modelId: string | null;
  modelName: string | null;
  modelType: string;
  status: 'HEALTHY' | 'FAILED' | 'SKIPPED';
  errorCode?: string;
  endpoint?: string;
  httpStatus?: number;
  enabled?: boolean;
};
export type ModelHealthReport = {
  scope: 'PUBLIC' | 'PERSONAL';
  checkedAt: number;
  healthy: boolean;
  models: ModelHealthItem[];
  loginCheckedAt?: number;
  dismissed?: boolean;
  presented?: boolean;
  focusModelId?: string;
};
export type HealthUser = {
  userId?: string | number;
  id?: string | number;
  userCode?: string;
  enterpriseId?: string | number;
};

const scopeFor = (user: HealthUser) => (user.userCode?.toLowerCase() === 'adminvip' ? 'PUBLIC' : 'PERSONAL');
const cacheKey = (user: HealthUser, scope = scopeFor(user)) =>
  `${user.enterpriseId ?? ''}:${user.userId ?? user.id}:${scope}`;
// Render snapshots only. All persistence, merging, dismissal and probe deadlines live in Redis.
const snapshots = new Map<string, ModelHealthReport>();
const inFlight = new Map<string, Promise<ModelHealthReport | undefined>>();
const revisions = new Map<string, number>();
const deletedModelIds = new Set<string>();
const requestConfig = { timeout: 120000, responseCfg: { customHandle: true, hideErrorTips: true } };

async function api(action: string, params: Record<string, unknown>) {
  const response: any = await POST(`/byaiService/new/model/${action}`, params, {
    ...requestConfig,
    timeout: action === 'healthCheck' ? 120000 : 10000,
  });
  if (response?.code !== 0 || response?.success === false) throw new Error('CHECK_UNAVAILABLE');
  const report = response.data;
  if (
    ['healthCache', 'healthCheck', 'healthDebugComplete'].includes(action) &&
    report !== null &&
    report !== undefined &&
    (!Array.isArray(report.models) ||
      !['PUBLIC', 'PERSONAL'].includes(report.scope) ||
      typeof report.checkedAt !== 'number')
  )
    throw new Error('CHECK_UNAVAILABLE');
  return report;
}

function publish(
  user: HealthUser,
  scope: ModelHealthReport['scope'],
  report?: ModelHealthReport,
  options: { silent?: boolean } = {}
) {
  const current = snapshots.get(cacheKey(user, scope));
  if (report && current && current.checkedAt > report.checkedAt) return;
  if (report) snapshots.set(cacheKey(user, scope), report);
  else snapshots.delete(cacheKey(user, scope));
  window.dispatchEvent(
    new CustomEvent(MODEL_HEALTH_EVENT, {
      detail: {
        userId: user.userId ?? user.id,
        enterpriseId: user.enterpriseId,
        scope,
        report,
        silent: options.silent,
      },
    })
  );
}

/** Synchronous UI snapshot; use refreshCachedModelHealth on entry/focus to read Redis. */
export function getCachedModelHealth(user?: HealthUser, scope?: ModelHealthReport['scope']) {
  if (!user || (user.userId === undefined && user.id === undefined)) return undefined;
  return snapshots.get(cacheKey(user, scope));
}

/** Cache-only API: never invokes a model or changes the daily check deadline. */
export function refreshCachedModelHealth(user?: HealthUser, scope?: ModelHealthReport['scope']) {
  if (!user || (user.userId === undefined && user.id === undefined)) return Promise.resolve(undefined);
  const actualScope = scope || scopeFor(user);
  const key = cacheKey(user, actualScope);
  const requestKey = `${key}:read`;
  const pending = inFlight.get(requestKey);
  if (pending) return pending;
  const revision = revisions.get(key) || 0;
  const auth = getAuthSnapshot();
  const promise = api('healthCache', { scope: actualScope })
    .then((report) => {
      if (!isCurrentAuthSnapshot(auth) || revision !== (revisions.get(key) || 0))
        return getCachedModelHealth(user, actualScope);
      if (report && report.scope !== actualScope) return getCachedModelHealth(user, actualScope);
      publish(user, actualScope, report || undefined, { silent: true });
      return report || undefined;
    })
    .catch(() => getCachedModelHealth(user, actualScope))
    .finally(() => {
      if (inFlight.get(requestKey) === promise) inFlight.delete(requestKey);
    });
  inFlight.set(requestKey, promise);
  return promise;
}

export function openCachedModelHealth(user: HealthUser, scope: ModelHealthReport['scope'], modelId?: string) {
  window.dispatchEvent(
    new CustomEvent(MODEL_HEALTH_OPEN_EVENT, {
      detail: { userId: user.userId ?? user.id, enterpriseId: user.enterpriseId, scope, modelId },
    })
  );
}

/** The server confirms deletion before pruning Redis. No scans of browser storage. */
export async function removeCachedModelHealth(modelId: string | number) {
  if (modelId === undefined || modelId === null) return;
  const id = `${modelId}`;
  deletedModelIds.add(id);
  const auth = getAuthSnapshot();
  try {
    await api('healthRemoveDeleted', { id });
    if (!isCurrentAuthSnapshot(auth)) return;
    // Notify mounted consumers to reload their own authenticated Redis scope.
    window.dispatchEvent(new CustomEvent(MODEL_HEALTH_EVENT, { detail: { invalidated: true } }));
  } catch {
    // A later page entry/focus retries the authoritative read and confirmed-deletion pruning.
  }
}

export async function updateModelHealthNotice(user: HealthUser, report: ModelHealthReport, dismissed = false) {
  const key = cacheKey(user, report.scope);
  const current = snapshots.get(key);
  if (current?.checkedAt === report.checkedAt) snapshots.set(key, { ...current, presented: true, dismissed });
  try {
    await api('healthNotice', { scope: report.scope, checkedAt: report.checkedAt, dismissed });
  } catch {
    // Acknowledgement failure must not interrupt editing or navigation.
  }
}

/** Reuse the explicit debug call; Redis validates ownership and fences older in-flight checks. */
export async function runModelDebugWithHealth<T>(
  user: HealthUser | undefined,
  options: {
    modelId: string | number;
    modelName?: string;
    modelType?: string;
    scope: ModelHealthReport['scope'];
    signal?: AbortSignal;
  },
  request: () => Promise<T>
): Promise<T> {
  const auth = getAuthSnapshot();
  const key = user && cacheKey(user, options.scope);
  const id = `${options.modelId}`;
  const requestKey = `${key}:debug:${id}`;
  const revision = (revisions.get(requestKey) || 0) + 1;
  revisions.set(requestKey, revision);
  let ticket: number | undefined;
  if (user && key) {
    revisions.set(key, (revisions.get(key) || 0) + 1);
    try {
      ticket = await api('healthDebugBegin', { id });
    } catch {
      // Debug still works if Redis is unavailable.
    }
  }
  const record = async (success: boolean) => {
    if (
      !user ||
      !key ||
      ticket === undefined ||
      options.signal?.aborted ||
      !isCurrentAuthSnapshot(auth) ||
      revisions.get(requestKey) !== revision ||
      deletedModelIds.has(id)
    )
      return;
    revisions.set(key, (revisions.get(key) || 0) + 1);
    try {
      const report = await api('healthDebugComplete', { id, revision: ticket, success });
      if (isCurrentAuthSnapshot(auth) && revisions.get(requestKey) === revision && !deletedModelIds.has(id) && report)
        publish(user, options.scope, report);
    } catch {
      // Preserve the original debug result; cache refresh can recover later.
    }
  };
  try {
    const result = await request();
    await record(true);
    return result;
  } catch (error: any) {
    if (error?.name !== 'AbortError' && error?.code !== 'ERR_CANCELED') await record(false);
    throw error;
  }
}

export function modelHealthLocation(report: ModelHealthReport, item?: ModelHealthItem) {
  const target =
    item ||
    report.models.find((model) => model.status === 'FAILED' && model.modelId === report.focusModelId) ||
    report.models.find((model) => model.status === 'FAILED');
  const isPublic = report.scope === 'PUBLIC';
  const search = new URLSearchParams(isPublic ? {} : { tab: 'mine' });
  if (target?.modelId) search.set('healthModelId', target.modelId);
  const path = isPublic ? '/manager/systemParams/modal' : '/models';
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

/** Redis handles the 24-hour deadline; saving always probes the exact ID. */
export function checkModelHealth(
  user: HealthUser,
  options: { modelId?: string | number; scope?: ModelHealthReport['scope']; force?: boolean } = {}
): Promise<ModelHealthReport | undefined> {
  if (!user || (user.userId === undefined && user.id === undefined)) return Promise.resolve(undefined);
  const scope = options.scope || scopeFor(user);
  const key = cacheKey(user, scope);
  const requestKey = `${key}:${options.modelId ?? 'login'}`;
  if (!options.force && inFlight.has(requestKey)) return inFlight.get(requestKey)!;
  const revision = (revisions.get(requestKey) || 0) + 1;
  revisions.set(requestKey, revision);
  revisions.set(key, (revisions.get(key) || 0) + 1);
  if (options.modelId !== undefined) {
    const debugKey = `${key}:debug:${options.modelId}`;
    revisions.set(debugKey, (revisions.get(debugKey) || 0) + 1);
    revisions.set(`${key}:login`, (revisions.get(`${key}:login`) || 0) + 1);
  }
  const auth = getAuthSnapshot();
  const promise = (async () => {
    const report = await api('healthCheck', {
      ...(options.modelId === undefined ? {} : { id: `${options.modelId}` }),
      ...(options.force ? { force: true } : {}),
    });
    if (!isCurrentAuthSnapshot(auth) || revisions.get(requestKey) !== revision || !report) return undefined;
    if (options.modelId !== undefined && deletedModelIds.has(`${options.modelId}`)) return undefined;
    publish(user, report.scope, report);
    return report;
  })()
    .catch(() => undefined)
    .finally(() => {
      if (inFlight.get(requestKey) === promise) inFlight.delete(requestKey);
    });
  inFlight.set(requestKey, promise);
  return promise;
}
