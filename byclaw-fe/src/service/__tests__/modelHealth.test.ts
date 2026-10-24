import { POST } from '@/service/common/request';
import { isCurrentAuthSnapshot } from '@/utils/auth';
import {
  checkModelHealth,
  refreshCachedModelHealth,
  getCachedModelHealth,
  removeCachedModelHealth,
  runModelDebugWithHealth,
  updateModelHealthNotice,
  modelHealthLocation,
  MODEL_HEALTH_EVENT,
} from '../modelHealth';

jest.mock('@/service/common/request', () => ({ POST: jest.fn() }));
jest.mock('@/utils/auth', () => ({ getAuthSnapshot: () => ({}), isCurrentAuthSnapshot: jest.fn(() => true) }));
const post = POST as jest.Mock;
let user = { userId: 0, userCode: 'alice', enterpriseId: 1 };
const failed = () => ({
  scope: 'PERSONAL' as const,
  checkedAt: Date.now(),
  loginCheckedAt: 100,
  healthy: false,
  presented: true,
  dismissed: true,
  models: [
    { modelId: '42', modelName: 'My model', modelType: 'LLM', status: 'FAILED' as const, errorCode: 'AUTH_FAILED' },
  ],
});

beforeEach(() => {
  post.mockReset();
  (isCurrentAuthSnapshot as jest.Mock).mockReturnValue(true);
  user = { ...user, userId: user.userId + 1 };
});

it('loads Redis on entry without probing and ignores legacy localStorage records', async () => {
  localStorage.setItem(`byclaw:model-health:v3:1:${user.userId}:PERSONAL`, JSON.stringify(failed()));
  const report = { ...failed(), models: [] };
  post.mockResolvedValue({ code: 0, data: report });
  expect(await refreshCachedModelHealth(user, 'PERSONAL')).toEqual(report);
  expect(getCachedModelHealth(user)).toEqual(report);
  expect(post).toHaveBeenCalledWith(expect.stringMatching(/healthCache$/), { scope: 'PERSONAL' }, expect.any(Object));
  localStorage.clear();
});

it.each([true, false])('delegates the daily deadline to Redis for healthy=%s', async (healthy) => {
  const report = { ...failed(), healthy };
  post.mockResolvedValue({ code: 0, data: report });
  await checkModelHealth(user);
  await checkModelHealth(user);
  expect(post).toHaveBeenCalledTimes(2);
  expect(post).toHaveBeenLastCalledWith(expect.stringMatching(/healthCheck$/), {}, expect.any(Object));
});

it('deduplicates concurrent login requests within the current window', async () => {
  let resolve!: (response: any) => void;
  post.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const first = checkModelHealth(user);
  const second = checkModelHealth(user);
  expect(post).toHaveBeenCalledTimes(1);
  resolve({ code: 0, data: failed() });
  expect(await first).toEqual(await second);
});

it('always forces the saved ID and trusts the merged authoritative report without extending its deadline', async () => {
  const report = {
    ...failed(),
    focusModelId: '43',
    models: [...failed().models, { ...failed().models[0], modelId: '43' }],
  };
  post.mockResolvedValue({ code: 0, data: report });
  await checkModelHealth(user, { modelId: '43', force: true });
  await checkModelHealth(user, { modelId: '43', force: true });
  expect(post).toHaveBeenCalledTimes(2);
  expect(post).toHaveBeenLastCalledWith(
    expect.stringMatching(/healthCheck$/),
    { id: '43', force: true },
    expect.any(Object)
  );
  expect(getCachedModelHealth(user)).toEqual(report);
  expect(getCachedModelHealth(user)?.loginCheckedAt).toBe(100);
});

it('persists notice acknowledgement in Redis without sending model fields or credentials', async () => {
  const report = failed();
  post.mockResolvedValue({ code: 0, data: report });
  await refreshCachedModelHealth(user);
  await updateModelHealthNotice(user, report, true);
  expect(post).toHaveBeenLastCalledWith(
    expect.stringMatching(/healthNotice$/),
    { scope: 'PERSONAL', checkedAt: report.checkedAt, dismissed: true },
    expect.any(Object)
  );
});

