import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AllDigitalEmployees from '../components/AllDigitalEmployees';
import { buildDigitalEmployeeFilterParam } from '../filterParams';
import { getAllDigitalEmployeesV2, queryMyCreatedAndSubscribedAgentsV2 } from '@/service/digitalEmployees';

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
  default: ({ resource, enableFavorites }: any) => (
    <div
      data-testid="card"
      data-id={resource.id}
      data-favorites={String(enableFavorites)}
      data-favorited={String(resource.favorited)}
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
    (getAllDigitalEmployeesV2 as jest.Mock).mockResolvedValue({ list: [row(1)], total: 1, pageNum: 1 });
    (queryMyCreatedAndSubscribedAgentsV2 as jest.Mock).mockResolvedValue({ list: [row(1)], total: 1, pageNum: 1 });
  });

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

  it('preserves personal type filtering and the original query in official recommendations', async () => {
    render(
      <AllDigitalEmployees
        source="official"
        mode="all"
        enableFavorites
        hideCategories
        dropdownParam={{ digitalEmployeeType: 'PERSONAL_EMPLOYEE' }}
        buildFilterParam={buildDigitalEmployeeFilterParam}
      />
    );
    await screen.findByTestId('card');
    const params = (getAllDigitalEmployeesV2 as jest.Mock).mock.calls[0][0];
    expect(params).toMatchObject({ ownerType: 'personal', resourceStatus: '2', includeEmployeeGroup: false });
    expect(params).not.toHaveProperty('includeFavorites');
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
      agentType: '017',
      permission: '2',
      resourceStatus: '2',
      includeFavorites: true,
    });
  });

  it.each(['official', 'favorites'] as const)(
    'keeps the imperative search keyword when paginating %s',
    async (source) => {
      const ref = React.createRef<any>();
      const first = Array.from({ length: 20 }, (_, index) => row(index + 1));
      (getAllDigitalEmployeesV2 as jest.Mock)
        .mockResolvedValueOnce({ list: [row(1)], total: 1, pageNum: 1 })
        .mockResolvedValueOnce({ list: first, total: 21, pageNum: 1 })
        .mockResolvedValueOnce({ list: [row(21)], total: 21, pageNum: 2 });
      render(<AllDigitalEmployees ref={ref} source={source} mode="all" enableFavorites hideCategories />);
      await screen.findByTestId('card');
      await act(async () => {
        await ref.current.getSearch('weather');
      });
      fireEvent.click(screen.getByRole('button', { name: 'load more' }));
      await waitFor(() => expect(screen.getAllByTestId('card')).toHaveLength(21));
      expect((getAllDigitalEmployeesV2 as jest.Mock).mock.calls[2][0]).toMatchObject({
        keyword: 'weather',
        pageNum: 2,
      });
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
