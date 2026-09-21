const mockSetSearchParams = jest.fn();
const mockResourceFilterProps = jest.fn();
let mockAdminVip = true;
let mockSkillGroupMountCount = 0;
const mockSkillGroupProps = jest.fn();
const mockEventHandlers: Record<string, (payload?: unknown) => void> = {};
const mockEventEmitter = {
  on: jest.fn((event: string, handler: (payload?: unknown) => void) => {
    mockEventHandlers[event] = handler;
  }),
  off: jest.fn((event: string) => {
    delete mockEventHandlers[event];
  }),
  emit: jest.fn((event: string, payload?: unknown) => {
    mockEventHandlers[event]?.(payload);
  }),
};

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
  useSelector: (selector: (state: any) => any) =>
    selector({ user: { userInfo: {} }, employees: { defaultDigEmployeeId: 'employee-1' } }),
  useNavigate: () => jest.fn(),
  // 组件只读 location.state（透传给 setSearchParams），给个空路由对象即可；漏掉这个 mock 会整套用例报
  // useLocation is not a function。
  useLocation: () => ({ pathname: '/', search: '', hash: '', state: undefined, key: 'test' }),
  useSearchParams: () => {
    const [query, setQuery] = require('react').useState(globalThis.location.search);
    const params = new URLSearchParams(query);
    return [
      params,
      (nextParams: URLSearchParams) => {
        mockSetSearchParams(nextParams);
        const nextQuery = `?${nextParams.toString()}`;
        globalThis.history.pushState({}, '', `${globalThis.location.pathname}${nextQuery}`);
        setQuery(nextQuery);
      },
    ];
  },
}));

