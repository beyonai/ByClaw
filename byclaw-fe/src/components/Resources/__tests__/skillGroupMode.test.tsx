const mockSetSearchParams = jest.fn();
const mockNavigate = jest.fn();
const mockResourceFilterProps = jest.fn();
let mockAdminVip = true;
let mockSkillGroupMountCount = 0;
const mockSkillGroupProps = jest.fn();
const mockOpenTemporaryDetailPanel = jest.fn();
const mockClearDetailPanel = jest.fn();
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
  useNavigate: () => mockNavigate,
  // mock 工厂会被提升，使用允许的全局对象读取 JSDOM 路由状态。
  useLocation: () => ({
    pathname: globalThis.location.pathname,
    search: globalThis.location.search,
    hash: globalThis.location.hash,
    state: globalThis.history.state,
    key: 'test',
  }),
  useSearchParams: () => {
    const [query, setQuery] = require('react').useState(globalThis.location.search);
    const params = new URLSearchParams(query);
    return [
      params,
      (nextParams: URLSearchParams, options?: { state?: unknown }) => {
        mockSetSearchParams(nextParams, options);
        const nextQuery = `?${nextParams.toString()}`;
        globalThis.history.pushState(options?.state || {}, '', `${globalThis.location.pathname}${nextQuery}`);
        setQuery(nextQuery);
      },
    ];
  },
}));

