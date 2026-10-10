import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AllDigitalEmployees from '../components/AllDigitalEmployees';
import { buildDigitalEmployeeFilterParam } from '../filterParams';
import {
  getAllDigitalEmployeesV2,
  getCompositeAppInfo,
  queryMyCreatedAndSubscribedAgentsV2,
} from '@/service/digitalEmployees';

const mockIntl = { formatMessage: ({ id }: { id: string }) => id };
const mockEvents = { on: jest.fn(), off: jest.fn(), emit: jest.fn() };
const mockSearchParams = new URLSearchParams();
const mockSetSearchParams = jest.fn();
const mockDispatch = jest.fn();
const mockNavigate = jest.fn();

jest.mock('@umijs/max', () => ({
  useIntl: () => mockIntl,
  useDispatch: () => mockDispatch,
  useNavigate: () => mockNavigate,
  useSelector: (selector: any) => selector({ employees: { employeesTypeList: [] } }),
  useSearchParams: () => [mockSearchParams, mockSetSearchParams],
}));
jest.mock('@/hooks/useGlobal', () => ({ __esModule: true, default: () => ({ EventEmitter: mockEvents }) }));
jest.mock('@/hooks/useTracker', () => ({ __esModule: true, default: () => ({ trackerEmployeeClick: jest.fn() }) }));
jest.mock('@/utils', () => ({ getRuntimeActualUrl: (url: string) => url }));
jest.mock('@/utils/agent', () => ({
  agentHandler: (row: any) => ({ ...row, agentId: String(row.id) }),
  getAgentChatAvatar: () => null,
}));
jest.mock('@/service/digitalEmployees', () => ({
  getAllDigitalEmployeesV2: jest.fn(),
  queryMyCreatedAndSubscribedAgentsV2: jest.fn(),
  getCompositeAppInfo: jest.fn(),
}));
jest.mock('@/pages/manager/service/session', () => ({ getDcSystemConfig: jest.fn().mockResolvedValue({}) }));
jest.mock('@/pages/manager/service/resources', () => ({ applyResourceUse: jest.fn() }));
jest.mock('@/pages/manager/components/AuthListDrawer', () => () => null);
jest.mock('@/pages/manager/components/UseApplyAuditDrawer', () => () => null);
jest.mock('@/components/Empty', () => () => <div>empty</div>);
jest.mock('@/components/InfiniteScroll', () => ({
  __esModule: true,
  default: ({ children, next, hasMore }: any) => (
    <div>
      {children}
      {hasMore && <button onClick={next}>load more</button>}
    </div>
  ),
}));
jest.mock('@/components/Resources/components/ResourceCard', () => ({
  __esModule: true,
  default: ({ resource, enableFavorites, actionConfig }: any) => (
    <div
      data-testid="card"
      data-id={resource.id}
      data-favorites={String(enableFavorites)}
      data-favorited={String(resource.favorited)}
      data-default={String(resource.isDefault)}
      data-can-set-default={String(resource.canSetDefault)}
      data-lifecycle={String(actionConfig.enableDigitalEmployeeLifecycle)}
      data-delete={String(actionConfig.enableDigitalEmployeeDelete)}
      data-hidden-actions={actionConfig.hiddenMenuItemKeys.join(',')}
    >
      {resource.name}
    </div>
  ),
}));

const row = (id: number) => ({
  id,
  resourceId: id,
  name: `employee-${id}`,
  resourceStatus: 2,
  favorited: true,
  favoriteCount: 1,
});

