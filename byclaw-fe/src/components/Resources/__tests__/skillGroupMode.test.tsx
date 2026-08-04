const mockSetSearchParams = jest.fn();
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
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  Dropdown: ({ children, menu }: any) => {
    const [open, setOpen] = require('react').useState(false);
    const show = () => setOpen(true);
    return (
      <span onMouseEnter={show} onFocus={show} onClick={show} tabIndex={0}>
        {children}
        {open ? (
          <div role="menu">
            {menu.items.map((item: any) => (
              <button
                type="button"
                role="menuitem"
                key={item.key}
                onClick={() => menu.onClick?.({ key: item.key })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    menu.onClick?.({ key: item.key });
                  }
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
      </span>
    );
  },
  Empty: () => <div data-testid="empty" />,
  Input: (props: any) => <input {...props} />,
  Space: ({ children }: any) => <div>{children}</div>,
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
      {tabBarExtraContent}
    </div>
  ),
}));
jest.mock('@/components/AntdIcon', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/Resources/components/ResourceList', () => ({
  __esModule: true,
  default: () => <div data-testid="resource-list" />,
}));
jest.mock('@/components/Resources/components/SkillGroupList', () => ({
  __esModule: true,
  default: (props: any) => {
    mockSkillGroupProps(props);
    const mountId = require('react').useRef(++mockSkillGroupMountCount);
    return <div data-testid="skill-group-list">{mountId.current}</div>;
  },
}));
jest.mock('@/components/Resources/components/ResourceFilter', () => ({
  __esModule: true,
  default: () => <div data-testid="resource-filter" />,
  getDefaultParams: () => ({}),
}));
jest.mock('@/components/Resources/components/ResourceImport', () => ({ __esModule: true, default: () => null }));
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
  queryFixedEntryOperationCapability: jest.fn().mockResolvedValue({}),
  queryResourceOperationPermissions: jest.fn(),
}));
jest.mock('@/pages/manager/service/session', () => ({ getDcSystemConfig: jest.fn().mockResolvedValue({}) }));
jest.mock('@/pages/manager/service/DigitalEmployeeMgr', () => ({ saveTool: jest.fn() }));
jest.mock('@/constants/knowledge', () => ({ resourceBizTypeMap: {} }));
jest.mock('@/utils', () => ({ getRuntimeActualUrl: (value: string) => value }));
jest.mock('@/utils/auth', () => ({ getToken: () => '' }));

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import Resources from '..';

describe('Resources enterprise skill mode', () => {
  beforeEach(() => {
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

  it('defaults to single skills and preserves the enterprise tab', () => {
    renderAt('?tab=enterprise');

    expect(screen.getByText('resource.enterpriseSkillSingle')).toBeTruthy();
    expect(screen.getByTestId('resource-list')).toBeTruthy();
    expect(window.location.search).toBe('?tab=enterprise');
  });

  it('opens the enterprise skill menu from keyboard focus and switches to groups', async () => {
    mockSetSearchParams.mockReset();
    renderAt('?tab=enterprise');

    const enterpriseSkillTab = screen.getByText('resource.enterpriseSkillSingle');
    fireEvent.focus(enterpriseSkillTab);
    expect(screen.getByText('resource.skillGroup')).toBeTruthy();

    fireEvent.keyDown(enterpriseSkillTab, { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'resource.skillGroup' }), { key: 'Enter' });

    expect(window.location.search).toContain('tab=enterprise');
    expect(mockSetSearchParams).toHaveBeenCalledWith(expect.objectContaining({}));
    expect(mockSetSearchParams.mock.calls[0][0].get('kind')).toBe('group');
    cleanup();
    renderAt('?tab=enterprise&kind=group');
    expect(screen.getByTestId('skill-group-list')).toBeTruthy();
    expect(screen.queryByTestId('resource-list')).toBeNull();
  });

  it('renders the group mode label and keeps single-skill mode for personal skills', () => {
    const groupView = renderAt('?tab=enterprise&kind=group');
    expect(screen.getByText('resource.enterpriseSkillGroup')).toBeTruthy();
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
    expect(screen.getByText('Sales')).toBeTruthy();
  });

  it('clears enterprise skill kind when changing to another tab', () => {
    renderAt('?tab=enterprise&kind=group');

    fireEvent.click(screen.getByRole('button', { name: 'resource.personalcommon.skill' }));
    expect(window.location.search).toBe('?tab=personal');

    fireEvent.click(screen.getAllByRole('button', { name: 'resource.enterpriseSkillSingle' })[0]);
    expect(window.location.search).toBe('?tab=enterprise');
    expect(screen.getByText('resource.enterpriseSkillSingle')).toBeTruthy();
    expect(screen.queryByTestId('skill-group-list')).toBeNull();
  });

  it('passes enterprise active-group filters to SkillGroupList', () => {
    renderAt('?tab=enterprise&kind=group');

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
});