jest.mock('antd', () => ({
  message: { success: jest.fn(), error: jest.fn() },
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
  default: ({
    catalogId,
    enablePublishToEnterprise,
    dropdownParam,
    onDetail,
    onApplyUse,
    enableFavorites,
    activeTab,
  }: any) => (
    <div
      data-testid="resource-list"
      data-tab={activeTab}
      data-favorites-enabled={String(enableFavorites)}
      data-catalog-id={catalogId}
      data-status={dropdownParam?.resourceStatus}
      data-owner-type={dropdownParam?.ownerType || ''}
      data-permission={dropdownParam?.permission || ''}
      data-biz-types={(dropdownParam?.resourceBizTypeList || []).join(',')}
      data-enterprise-publication={String(enablePublishToEnterprise)}
    >
      <button onClick={() => onDetail({ resourceBizType: 'SKILL', resourceId: 'skill-1' })}>open skill</button>
      <button
        onClick={() => onDetail({ resourceBizType: 'KG_DOC', resourceId: 'knowledge-1', ownerType: 'enterprise' })}
      >
        open knowledge
      </button>
      <button onClick={() => onApplyUse({ resourceBizType: 'SKILL', resourceId: 'skill-1' })}>apply use</button>
    </div>
  ),
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
jest.mock('@/components/Resources/components/ResourceImport', () => ({
  __esModule: true,
  default: ({ visible }: any) => (visible ? <div data-testid="resource-import-modal" /> : null),
}));
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
  SiderContentContext: require('react').createContext({
    setDetailPanel: jest.fn(),
    clearDetailPanel: () => mockClearDetailPanel(),
    openTemporaryDetailPanel: (...args: any[]) => mockOpenTemporaryDetailPanel(...args),
  }),
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
jest.mock('@/constants/knowledge', () => ({
  resourceBizTypeMap: { KG_DOC: 'KG_DOC', KG_QA: 'KG_QA', KG_TERM: 'KG_TERM' },
}));
jest.mock('@/utils', () => ({ getRuntimeActualUrl: (value: string) => value }));
jest.mock('@/utils/auth', () => ({ getToken: () => '', isAdminVip: () => mockAdminVip }));

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import Resources from '..';
import { getDcSystemConfig } from '@/pages/manager/service/session';
import {
  applyResourceUse,
  queryFixedEntryOperationCapability,
  queryResourceUseApplyAudit,
} from '@/pages/manager/service/resources';

describe('Resources enterprise skill mode', () => {
  beforeEach(() => {
    (getDcSystemConfig as jest.Mock).mockImplementation(({ paramCode }) =>
      Promise.resolve(paramCode === 'BYAI_BRAND_VERSION' ? { paramValue: 'openSource' } : {})
    );
    mockResourceFilterProps.mockClear();
    mockNavigate.mockClear();
    mockAdminVip = true;
    (queryFixedEntryOperationCapability as jest.Mock).mockReset();
    (queryFixedEntryOperationCapability as jest.Mock).mockResolvedValue({ canImportEnterpriseSkill: true });
    mockSkillGroupMountCount = 0;
    mockSkillGroupProps.mockReset();
    Object.keys(mockEventHandlers).forEach((event) => delete mockEventHandlers[event]);
    mockEventEmitter.on.mockClear();
    mockEventEmitter.off.mockClear();
    mockEventEmitter.emit.mockClear();
    mockOpenTemporaryDetailPanel.mockClear();
    mockClearDetailPanel.mockClear();
  });

  const renderAt = (search: string) => {
    window.history.pushState({}, '', `/skillCenter${search}`);
    return render(<Resources resourceType="SKILL" />);
  };

  const setBrandVersion = (version: string | null | undefined) => {
    (getDcSystemConfig as jest.Mock).mockImplementation(({ paramCode }) =>
      Promise.resolve(paramCode === 'BYAI_BRAND_VERSION' ? { paramValue: version } : {})
    );
  };

  it.each(['personal', 'enterprise', 'favorites'])(
    'stores the resource center return route from the %s knowledge list',
    async (tab) => {
      if (tab === 'favorites') setBrandVersion('commercial');
      const state = { preserveDetailPanel: true };
      window.history.replaceState(state, '', `/resourceCenter?resourceTab=knowledge&tab=${tab}#resources`);
      render(<Resources resourceType="KG_DOC" />);
      const openKnowledge = await screen.findByText('open knowledge');
      await act(async () => {
        fireEvent.click(openKnowledge);
      });

      const [detailPath, options] = mockNavigate.mock.calls[0];
      const detailUrl = new URL(detailPath, window.location.origin);
      expect(detailUrl.pathname).toBe('/knowledgeDetail');
      expect(detailUrl.searchParams.get('resourceId')).toBe('knowledge-1');
      expect(detailUrl.searchParams.get('fromTab')).toBe(tab);
      expect(options.state.knowledgeDetailReturnLocation).toEqual({
        pathname: '/resourceCenter',
        search: `?resourceTab=knowledge&tab=${tab}`,
        hash: '#resources',
        state: { ...state, resourceCenterMyResourcesOnly: false },
      });
    }
  );

  it('restores the enterprise tab when my knowledge remounts after detail', async () => {
    window.history.replaceState(
      { resourceCenterMyResourcesOnly: true },
      '',
      '/resourceCenter?resourceTab=knowledge&tab=enterprise'
    );
    render(<Resources resourceType="KG_DOC" myResourcesOnly />);
    await waitFor(() => {
      expect(screen.getByTestId('resource-list')).toHaveAttribute('data-tab', 'enterprise');
    });
    fireEvent.click(screen.getByText('open knowledge'));
    expect(mockNavigate.mock.calls[0][1].state.knowledgeDetailReturnLocation.state).toEqual({
      resourceCenterMyResourcesOnly: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'resourceCenter.backToAll' }));
    expect(mockSetSearchParams).toHaveBeenLastCalledWith(expect.any(URLSearchParams), {
      state: { resourceCenterMyResourcesOnly: false },
    });
  });

  it('does not remount the resource list after submitting a use application', async () => {
    (applyResourceUse as jest.Mock).mockReset().mockResolvedValue({ code: 0 });
    renderAt('?tab=enterprise');
    const list = await screen.findByTestId('resource-list');

    await act(async () => {
      fireEvent.click(screen.getByText('apply use'));
    });

    expect(applyResourceUse).toHaveBeenCalledWith({ resourceId: 'skill-1' });
    expect(screen.getByTestId('resource-list')).toBe(list);
  });

  it.each(['SKILL', 'KG_DOC', 'TOOL'])(
    'loads official %s resources before the brand request finishes',
    async (resourceType) => {
      let resolveBrand!: (value: any) => void;
      (getDcSystemConfig as jest.Mock).mockImplementation(({ paramCode }) =>
        paramCode === 'BYAI_BRAND_VERSION'
          ? new Promise((resolve) => {
              resolveBrand = resolve;
            })
          : Promise.resolve({})
      );
      window.history.pushState({}, '', '/resourceCenter?tab=enterprise');
      render(<Resources resourceType={resourceType} />);
      expect(screen.getByTestId('resource-list')).toHaveAttribute('data-favorites-enabled', 'false');
      await act(async () => {
        resolveBrand({ paramValue: 'openSource' });
      });
      expect(screen.getByTestId('resource-list')).toHaveAttribute('data-favorites-enabled', 'false');
    }
  );

  // 三类资源分别使用浏览页签与管理入口的语言键，避免两处显示相同名称。
  it.each([
    ['KG_DOC', 'resource.myKnowledge', 'resourceCenter.myKnowledge'],
    ['SKILL', 'resource.mySkills', 'resourceCenter.mySkills'],
    ['TOOL', 'resource.myTools', 'resourceCenter.myTools'],
  ])('uses distinct browsing and management labels for %s', async (resourceType, browseLabel, manageLabel) => {
    render(<Resources resourceType={resourceType} onMyResourcesOnlyChange={jest.fn()} />);
    expect(await screen.findByRole('button', { name: browseLabel })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: manageLabel })).toBeInTheDocument();
    expect(screen.getByText('resource.official')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'resource.available' })).toBeNull();
  });

  it('places commercial favorites after official recommendations and before the skill market', async () => {
    setBrandVersion('commercial');
    renderAt('?tab=enterprise');
    const favorite = await screen.findByRole('button', { name: 'resource.myFavorites' });
    const tabs = favorite.parentElement?.querySelectorAll(':scope > button[aria-selected]');
    expect(Array.from(tabs || []).map((tab) => tab.textContent)).toEqual([
      'resource.mySkills',
      'resource.official',
      'resource.myFavorites',
      'resource.skillMarketplace',
    ]);
    expect(screen.getByTestId('resource-list')).toHaveAttribute('data-favorites-enabled', 'true');
    fireEvent.click(favorite);
    expect(screen.getByTestId('resource-list')).toHaveAttribute('data-tab', 'favorites');
    expect(screen.queryByTestId('skill-group-list')).toBeNull();
    expect(screen.queryByRole('button', { name: 'common.import' })).toBeNull();
  });

  it('keeps skill groups on their existing commercial list without favorites', async () => {
    setBrandVersion('commercial');
    renderAt('?tab=enterprise&kind=group');
    await screen.findByTestId('skill-group-list');
    expect(screen.queryByTestId('resource-list')).toBeNull();
    expect(mockSkillGroupProps.mock.calls.at(-1)?.[0]).not.toHaveProperty('enableFavorites');
  });

  it('does not add favorites to open-source or resource management tabs', async () => {
    setBrandVersion('openSource');
    renderAt('?tab=enterprise');
    await screen.findByTestId('resource-list');
    expect(screen.queryByRole('button', { name: 'resource.myFavorites' })).toBeNull();
    cleanup();
    setBrandVersion('commercial');
    render(<Resources resourceType="SKILL" myResourcesOnly />);
    await waitFor(() => expect(screen.getByTestId('resource-list')).toHaveAttribute('data-favorites-enabled', 'false'));
    expect(screen.queryByRole('button', { name: 'resource.myFavorites' })).toBeNull();
  });

  it('opens skill details as temporary panels and closes only that detail', async () => {
    renderAt('?tab=enterprise');
    fireEvent.click(await screen.findByRole('button', { name: 'open skill' }));
    expect(mockOpenTemporaryDetailPanel).toHaveBeenCalledWith(expect.any(Function), { width: 350 });
    const closeTemporary = jest.fn();
    const detail = mockOpenTemporaryDetailPanel.mock.calls[0][0](closeTemporary);
    expect(detail.props.resourceId).toBe('skill-1');
    detail.props.onClose();
    expect(closeTemporary).toHaveBeenCalledTimes(1);
    expect(mockClearDetailPanel).not.toHaveBeenCalled();
    expect(screen.getByTestId('resource-list')).toBeInTheDocument();
  });

  it.each([true, false])('shows noncommercial skill import for authorized users (AdminVip: %s)', async (adminVip) => {
    setBrandVersion('openSource');
    mockAdminVip = adminVip;
    renderAt('?tab=enterprise');

    const importButton = await screen.findByRole('button', { name: 'common.import' });
    expect(importButton).toBeEnabled();
    fireEvent.click(importButton);
    expect(screen.getByTestId('resource-import-modal')).toBeInTheDocument();
  });

  it.each([false, undefined])('hides official skill import without an explicit capability: %s', async (allowed) => {
    setBrandVersion('openSource');
    mockAdminVip = false;
    (queryFixedEntryOperationCapability as jest.Mock).mockResolvedValue({ canImportEnterpriseSkill: allowed });
    renderAt('?tab=enterprise');

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: 'common.import' })).not.toBeInTheDocument();
  });

  it('hides official skill import while permissions load and when the query fails', async () => {
    setBrandVersion('openSource');
    let rejectCapability!: (reason: Error) => void;
    (queryFixedEntryOperationCapability as jest.Mock).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectCapability = reject;
        })
    );
    renderAt('?tab=enterprise');

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: 'common.import' })).not.toBeInTheDocument();
    await act(async () => {
      rejectCapability(new Error('unavailable'));
    });
    expect(screen.queryByRole('button', { name: 'common.import' })).not.toBeInTheDocument();
  });

  it.each(['openSource', 'commercial', 'custom', '', undefined, null])(
    'keeps personal skill import available without official import permission for brand: %s',
    async (version) => {
      setBrandVersion(version);
      mockAdminVip = false;
      (queryFixedEntryOperationCapability as jest.Mock).mockResolvedValue({ canImportEnterpriseSkill: false });
      renderAt('?tab=personal');

      // 等待版本和权限返回，确认普通用户在配置加载后仍可打开导入弹窗。
      await act(async () => {
        await Promise.resolve();
      });
      const importButton = screen.getByRole('button', { name: 'common.import' });
      expect(importButton).toBeEnabled();
      expect(screen.queryByTestId('skill-export-toolbar')).not.toBeInTheDocument();
      fireEvent.click(importButton);
      expect(screen.getByTestId('resource-import-modal')).toBeInTheDocument();
    }
  );

  it.each(['openSource', 'custom', '', undefined, null])(
    'hides official skill import from ordinary users for noncommercial brand: %s',
    async (version) => {
      setBrandVersion(version);
      mockAdminVip = false;
      (queryFixedEntryOperationCapability as jest.Mock).mockResolvedValue({ canImportEnterpriseSkill: false });
      renderAt('?tab=enterprise');

      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByRole('button', { name: 'common.import' })).not.toBeInTheDocument();
      expect(screen.queryByTestId('skill-export-toolbar')).not.toBeInTheDocument();
    }
  );

  it.each([true, false, undefined])(
    'allows commercial skill import regardless of role capability: %s',
    async (allowed) => {
      setBrandVersion('commercial');
      mockAdminVip = false;
      (queryFixedEntryOperationCapability as jest.Mock).mockResolvedValue({ canImportEnterpriseSkill: allowed });
      renderAt('?tab=enterprise');

      const importButton = await screen.findByRole('button', { name: 'common.import' });
      expect(importButton).toBeEnabled();
      fireEvent.click(importButton);
      expect(screen.getByTestId('resource-import-modal')).toBeInTheDocument();
    }
  );

  it('waits for the brand before exposing official skill import', async () => {
    let resolveBrand!: (value: any) => void;
    (getDcSystemConfig as jest.Mock).mockImplementation(({ paramCode }) =>
      paramCode === 'BYAI_BRAND_VERSION'
        ? new Promise((resolve) => {
            resolveBrand = resolve;
          })
        : Promise.resolve({})
    );
    renderAt('?tab=enterprise');

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: 'common.import' })).not.toBeInTheDocument();
    await act(async () => {
      resolveBrand({ paramValue: 'openSource' });
    });
    expect(screen.getByRole('button', { name: 'common.import' })).toBeEnabled();
  });

  it('allows commercial official skill import even when role capabilities fail to load', async () => {
    setBrandVersion('commercial');
    mockAdminVip = false;
    (queryFixedEntryOperationCapability as jest.Mock).mockRejectedValue(new Error('unavailable'));
    renderAt('?tab=enterprise');

    expect(await screen.findByRole('button', { name: 'common.import' })).toBeEnabled();
  });

  it.each(['commercial', 'openSource'])(
    'uses the same brand rule for official skill group import: %s',
    async (version) => {
      setBrandVersion(version);
      mockAdminVip = false;
      (queryFixedEntryOperationCapability as jest.Mock).mockResolvedValue({
        canImportEnterpriseSkill: version !== 'commercial',
      });
      renderAt('?tab=enterprise&kind=group');

      const importButton = await screen.findByRole('button', { name: 'common.import' });
      expect(importButton).toBeEnabled();
      fireEvent.click(importButton);
      expect(screen.getByTestId('skill-group-create-modal')).toBeInTheDocument();
    }
  );

  it.each(['commercial', 'openSource', 'custom', '', undefined])(
    'enables enterprise publication only after loading a noncommercial brand: %s',
    async (version) => {
      let resolveBrand!: (value: any) => void;
      (getDcSystemConfig as jest.Mock).mockImplementation(({ paramCode }) =>
        paramCode === 'BYAI_BRAND_VERSION'
          ? new Promise((resolve) => {
              resolveBrand = resolve;
            })
          : Promise.resolve({})
      );
      renderAt('?tab=personal');
      expect(screen.getByTestId('resource-list')).toHaveAttribute('data-enterprise-publication', 'false');
      await act(async () => {
        resolveBrand({ paramValue: version });
      });
      await waitFor(() =>
        expect(screen.getByTestId('resource-list')).toHaveAttribute(
          'data-enterprise-publication',
          String(version !== 'commercial')
        )
      );
    }
  );

  it.each(['SKILL', 'KG_DOC', 'TOOL'])('hides status filters in available and official %s tabs', (resourceType) => {
    window.history.pushState({}, '', '/resourceCenter?tab=personal');
    render(<Resources resourceType={resourceType} />);

    expect(mockResourceFilterProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activeTab: 'personal',
        hideStatusFilter: true,
        resourceOwnerFilter: false,
        hidePermissionFilter: true,
      })
    );
    fireEvent.click(
      resourceType === 'SKILL'
        ? screen.getByTestId('enterprise-skill-tab-trigger').closest('button')!
        : screen.getByRole('button', { name: 'resource.official' })
    );
    expect(mockResourceFilterProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activeTab: 'enterprise',
        hideStatusFilter: true,
        resourceOwnerFilter: false,
        hidePermissionFilter: true,
      })
    );
  });

  it.each([
    ['SKILL', 'Skill'],
    ['KG_DOC', 'Knowledge'],
    ['TOOL', 'Tool'],
  ])(
    'preserves quick filters when confirming categories and resets them on tab changes for %s',
    (resourceType, suffix) => {
      window.history.pushState({}, '', '/resourceCenter?tab=personal');
      render(<Resources resourceType={resourceType} />);

      fireEvent.click(screen.getByRole('button', { name: `resource.tag.enterprise${suffix}` }));
      fireEvent.click(screen.getByRole('button', { name: 'resource.authorizedToMe' }));
      const list = screen.getByTestId('resource-list');
      expect(list).toHaveAttribute('data-owner-type', 'enterprise');
      expect(list).toHaveAttribute('data-permission', 'AUTHORIZED_TO_ME');
      expect(list).toHaveAttribute('data-status', '2');
      fireEvent.click(screen.getByTestId('resource-filter'));
      expect(list).toHaveAttribute('data-catalog-id', 'catalog-1');
      expect(list).toHaveAttribute('data-owner-type', 'enterprise');
      expect(list).toHaveAttribute('data-permission', 'AUTHORIZED_TO_ME');

      fireEvent.click(
        resourceType === 'SKILL'
          ? screen.getByTestId('enterprise-skill-tab-trigger').closest('button')!
          : screen.getByRole('button', { name: 'resource.official' })
      );
      expect(screen.queryAllByRole('group', { name: 'resource.type' })).toHaveLength(resourceType !== 'SKILL' ? 1 : 0);
      expect(screen.queryByRole('group', { name: 'resource.source' })).toBeNull();
      expect(list).toHaveAttribute('data-owner-type', '');
      expect(list).toHaveAttribute('data-permission', '');
      expect(list).toHaveAttribute('data-catalog-id', '');
      fireEvent.click(screen.getByRole('button', { name: 'resource.appliedByMe' }));
      expect(list).toHaveAttribute('data-permission', 'APPLIED_BY_ME');

      const personalLabel = resourceType === 'KG_DOC' ? 'resource.myKnowledge' : `resource.my${suffix}s`;
      fireEvent.click(screen.getByRole('button', { name: personalLabel }));
      expect(screen.getByRole('group', { name: 'resource.type' })).toBeInTheDocument();
      expect(screen.queryAllByRole('group', { name: 'resource.source' })).toHaveLength(resourceType !== 'SKILL' ? 1 : 0);
      expect(list).toHaveAttribute('data-permission', '');
      expect(screen.queryByRole('button', { name: 'resource.appliedByMe' })).toBeNull();
    }
  );

  it.each([
    ['TOOL', 'resource.mcp', 'MCP', 'resource.toolkit', 'TOOLKIT'],
    ['KG_DOC', 'resource.kgDoc', 'KG_DOC', 'resource.kgQa', 'KG_QA'],
  ])(
    'preserves external %s types when confirming categories and resets them on tab changes',
    (resourceType, firstLabel, firstValue, secondLabel, secondValue) => {
      window.history.pushState({}, '', '/resourceCenter?tab=personal');
      const { rerender } = render(<Resources resourceType={resourceType} />);
      const list = screen.getByTestId('resource-list');
      expect(mockResourceFilterProps).toHaveBeenLastCalledWith(
        expect.objectContaining({ hideResourceBizTypeFilter: true })
      );
      fireEvent.click(screen.getByRole('button', { name: firstLabel }));
      expect(list).toHaveAttribute('data-biz-types', firstValue);
      fireEvent.click(screen.getByTestId('resource-filter'));
      expect(list).toHaveAttribute('data-catalog-id', 'catalog-1');
      expect(list).toHaveAttribute('data-biz-types', firstValue);

      fireEvent.click(screen.getByRole('button', { name: 'resource.official' }));
      expect(list).toHaveAttribute('data-biz-types', '');
      fireEvent.click(screen.getByRole('button', { name: secondLabel }));
      expect(list).toHaveAttribute('data-biz-types', secondValue);
      const types = within(screen.getByRole('button', { name: firstLabel }).closest('[role="group"]')!);
      fireEvent.click(types.getByRole('button', { name: 'common.all' }));
      expect(list).toHaveAttribute('data-biz-types', '');

      // 管理工具与知识页沿用原弹层类型筛选，避免更改独立管理布局。
      rerender(<Resources resourceType={resourceType} myResourcesOnly />);
      expect(screen.queryByRole('button', { name: firstLabel })).toBeNull();
      expect(mockResourceFilterProps).toHaveBeenLastCalledWith(
        expect.objectContaining({ hideResourceBizTypeFilter: false })
      );
    }
  );

  it.each([
    { search: '?tab=personal', myResourcesOnly: true },
    { search: '?tab=enterprise&kind=group', myResourcesOnly: false },
    { search: '?tab=marketplace', myResourcesOnly: false },
  ])('hides quick filters outside resource browsing: $search / $myResourcesOnly', ({ search, myResourcesOnly }) => {
    window.history.pushState({}, '', `/resourceCenter${search}`);
    render(<Resources resourceType="SKILL" myResourcesOnly={myResourcesOnly} />);

    expect(screen.queryByRole('group', { name: 'resource.type' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'common.belong' })).toBeNull();
  });

  it.each([
    ['SKILL', 'resourceCenter.enterpriseSkills'],
    ['KG_DOC', 'resourceCenter.enterpriseKnowledge'],
    ['TOOL', 'resourceCenter.enterpriseTools'],
  ])(
    'shares compact toolbar spacing across personal and enterprise %s management',
    (resourceType, enterpriseLabel) => {
      window.history.pushState({}, '', '/resourceCenter?tab=personal');
      const { container, rerender } = render(<Resources resourceType={resourceType} myResourcesOnly />);

      expect(container.querySelector('.myResourcesToolbar')).toBeInTheDocument();
      expect(screen.getByTestId('resource-list')).toHaveAttribute('data-tab', 'personal');

      fireEvent.click(screen.getByRole('button', { name: enterpriseLabel }));
      expect(container.querySelector('.myResourcesToolbar')).toBeInTheDocument();
      expect(screen.getByTestId('resource-list')).toHaveAttribute('data-tab', 'enterprise');

      rerender(<Resources resourceType={resourceType} />);
      expect(container.querySelector('.myResourcesToolbar')).toBeNull();
    }
  );

  it.each([
    ['SKILL', 'resourceCenter.enterpriseSkills'],
    ['KG_DOC', 'resourceCenter.enterpriseKnowledge'],
    ['TOOL', 'resourceCenter.enterpriseTools'],
  ])('only shows supported status filters in my enterprise %s resources', (resourceType, enterpriseLabel) => {
    window.history.pushState({}, '', '/resourceCenter?tab=personal');
    render(<Resources resourceType={resourceType} myResourcesOnly />);

    if (resourceType === 'SKILL') {
      expect(screen.queryByTestId('resource-filter')).not.toBeInTheDocument();
    } else {
      expect(mockResourceFilterProps).toHaveBeenLastCalledWith(
        expect.objectContaining({
          activeTab: 'personal',
          hideStatusFilter: true,
          catalogOptions: undefined,
        })
      );
    }
    fireEvent.click(screen.getByRole('button', { name: enterpriseLabel }));
    if (resourceType === 'SKILL') {
      expect(screen.queryByTestId('resource-filter')).not.toBeInTheDocument();
    } else {
      expect(mockResourceFilterProps).toHaveBeenLastCalledWith(
        expect.objectContaining({
          activeTab: 'enterprise',
          hideStatusFilter: true,
          catalogOptions: undefined,
        })
      );
    }
    expect(screen.queryByRole('button', { name: 'resourceStatus.pendingShelf' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'resource.statusCancelled' })).toBeNull();
    for (const [label, value] of [
      ['common.all', ''],
      ['resourceStatus.draft', '0'],
      ['resourceStatus.published', '2'],
      ['resourceStatus.unpublished', '3'],
    ]) {
      const button = screen.getByRole('button', { name: label });
      fireEvent.click(button);
      expect(button).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('resource-list')).toHaveAttribute('data-status', value);
    }
  });

  it.each([
    ['KG_DOC', 'resourceCenter.myKnowledge', 'resourceCenter.personalKnowledge', 'resourceCenter.enterpriseKnowledge'],
    ['SKILL', 'resourceCenter.mySkills', 'resourceCenter.personalSkills', 'resourceCenter.enterpriseSkills'],
    ['TOOL', 'resourceCenter.myTools', 'resourceCenter.personalTools', 'resourceCenter.enterpriseTools'],
  ])(
    'keeps %s management separate from the approval center',
    async (resourceType, label, personalLabel, enterpriseLabel) => {
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
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(screen.getByRole('button', { name: personalLabel })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: enterpriseLabel })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'resourceCenter.auditCenter' })).not.toBeInTheDocument();
      expect(screen.queryByTestId('audit-badge')).not.toBeInTheDocument();
      expect(queryResourceUseApplyAudit).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'resourceCenter.backToAll' }));
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  );

  it('defaults to single skills and preserves the enterprise tab', async () => {
    renderAt('?tab=enterprise');

    expect(screen.getByTestId('enterprise-skill-tab-trigger').closest('button')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(await screen.findByTestId('resource-list')).toBeTruthy();
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
    expect(mockSetSearchParams).toHaveBeenCalledWith(expect.any(URLSearchParams), expect.any(Object));
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

  it('hides no-op filters in enterprise group mode but preserves them for single skills', async () => {
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
    expect(await screen.findByTestId('resource-list')).toHaveAttribute('data-catalog-id', 'catalog-1');
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

  it('hides the noncommercial skill group create entry from users without platform permission', async () => {
    setBrandVersion('openSource');
    (queryFixedEntryOperationCapability as jest.Mock).mockResolvedValue({ canImportEnterpriseSkill: false });
    mockAdminVip = false;
    renderAt('?tab=enterprise&kind=group');

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: 'common.import' })).toBeNull();
  });

  it('clears enterprise skill kind when changing to another tab', async () => {
    renderAt('?tab=enterprise&kind=group');

    fireEvent.click(screen.getByRole('button', { name: 'resource.mySkills' }));
    expect(window.location.search).toBe('?tab=personal');

    fireEvent.click(screen.getByTestId('enterprise-skill-tab-trigger').closest('button')!);
    expect(window.location.search).toBe('?tab=enterprise');
    expect(await screen.findByTestId('resource-list')).toBeTruthy();
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

  it('enters the personal and enterprise management view from the new entry', () => {
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

    expect(screen.getByRole('button', { name: 'resourceCenter.personalSkills' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'resourceCenter.enterpriseSkills' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'resourceCenter.auditCenter' })).not.toBeInTheDocument();
    expect(screen.getByTestId('resource-list')).toBeInTheDocument();

    // 返回入口和搜索均独立于页签，避免再次挤进同一行。
    const personalTab = screen.getByRole('button', { name: 'resourceCenter.personalSkills' });
    const backButton = screen.getByRole('button', { name: 'resourceCenter.backToAll' });
    const searchInput = screen.getByPlaceholderText('common.inputKeyword');
    expect(personalTab.parentElement).not.toContainElement(backButton);
    expect(personalTab.parentElement).not.toContainElement(searchInput);
    expect(screen.getAllByPlaceholderText('common.inputKeyword')).toHaveLength(1);

    fireEvent.click(backButton);
    expect(screen.getByRole('button', { name: 'resourceCenter.mySkills' })).toBeInTheDocument();
  });
});
