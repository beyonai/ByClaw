import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { setMultiTenancyConfig } from '@/utils/multiTenancy';
import { listTenants } from '@/pages/manager/service/TenantMgr';
import SandboxMgr from '../index';
import { getDcSystemConfig } from '@/pages/manager/service/session';

jest.mock('@/pages/manager/service/session', () => ({ getDcSystemConfig: jest.fn() }));
const mockDispatch = jest.fn();
let mockUserInfo: any;
let mockLocale = 'zh-CN';
jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) =>
      id.startsWith('sandbox.')
        ? jest.requireActual('@/testUtils/localeIntl').getLocaleIntl(mockLocale).formatMessage({ id })
        : id,
  }),
  useDispatch: () => mockDispatch,
  useSelector: (select: any) => select({ user: { userInfo: mockUserInfo } }),
}));
jest.mock('@/pages/manager/components/ModalDrawer', () => () => null);
jest.mock('@/pages/manager/components/JsonCodeEditor', () => () => null);
jest.mock('@/pages/manager/utils/auth', () => ({ isAdminVip: () => true }));
jest.mock('@/pages/manager/service/SandboxMgr', () => ({ getPreferredServiceKey: jest.fn() }));
jest.mock('@/pages/manager/service/TenantMgr', () => ({ listTenants: jest.fn().mockResolvedValue([]) }));

beforeEach(() => {
  jest.clearAllMocks();
  (getDcSystemConfig as jest.Mock).mockResolvedValue({ paramValue: 'commercial' });
  mockLocale = 'zh-CN';
  mockUserInfo = { enterpriseId: '123', usersOrganizations: [{ userType: 'PLAT_MAN' }] };
});

test('business managers load user resources without requesting tenant administration', () => {
  mockUserInfo = { enterpriseId: '123', usersOrganizations: [{ userType: 'BUSINESS_MAN' }] };
  setMultiTenancyConfig({ ENABLE_MULTI_TENACY: '1' });
  render(<SandboxMgr />);
  expect(mockDispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'sandboxMgr/listSandboxRecords',
      payload: expect.objectContaining({ ownerScope: 'USER', enterpriseId: undefined }),
    })
  );
  expect(screen.queryByRole('tab', { name: '租户资源' })).not.toBeInTheDocument();
  expect(listTenants).not.toHaveBeenCalled();
  expect(screen.queryByText('sandboxMgr.tenant.launch')).not.toBeInTheDocument();
});

test.each(['', '0'])('disabled switch %s hides tenant controls and loads user resources', (value) => {
  setMultiTenancyConfig({ ENABLE_MULTI_TENACY: value });
  render(<SandboxMgr />);
  expect(screen.queryByRole('tab', { name: '租户资源' })).not.toBeInTheDocument();
  expect(screen.queryByText('sandboxMgr.tenant.launch')).not.toBeInTheDocument();
  expect(listTenants).not.toHaveBeenCalled();
  expect(mockDispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'sandboxMgr/listSandboxRecords',
      payload: expect.objectContaining({ ownerScope: 'USER' }),
    })
  );
});

test('turning off tenants while viewing tenant resources reloads the user list', () => {
  setMultiTenancyConfig({ ENABLE_MULTI_TENACY: '1' });
  render(<SandboxMgr />);
  expect(screen.getByRole('tab', { name: '租户资源' })).toBeInTheDocument();
  act(() => setMultiTenancyConfig({ ENABLE_MULTI_TENACY: '0' }));
  expect(screen.queryByRole('tab', { name: '租户资源' })).not.toBeInTheDocument();
  expect(mockDispatch).toHaveBeenLastCalledWith(
    expect.objectContaining({
      type: 'sandboxMgr/listSandboxRecords',
      payload: expect.objectContaining({ ownerScope: 'USER', enterpriseId: undefined }),
    })
  );
});

test('a late tenant response cannot replace user resources after the switch is disabled', () => {
  setMultiTenancyConfig({ ENABLE_MULTI_TENACY: '1' });
  render(<SandboxMgr />);
  const tenantRequest = mockDispatch.mock.calls[0][0];
  act(() => setMultiTenancyConfig({ ENABLE_MULTI_TENACY: '0' }));
  const userRequest = mockDispatch.mock.calls[mockDispatch.mock.calls.length - 1][0];
  const record = { id: 1, ownerScope: 'USER', userCode: 'user-1', sandboxType: 'openclaw', status: 'RUNNING' };
  act(() => userRequest.success({ list: [{ ...record, sandboxId: 'user-sandbox' }] }));
  act(() => tenantRequest.success({ list: [{ ...record, ownerScope: 'TENANT', sandboxId: 'old-tenant-sandbox' }] }));
  expect(screen.getByText('user-sandbox')).toBeInTheDocument();
  expect(screen.queryByText('old-tenant-sandbox')).not.toBeInTheDocument();
});

