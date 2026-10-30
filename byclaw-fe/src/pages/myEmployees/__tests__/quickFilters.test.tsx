import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider, message } from 'antd';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { IAgentCache } from '@/typescript/agent';
import { queryManagedEnterpriseEmployees, queryMyCreated } from '@/service/digitalEmployees';
import MyEmployeesPage from '..';

const mockNavigate = jest.fn();
const mockRefreshEmployee = jest.fn();
const mockRemoveVisibleEmployee = jest.fn();
const mockInfiniteScroll = jest.fn();

jest.mock('@umijs/max', () => {
  // 保持 intl 引用稳定，避免筛选请求的 effect 因测试 mock 的引用变化反复触发。
  const intl = { formatMessage: ({ id }: { id: string }) => id };
  return { useIntl: () => intl, getIntl: () => intl, useNavigate: () => mockNavigate };
});
jest.mock('@/service/digitalEmployees', () => ({
  queryMyCreated: jest.fn(),
  queryManagedEnterpriseEmployees: jest.fn(),
  deleteDigitalEmployee: jest.fn(),
  shelfDigitalEmployee: jest.fn(),
  unShelfDigitalEmployee: jest.fn(),
}));
jest.mock('@/utils/agent', () => ({ agentHandler: (item: unknown) => item, getAgentChatAvatar: () => null }));
jest.mock('@/hooks/useEmployeeRowRefresh', () => ({
  __esModule: true,
  default: (list: IAgentCache[], setList: Dispatch<SetStateAction<IAgentCache[]>>, onRemove: () => void) => {
    mockRemoveVisibleEmployee.mockImplementation(() => {
      if (list.length === 0) return;
      setList((current) => current.slice(0, -1));
      onRemove();
    });
    return mockRefreshEmployee;
  },
  employeeRowId: jest.fn(),
  removeEmployeeRow: jest.fn(),
  updateEmployeeRow: jest.fn(),
}));
jest.mock('@/components/InfiniteScroll', () => ({
  __esModule: true,
  default: (props: { children: ReactNode; next: () => Promise<void>; hasMore: boolean; isLoading: boolean }) => {
    mockInfiniteScroll(props);
    return (
      <>
        {props.children}
        <button
          type="button"
          data-testid="load-more"
          disabled={!props.hasMore || props.isLoading}
          onClick={() => void props.next()}
        >
          Load more
        </button>
      </>
    );
  },
}));
jest.mock('@/components/Resources/components/ResourceCard', () => ({
  __esModule: true,
  default: ({ resource, variant }: { resource: { resourceName: string }; variant: string }) =>
    variant === 'employeeRow' ? (
      <tr>
        <td>{resource.resourceName}</td>
      </tr>
    ) : (
      <article>{resource.resourceName}</article>
    ),
}));
jest.mock('@/pages/digitalEmployees', () => ({ EmployeePreviewModal: () => null }));
jest.mock('@/pages/manager/components/AuthListDrawer', () => ({ __esModule: true, default: () => null }));
jest.mock('@/pages/manager/service/resources', () => ({ applyResourceUse: jest.fn() }));

const renderPage = () =>
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <MyEmployeesPage />
    </ConfigProvider>
  );

function employeeBatch(pageNum: number, count = 12) {
  return Array.from({ length: count }, (_, index) => ({
    resourceId: `${pageNum}-${index}`,
    resourceName: `Employee ${pageNum}-${index}`,
  }));
}