it.each([true, false])('records debug success=%s with a server-issued revision and no extra probe', async (success) => {
  const report = failed();
  post.mockResolvedValueOnce({ code: 0, data: 7 }).mockResolvedValueOnce({ code: 0, data: report });
  const request = jest.fn(async () => {
    if (!success) throw new Error('secret-provider-response');
    return 'OK';
  });
  const debug = runModelDebugWithHealth(user, { modelId: '42', scope: 'PERSONAL' }, request);
  if (success) await expect(debug).resolves.toBe('OK');
  else await expect(debug).rejects.toThrow('secret-provider-response');
  expect(request).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenLastCalledWith(
    expect.stringMatching(/healthDebugComplete$/),
    { id: '42', revision: 7, success },
    expect.any(Object)
  );
  expect(post.mock.calls.some(([url]) => url.endsWith('/healthCheck'))).toBe(false);
  expect(JSON.stringify(post.mock.calls)).not.toContain('secret-provider-response');
  expect(getCachedModelHealth(user)).toEqual(report);
});

it.each(['abort', 'logout', 'delete'] as const)('does not persist a debug result after %s', async (reason) => {
  post.mockResolvedValue({ code: 0, data: 7 });
  const controller = new AbortController();
  await expect(
    runModelDebugWithHealth(
      user,
      { modelId: `gone-${reason}`, scope: 'PERSONAL', signal: controller.signal },
      async () => {
        if (reason === 'abort') controller.abort();
        if (reason === 'logout') (isCurrentAuthSnapshot as jest.Mock).mockReturnValue(false);
        if (reason === 'delete') await removeCachedModelHealth(`gone-${reason}`);
        throw new Error('failed');
      }
    )
  ).rejects.toThrow('failed');
  expect(post.mock.calls.some(([url]) => url.endsWith('/healthDebugComplete'))).toBe(false);
});

it('does not let an old Redis read replace a newer saved check', async () => {
  let resolve!: (response: any) => void;
  post.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const read = refreshCachedModelHealth(user);
  const fresh = { ...failed(), checkedAt: 9999999999999, healthy: true, models: [] };
  post.mockResolvedValueOnce({ code: 0, data: fresh });
  await checkModelHealth(user, { force: true, modelId: '42' });
  resolve({ code: 0, data: failed() });
  await read;
  expect(getCachedModelHealth(user)).toEqual(fresh);
});

it('removes confirmed-deleted records through Redis and signals mounted consumers to reload', async () => {
  post.mockResolvedValue({ code: 0, data: true });
  const listener = jest.fn();
  window.addEventListener(MODEL_HEALTH_EVENT, listener);
  try {
    await removeCachedModelHealth('deleted-42');
    expect(post).toHaveBeenCalledWith(
      expect.stringMatching(/healthRemoveDeleted$/),
      { id: 'deleted-42' },
      expect.any(Object)
    );
    expect(listener.mock.calls[0][0].detail).toEqual({ invalidated: true });
  } finally {
    window.removeEventListener(MODEL_HEALTH_EVENT, listener);
  }
});

it.each([{ code: -1, data: null, success: false }, { code: 0, success: false }, null])(
  'does not convert a failed endpoint response into a healthy cache',
  async (response) => {
    post.mockResolvedValue(response);
    expect(await checkModelHealth(user)).toBeUndefined();
    expect(getCachedModelHealth(user)).toBeUndefined();
  }
);

it('does not publish a request belonging to a previous authenticated session', async () => {
  post.mockImplementation(async () => {
    (isCurrentAuthSnapshot as jest.Mock).mockReturnValue(false);
    return { code: 0, data: failed() };
  });
  expect(await checkModelHealth(user)).toBeUndefined();
  expect(getCachedModelHealth(user)).toBeUndefined();
});

it('routes the exact saved model to its editable scope', () => {
  expect(modelHealthLocation({ ...failed(), focusModelId: '42' })).toBe('/models?tab=mine&healthModelId=42');
  expect(modelHealthLocation({ ...failed(), scope: 'PUBLIC' })).toBe('/manager/systemParams/modal?healthModelId=42');
});
