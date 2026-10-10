import { act, render, screen } from '@testing-library/react';
import { setMultiTenancyConfig } from '@/utils/multiTenancy';
import Sider from '../index';

const mockIntl = { locale: 'zh-CN', formatMessage: ({ defaultMessage }: any) => defaultMessage };
const mockState = {
  user: { userInfo: { userId: '1', usersOrganizations: [{ userType: 'PLAT_MAN' }] } },
  menu: { blockedPaths: [] },
};
jest.mock('@umijs/max', () => ({
  useIntl: () => mockIntl,
  useLocation: () => ({ pathname: '/manager/systemParams/sandbox' }),
  useNavigate: () => jest.fn(),
  getLocale: () => 'zh-CN',
  setLocale: jest.fn(),
  useSelector: (select: any) => select(mockState),
}));
jest.mock('@/pages/manager/layout/sider/components/userDropdown', () => () => null);
jest.mock('@/pages/manager/components/AntdIcon', () => () => null);
jest.mock('@/pages/manager/utils/auth', () => ({ isAdminVip: () => true }));
jest.mock('@/pages/manager/service/session', () => ({ getDcSystemConfig: jest.fn().mockResolvedValue({}) }));
jest.mock('@/pages/manager/service/WorkgroupTemplate', () => ({ getWorkgroupTemplateCapability: async () => false }));
jest.mock('@/pages/manager/service/AppVersion', () => ({ getAppVersionCapability: async () => false }));

test('platform administrators only see tenant menus while multi-tenancy is enabled', async () => {
  setMultiTenancyConfig({ ENABLE_MULTI_TENACY: '1' });
  render(<Sider />);
  expect(await screen.findByText('租户管理')).toBeInTheDocument();
  expect(screen.getByText('租户数据源')).toBeInTheDocument();
  act(() => setMultiTenancyConfig({ ENABLE_MULTI_TENACY: '0' }));
  expect(screen.queryByText('租户管理')).not.toBeInTheDocument();
  expect(screen.queryByText('租户数据源')).not.toBeInTheDocument();
});
