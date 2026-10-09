import { act, render, screen } from '@testing-library/react';
import { setMultiTenancyConfig } from '@/utils/multiTenancy';
import { listTenants } from '@/pages/manager/service/TenantMgr';
import SandboxMgr from '../index';

const mockDispatch = jest.fn();
jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
  useDispatch: () => mockDispatch,
  useSelector: (select: any) => select({ user: { userInfo: { usersOrganizations: [{ userType: 'PLAT_MAN' }] } } }),
}));
jest.mock('@/pages/manager/components/ModalDrawer', () => () => null);
jest.mock('@/pages/manager/components/JsonCodeEditor', () => () => null);
jest.mock('@/pages/manager/utils/auth', () => ({ isAdminVip: () => true }));
jest.mock('@/pages/manager/service/SandboxMgr', () => ({ getPreferredServiceKey: jest.fn() }));
jest.mock('@/pages/manager/service/TenantMgr', () => ({ listTenants: jest.fn().mockResolvedValue([]) }));

beforeEach(() => jest.clearAllMocks());

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
