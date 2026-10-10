import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DigitalEmployeesPage, { EmployeePreviewModal } from '../index';
import { getDcSystemConfig } from '@/pages/manager/service/session';
import { getCompositeAppInfo } from '@/service/digitalEmployees';
import { applyResourceUse } from '@/pages/manager/service/resources';

let mockTab = 'available';
let mockBrandVersion = 'openSource';
let mockUserInfo: { userCode: string; usersOrganizations?: { userType: string }[] } | null;
const mockNavigate = jest.fn();
const mockDispatch = jest.fn();
const mockSetSearchParams = jest.fn();
const mockEventEmitter = { on: jest.fn(), off: jest.fn() };
const mockEmployeeSearch = jest.fn();
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
  useSearchParams: () => {
    const [params, setParams] = require('react').useState(() => new URLSearchParams({ tab: mockTab }));
    return [
      params,
      (next: URLSearchParams) => {
        mockSetSearchParams(next);
        setParams(new URLSearchParams(next));
      },
    ];
  },
}));
jest.mock('@/utils/auth', () => ({
  isAdminVip: (userInfo: { userCode: string }) => userInfo.userCode.toLowerCase() === 'adminvip',
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
  default: require('react').forwardRef(({ source, enableFavorites, dropdownParam }: any, ref: any) => {
    require('react').useImperativeHandle(ref, () => ({
      getSearch: (keyword: string, param: any) => mockEmployeeSearch(source, keyword, param),
    }));
    return (
      <div
        data-testid={`employee-list-${source}`}
        data-favorites-enabled={String(enableFavorites)}
        data-type={dropdownParam?.digitalEmployeeType || ''}
        data-permission={dropdownParam?.permission || ''}
      />
    );
  }),
}));
jest.mock('@/pages/manager/service/session', () => ({
  getDcSystemConfig: jest.fn(() => Promise.resolve({ paramValue: mockBrandVersion })),
}));
jest.mock('../components/EmployeeTypeTag', () => () => null);
jest.mock('@/components/Resources/components/ResourceFilter', () => ({
  __esModule: true,
  default: () => null,
  getDefaultParams: () => ({ resourceStatus: '2', digitalEmployeeType: '', permission: '' }),
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
  const DefaultTabBar = ({ children, tabBarExtraContent, activeKey, onChange }: any) => (
    <div role="tablist">
      {require('react').Children.map(
        children,
        (child: any) =>
          child && (
            <button role="tab" aria-selected={child.key === activeKey} onClick={() => onChange(child.key)}>
              {child.props.tab}
            </button>
          )
      )}
      {tabBarExtraContent}
    </div>
  );
  const Tabs = ({ renderTabBar, ...props }: any) => (
    <div>
      {renderTabBar ? renderTabBar(props, DefaultTabBar) : <DefaultTabBar {...props} />}
      {props.children}
    </div>
  );
  Tabs.TabPane = ({ children }: any) => <div>{children}</div>;
  return {
    Badge: Wrapper,
    Button: ({ children, onClick, disabled, loading }: any) => (
      <button onClick={onClick} disabled={disabled || loading}>
        {children}
      </button>
    ),
    Dropdown: ({ children, overlay }: any) => (
      <div>
        {children}
        {overlay}
      </div>
    ),
    Input: ({ value, onChange, onPressEnter, placeholder }: any) => (
      <input
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        onKeyDown={(event) => event.key === 'Enter' && onPressEnter?.()}
      />
    ),
    Menu: ({ items, onClick }: any) => (
      <div role="menu">
        {items.map(({ key, label }: any) => (
          <button key={key} role="menuitem" onClick={() => onClick({ key })}>
            {label}
          </button>
        ))}
      </div>
    ),
    Modal: ({ open, children }: any) => (open ? <div>{children}</div> : null),
    Popconfirm: ({ children, onConfirm, disabled, okText }: any) => (
      <div>
        {children}
        <button disabled={disabled} onClick={onConfirm}>
          {okText}
        </button>
      </div>
    ),
    Space: Wrapper,
    Spin: Wrapper,
    Tabs,
    Typography: { Paragraph: Wrapper, Text: Wrapper, Title: Wrapper },
    message: { success: jest.fn(), error: jest.fn() },
  };
});

describe('employee preview operation permissions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (applyResourceUse as jest.Mock).mockResolvedValue({});
  });

  const employee = { resourceId: 'preview-1', name: 'Employee', openingQuestion: ['问一个问题'] };
  const loadPreview = async (permissions: any, onCreateTask = jest.fn()) => {
    (getCompositeAppInfo as jest.Mock).mockResolvedValue({ operationPermissions: permissions });
    render(<EmployeePreviewModal employee={employee} onClose={jest.fn()} onCreateTask={onCreateTask} />);
    await waitFor(() => expect(getCompositeAppInfo).toHaveBeenCalled());
    // 等待详情权限响应合入预览状态。
    await act(async () => {});
    return onCreateTask;
  };

  it('does not infer application permission or allow sample task creation without backend permission', async () => {
    const createTask = await loadPreview({ hasUsePermission: false, canApplyUse: false, useApplyPending: false });
    expect(screen.queryByText('digitalEmployees.newTask')).toBeNull();
    expect(screen.queryByText('digitalEmployees.useRequest')).toBeNull();
    fireEvent.click(screen.getByText('问一个问题'));
    expect(createTask).not.toHaveBeenCalled();
    expect(applyResourceUse).not.toHaveBeenCalled();
  });

  it('uses backend application permission and changes to pending after submitting once', async () => {
    await loadPreview({ hasUsePermission: false, canApplyUse: true, useApplyPending: false });
    expect(screen.getByText('digitalEmployees.useRequest')).toBeInTheDocument();
    fireEvent.click(screen.getByText('common.confirm'));
    await screen.findByText('digitalEmployees.pendingApproval');
    expect(applyResourceUse).toHaveBeenCalledWith({ resourceId: 'preview-1' });
    expect(screen.getByText('digitalEmployees.pendingApproval')).toBeDisabled();
    fireEvent.click(screen.getByText('common.confirm'));
    expect(applyResourceUse).toHaveBeenCalledTimes(1);
  });

  it('keeps a backend-reported pending application disabled', async () => {
    await loadPreview({ hasUsePermission: false, canApplyUse: false, useApplyPending: true });
    expect(screen.getByText('digitalEmployees.pendingApproval')).toBeDisabled();
    fireEvent.click(screen.getByText('common.confirm'));
    expect(applyResourceUse).not.toHaveBeenCalled();
  });

  it('allows the main task button and samples when backend use permission is true', async () => {
    const createTask = await loadPreview({ hasUsePermission: true, canApplyUse: false });
    fireEvent.click(screen.getByText('digitalEmployees.newTask'));
    fireEvent.click(screen.getByText('问一个问题'));
    expect(createTask.mock.calls).toEqual([[], ['问一个问题']]);
    expect(screen.queryByText('digitalEmployees.useRequest')).toBeNull();
  });
});

