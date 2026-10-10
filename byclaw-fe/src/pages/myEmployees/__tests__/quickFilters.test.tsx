import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import type { ReactNode } from 'react';
import { queryManagedEnterpriseEmployees, queryMyCreated } from '@/service/digitalEmployees';
import MyEmployeesPage from '..';

const mockNavigate = jest.fn();
const mockRefreshEmployee = jest.fn();

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
  default: () => mockRefreshEmployee,
  employeeRowId: jest.fn(),
  removeEmployeeRow: jest.fn(),
  updateEmployeeRow: jest.fn(),
}));
jest.mock('@/components/InfiniteScroll', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
jest.mock('@/components/Resources/components/ResourceCard', () => ({ __esModule: true, default: () => null }));
jest.mock('@/pages/digitalEmployees', () => ({ EmployeePreviewModal: () => null }));
jest.mock('@/pages/manager/components/AuthListDrawer', () => ({ __esModule: true, default: () => null }));
jest.mock('@/pages/manager/service/resources', () => ({ applyResourceUse: jest.fn() }));

const renderPage = () =>
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <MyEmployeesPage />
    </ConfigProvider>
  );

describe('employee management quick filters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it('preserves enterprise scope and status filters and resets them when switching tabs', async () => {
    renderPage();
    await waitFor(() => expect(queryMyCreated).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('tab', { name: 'myEmployees.enterprise' }));
    await waitFor(() => expect(queryManagedEnterpriseEmployees).toHaveBeenCalled());
    const types = within(screen.getByRole('group', { name: 'resource.type' }));
    const permissions = within(screen.getByRole('group', { name: 'common.belong' }));
    const statuses = within(screen.getByRole('group', { name: 'common.status' }));
    fireEvent.click(types.getByRole('button', { name: 'myEmployees.group' }));

    for (const [label, type] of [
      ['myEmployees.createdByMe', 'owner'],
      ['myEmployees.managedByMe', 'managerExcludingOwner'],
      ['myEmployees.all', 'ownerOrManager'],
    ]) {
      const button = permissions.getByRole('button', { name: label });
      fireEvent.click(button);
      expect(button).toHaveClass('option', 'active');
      await waitFor(() =>
        expect(queryManagedEnterpriseEmployees).toHaveBeenLastCalledWith(
          expect.objectContaining({ type, agentType: '017', includeEmployeeGroup: false })
        )
      );
    }
    for (const [label, resourceStatus] of [
      ['resourceStatus.draft', 0],
      ['resourceStatus.published', 2],
      ['resourceStatus.unpublished', 3],
    ] as const) {
      const button = statuses.getByRole('button', { name: label });
      fireEvent.click(button);
      expect(button).toHaveClass('option', 'active');
      await waitFor(() =>
        expect(queryManagedEnterpriseEmployees).toHaveBeenLastCalledWith(
          expect.objectContaining({ type: 'ownerOrManager', agentType: '017', resourceStatus })
        )
      );
      expect((queryManagedEnterpriseEmployees as jest.Mock).mock.calls.at(-1)?.[0]).not.toHaveProperty(
        'includeAllResourceStatus'
      );
    }
    fireEvent.click(statuses.getByRole('button', { name: 'myEmployees.all' }));
    await waitFor(() =>
      expect(queryManagedEnterpriseEmployees).toHaveBeenLastCalledWith(
        expect.objectContaining({ includeAllResourceStatus: true })
      )
    );
    expect((queryManagedEnterpriseEmployees as jest.Mock).mock.calls.at(-1)?.[0]).not.toHaveProperty('resourceStatus');

    fireEvent.click(screen.getByRole('tab', { name: 'myEmployees.personal' }));
    await waitFor(() =>
      expect(queryMyCreated).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: 'owner', agentType: undefined, includeEmployeeGroup: true })
      )
    );
    fireEvent.click(screen.getByRole('tab', { name: 'myEmployees.enterprise' }));
    for (const title of ['resource.type', 'common.belong', 'common.status']) {
      const group = within(screen.getByRole('group', { name: title }));
      expect(group.getByRole('button', { name: 'myEmployees.all' })).toHaveAttribute('aria-pressed', 'true');
    }
    await waitFor(() =>
      expect(queryManagedEnterpriseEmployees).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: 'ownerOrManager', agentType: undefined, includeAllResourceStatus: true })
      )
    );
  });
});
