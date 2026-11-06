import { act, renderHook } from '@testing-library/react';
import { useOperationAccountLogin } from '../useOperationAccountLogin';
import useVncOpener from '@/hooks/useVncOpener';
import { useDesktopWorkspace } from '@/utils/desktopWorkspace';
const mockEmit = jest.fn();
let mockIdentity = 'tenant';
const mockEmitter = { emit: mockEmit };
const mockCache = jest.fn();
const mockList = jest.fn();
const mockNavigate = jest.fn();
const mockConfirm = jest.fn();
const mockMessage = { success: jest.fn(), warning: jest.fn(), error: jest.fn() };
jest.mock('antd', () => ({ App: { useApp: () => ({ message: mockMessage }) } }));
jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: any) => id }),
  useSelector: () => ({ userCode: 'user' }),
}));
jest.mock('@/hooks/useGlobal', () => () => ({ EventEmitter: mockEmitter }));
jest.mock('@/models/common/useAppStore', () => ({
  __esModule: true,
  default: { setState: (...args: any[]) => mockCache(...args) },
}));
jest.mock('@/service/devloop', () => ({ loginOperationAccount: (...args: any[]) => mockConfirm(...args) }));
jest.mock('@/service/sandbox', () => ({
  getSandboxInfo: (...args: any[]) => mockList(...args),
  navigateSandboxBrowser: (...args: any[]) => mockNavigate(...args),
  getBrowserServiceKey: jest.fn(),
  launchSandboxByUserCode: jest.fn(),
}));
jest.mock('@/utils/auth', () => ({
  getDesktopIdentitySnapshot: () => ({ account: 'user', enterpriseId: mockIdentity }),
  getAuthSnapshot: () => ({ sessionId: 'auth', token: '', ssoToken: '' }),
}));
jest.mock('@/utils/chat', () => ({ getVNCUrl: () => 'https://desktop/vnc.html' }));
const account = (id: number) => ({ id, platformId: 'Douyin' } as any);
const row = (sandboxId: string) => [
  { sandboxId, status: 'RUNNING', instanceEndpoints: { vnc: 'https://desktop/vnc.html' } },
];
beforeEach(() => {
  jest.clearAllMocks();
  sessionStorage.clear();
  useDesktopWorkspace.setState({ owners: {}, panel: '', activeOwner: '', visible: false, revision: 0 });
  mockIdentity = 'tenant';
  mockList.mockResolvedValue(row('a'));
  mockNavigate.mockResolvedValue({});
});
it('keeps a newly opened chat desktop when an older login discovery completes', async () => {
  let resolve!: (value: any) => void;
  mockList.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  const { result } = renderHook(() => ({ login: useOperationAccountLogin(), openChat: useVncOpener('chat') }));
  let opening!: Promise<void>;
  act(() => {
    opening = result.current.login.handleLogin(account(1));
  });
  act(() => result.current.openChat());
  await act(async () => {
    resolve(row('a'));
    await opening;
  });
  const views = mockEmit.mock.calls.filter(([, event]) => event.action === 'open');
  expect(views).toHaveLength(1);
  expect(views[0][1].config.drawerType).toBe('desktop');
  expect(result.current.login.loginTarget).toBeNull();
  expect(result.current.login.loginPreparingAccountId).toBeNull();
  expect(mockCache).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
});
it('does not let delayed confirmation A close or clear the newer login B', async () => {
  let resolve!: () => void;
  mockConfirm.mockReturnValue(
    new Promise<void>((done) => {
      resolve = done;
    })
  );
  const { result } = renderHook(() => useOperationAccountLogin());
  await act(async () => result.current.handleLogin(account(1)));
  let confirmation!: Promise<void>;
  act(() => {
    confirmation = result.current.handleConfirmLogin();
  });
  act(() => result.current.closeRemoteDesktop());
  mockList.mockResolvedValue(row('b'));
  await act(async () => result.current.handleLogin(account(2)));
  await act(async () => {
    resolve();
    await confirmation;
  });
  expect(result.current.loginTarget?.id).toBe(2);
  expect(mockConfirm).toHaveBeenCalledWith(1, 'a');
  expect(mockMessage.success).not.toHaveBeenCalledWith('projectSpace.operation.account.loginSuccess');
});
it('does not write directory cache or open a view after preparation was cancelled', async () => {
  let resolve!: (value: any) => void;
  mockList.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  const { result } = renderHook(() => useOperationAccountLogin());
  let opening!: Promise<void>;
  act(() => {
    opening = result.current.handleLogin(account(1));
  });
  act(() => result.current.closeRemoteDesktop());
  await act(async () => {
    resolve(row('a'));
    await opening;
  });
  expect(mockCache).not.toHaveBeenCalled();
  expect(mockEmit.mock.calls.filter(([, event]) => event.action === 'open')).toHaveLength(0);
});
it('cancels the delayed navigation retry after the login is closed', async () => {
  jest.useFakeTimers();
  try {
    mockNavigate.mockRejectedValue(new Error('warming'));
    const { result } = renderHook(() => useOperationAccountLogin());
    let opening!: Promise<void>;
    await act(async () => {
      opening = result.current.handleLogin(account(1));
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => result.current.closeRemoteDesktop());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
      await opening;
    });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});
it('clears a completed login target on authentication changes so old sandboxes cannot be confirmed', async () => {
  const { result } = renderHook(() => useOperationAccountLogin());
  await act(async () => result.current.handleLogin(account(1)));
  expect(result.current.loginTarget?.id).toBe(1);
  act(() => window.dispatchEvent(new Event('byclaw-auth-change')));
  expect(result.current.loginTarget?.id).toBe(1);
  mockIdentity = 'other-tenant';
  act(() => window.dispatchEvent(new Event('byclaw-auth-change')));
  expect(result.current.loginTarget).toBeNull();
  await act(async () => result.current.handleConfirmLogin());
  expect(mockConfirm).not.toHaveBeenCalled();
});