describe('digital employee creation by tab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTab = 'available';
    mockBrandVersion = 'openSource';
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

  it.each(['PLAT_MAN', 'plat_man', 'Plat_Man', 'adminvip', 'AdminVip', 'ADMINVIP'])(
    'only offers enterprise creation on official for %s',
    (role) => {
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
    }
  );

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

  it.each(['commercial', 'openSource'])('enables employee favorites only for %s', async (brand) => {
    mockBrandVersion = brand;
    mockTab = 'official';
    render(<DigitalEmployeesPage />);
    await waitFor(() =>
      expect(screen.getByTestId('employee-list-official')).toHaveAttribute(
        'data-favorites-enabled',
        String(brand === 'commercial')
      )
    );
    expect(screen.getByTestId('employee-list-available')).toHaveAttribute('data-favorites-enabled', 'undefined');
    if (brand === 'commercial') {
      expect(screen.getByText('resource.myFavorites')).toBeInTheDocument();
      expect(screen.getByTestId('employee-list-favorites')).toHaveAttribute('data-favorites-enabled', 'true');
    } else {
      expect(screen.queryByText('resource.myFavorites')).toBeNull();
    }
  });

  it.each(['commercial', 'openSource'])(
    'loads official employees before the %s brand request finishes',
    async (brand) => {
      let resolveBrand!: (value: any) => void;
      (getDcSystemConfig as jest.Mock).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveBrand = resolve;
          })
      );
      mockTab = 'official';
      render(<DigitalEmployeesPage />);
      expect(screen.getByTestId('employee-list-official')).toHaveAttribute('data-favorites-enabled', 'false');
      await act(async () => {
        resolveBrand({ paramValue: brand });
      });
      expect(screen.getByTestId('employee-list-official')).toHaveAttribute(
        'data-favorites-enabled',
        String(brand === 'commercial')
      );
    }
  );

  it('applies quick filters immediately and keeps independent conditions for each employee tab', async () => {
    mockBrandVersion = 'commercial';
    render(<DigitalEmployeesPage />);
    await screen.findByRole('tab', { name: 'resource.myFavorites' });
    expect(screen.queryByText('common.confirm')).toBeNull();
    expect(screen.queryByRole('button', { name: 'resource.appliedByMe' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'digitalEmployees.filter.personalGroup' }));
    fireEvent.click(screen.getByRole('button', { name: 'resource.authorizedToMe' }));
    expect(mockEmployeeSearch).toHaveBeenLastCalledWith(
      'available',
      '',
      expect.objectContaining({
        resourceStatus: '2',
        digitalEmployeeType: 'PERSONAL_GROUP',
        permission: 'AUTHORIZED_TO_ME',
      })
    );

    fireEvent.click(screen.getByRole('tab', { name: 'digitalEmployees.official' }));
    // 企业推荐只展示企业类型，并保留与其他页签独立的筛选状态。
    const officialTypes = within(screen.getByRole('group', { name: 'resource.type' }));
    expect(officialTypes.getByRole('button', { name: 'digitalEmployees.tag.enterpriseEmployee' })).toBeInTheDocument();
    expect(officialTypes.queryByRole('button', { name: 'digitalEmployees.filter.personalGroup' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'resource.appliedByMe' }));
    expect(mockEmployeeSearch).toHaveBeenLastCalledWith(
      'official',
      '',
      expect.objectContaining({
        resourceStatus: '2',
        digitalEmployeeType: '',
        permission: 'APPLIED_BY_ME',
      })
    );
    fireEvent.click(officialTypes.getByRole('button', { name: 'digitalEmployees.filter.enterpriseGroup' }));
    expect(mockEmployeeSearch).toHaveBeenLastCalledWith(
      'official',
      '',
      expect.objectContaining({ digitalEmployeeType: 'ENTERPRISE_GROUP', permission: 'APPLIED_BY_ME' })
    );

    fireEvent.click(screen.getByRole('tab', { name: 'resource.myFavorites' }));
    fireEvent.click(screen.getByRole('button', { name: 'digitalEmployees.filter.enterpriseGroup' }));
    fireEvent.click(screen.getByRole('button', { name: 'resource.createdByMe' }));
    expect(mockEmployeeSearch).toHaveBeenLastCalledWith(
      'favorites',
      '',
      expect.objectContaining({
        digitalEmployeeType: 'ENTERPRISE_GROUP',
        permission: 'CREATED_BY_ME',
      })
    );
    const types = within(screen.getByRole('group', { name: 'resource.type' }));
    fireEvent.click(types.getByRole('button', { name: 'common.all' }));
    expect(mockEmployeeSearch).toHaveBeenLastCalledWith(
      'favorites',
      '',
      expect.objectContaining({
        digitalEmployeeType: '',
        permission: 'CREATED_BY_ME',
      })
    );

    fireEvent.click(screen.getByRole('tab', { name: 'digitalEmployees.available' }));
    expect(screen.getByRole('button', { name: 'digitalEmployees.filter.personalGroup' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'resource.authorizedToMe' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'resource.appliedByMe' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'digitalEmployees.official' }));
    expect(screen.getByRole('button', { name: 'digitalEmployees.filter.enterpriseGroup' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'resource.appliedByMe' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the keyword and cancels stale delayed searches when applying quick filters', () => {
    jest.useFakeTimers();
    const view = render(<DigitalEmployeesPage />);
    try {
      const search = screen.getByPlaceholderText('common.inputKeyword');
      fireEvent.change(search, { target: { value: 'weather' } });
      fireEvent.keyDown(search, { key: 'Enter' });
      expect(mockEmployeeSearch).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'digitalEmployees.filter.enterpriseGroup' }));
      expect(mockEmployeeSearch).toHaveBeenCalledTimes(1);
      expect(mockEmployeeSearch).toHaveBeenLastCalledWith(
        'available',
        'weather',
        expect.objectContaining({
          digitalEmployeeType: 'ENTERPRISE_GROUP',
        })
      );
      act(() => jest.advanceTimersByTime(500));
      expect(mockEmployeeSearch).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
      jest.useRealTimers();
    }
  });
});