describe('commercial employee favorite lists', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getCompositeAppInfo).mockReset().mockResolvedValue(undefined);
    (getAllDigitalEmployeesV2 as jest.Mock).mockResolvedValue({ list: [row(1)], total: 1, pageNum: 1 });
    (queryMyCreatedAndSubscribedAgentsV2 as jest.Mock).mockResolvedValue({ list: [row(1)], total: 1, pageNum: 1 });
  });

  // 员工和员工组共用页签配置，我的员工不再屏蔽授权及上下架，收藏页也统一遵循后端操作权限。
  it.each([
    ['available', 'employee', true, true, ''],
    ['available', 'group', true, true, ''],
    ['official', 'employee', true, true, ''],
    ['official', 'group', true, true, ''],
    ['favorites', 'employee', true, true, ''],
    ['favorites', 'group', true, true, ''],
  ] as const)('configures lifecycle actions for %s / %s', async (source, mode, lifecycle, deletion, hiddenActions) => {
    render(<AllDigitalEmployees source={source} mode={mode} hideCategories />);
    const card = await screen.findByTestId('card');
    expect(card).toHaveAttribute('data-lifecycle', String(lifecycle));
    expect(card).toHaveAttribute('data-delete', String(deletion));
    expect(card).toHaveAttribute('data-hidden-actions', hiddenActions);
  });

  // 设置默认后的事件更新默认标识并刷新权限，不隐藏当前员工入口，也不能放大其他员工的后端权限。
  it.each(['available', 'official', 'favorites'] as const)(
    'preserves backend set-default permissions after switching the default in %s',
    async (source) => {
      const employees = [
        { ...row(1), hasUsePermission: true, canSetDefault: true, operationPermissionsLoaded: true },
        { ...row(2), hasUsePermission: true, canSetDefault: false, operationPermissionsLoaded: true },
      ];
      (getAllDigitalEmployeesV2 as jest.Mock).mockResolvedValue({ list: employees, total: 2, pageNum: 1 });
      (queryMyCreatedAndSubscribedAgentsV2 as jest.Mock).mockResolvedValue({ list: employees, total: 2, pageNum: 1 });
      // 默认员工切换会重新读取受影响行的后端权限，详情 mock 必须返回 Promise 并保留权限差异。
      jest.mocked(getCompositeAppInfo).mockImplementation(async ({ resourceId }) => {
        const employee = employees.find((item) => String(item.resourceId) === String(resourceId));
        return employee
          ? { ...employee, operationPermissions: { hasUsePermission: true, canSetDefault: employee.canSetDefault } }
          : undefined;
      });
      render(<AllDigitalEmployees source={source} mode="all" hideCategories />);
      await waitFor(() => expect(screen.getAllByTestId('card')).toHaveLength(2));
      const handler = mockEvents.on.mock.calls.find(([event]) => event === 'beyond-update-employee')?.[1];
      expect(handler).toEqual(expect.any(Function));
      await act(async () => {
        handler({ defaultResourceId: '1' });
      });
      const cards = screen.getAllByTestId('card');
      expect(cards[0]).toHaveAttribute('data-default', 'true');
      expect(cards[0]).toHaveAttribute('data-can-set-default', 'true');
      expect(cards[1]).toHaveAttribute('data-default', 'false');
      expect(cards[1]).toHaveAttribute('data-can-set-default', 'false');
      expect(getCompositeAppInfo).toHaveBeenCalledWith({ resourceId: '1' });
      expect(getCompositeAppInfo).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['official', 'favorites'] as const)(
    'loads %s with one paged request and no per-card requests',
    async (source) => {
      render(<AllDigitalEmployees source={source} mode="all" enableFavorites hideCategories />);
      await screen.findByTestId('card');
      expect(getAllDigitalEmployeesV2).toHaveBeenCalledTimes(1);
      expect(getAllDigitalEmployeesV2).toHaveBeenCalledWith(
        expect.objectContaining({
          includeFavorites: true,
          favoritesOnly: source === 'favorites',
          employeeGroupFirst: false,
        }),
        expect.any(AbortController)
      );
      expect(screen.getByTestId('card')).toHaveAttribute('data-favorites', 'true');
    }
  );

  it.each(['official', 'favorites'] as const)('only keeps personal type filtering in favorites: %s', async (source) => {
    render(
      <AllDigitalEmployees
        source={source}
        mode="all"
        enableFavorites
        hideCategories
        dropdownParam={{ resourceStatus: '2', digitalEmployeeType: 'PERSONAL_EMPLOYEE' }}
        buildFilterParam={buildDigitalEmployeeFilterParam}
      />
    );
    await screen.findByTestId('card');
    const params = (getAllDigitalEmployeesV2 as jest.Mock).mock.calls[0][0];
    expect(params).toMatchObject({
      ownerType: source === 'official' ? 'enterprise' : 'personal',
      resourceStatus: '2',
      includeEmployeeGroup: source === 'official',
      includeFavorites: true,
      favoritesOnly: source === 'favorites',
    });
    expect(params).not.toHaveProperty('agentType');
  });

  // 类型条件必须在接口分页前生效，且搜索、翻页、恢复全部时不能保留上一种类型限制。
  it.each([
    ['ENTERPRISE_EMPLOYEE', { includeEmployeeGroup: false }],
    ['ENTERPRISE_GROUP', { includeEmployeeGroup: true, agentType: '017' }],
  ] as const)('retains official %s filtering through search and pagination', async (digitalEmployeeType, expected) => {
    const first = Array.from({ length: 20 }, (_, index) => row(index + 1));
    (getAllDigitalEmployeesV2 as jest.Mock).mockImplementation(async ({ pageNum }) => ({
      list: pageNum === 1 ? first : [row(21)],
      total: 21,
      pageNum,
    }));
    const ref = React.createRef<any>();
    render(
      <AllDigitalEmployees
        ref={ref}
        source="official"
        mode="all"
        enableFavorites
        hideCategories
        dropdownParam={{ digitalEmployeeType, permission: 'AUTHORIZED_TO_ME' }}
        buildFilterParam={buildDigitalEmployeeFilterParam}
      />
    );
    await waitFor(() => expect(screen.getAllByTestId('card')).toHaveLength(20));
    const expectedParams = {
      ownerType: 'enterprise',
      resourceStatus: '2',
      excludeDeleted: true,
      permission: 'AUTHORIZED_TO_ME',
      ...expected,
    };
    expect((getAllDigitalEmployeesV2 as jest.Mock).mock.calls[0][0]).toMatchObject({
      ...expectedParams,
      pageNum: 1,
    });
    await act(async () => {
      await ref.current.getSearch('employee keyword');
    });
    expect((getAllDigitalEmployeesV2 as jest.Mock).mock.calls[1][0]).toMatchObject({
      ...expectedParams,
      pageNum: 1,
      keyword: 'employee keyword',
    });
    fireEvent.click(screen.getByRole('button', { name: 'load more' }));
    await waitFor(() => expect(screen.getAllByTestId('card')).toHaveLength(21));
    expect((getAllDigitalEmployeesV2 as jest.Mock).mock.calls[2][0]).toMatchObject({
      ...expectedParams,
      pageNum: 2,
      keyword: 'employee keyword',
    });
    await act(async () => {
      await ref.current.getSearch('employee keyword', { digitalEmployeeType: '', permission: 'AUTHORIZED_TO_ME' });
    });
    const allParams = (getAllDigitalEmployeesV2 as jest.Mock).mock.calls[3][0];
    expect(allParams).toMatchObject({
      ownerType: 'enterprise',
      includeEmployeeGroup: true,
      pageNum: 1,
      keyword: 'employee keyword',
      permission: 'AUTHORIZED_TO_ME',
    });
    expect(allParams).not.toHaveProperty('agentType');
  });

  it('leaves available employees and noncommercial recommendations on their original requests', async () => {
    const available = render(<AllDigitalEmployees source="available" mode="all" enableFavorites hideCategories />);
    await screen.findByTestId('card');
    expect((queryMyCreatedAndSubscribedAgentsV2 as jest.Mock).mock.calls[0][0]).not.toHaveProperty('includeFavorites');
    expect(getAllDigitalEmployeesV2).not.toHaveBeenCalled();
    available.unmount();
    render(<AllDigitalEmployees source="official" mode="all" hideCategories />);
    await screen.findByTestId('card');
    expect((getAllDigitalEmployeesV2 as jest.Mock).mock.calls[0][0]).not.toHaveProperty('includeFavorites');
  });

  it('removes a canceled favorite without refetching and fills the shifted pagination boundary', async () => {
    const first = Array.from({ length: 20 }, (_, index) => row(index + 1));
    (getAllDigitalEmployeesV2 as jest.Mock)
      .mockResolvedValueOnce({ list: first, total: 21, pageNum: 1 })
      .mockResolvedValueOnce({ list: [...first.slice(1), row(21)], total: 20, pageNum: 1 });
    render(<AllDigitalEmployees source="favorites" mode="all" enableFavorites hideCategories />);
    await waitFor(() => expect(screen.getAllByTestId('card')).toHaveLength(20));
    act(() => {
      window.dispatchEvent(
        new CustomEvent('resourceFavoriteChanged', {
          detail: { resourceId: '1', favorited: false, favoriteCount: 0 },
        })
      );
    });
    expect(screen.getAllByTestId('card')).toHaveLength(19);
    expect(getAllDigitalEmployeesV2).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'load more' }));
    await waitFor(() => expect(screen.getAllByTestId('card')).toHaveLength(20));
    expect((getAllDigitalEmployeesV2 as jest.Mock).mock.calls[1][0]).toMatchObject({ pageNum: 1, favoritesOnly: true });
    expect(screen.getAllByTestId('card').map((card) => card.getAttribute('data-id'))).toEqual(
      Array.from({ length: 20 }, (_, index) => String(index + 2))
    );
  });

  it('enables commercial sorting when the brand arrives after the initial official list', async () => {
    const view = render(<AllDigitalEmployees source="official" mode="all" hideCategories />);
    await screen.findByTestId('card');
    expect((getAllDigitalEmployeesV2 as jest.Mock).mock.calls[0][0]).not.toHaveProperty('includeFavorites');
    view.rerender(<AllDigitalEmployees source="official" mode="all" enableFavorites hideCategories />);
    await waitFor(() => expect(getAllDigitalEmployeesV2).toHaveBeenCalledTimes(2));
    expect((getAllDigitalEmployeesV2 as jest.Mock).mock.calls[1][0]).toMatchObject({ includeFavorites: true });
  });

  it('keeps the active keyword and filters when a late brand response enables commercial sorting', async () => {
    const ref = React.createRef<any>();
    const view = render(
      <AllDigitalEmployees
        ref={ref}
        source="official"
        mode="all"
        hideCategories
        buildFilterParam={buildDigitalEmployeeFilterParam}
      />
    );
    await screen.findByTestId('card');
    await act(async () => {
      await ref.current.getSearch('weather', { digitalEmployeeType: 'ENTERPRISE_GROUP', permission: '2' });
    });
    view.rerender(
      <AllDigitalEmployees
        ref={ref}
        source="official"
        mode="all"
        enableFavorites
        hideCategories
        buildFilterParam={buildDigitalEmployeeFilterParam}
      />
    );
    await waitFor(() => expect(getAllDigitalEmployeesV2).toHaveBeenCalledTimes(3));
    expect((getAllDigitalEmployeesV2 as jest.Mock).mock.calls[2][0]).toMatchObject({
      keyword: 'weather',
      ownerType: 'enterprise',
      includeEmployeeGroup: true,
      agentType: '017',
      permission: '2',
      resourceStatus: '2',
      includeFavorites: true,
    });
  });

  it.each(['official', 'favorites'] as const)(
    'keeps the keyword and permission with source-specific type filtering when paginating %s',
    async (source) => {
      const ref = React.createRef<any>();
      const first = Array.from({ length: 20 }, (_, index) => row(index + 1));
      (getAllDigitalEmployeesV2 as jest.Mock)
        .mockResolvedValueOnce({ list: [row(1)], total: 1, pageNum: 1 })
        .mockResolvedValueOnce({ list: first, total: 21, pageNum: 1 })
        .mockResolvedValueOnce({ list: [row(21)], total: 21, pageNum: 2 });
      render(
        <AllDigitalEmployees
          ref={ref}
          source={source}
          mode="all"
          enableFavorites
          hideCategories
          buildFilterParam={buildDigitalEmployeeFilterParam}
        />
      );
      await screen.findByTestId('card');
      await act(async () => {
        await ref.current.getSearch('weather', {
          digitalEmployeeType: 'ENTERPRISE_GROUP',
          permission: 'AUTHORIZED_TO_ME',
        });
      });
      fireEvent.click(screen.getByRole('button', { name: 'load more' }));
      await waitFor(() => expect(screen.getAllByTestId('card')).toHaveLength(21));
      const params = (getAllDigitalEmployeesV2 as jest.Mock).mock.calls[2][0];
      expect(params).toMatchObject({
        keyword: 'weather',
        pageNum: 2,
        ownerType: 'enterprise',
        permission: 'AUTHORIZED_TO_ME',
      });
      // 企业推荐和收藏均保留显式员工组条件，避免分页混入员工。
      expect(params).toMatchObject({ includeEmployeeGroup: true, agentType: '017' });
    }
  );

  it.each(['official', 'favorites'] as const)(
    'does not restore canceled state from an in-flight %s request',
    async (source) => {
      let finishOld!: (value: any) => void;
      (getAllDigitalEmployeesV2 as jest.Mock)
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishOld = resolve;
            })
        )
        .mockResolvedValueOnce({
          list: source === 'favorites' ? [row(2)] : [{ ...row(1), favorited: false, favoriteCount: 0 }, row(2)],
          total: source === 'favorites' ? 1 : 2,
          pageNum: 1,
        });
      render(<AllDigitalEmployees source={source} mode="all" enableFavorites hideCategories searchName="query" />);
      await waitFor(() => expect(getAllDigitalEmployeesV2).toHaveBeenCalledTimes(1));
      act(() => {
        window.dispatchEvent(
          new CustomEvent('resourceFavoriteChanged', {
            detail: { resourceId: '1', favorited: false, favoriteCount: 0 },
          })
        );
      });
      await act(async () => {
        finishOld({ list: [row(1), row(2)], total: 2, pageNum: 1 });
      });
      await waitFor(() => expect(getAllDigitalEmployeesV2).toHaveBeenCalledTimes(2));
      expect((getAllDigitalEmployeesV2 as jest.Mock).mock.calls[1][0]).toMatchObject({
        keyword: 'query',
        favoritesOnly: source === 'favorites',
      });
      if (source === 'favorites') {
        expect(screen.queryByText('employee-1')).toBeNull();
        expect(screen.getAllByTestId('card')).toHaveLength(1);
      } else {
        expect(screen.getByText('employee-1')).toHaveAttribute('data-favorited', 'false');
      }
    }
  );

  it('retries the shifted boundary page if cancellation completes during pagination', async () => {
    let finishOld!: (value: any) => void;
    const first = Array.from({ length: 20 }, (_, index) => row(index + 1));
    (getAllDigitalEmployeesV2 as jest.Mock)
      .mockResolvedValueOnce({ list: first, total: 21, pageNum: 1 })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          })
      )
      .mockResolvedValueOnce({ list: [...first.slice(1), row(21)], total: 20, pageNum: 1 });
    render(<AllDigitalEmployees source="favorites" mode="all" enableFavorites hideCategories />);
    await waitFor(() => expect(screen.getAllByTestId('card')).toHaveLength(20));
    fireEvent.click(screen.getByRole('button', { name: 'load more' }));
    act(() => {
      window.dispatchEvent(
        new CustomEvent('resourceFavoriteChanged', {
          detail: { resourceId: '1', favorited: false, favoriteCount: 0 },
        })
      );
    });
    await act(async () => {
      finishOld({ list: [row(21)], total: 21, pageNum: 2 });
    });
    await waitFor(() => expect(screen.getAllByTestId('card')).toHaveLength(20));
    expect((getAllDigitalEmployeesV2 as jest.Mock).mock.calls.map(([params]) => params.pageNum)).toEqual([1, 2, 1]);
    expect(screen.queryByText('employee-1')).toBeNull();
    expect(screen.queryByRole('button', { name: 'load more' })).toBeNull();
  });
});