jest.mock('antd', () => ({
  Button: ({ children, icon, ...props }: any) => (
    <button type="button" {...props}>
      <span aria-hidden="true">{icon}</span>
      {children}
    </button>
  ),
  Badge: ({ children, count }: any) => (
    <span data-testid="audit-badge" data-count={count}>
      {children}
    </span>
  ),
  Dropdown: ({
    children,
    menu,
    mouseEnterDelay,
    mouseLeaveDelay,
    open,
    onOpenChange,
    transitionName,
    trigger = [],
  }: any) => {
    const React = require('react');
    const triggerChild = React.cloneElement(children, {
      'data-mouse-enter-delay': mouseEnterDelay,
      'data-mouse-leave-delay': mouseLeaveDelay,
      'data-transition-name': transitionName,
      onClick: (event: React.MouseEvent) => {
        children.props.onClick?.(event);
        if (trigger.includes('click')) {
          onOpenChange?.(!open);
        }
      },
      onMouseEnter: (event: React.MouseEvent) => {
        children.props.onMouseEnter?.(event);
        if (trigger.includes('hover')) {
          onOpenChange?.(true);
        }
      },
      onMouseLeave: (event: React.MouseEvent) => {
        children.props.onMouseLeave?.(event);
        if (trigger.includes('hover')) {
          onOpenChange?.(false);
        }
      },
    });
    return (
      <>
        {triggerChild}
        {open ? (
          <div role="menu">
            {menu.items.map((item: any) => (
              <button
                type="button"
                role="menuitem"
                key={item.key}
                data-selected={menu.selectedKeys?.includes(item.key) || undefined}
                onClick={(event) => menu.onClick?.({ key: item.key, domEvent: event })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    menu.onClick?.({ key: item.key, domEvent: event });
                  }
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
      </>
    );
  },
  Empty: () => <div data-testid="empty" />,
  Input: (props: any) => <input {...props} />,
  Space: ({ children }: any) => <div>{children}</div>,
  // 保留状态值和变更事件，覆盖管理员技能组状态筛选。
  Select: ({ options, value, onChange, ...props }: any) => (
    <select {...props} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  Segmented: ({ options, value, onChange }: any) => (
    <div>
      {options.map((option: any) => (
        <button
          type="button"
          key={option.value}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
  Spin: () => <div data-testid="spin" />,
  Tabs: ({ items, activeKey, onChange, ...props }: any) => (
    <div {...props}>
      {items?.map((item: any) => (
        <button
          type="button"
          key={item.key}
          aria-selected={item.key === activeKey}
          onClick={() => onChange?.(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  ),
  Tooltip: ({ children }: any) => children,
  message: { error: jest.fn(), success: jest.fn() },
}));

jest.mock('@/components/CommonTabs', () => ({
  __esModule: true,
  default: ({ items, activeKey, onChange, tabBarExtraContent }: any) => (
    <div>
      {items?.map((item: any) => (
        <button
          type="button"
          key={item.key}
          aria-selected={item.key === activeKey}
          onClick={() => onChange?.(item.key)}
        >
          {item.label}
        </button>
      ))}
      {tabBarExtraContent?.left ? (
        <>
          {tabBarExtraContent.left}
          {tabBarExtraContent.right}
        </>
      ) : (
        tabBarExtraContent
      )}
    </div>
  ),
}));
jest.mock('@/components/AntdIcon', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/Resources/components/ResourceList', () => ({
  __esModule: true,
  default: ({ catalogId }: any) => <div data-testid="resource-list" data-catalog-id={catalogId} />,
}));
jest.mock('@/components/Resources/components/ResourceAuditCenter', () => ({
  __esModule: true,
  default: () => <div data-testid="resource-audit-center" />,
}));
jest.mock('@/components/Resources/components/SkillGroupList', () => ({
  __esModule: true,
  default: (props: any) => {
    mockSkillGroupProps(props);
    // Lazy initialization counts actual mounts; a useRef initializer would run on every render.
    const mountId = require('react').useState(() => ++mockSkillGroupMountCount)[0];
    return <div data-testid="skill-group-list">{mountId}</div>;
  },
}));
jest.mock('@/components/Resources/components/ResourceFilter', () => ({
  __esModule: true,
  default: (props: any) => {
    mockResourceFilterProps(props);
    return (
      <button data-testid="resource-filter" onClick={() => props.onOk({ catalogId: 'catalog-1' })}>
        Filter
      </button>
    );
  },
  getDefaultParams: () => ({ resourceStatus: '2' }),
}));
jest.mock('@/components/Resources/components/ResourceImport', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/Resources/components/SkillGroupCreateModal', () => ({
  __esModule: true,
  default: ({ visible, onSuccess }: any) =>
    visible ? (
      <button type="button" data-testid="skill-group-create-modal" onClick={onSuccess}>
        Create skill group
      </button>
    ) : null,
}));
jest.mock('@/components/Resources/components/ResourceEdit', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/Resources/components/ResourceDetail', () => ({ __esModule: true, default: () => null }));
jest.mock('@/pages/manager/components/AuthListDrawer', () => ({ __esModule: true, default: () => null }));
jest.mock('@/pages/manager/components/UseApplyAuditDrawer', () => ({ __esModule: true, default: () => null }));
jest.mock('@/pages/knowledgeCenter/components/DetailPanel', () => ({ __esModule: true, default: () => null }));
jest.mock('@/pages/manager/components/SkillDetailDrawer/SkillDetailDrawer', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/pages/manager/components/SkillDetailDrawer/useSkillDetailDrawer', () => ({
  useSkillDetailDrawer: () => ({ placeholder: null, show: jest.fn() }),
}));
jest.mock('@/layout/sider/siderContentContext', () => ({
  SiderContentContext: require('react').createContext({ setDetailPanel: jest.fn(), clearDetailPanel: jest.fn() }),
}));
jest.mock('@/hooks/useModuleEvent', () => ({ __esModule: true, default: () => ({ logoutModuleEvent: jest.fn() }) }));
jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({ EventEmitter: mockEventEmitter }),
}));
jest.mock('@/utils/catalog', () => ({
  getLocalizedCatalogName: (catalog: { catalogName?: string }) => catalog.catalogName || '',
  getTopLevelCatalogs: () => [{ catalogId: 'catalog-1', catalogName: 'Sales' }],
  normalizeCatalogTree: (value: any) => value,
}));
jest.mock('@/service/digitalEmployees', () => ({
  queryCatalogTree: jest.fn().mockResolvedValue([]),
  updateResource: jest.fn(),
}));
jest.mock('@/service/knowledgeCenter', () => ({ queryKnowledgeCapability: jest.fn().mockResolvedValue({}) }));
jest.mock('@/pages/manager/service/resources', () => ({
  applyResourceUse: jest.fn(),
  queryResourceUseApplyAudit: jest.fn().mockResolvedValue({ data: [] }),
  queryFixedEntryOperationCapability: jest.fn().mockResolvedValue({ canImportEnterpriseSkill: true }),
}));
jest.mock('@/pages/manager/service/session', () => ({
  getDcSystemConfig: jest.fn(({ paramCode }: { paramCode: string }) =>
    Promise.resolve(paramCode === 'BYAI_BRAND_VERSION' ? { paramValue: 'openSource' } : {})
  ),
}));
jest.mock('@/pages/manager/service/DigitalEmployeeMgr', () => ({ saveTool: jest.fn() }));
jest.mock('@/constants/knowledge', () => ({ resourceBizTypeMap: {} }));
jest.mock('@/utils', () => ({ getRuntimeActualUrl: (value: string) => value }));
jest.mock('@/utils/auth', () => ({ getToken: () => '', isAdminVip: () => mockAdminVip }));

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Resources from '..';
import { queryResourceUseApplyAudit } from '@/pages/manager/service/resources';

describe('Resources enterprise skill mode', () => {
  beforeEach(() => {
    mockResourceFilterProps.mockClear();
    mockAdminVip = true;
    mockSkillGroupMountCount = 0;
    mockSkillGroupProps.mockReset();
    Object.keys(mockEventHandlers).forEach((event) => delete mockEventHandlers[event]);
    mockEventEmitter.on.mockClear();
    mockEventEmitter.off.mockClear();
    mockEventEmitter.emit.mockClear();
  });

  const renderAt = (search: string) => {
    window.history.pushState({}, '', `/skillCenter${search}`);
    return render(<Resources resourceType="SKILL" />);
  };

  it.each(['SKILL', 'KG_DOC', 'TOOL'])('hides status filters in available and official %s tabs', (resourceType) => {
    window.history.pushState({}, '', '/resourceCenter?tab=personal');
    render(<Resources resourceType={resourceType} />);

    expect(mockResourceFilterProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ activeTab: 'personal', hideStatusFilter: true })
    );
    fireEvent.click(
      resourceType === 'SKILL'
        ? screen.getByTestId('enterprise-skill-tab-trigger').closest('button')!
        : screen.getByRole('button', { name: 'resource.official' })
    );
    expect(mockResourceFilterProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ activeTab: 'enterprise', hideStatusFilter: true })
    );
  });

  it.each(['SKILL', 'KG_DOC', 'TOOL'])('preserves status filters in my %s resources', (resourceType) => {
    window.history.pushState({}, '', '/resourceCenter?tab=personal');
    render(<Resources resourceType={resourceType} myResourcesOnly />);

    expect(mockResourceFilterProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ activeTab: 'personal', hideStatusFilter: false })
    );
    fireEvent.click(screen.getByRole('button', { name: 'resourceCenter.enterprise' }));
    expect(mockResourceFilterProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ activeTab: 'enterprise', hideStatusFilter: false })
    );
  });

  it.each([
    ['KG_DOC', 'KG_DOC', 'resourceCenter.myKnowledge'],
    ['SKILL', 'SKILL', 'resourceCenter.mySkills'],
    ['TOOL', 'MCP', 'resourceCenter.myTools'],
  ])('shares the pending count between the %s entry and audit tab', async (resourceType, resourceBizType, label) => {
    (queryResourceUseApplyAudit as jest.Mock).mockResolvedValue({
      data: [
        { resourceId: 'pending-1', resourceBizType },
        { resourceId: 'pending-2', resourceBizType },
        { resourceId: 'unrelated', resourceBizType: 'DIG_EMPLOYEE' },
        { resourceBizType },
      ],
    });
    const Wrapper = () => {
      const [myResourcesOnly, setMyResourcesOnly] = React.useState(false);
      return (
        <Resources
          resourceType={resourceType}
          myResourcesOnly={myResourcesOnly}
          onMyResourcesOnlyChange={setMyResourcesOnly}
        />
      );
    };
    render(<Wrapper />);
    await waitFor(() => expect(screen.getByTestId('audit-badge')).toHaveAttribute('data-count', '2'));
    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(screen.getByTestId('audit-badge')).toHaveAttribute('data-count', '2'));
    expect(screen.getByRole('button', { name: 'resourceCenter.auditCenter' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'resourceCenter.backToAll' }));
    await waitFor(() => expect(screen.getByTestId('audit-badge')).toHaveAttribute('data-count', '2'));
    (queryResourceUseApplyAudit as jest.Mock).mockResolvedValue({ data: [] });
  });

  it('clears the badge when the pending query fails', async () => {
    (queryResourceUseApplyAudit as jest.Mock).mockRejectedValueOnce(new Error('unavailable'));
    render(<Resources resourceType="KG_DOC" onMyResourcesOnlyChange={jest.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('audit-badge')).toHaveAttribute('data-count', '0');
  });

  it('defaults to single skills and preserves the enterprise tab', () => {
    renderAt('?tab=enterprise');

    expect(screen.getByTestId('enterprise-skill-tab-trigger').closest('button')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByTestId('resource-list')).toBeTruthy();
    expect(window.location.search).toBe('?tab=enterprise');
  });

  it('marks the current enterprise skill type as selected in the menu', () => {
    const singleView = renderAt('?tab=enterprise');
    fireEvent.mouseEnter(screen.getByTestId('enterprise-skill-tab-trigger'));

    expect(screen.getByRole('menuitem', { name: 'resource.skillSingle' })).toHaveAttribute('data-selected', 'true');
    expect(screen.getByRole('menuitem', { name: 'resource.skillGroup' })).not.toHaveAttribute('data-selected');

    singleView.unmount();
    renderAt('?tab=enterprise&kind=group');
    fireEvent.mouseEnter(screen.getByTestId('enterprise-skill-tab-trigger'));

    expect(screen.getByRole('menuitem', { name: 'resource.skillSingle' })).not.toHaveAttribute('data-selected');
    expect(screen.getByRole('menuitem', { name: 'resource.skillGroup' })).toHaveAttribute('data-selected', 'true');
  });

  it('opens the enterprise skill menu from the keyboard and switches to groups', async () => {
    mockSetSearchParams.mockReset();
    renderAt('?tab=enterprise');

    const enterpriseSkillTab = screen.getByTestId('enterprise-skill-tab-trigger');
    fireEvent.focus(enterpriseSkillTab);
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.keyDown(enterpriseSkillTab, { key: 'ArrowDown' });
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'resource.skillGroup' }), { key: 'Enter' });

    expect(window.location.search).toContain('tab=enterprise');
    expect(mockSetSearchParams).toHaveBeenCalledWith(expect.objectContaining({}));
    expect(mockSetSearchParams.mock.calls[0][0].get('kind')).toBe('group');
    cleanup();
    renderAt('?tab=enterprise&kind=group');
    expect(screen.getByTestId('skill-group-list')).toBeTruthy();
    expect(screen.queryByTestId('resource-list')).toBeNull();
  });

  it('switches from personal skills to enterprise skill groups when clicking the group menu item', () => {
    mockSetSearchParams.mockReset();
    renderAt('?tab=personal');

    fireEvent.mouseEnter(screen.getByTestId('enterprise-skill-tab-trigger'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'resource.skillGroup' }));

    expect(window.location.search).toBe('?tab=enterprise&kind=group');
    expect(screen.getByTestId('enterprise-skill-tab-trigger')).toHaveTextContent('resource.official');
    expect(screen.getByTestId('skill-group-list')).toBeTruthy();
    expect(screen.queryByTestId('resource-list')).toBeNull();
  });

  it('opens on hover with a short delay without opening on click or focus', () => {
    renderAt('?tab=personal');

    const enterpriseSkillTab = screen.getByTestId('enterprise-skill-tab-trigger');
    expect(enterpriseSkillTab).toHaveAttribute('aria-haspopup', 'menu');
    expect(enterpriseSkillTab).toHaveAttribute('aria-expanded', 'false');
    expect(enterpriseSkillTab).toHaveAttribute('data-mouse-enter-delay', '0.12');
    expect(enterpriseSkillTab).toHaveAttribute('data-mouse-leave-delay', '0.1');
    expect(enterpriseSkillTab).toHaveAttribute('data-transition-name', 'enterprise-skill-dropdown-motion');
    expect(screen.getByTestId('enterprise-skill-dropdown-chevron')).toBeTruthy();

    fireEvent.focus(enterpriseSkillTab);
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(enterpriseSkillTab);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(enterpriseSkillTab).toHaveAttribute('aria-expanded', 'false');
    expect(window.location.search).toBe('?tab=enterprise');

    fireEvent.mouseEnter(enterpriseSkillTab);
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(enterpriseSkillTab).toHaveAttribute('aria-expanded', 'true');

    fireEvent.mouseLeave(enterpriseSkillTab);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(enterpriseSkillTab).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders the shared enterprise label in group mode and keeps single-skill mode for personal skills', () => {
    const groupView = renderAt('?tab=enterprise&kind=group');
    expect(screen.getByTestId('enterprise-skill-tab-trigger')).toHaveTextContent('resource.official');
    expect(screen.getByTestId('skill-group-list')).toBeTruthy();

    groupView.unmount();
    renderAt('?tab=personal&kind=group');
    expect(screen.getByTestId('resource-list')).toBeTruthy();
    expect(screen.queryByTestId('skill-group-list')).toBeNull();
  });

  it('hides no-op filters in enterprise group mode but preserves them for single skills', () => {
    renderAt('?tab=enterprise&kind=group');

    expect(screen.queryByTestId('resource-filter')).toBeNull();
    expect(screen.queryByText('Sales')).toBeNull();

    cleanup();
    renderAt('?tab=enterprise');

    expect(screen.getByTestId('resource-filter')).toBeTruthy();
    expect(screen.queryByText('Sales')).toBeNull();
    expect(mockResourceFilterProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        catalogOptions: expect.arrayContaining([{ value: 'catalog-1', label: 'Sales' }]),
      })
    );
    fireEvent.click(screen.getByTestId('resource-filter'));
    expect(screen.getByTestId('resource-list')).toHaveAttribute('data-catalog-id', 'catalog-1');
  });

  it('uses the upload entry to open the skill group create dialog and refresh the group list', async () => {
    renderAt('?tab=enterprise&kind=group');

    const importButton = await screen.findByRole('button', { name: 'common.import' });
    const initialMountId = Number(screen.getByTestId('skill-group-list').textContent);
    fireEvent.click(importButton);
    fireEvent.click(screen.getByTestId('skill-group-create-modal'));

    await waitFor(() =>
      expect(Number(screen.getByTestId('skill-group-list').textContent)).toBeGreaterThan(initialMountId)
    );
  });

  it('hides the skill group create entry from non AdminVip users', async () => {
    mockAdminVip = false;
    renderAt('?tab=enterprise&kind=group');

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: 'common.import' })).toBeNull();
  });

  it('clears enterprise skill kind when changing to another tab', () => {
    renderAt('?tab=enterprise&kind=group');

    fireEvent.click(screen.getByRole('button', { name: 'resource.available' }));
    expect(window.location.search).toBe('?tab=personal');

    fireEvent.click(screen.getByTestId('enterprise-skill-tab-trigger').closest('button')!);
    expect(window.location.search).toBe('?tab=enterprise');
    expect(screen.getByTestId('resource-list')).toBeTruthy();
    expect(screen.queryByTestId('skill-group-list')).toBeNull();
  });

  it('passes the selected enterprise group status to SkillGroupList for administrators', () => {
    renderAt('?tab=enterprise&kind=group');

    expect(mockSkillGroupProps).toHaveBeenCalledWith(
      expect.objectContaining({ ownerType: 'enterprise', resourceStatus: '2' })
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'common.status' }), { target: { value: '3' } });
    expect(mockSkillGroupProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ ownerType: 'enterprise', resourceStatus: '3' })
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'common.status' }), { target: { value: '' } });
    expect(mockSkillGroupProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ ownerType: 'enterprise', resourceStatus: undefined })
    );
  });

  it('restricts non-administrators to published enterprise skill groups', () => {
    mockAdminVip = false;
    renderAt('?tab=enterprise&kind=group');

    expect(screen.queryByRole('combobox', { name: 'common.status' })).toBeNull();
    expect(mockSkillGroupProps).toHaveBeenCalledWith(
      expect.objectContaining({ ownerType: 'enterprise', resourceStatus: 2 })
    );
  });

  it('refreshes the group list without resetting enterprise group mode', () => {
    renderAt('?tab=enterprise&kind=group');

    expect(screen.getByTestId('skill-group-list')).toHaveTextContent('1');

    act(() => {
      mockEventEmitter.emit('beyond-resourceList-resourceType-reload', {
        resourceType: 'SKILL',
        resetSkillFilters: false,
      });
    });

    expect(window.location.search).toBe('?tab=enterprise&kind=group');
    expect(screen.getByTestId('skill-group-list')).toHaveTextContent('2');
  });

  it('enters the three-tab my resources view from the new entry', () => {
    const Wrapper = () => {
      const [myResourcesOnly, setMyResourcesOnly] = React.useState(false);
      return (
        <Resources
          resourceType="SKILL"
          myResourcesOnly={myResourcesOnly}
          onMyResourcesOnlyChange={setMyResourcesOnly}
        />
      );
    };

    render(<Wrapper />);
    const mySkillsButton = screen.getByRole('button', { name: 'resourceCenter.mySkills' });
    // 我的资源入口与“我的员工”统一使用列表图标。
    expect(mySkillsButton.querySelector('[aria-label="unordered-list"]')).toBeInTheDocument();
    fireEvent.click(mySkillsButton);

    expect(screen.getByRole('button', { name: 'resourceCenter.personal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'resourceCenter.enterprise' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'resourceCenter.auditCenter' })).toBeInTheDocument();
    expect(screen.getByTestId('resource-list')).toBeInTheDocument();

    // 返回入口和搜索均独立于页签，避免再次挤进同一行。
    const personalTab = screen.getByRole('button', { name: 'resourceCenter.personal' });
    const backButton = screen.getByRole('button', { name: 'resourceCenter.backToAll' });
    const searchInput = screen.getByPlaceholderText('common.inputKeyword');
    expect(personalTab.parentElement).not.toContainElement(backButton);
    expect(personalTab.parentElement).not.toContainElement(searchInput);
    expect(screen.getAllByPlaceholderText('common.inputKeyword')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'resourceCenter.auditCenter' }));
    expect(screen.queryByPlaceholderText('common.inputKeyword')).not.toBeInTheDocument();
    fireEvent.click(backButton);
    expect(screen.getByRole('button', { name: 'resourceCenter.mySkills' })).toBeInTheDocument();
  });
});
