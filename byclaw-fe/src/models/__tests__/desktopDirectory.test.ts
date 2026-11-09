import useAppStore from '../common/useAppStore';
const mockDirectory = jest.fn();
let mockTenant = 'tenant-a';
jest.mock('@/service/message', () => ({
  getSandboxInfo: (...args: any[]) => mockDirectory(...args),
  getContentFeedbackType: jest.fn(),
}));
jest.mock('@/service/system', () => ({ bathQryPropertyKey: jest.fn() }));
jest.mock('@/pages/manager/service/NotificationMgr', () => ({ getLatestVersionNotification: jest.fn() }));
jest.mock('@/utils/auth', () => ({
  getAuthSnapshot: () => ({ sessionId: 'same-credentials', token: '', ssoToken: '' }),
  getDesktopIdentitySnapshot: () => ({ account: 'account', enterpriseId: mockTenant }),
}));
beforeEach(() => {
  mockTenant = 'tenant-a';
  mockDirectory.mockReset();
  window.dispatchEvent(new Event('byclaw-auth-change'));
});
it('rejects old-tenant in-flight directory results even when credentials are unchanged', async () => {
  let resolve!: (rows: any[]) => void;
  mockDirectory.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  const first = useAppStore.getState().getSandboxesInfoUrl();
  mockTenant = 'tenant-b';
  window.dispatchEvent(new Event('byclaw-auth-change'));
  mockDirectory.mockResolvedValueOnce([{ sandboxId: 'b' }]);
  const second = useAppStore.getState().getSandboxesInfoUrl();
  resolve([{ sandboxId: 'a' }]);
  await expect(first).rejects.toThrow('AUTH_CHANGED');
  await expect(second).resolves.toEqual([{ sandboxId: 'b' }]);
  expect(useAppStore.getState().sandboxesInfo).toEqual([{ sandboxId: 'b' }]);
  expect(mockDirectory).toHaveBeenCalledTimes(2);
});
it('clears resolved authorized addresses when the principal changes', async () => {
  mockDirectory.mockResolvedValue([{ sandboxId: 'a', instanceEndpoints: { vnc: 'https://a/?token=old' } }]);
  await useAppStore.getState().getSandboxesInfoUrl();
  mockTenant = 'tenant-b';
  window.dispatchEvent(new Event('byclaw-auth-change'));
  expect(useAppStore.getState().sandboxesInfo).toEqual([]);
});
it('bounds a permanently pending request and allows a fresh manual retry', async () => {
  jest.useFakeTimers();
  try {
    mockDirectory.mockReturnValueOnce(new Promise(() => {}));
    const pending = useAppStore.getState().getSandboxesInfoUrl();
    const failure = expect(pending).rejects.toThrow('TIMEOUT');
    await jest.advanceTimersByTimeAsync(5000);
    await failure;
    mockDirectory.mockResolvedValueOnce([]);
    await expect(useAppStore.getState().getSandboxesInfoUrl()).resolves.toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

it('keeps the resolved directory visible during a shared refresh and removes stopped desktops after it', async () => {
  const running = [{ sandboxId: 'sandbox', status: 'RUNNING' }];
  mockDirectory.mockResolvedValueOnce(running);
  const store = useAppStore.getState();
  await store.getSandboxesInfoUrl();
  let finish!: (rows: unknown[]) => void;
  mockDirectory.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const pending = store.getSandboxesInfoUrl();
  expect(store.getSandboxesInfoUrl()).toBe(pending);
  expect(useAppStore.getState().sandboxesInfo).toEqual(running);
  finish([]);
  await pending;
  expect(useAppStore.getState().sandboxesInfo).toEqual([]);
});