describe('employee management quick filters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    (queryMyCreated as jest.Mock).mockResolvedValue({ list: [], total: 0 });
    (queryManagedEnterpriseEmployees as jest.Mock).mockResolvedValue({ list: [], total: 0 });
  });

  it('keeps search in the right-side tab slot and preserves keyword requests across tabs', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(queryMyCreated).toHaveBeenCalled());
    const search = screen.getByPlaceholderText('myEmployees.searchPlaceholder');
    expect(search.closest('.ant-tabs-extra-content')).toBeInTheDocument();
    expect(container.querySelector('.toolbar')).not.toContainElement(search);

    fireEvent.change(search, { target: { value: 'employee keyword' } });
    await waitFor(() =>
      expect(queryMyCreated).toHaveBeenLastCalledWith(expect.objectContaining({ keyword: 'employee keyword' }))
    );
    fireEvent.click(screen.getByRole('tab', { name: 'myEmployees.enterprise' }));
    expect(search).toHaveValue('');
    expect(search.closest('.ant-tabs-extra-content')).toBeInTheDocument();
    await waitFor(() =>
      expect(queryManagedEnterpriseEmployees).toHaveBeenLastCalledWith(expect.objectContaining({ keyword: undefined }))
    );
  });

  it('uses shared pill buttons while preserving personal employee and group requests', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(queryMyCreated).toHaveBeenCalled());
    expect(container.querySelector('.filters.container')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'common.belong' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'common.status' })).toBeNull();
    const types = within(screen.getByRole('group', { name: 'resource.type' }));

    for (const [label, agentType, includeEmployeeGroup] of [
      ['myEmployees.employee', undefined, false],
      ['myEmployees.group', '017', false],
      ['myEmployees.all', undefined, true],
    ] as const) {
      const button = types.getByRole('button', { name: label });
      fireEvent.click(button);
      expect(button).toHaveClass('option', 'active');
      expect(button).toHaveAttribute('aria-pressed', 'true');
      await waitFor(() =>
        expect(queryMyCreated).toHaveBeenLastCalledWith(
          expect.objectContaining({ type: 'owner', agentType, includeEmployeeGroup, includeAllResourceStatus: true })
        )
      );
    }
  });

  it('defaults enterprise management to all statuses on entry', async () => {
    renderPage();
    await waitFor(() => expect(queryMyCreated).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('tab', { name: 'myEmployees.enterprise' }));
    const statuses = within(screen.getByRole('group', { name: 'common.status' }));
    expect(statuses.getByRole('button', { name: 'myEmployees.all' })).toHaveAttribute('aria-pressed', 'true');
    expect(statuses.getByRole('button', { name: 'resourceStatus.published' })).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() =>
      expect(queryManagedEnterpriseEmployees).toHaveBeenLastCalledWith(
        expect.objectContaining({ includeAllResourceStatus: true })
      )
    );
    expect((queryManagedEnterpriseEmployees as jest.Mock).mock.calls.at(-1)?.[0]).not.toHaveProperty('resourceStatus');
  });

  // 此用例连续验证多个筛选请求及页签重置，为真实 AntD 交互保留 15 秒总预算。
  it('preserves enterprise scope and status filters and resets them when switching tabs', async () => {
    // 请求均为立即返回的 mock；等待 effect 和响应状态更新完成后直接断言，避免逐步轮询。
    await act(async () => {
      renderPage();
    });
    const clickAndFlush = async (element: HTMLElement) => {
      await act(async () => {
        fireEvent.click(element);
      });
    };
    expect(queryMyCreated).toHaveBeenCalled();
    // 在真实页签内按文案定位，避免反复计算整页的无障碍名称和 CSS 可见性。
    const tabs = within(screen.getByRole('tablist', { hidden: true }));
    const enterpriseTab = tabs.getByText('myEmployees.enterprise').closest<HTMLElement>('[role="tab"]')!;
    const personalTab = tabs.getByText('myEmployees.personal').closest<HTMLElement>('[role="tab"]')!;
    await clickAndFlush(enterpriseTab);
    expect(queryManagedEnterpriseEmployees).toHaveBeenCalled();
    const types = within(screen.getByRole('group', { name: 'resource.type' }));
    const permissions = within(screen.getByRole('group', { name: 'common.belong' }));
    const statuses = within(screen.getByRole('group', { name: 'common.status' }));
    await clickAndFlush(types.getByText('myEmployees.group'));

    for (const [label, type] of [
      ['myEmployees.createdByMe', 'owner'],
      ['myEmployees.managedByMe', 'managerExcludingOwner'],
      ['myEmployees.all', 'ownerOrManager'],
    ]) {
      const button = permissions.getByText(label);
      await clickAndFlush(button);
      expect(button).toHaveClass('option', 'active');
      expect(queryManagedEnterpriseEmployees).toHaveBeenLastCalledWith(
        expect.objectContaining({ type, agentType: '017', includeEmployeeGroup: false })
      );
    }
    for (const [label, resourceStatus] of [
      ['resourceStatus.draft', 0],
      ['resourceStatus.published', 2],
      ['resourceStatus.unpublished', 3],
    ] as const) {
      const button = statuses.getByText(label);
      await clickAndFlush(button);
      expect(button).toHaveClass('option', 'active');
      expect(queryManagedEnterpriseEmployees).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: 'ownerOrManager', agentType: '017', resourceStatus })
      );
      expect((queryManagedEnterpriseEmployees as jest.Mock).mock.calls.at(-1)?.[0]).not.toHaveProperty(
        'includeAllResourceStatus'
      );
    }
    await clickAndFlush(statuses.getByText('myEmployees.all'));
    expect(queryManagedEnterpriseEmployees).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeAllResourceStatus: true })
    );
    expect((queryManagedEnterpriseEmployees as jest.Mock).mock.calls.at(-1)?.[0]).not.toHaveProperty('resourceStatus');

    await clickAndFlush(personalTab);
    expect(queryMyCreated).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'owner', agentType: undefined, includeEmployeeGroup: true })
    );
    await clickAndFlush(enterpriseTab);
    for (const title of ['resource.type', 'common.belong', 'common.status']) {
      const group = within(screen.getByRole('group', { name: title }));
      expect(group.getByText('myEmployees.all')).toHaveAttribute('aria-pressed', 'true');
    }
    expect(queryManagedEnterpriseEmployees).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'ownerOrManager', agentType: undefined, includeAllResourceStatus: true })
    );
  }, 15000);
  it.each(['card', 'list'])('appends employees in the %s view and retains them when switching views', async (view) => {
    localStorage.setItem('byclaw-my-employees-view', view);
    (queryMyCreated as jest.Mock).mockImplementation(({ pageNum }) =>
      Promise.resolve({
        list: employeeBatch(pageNum, pageNum === 1 ? 12 : 1),
        total: 13,
      })
    );
    const { container } = renderPage();
    await screen.findByText('Employee 1-0');

    // 装饰图标不应将英文图标名拼入视图按钮的无障碍名称。
    const viewSwitch = within(screen.getByRole('group', { name: 'myEmployees.view' }));
    expect(viewSwitch.getByRole('button', { name: 'myEmployees.cardView' })).toHaveAttribute(
      'aria-pressed',
      String(view === 'card')
    );
    expect(viewSwitch.getByRole('button', { name: 'myEmployees.listView' })).toHaveAttribute(
      'aria-pressed',
      String(view === 'list')
    );
    expect(viewSwitch.queryByRole('img')).not.toBeInTheDocument();
    expect(queryMyCreated).toHaveBeenLastCalledWith(expect.objectContaining({ pageNum: 1, pageSize: 12 }));
    expect(container.querySelector('.ant-pagination')).not.toBeInTheDocument();
    expect(mockInfiniteScroll.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        autoFill: true,
        scrollableTarget: 'myEmployeesScroller',
        appendItemsAutoScrollBottom: false,
      })
    );
    fireEvent.click(screen.getByTestId('load-more'));
    await screen.findByText('Employee 2-0');
    expect(screen.getByText('Employee 1-0')).toBeInTheDocument();
    expect(queryMyCreated).toHaveBeenLastCalledWith(expect.objectContaining({ pageNum: 2, pageSize: 12 }));
    expect(screen.getByTestId('load-more')).toBeDisabled();
    const requestCount = (queryMyCreated as jest.Mock).mock.calls.length;
    const nextView = view === 'card' ? 'list' : 'card';
    fireEvent.click(screen.getByRole('button', { name: `myEmployees.${nextView}View` }));
    expect(screen.getByText('Employee 1-0')).toBeInTheDocument();
    expect(screen.getByText('Employee 2-0')).toBeInTheDocument();
    expect(queryMyCreated).toHaveBeenCalledTimes(requestCount);
    expect(localStorage.getItem('byclaw-my-employees-view')).toBe(nextView);
    fireEvent.click(within(screen.getByRole('group', { name: 'resource.type' })).getByText('myEmployees.group'));
    await waitFor(() =>
      expect(queryMyCreated).toHaveBeenLastCalledWith(expect.objectContaining({ pageNum: 1, agentType: '017' }))
    );
    expect(screen.queryByText('Employee 2-0')).not.toBeInTheDocument();
  });

  it('blocks concurrent continuation requests and retries the failed batch without clearing existing rows', async () => {
    let failNextBatch!: (error: Error) => void;
    (queryMyCreated as jest.Mock)
      .mockResolvedValueOnce({ list: employeeBatch(1), total: 13 })
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failNextBatch = reject;
          })
      )
      .mockResolvedValueOnce({ list: employeeBatch(2, 1), total: 13 });
    const errorMessage = jest.spyOn(message, 'error').mockImplementation(jest.fn());
    try {
      renderPage();
      await screen.findByText('Employee 1-0');
      const { next } = mockInfiniteScroll.mock.calls.at(-1)[0];
      await act(async () => {
        void next();
        void next();
      });
      expect(queryMyCreated).toHaveBeenCalledTimes(2);
      await act(async () => {
        failNextBatch(new Error('Load failed'));
      });
      expect(screen.getByText('Employee 1-0')).toBeInTheDocument();
      expect(screen.getByTestId('load-more')).toBeEnabled();
      fireEvent.click(screen.getByTestId('load-more'));
      await screen.findByText('Employee 2-0');
      expect(queryMyCreated).toHaveBeenLastCalledWith(expect.objectContaining({ pageNum: 2 }));
      expect(screen.getAllByRole('article')).toHaveLength(13);
    } finally {
      errorMessage.mockRestore();
    }
  });

  it('stops loading after an empty batch even if the server total is stale', async () => {
    (queryMyCreated as jest.Mock)
      .mockResolvedValueOnce({ list: employeeBatch(1), total: 100 })
      .mockResolvedValueOnce({ list: [], total: 100 });
    renderPage();
    await screen.findByText('Employee 1-0');
    await act(async () => {
      fireEvent.click(screen.getByTestId('load-more'));
    });
    expect(queryMyCreated).toHaveBeenLastCalledWith(expect.objectContaining({ pageNum: 2 }));
    expect(screen.getByTestId('load-more')).toBeDisabled();
    expect(screen.getAllByRole('article')).toHaveLength(12);
  });

  it('restores the list preference and adds ownership and status columns only for enterprise employees', async () => {
    localStorage.setItem('byclaw-my-employees-view', 'list');
    const response = { list: [{ resourceId: '1', resourceName: 'Employee' }], total: 1 };
    (queryMyCreated as jest.Mock).mockResolvedValue(response);
    (queryManagedEnterpriseEmployees as jest.Mock).mockResolvedValue(response);
    renderPage();
    await screen.findByRole('table');
    expect(screen.getAllByRole('columnheader')).toHaveLength(5);
    fireEvent.click(screen.getByRole('tab', { name: 'myEmployees.enterprise' }));
    await screen.findByRole('table');
    expect(screen.getAllByRole('columnheader')).toHaveLength(7);
    expect(screen.getByRole('columnheader', { name: 'common.belong' })).toBeInTheDocument();
  });

  it('submits the latest input immediately and resets empty results with their filters', async () => {
    renderPage();
    await waitFor(() => expect(queryMyCreated).toHaveBeenCalled());
    const search = screen.getByPlaceholderText('myEmployees.searchPlaceholder');
    fireEvent.change(search, { target: { value: 'new keyword' } });
    fireEvent.keyDown(search, { key: 'Enter', code: 'Enter', charCode: 13, keyCode: 13 });
    await waitFor(() =>
      expect(queryMyCreated).toHaveBeenLastCalledWith(expect.objectContaining({ pageNum: 1, keyword: 'new keyword' }))
    );
    fireEvent.click(screen.getByRole('button', { name: 'myEmployees.clearFilters' }));
    await waitFor(() =>
      expect(queryMyCreated).toHaveBeenLastCalledWith(
        expect.objectContaining({ pageNum: 1, keyword: undefined, includeEmployeeGroup: true })
      )
    );
    expect(search).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'myEmployees.resetFilters' })).not.toBeInTheDocument();
  });

  it('ignores an older personal response after changing tabs', async () => {
    let finishPersonal!: (value: unknown) => void;
    (queryMyCreated as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        finishPersonal = resolve;
      })
    );
    (queryManagedEnterpriseEmployees as jest.Mock).mockResolvedValue({
      list: [{ resourceId: 'enterprise', resourceName: 'Enterprise employee' }],
      total: 1,
    });
    renderPage();
    await waitFor(() => expect(queryMyCreated).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('tab', { name: 'myEmployees.enterprise' }));
    await screen.findByText('Enterprise employee');
    await act(async () => {
      finishPersonal({ list: [{ resourceId: 'personal', resourceName: 'Old personal employee' }], total: 1 });
    });
    expect(screen.queryByText('Old personal employee')).not.toBeInTheDocument();
    expect(screen.getByText('Enterprise employee')).toBeInTheDocument();
  });

  it('keeps view switching usable when browser storage is blocked', async () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Blocked');
    });
    try {
      renderPage();
      await waitFor(() => expect(queryMyCreated).toHaveBeenCalled());
      fireEvent.click(screen.getByRole('button', { name: 'myEmployees.listView' }));
      expect(screen.getByRole('button', { name: 'myEmployees.listView' })).toHaveAttribute('aria-pressed', 'true');
    } finally {
      setItem.mockRestore();
    }
  });
  it('keeps other loaded employees after removing the final record without refetching', async () => {
    (queryMyCreated as jest.Mock).mockImplementation(({ pageNum }) =>
      Promise.resolve({
        list: employeeBatch(pageNum, pageNum === 1 ? 12 : 1),
        total: 13,
      })
    );
    renderPage();
    await screen.findByText('Employee 1-0');
    fireEvent.click(screen.getByTestId('load-more'));
    await screen.findByText('Employee 2-0');
    const requestCount = (queryMyCreated as jest.Mock).mock.calls.length;
    await act(async () => {
      mockRemoveVisibleEmployee();
    });
    expect(screen.getByText('Employee 1-0')).toBeInTheDocument();
    expect(screen.queryByText('Employee 2-0')).not.toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(12);
    expect(queryMyCreated).toHaveBeenCalledTimes(requestCount);
  });
});
