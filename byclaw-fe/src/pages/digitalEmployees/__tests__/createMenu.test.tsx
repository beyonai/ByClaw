import { act, fireEvent, render, screen } from '@testing-library/react';
import DigitalEmployeesPage from '../index';

let mockTab = 'available';
let mockUserInfo: { userCode: string; usersOrganizations?: { userType: string }[] } | null;
const mockNavigate = jest.fn();
const mockDispatch = jest.fn();
const mockSetSearchParams = jest.fn();
const mockEventEmitter = { on: jest.fn(), off: jest.fn() };
const mockUserListeners = new Set<() => void>();

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
  useNavigate: () => mockNavigate,
  useDispatch: () => mockDispatch,
  // 模拟 store 的订阅通知，使用户更新能穿过页面的 React.memo。
  useSelector: (selector: (state: any) => any) => {
    const userInfo = require('react').useSyncExternalStore(
      (listener: () => void) => {
        mockUserListeners.add(listener);
        return () => mockUserListeners.delete(listener);
      },
      () => mockUserInfo
    );
    return selector({ user: { userInfo } });
  },
  useSearchParams: () => [new URLSearchParams({ tab: mockTab }), mockSetSearchParams],
}));
jest.mock('@/utils/auth', () => ({
  isAdminVip: (userInfo: { userCode: string }) => userInfo.userCode === 'adminvip',
}));
jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({ EventEmitter: mockEventEmitter }),
}));
jest.mock('@/hooks/useDigitalEmployeeAuditCount', () => ({
  __esModule: true,
  default: () => ({ count: 0, rows: [] }),
}));
jest.mock('../components/AllDigitalEmployees', () => ({
  __esModule: true,
  default: require('react').forwardRef(() => null),
}));
jest.mock('../components/EmployeeTypeTag', () => () => null);
jest.mock('@/components/Resources/components/ResourceFilter', () => ({
  __esModule: true,
  default: () => null,
  getDefaultParams: () => ({}),
}));
jest.mock('@/pages/manager/pages/digitalEmployeeMgr/components/EmployFormModal', () => ({
  __esModule: true,
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="enterprise-form" /> : null),
}));
jest.mock('@/components/Preview/Md', () => () => null);
jest.mock('@/components/AntdIcon', () => () => null);
jest.mock('@/service/digitalEmployees', () => ({ getCompositeAppInfo: jest.fn() }));
jest.mock('@/pages/manager/service/resources', () => ({ applyResourceUse: jest.fn() }));
jest.mock('@/utils/agent', () => ({ getAgentChatAvatar: jest.fn() }));
jest.mock('@/utils/employeeChat', () => ({ navigateToEmployeeChat: jest.fn() }));
jest.mock('@/utils/file', () => ({ getFileUrl: jest.fn() }));

// 保留菜单点击行为，隔离列表、预览与 antd 浮层，使测试聚焦页面创建入口。
jest.mock('antd', () => {
  const Wrapper = ({ children }: any) => <div>{children}</div>;
  const Tabs = ({ children, tabBarExtraContent }: any) => (
    <div>
      {tabBarExtraContent}
      {children}
    </div>
  );
  Tabs.TabPane = Wrapper;
  return {
    Badge: Wrapper,
    Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
    Dropdown: ({ children, overlay }: any) => (
      <div>
        {children}
        {overlay}
      </div>
    ),
    Input: () => null,
    Menu: ({ items, onClick }: any) => (
      <div role="menu">
        {items.map(({ key, label }: any) => (
          <button key={key} role="menuitem" onClick={() => onClick({ key })}>
            {label}
          </button>
        ))}
      </div>
    ),
    Modal: () => null,
    Popconfirm: Wrapper,
    Space: Wrapper,
    Spin: Wrapper,
    Tabs,
    Typography: { Paragraph: Wrapper, Text: Wrapper, Title: Wrapper },
    message: { success: jest.fn(), error: jest.fn() },
  };
});

describe('digital employee creation by tab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTab = 'available';
    mockUserInfo = null;
    sessionStorage.clear();
  });

  it.each(['USER', 'PLAT_MAN', 'adminvip'])('only offers personal creation on available for %s', (role) => {
    mockUserInfo = { userCode: role, usersOrganizations: [{ userType: role }] };
    render(<DigitalEmployeesPage />);
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'digitalEmployees.createPersonal',
      'digitalEmployees.createPersonalGroup',
    ]);
    fireEvent.click(screen.getByText('digitalEmployees.createPersonalGroup'));
    expect(mockNavigate).toHaveBeenCalledWith(
      '/digitalEmployeesCreate?ownerType=personal&digitalType=FROM_MANUALLY&agentType=017'
    );
    fireEvent.click(screen.getByText('digitalEmployees.createPersonal'));
    expect(mockNavigate).toHaveBeenCalledWith('/digitalEmployeesCreate?ownerType=personal&digitalType=FROM_MANUALLY');
  });

  it.each(['USER', 'ORG_MAN', 'BUSINESS_MAN', 'PLAT_DEVOPS', 'DEV_USER'])('hides official creation for %s', (role) => {
    mockTab = 'official';
    mockUserInfo = { userCode: 'ordinary-user', usersOrganizations: [{ userType: role }] };
    render(<DigitalEmployeesPage />);
    expect(screen.queryByText('digitalEmployees.create')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByText('digitalEmployees.myEmployees')).toBeTruthy();
  });

  it.each(['PLAT_MAN', 'adminvip'])('only offers enterprise creation on official for %s', (role) => {
    mockTab = 'official';
    mockUserInfo = { userCode: role, usersOrganizations: [{ userType: 'USER' }, { userType: role }] };
    render(<DigitalEmployeesPage />);
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'digitalEmployees.createEnterprise',
      'digitalEmployees.createEnterpriseGroup',
    ]);
    fireEvent.click(screen.getByText('digitalEmployees.createEnterpriseGroup'));
    expect(mockNavigate).toHaveBeenCalledWith(
      '/digitalEmployeesCreate?ownerType=enterprise&digitalType=FROM_MANUALLY&agentType=017'
    );
    fireEvent.click(screen.getByText('digitalEmployees.createEnterprise'));
    expect(screen.getByTestId('enterprise-form')).toBeTruthy();
  });

  it('updates official creation when login roles load or change', () => {
    mockTab = 'official';
    render(<DigitalEmployeesPage />);
    expect(screen.queryByText('digitalEmployees.create')).toBeNull();
    act(() => {
      mockUserInfo = { userCode: 'platform-manager', usersOrganizations: [{ userType: 'PLAT_MAN' }] };
      mockUserListeners.forEach((listener) => listener());
    });
    expect(screen.getByText('digitalEmployees.create')).toBeTruthy();
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
    act(() => {
      mockUserInfo = { userCode: 'ordinary-user' };
      mockUserListeners.forEach((listener) => listener());
    });
    expect(screen.queryByText('digitalEmployees.create')).toBeNull();
  });
});
