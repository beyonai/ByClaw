import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import TenantMgr from '../index';
import TenantOrganizationModal from '../TenantOrganizationModal';
import TenantProvisionProgress from '../TenantProvisionProgress';
import { deleteTenant, listTenants, listTenantOrganizationMembers } from '../../../service/TenantMgr';

let mockLocale = 'zh-CN';
const tenant: any = {
  enterpriseId: '9007199254740993',
  enterpriseName: '测试企业',
  packageName: '标准版',
  provisionState: 'READY',
};
jest.mock('@umijs/max', () => ({
  useIntl: () => jest.requireActual('@/testUtils/localeIntl').getLocaleIntl(mockLocale),
  useSelector: (select: any) => select({ user: { userInfo: { usersOrganizations: [{ userType: 'PLAT_MAN' }] } } }),
}));
jest.mock('../../../service/TenantMgr', () => ({
  listTenants: jest.fn(),
  listTenantPackages: jest.fn().mockResolvedValue([]),
  createTenant: jest.fn(),
  provisionTenant: jest.fn(),
  deleteTenant: jest.fn().mockResolvedValue(undefined),
  listTenantOrganizations: jest.fn().mockResolvedValue([{ orgId: '1', orgName: '研发部', parentOrgId: '0' }]),
  listTenantOrganizationMembers: jest
    .fn()
    .mockResolvedValue([{ userId: '2', userCode: 'u2', userName: '张三', alreadyMember: true }]),
  addTenantMember: jest.fn(),
  attachTenantOrganization: jest.fn(),
}));
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider>
);
beforeEach(() => {
  jest.clearAllMocks();
  mockLocale = 'zh-CN';
  (listTenants as jest.Mock).mockResolvedValue([tenant]);
});

test('switches status text while preserving the ready color and exact-name deletion guard', async () => {
  const { rerender } = render(<TenantMgr />, { wrapper });
  expect(await screen.findByText('已开通')).toHaveClass('ant-tag-green');
  mockLocale = 'en-US';
  rerender(<TenantMgr />);
  expect(screen.getByText('Ready')).toHaveClass('ant-tag-green');
  fireEvent.click(screen.getByRole('button', { name: 'Delete tenant' }));
  const dialog = within(await screen.findByRole('dialog', { name: 'Delete tenant: 测试企业' }));
  expect(dialog.getByRole('button', { name: 'Confirm deletion' })).toBeDisabled();
  fireEvent.change(dialog.getByRole('textbox', { name: 'Enter the tenant name to confirm deletion' }), {
    target: { value: '测试企业' },
  });
  fireEvent.click(dialog.getByRole('button', { name: 'Confirm deletion' }));
  await waitFor(() => expect(deleteTenant).toHaveBeenCalledWith('9007199254740993', '测试企业'));
});

test('localizes progress at render time without translating enterprise identifiers or package data', () => {
  const props = { tenant, onClose: jest.fn(), onRetry: jest.fn(), retrying: false };
  const { rerender } = render(<TenantProvisionProgress {...props} />, { wrapper });
  expect(screen.getByText('创建企业与成员身份')).toBeInTheDocument();
  mockLocale = 'en-US';
  rerender(<TenantProvisionProgress {...props} />);
  expect(screen.getByText('Create enterprise and member identities')).toBeInTheDocument();
  expect(screen.getByText('Enterprise ID: 9007199254740993')).toBeInTheDocument();
  expect(screen.getByText('Package: 标准版')).toBeInTheDocument();
  expect(screen.getAllByText('Completed')).toHaveLength(4);
});

test('localizes organization membership while retaining names and query arguments', async () => {
  mockLocale = 'en-US';
  render(<TenantOrganizationModal tenant={tenant} onClose={jest.fn()} />, { wrapper });
  expect(await screen.findByText('研发部 · 1 members')).toBeInTheDocument();
  expect(screen.getByText('Joined')).toBeInTheDocument();
  expect(screen.getByText('张三')).toBeInTheDocument();
  expect(listTenantOrganizationMembers).toHaveBeenCalledWith('9007199254740993', '1', true);
});

test('shows manual action in the list instead of provisioning', async () => {
  (listTenants as jest.Mock).mockResolvedValue([{ ...tenant, provisionState: 'MANUAL_REQUIRED' }]);
  const { rerender } = render(<TenantMgr />, { wrapper });
  expect(await screen.findByText('待人工处理')).toHaveClass('ant-tag-orange');
  mockLocale = 'en-US';
  rerender(<TenantMgr />);
  expect(screen.getByText('Manual action required')).toHaveClass('ant-tag-orange');
});

test.each([360, 1280])('shows paused progress and reason without legacy retry at viewport %s', (width) => {
  const previousWidth = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  try {
    const paused = {
      ...tenant,
      provisionState: 'MANUAL_REQUIRED',
      provisionStage: 'DB_CREATE',
      failureReason: 'PROVIDER_RESULT_UNKNOWN',
    };
    const props = { tenant: paused, onClose: jest.fn(), onRetry: jest.fn(), retrying: false };
    const { rerender } = render(<TenantProvisionProgress {...props} />, { wrapper });
    expect(screen.getByText('已暂停')).toBeInTheDocument();
    expect(screen.getByText('PROVIDER_RESULT_UNKNOWN')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试开通' })).not.toBeInTheDocument();
    mockLocale = 'en-US';
    rerender(<TenantProvisionProgress {...props} />);
    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.getByText('PROVIDER_RESULT_UNKNOWN')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry provisioning' })).not.toBeInTheDocument();
    expect(props.onRetry).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousWidth });
  }
});