test('a role change to business manager ignores an earlier tenant response', () => {
  setMultiTenancyConfig({ ENABLE_MULTI_TENACY: '1' });
  const { rerender } = render(<SandboxMgr />);
  const tenantRequest = mockDispatch.mock.calls[0][0];
  mockUserInfo = { enterpriseId: '123', usersOrganizations: [{ userType: 'BUSINESS_MAN' }] };
  rerender(<SandboxMgr />);
  const userRequest = mockDispatch.mock.calls[mockDispatch.mock.calls.length - 1][0];
  expect(screen.queryByRole('tab', { name: '租户资源' })).not.toBeInTheDocument();
  const record = { id: 1, ownerScope: 'USER', userCode: 'user-1', sandboxType: 'openclaw', status: 'RUNNING' };
  act(() => userRequest.success({ list: [{ ...record, sandboxId: 'current-user-sandbox' }] }));
  act(() => tenantRequest.success({ list: [{ ...record, sandboxId: 'earlier-tenant-sandbox' }] }));
  expect(screen.getByText('current-user-sandbox')).toBeInTheDocument();
  expect(screen.queryByText('earlier-tenant-sandbox')).not.toBeInTheDocument();
});

test('localizes ownership controls while retaining the TENANT request scope', () => {
  setMultiTenancyConfig({ ENABLE_MULTI_TENACY: '1' });
  const { rerender } = render(<SandboxMgr />);
  expect(screen.getByRole('tab', { name: '租户资源' })).toBeInTheDocument();
  mockLocale = 'en-US';
  rerender(<SandboxMgr />);
  expect(screen.getByRole('tab', { name: 'Tenant resources' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'User resources' })).toBeInTheDocument();
  expect(mockDispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'sandboxMgr/listSandboxRecords',
      payload: expect.objectContaining({ ownerScope: 'TENANT' }),
    })
  );
});

test.each([
  ['adminvip', 'openSource', true],
  ['ordinary', 'openSource', false],
  ['adminvip', 'commercial', false],
  ['ordinary', 'commercial', false],
  ['adminvip', undefined, false],
])('recovery tab for account %s and version %s is visible=%s', async (account, version, visible) => {
  mockUserInfo = { userCode: account, usersOrganizations: [] };
  (getDcSystemConfig as jest.Mock).mockResolvedValue({ paramValue: version });
  setMultiTenancyConfig({ ENABLE_MULTI_TENACY: '0' });
  await act(async () => {
    render(<SandboxMgr />);
  });
  expect(Boolean(screen.queryByRole('tab', { name: '恢复任务' }))).toBe(visible);
});

test('running endpoints show named links and expand the complete list without navigating JSON', async () => {
  setMultiTenancyConfig({ ENABLE_MULTI_TENACY: '0' });
  render(<SandboxMgr />);
  const request = mockDispatch.mock.calls[0][0];
  act(() =>
    request.success({
      list: [
        {
          id: 1,
          ownerScope: 'USER',
          sandboxType: 'byclaw-dsh',
          status: 'RUNNING',
          endpoint: JSON.stringify({
            openclaw: 'https://sandbox.example/chat',
            vnc: 'https://sandbox.example/vnc',
            bycli: 'https://sandbox.example/cli',
          }),
        },
      ],
    })
  );
  expect(screen.getByRole('link', { name: 'openclaw' })).toHaveAttribute('href', 'https://sandbox.example/chat');
  expect(screen.getByRole('link', { name: 'vnc' })).toHaveAttribute('href', 'https://sandbox.example/vnc');
  fireEvent.click(screen.getByRole('button', { name: /sandboxMgr.endpoint.more/ }));
  const menu = await screen.findByRole('menu', { hidden: true });
  await waitFor(() => expect(menu).toBeVisible());
  expect(within(menu).getByRole('link', { name: 'bycli', hidden: true })).toHaveAttribute(
    'href',
    'https://sandbox.example/cli'
  );
  expect(screen.queryByText(/\{"openclaw"/)).not.toBeInTheDocument();
}, 15000);

test('shows the user name returned for a user sandbox record', () => {
  setMultiTenancyConfig({ ENABLE_MULTI_TENACY: '0' });
  render(<SandboxMgr />);
  const request = mockDispatch.mock.calls[0][0];
  act(() =>
    request.success({
      list: [
        {
          id: 1,
          ownerScope: 'USER',
          userCode: 'user001',
          userName: 'Test User',
          sandboxType: 'openclaw',
          status: 'RUNNING',
        },
      ],
    })
  );
  expect(screen.getByText('Test User')).toBeInTheDocument();
});
