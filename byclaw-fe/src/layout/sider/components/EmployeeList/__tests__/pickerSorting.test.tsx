import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AllEmployees from '../components/AllEmployees';
import { queryMyCreatedAndSubscribedAgentsV2 } from '@/service/digitalEmployees';

const mockEvents = { on: jest.fn(), off: jest.fn() };
const mockIntl = { formatMessage: ({ id }: { id: string }) => id };
jest.mock('@umijs/max', () => ({ useIntl: () => mockIntl }));
jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({ EventEmitter: mockEvents, platform: 'desktop' }),
}));
jest.mock('@/layout/components/provider/global', () => ({ Platform: { mobile: 'mobile' } }));
jest.mock('..', () => ({
  EmployeeListContext: jest.requireActual('react').createContext({}),
  isInputMode: () => true,
  isExcludedEmployee: () => false,
}));
jest.mock('@/service/digitalEmployees', () => ({ queryMyCreatedAndSubscribedAgentsV2: jest.fn() }));
jest.mock('@/utils/agent', () => ({ agentHandler: (row: any) => row }));
jest.mock('react-dnd', () => ({ DndProvider: ({ children }: any) => children }));
jest.mock('react-dnd-html5-backend', () => ({ HTML5Backend: {} }));
jest.mock('@/components/QueryInput/withDrag', () => ({
  __esModule: true,
  default:
    () =>
    ({ children }: any) =>
      children,
  DragType: { digitalEmployee: 'digitalEmployee' },
}));
jest.mock('@/components/EmptyTips', () => () => null);
jest.mock('../EmployeeCard', () => ({ employee }: any) => (
  <div data-testid="employee" data-default={String(employee.isDefault)}>
    {employee.agentId}
  </div>
));
jest.mock('antd', () => ({
  Divider: () => null,
  Skeleton: () => null,
  Spin: () => null,
  List: ({ dataSource, renderItem }: any) => <div>{dataSource.map(renderItem)}</div>,
}));
jest.mock('@/components/InfiniteScroll', () => ({
  __esModule: true,
  default: ({ children, next, hasMore }: any) => (
    <div>
      {children}
      {hasMore && (
        <button type="button" onClick={next}>
          load more
        </button>
      )}
    </div>
  ),
}));

const row = (id: number) => ({ agentId: String(id), agentType: '016', isDefault: id === 1, isTop: '0' });

describe('new task employee picker sorting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('preserves backend default and usage order across pages and ignores manual pin events', async () => {
    const first = Array.from({ length: 30 }, (_, index) => row(index + 1));
    first[4] = { ...first[4], agentType: '017' };
    first[29] = { ...first[29], isTop: '1' };
    (queryMyCreatedAndSubscribedAgentsV2 as jest.Mock).mockImplementation(async ({ pageNum }) => ({
      list: pageNum === 1 ? first : [row(31)],
      pageNum,
      total: 31,
    }));
    render(<AllEmployees includeEmployeeGroups compactCard />);
    await waitFor(() => expect(screen.getAllByTestId('employee')).toHaveLength(30));
    fireEvent.click(screen.getByRole('button', { name: 'load more' }));
    await waitFor(() => expect(screen.getAllByTestId('employee')).toHaveLength(31));
    expect(screen.getAllByTestId('employee').map((item) => item.textContent)).toEqual(
      Array.from({ length: 31 }, (_, index) => String(index + 1))
    );
    const requests = (queryMyCreatedAndSubscribedAgentsV2 as jest.Mock).mock.calls.map(([params]) => params);
    expect(requests.map((params) => params.pageNum)).toEqual([1, 2]);
    requests.forEach((params) => {
      expect(params).toMatchObject({ sortMode: 'DEFAULT_USAGE_DESC', excludeEmployeeGroup: false, pageSize: 30 });
    });
    await act(async () => {
      mockEvents.on.mock.calls
        .filter(([event]) => event === 'beyond-update-employee')
        .forEach(([, handler]) => handler({ pinList: ['31'] }));
    });
    expect(screen.getAllByTestId('employee')[0]).toHaveTextContent(/^1$/);
    expect(screen.getAllByTestId('employee')[30]).toHaveTextContent(/^31$/);
  });

  it('retains sorting when searching and reloads server order after the default changes', async () => {
    (queryMyCreatedAndSubscribedAgentsV2 as jest.Mock).mockResolvedValue({ list: [row(1)], pageNum: 1, total: 1 });
    const ref = React.createRef<any>();
    render(<AllEmployees ref={ref} includeEmployeeGroups compactCard searchName="employee" />);
    await screen.findByTestId('employee');
    await act(async () => {
      ref.current.getSearch('employee');
    });
    (queryMyCreatedAndSubscribedAgentsV2 as jest.Mock).mockResolvedValue({
      list: [
        { ...row(9), isDefault: true },
        { ...row(1), isDefault: false },
      ],
      pageNum: 1,
      total: 2,
    });
    await act(async () => {
      mockEvents.on.mock.calls
        .filter(([event]) => event === 'beyond-update-employee')
        .forEach(([, handler]) => handler({ defaultResourceId: '9' }));
    });
    await waitFor(() => expect(screen.getAllByTestId('employee')).toHaveLength(2));
    expect(screen.getAllByTestId('employee').map((item) => item.textContent)).toEqual(['9', '1']);
    expect(screen.getAllByTestId('employee').map((item) => item.dataset.default)).toEqual(['true', 'false']);
    expect(queryMyCreatedAndSubscribedAgentsV2).toHaveBeenCalledTimes(3);
    (queryMyCreatedAndSubscribedAgentsV2 as jest.Mock).mock.calls.forEach(([params]) => {
      expect(params).toMatchObject({ sortMode: 'DEFAULT_USAGE_DESC', pageNum: 1, keyword: 'employee' });
    });
  });

  it('discards an old pending page when a default outside the loaded page becomes first', async () => {
    let resolveOldPage!: (value: any) => void;
    (queryMyCreatedAndSubscribedAgentsV2 as jest.Mock)
      .mockResolvedValueOnce({ list: Array.from({ length: 30 }, (_, index) => row(index + 1)), pageNum: 1, total: 60 })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOldPage = resolve;
          })
      )
      .mockResolvedValueOnce({
        list: [
          { ...row(50), isDefault: true },
          { ...row(1), isDefault: false },
        ],
        pageNum: 1,
        total: 2,
      });
    render(<AllEmployees includeEmployeeGroups compactCard />);
    await waitFor(() => expect(screen.getAllByTestId('employee')).toHaveLength(30));
    fireEvent.click(screen.getByRole('button', { name: 'load more' }));

    await act(async () => {
      mockEvents.on.mock.calls
        .filter(([event]) => event === 'beyond-update-employee')
        .forEach(([, handler]) => handler({ defaultResourceId: '50' }));
    });
    await waitFor(() => expect(screen.getAllByTestId('employee').map((item) => item.textContent)).toEqual(['50', '1']));
    await act(async () => {
      resolveOldPage({ list: [row(31), row(50)], pageNum: 2, total: 60 });
    });

    expect(screen.getAllByTestId('employee').map((item) => item.textContent)).toEqual(['50', '1']);
    expect(screen.getAllByTestId('employee').map((item) => item.dataset.default)).toEqual(['true', 'false']);
    expect(screen.queryByRole('button', { name: 'load more' })).toBeNull();
  });
});
