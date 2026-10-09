import { act, fireEvent, render as renderComponent, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import ApprovalCenter from '..';
import useEmployeePublicationCapabilities from '@/hooks/useEmployeePublicationCapabilities';
import { approveUseApply, queryResourceUseApplyAudit } from '@/pages/manager/service/resources';

const mockRefresh = jest.fn();
jest.mock('@/hooks/useApprovalPendingCounts', () => ({
  __esModule: true,
  default: () => ({ counts: { employee: 2, skill: 1, knowledge: 3, tool: 4 }, refresh: mockRefresh }),
}));
jest.mock('@/hooks/useEmployeePublicationCapabilities');
jest.mock('@umijs/max', () => {
  const { useState } = require('react');
  const intl = { formatMessage: ({ id }: { id: string }) => id };
  return {
    useIntl: () => intl,
    useSearchParams: () => {
      const [query, setQuery] = useState(globalThis.window.location.search);
      return [
        new URLSearchParams(query),
        (next: URLSearchParams) => {
          globalThis.window.history.replaceState({}, '', `?${next}`);
          setQuery(`?${next}`);
        },
      ];
    },
  };
});
jest.mock('@/pages/manager/service/resources', () => ({
  queryResourceUseApplyAudit: jest.fn(),
  approveUseApply: jest.fn().mockResolvedValue(undefined),
  rejectUseApply: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/components/EmployeePublication/AuditList', () => ({
  __esModule: true,
  default: ({ onAuditComplete, initialReview, toolbarExtra }: any) => (
    <div>
      <div data-testid="publication-toolbar">{toolbarExtra}</div>
      <button type="button" data-review={String(initialReview)} onClick={onAuditComplete}>
        publication approval
      </button>
    </div>
  ),
}));

const types = ['DIG_EMPLOYEE', 'SKILL', 'KG_DOC', 'KG_QA', 'KG_TERM', 'MCP', 'TOOLKIT', 'AGENT'];

// 使用真实页签和审核表格，但禁用动画，避免切换时的动画更新跨越用例边界。
const render = (ui: Parameters<typeof renderComponent>[0]) =>
  renderComponent(ui, {
    wrapper: ({ children }) => <ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider>,
  });

describe('approval center', () => {
  // 类型隔离用例包含多次真实表格渲染，只增加用例总预算，保留断言默认超时。
  jest.setTimeout(15000);

  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, '', '/approvalCenter');
    (useEmployeePublicationCapabilities as jest.Mock).mockReturnValue({ enabled: true, administrator: true });
    // 故意混入所有业务类型，验证入口切换和表格的二次隔离规则。
    (queryResourceUseApplyAudit as jest.Mock).mockImplementation(({ history }: { history: boolean }) =>
      Promise.resolve({
        data: types.map((type) => ({
          resourceId: type,
          resourceBizType: type,
          resourceName: `${history ? 'history' : 'pending'}-${type}`,
          privilegeGrantId: `grant-${type}`,
          userId: 'applicant',
          userName: '申请人',
          applyStatus: history ? 'X' : 'P',
          auditUserName: '审核人',
          auditTime: '2026-10-08 10:00:00',
        })),
      })
    );
  });

  it.each([
    ['employee', ['DIG_EMPLOYEE']],
    ['skill', ['SKILL']],
    ['knowledge', ['KG_DOC', 'KG_QA', 'KG_TERM']],
    ['tool', ['MCP', 'TOOLKIT', 'AGENT']],
  ])('opens %s directly and isolates pending and history rows', async (tab, allowedTypes) => {
    window.history.replaceState({}, '', `/approvalCenter?tab=${tab}`);
    render(<ApprovalCenter />);
    // 页签断言限定在页签栏，避免反复遍历无关的审核表格和计算其可见性。
    const tabs = within(screen.getByRole('tablist'));
    for (const name of ['employee', 'skill', 'knowledge', 'tool']) {
      expect(tabs.getByRole('tab', { name: new RegExp(`approvalCenter.${name}`) })).toBeInTheDocument();
    }
    for (const history of [false, true]) {
      if (history) {
        await act(async () => {
          fireEvent.click(screen.getByText('resourceCenter.reviewHistory'));
        });
      }
      const prefix = history ? 'history' : 'pending';
      await screen.findByText(`${prefix}-${allowedTypes[0]}`);
      for (const type of types) {
        if (allowedTypes.includes(type)) expect(screen.getByText(`${prefix}-${type}`)).toBeInTheDocument();
        else expect(screen.queryByText(`${prefix}-${type}`)).not.toBeInTheDocument();
      }
      expect(queryResourceUseApplyAudit).toHaveBeenCalledWith({ history, resourceBizTypeList: allowedTypes });
    }
  });

  it('removes an approved row and refreshes the shared pending counts', async () => {
    window.history.replaceState({}, '', '/approvalCenter?tab=skill');
    render(<ApprovalCenter />);
    await screen.findByText('pending-SKILL');
    fireEvent.click(screen.getByRole('button', { name: 'resourceCenter.approve' }));
    fireEvent.click(await screen.findByRole('button', { name: 'common.confirm' }));
    await waitFor(() => expect(screen.queryByText('pending-SKILL')).not.toBeInTheDocument());
    expect(approveUseApply).toHaveBeenCalledWith({ resourceId: 'SKILL', applyUserId: 'applicant' });
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('clears the prior history view when switching resource types', async () => {
    render(<ApprovalCenter />);
    await screen.findByText('pending-DIG_EMPLOYEE');
    fireEvent.click(screen.getByText('resourceCenter.reviewHistory'));
    await screen.findByText('history-DIG_EMPLOYEE');
    fireEvent.click(screen.getByRole('tab', { name: /approvalCenter.skill/ }));
    await screen.findByText('pending-SKILL');
    expect(window.location.search).toBe('?tab=skill');
    expect(screen.queryByText('history-DIG_EMPLOYEE')).not.toBeInTheDocument();
  });

  it('keeps employee publication approvals in the employee tab and refreshes their count', async () => {
    render(<ApprovalCenter />);
    fireEvent.click(screen.getByText('approvalCenter.employeePublication'));
    const publication = screen.getByRole('button', { name: 'publication approval' });
    expect(publication).toHaveAttribute('data-review', 'true');
    fireEvent.click(publication);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('places employee approval kinds at the right of the tab bar and keeps switching available in publication mode', async () => {
    render(<ApprovalCenter />);
    await screen.findByText('pending-DIG_EMPLOYEE');
    const tabs = within(screen.getByRole('tablist'));
    const search = screen.getByPlaceholderText('myEmployees.searchPlaceholder');
    const searchControl = search.closest('.ant-input-affix-wrapper')!;
    const kinds = screen.getByText('approvalCenter.employeeUse').closest('.ant-segmented')!;
    const status = screen.getByText('resourceCenter.unreviewed').closest('.ant-segmented')!;
    const tabBar = tabs.getByRole('tab', { name: /approvalCenter.employee/ }).closest('.ant-tabs-nav')!;
    const extra = kinds.closest('.ant-tabs-extra-content')!;
    // 使用 Tabs 的右侧扩展区域，将类型切换与页签放在同一行，并移出搜索工具栏。
    expect(tabBar).toContainElement(kinds);
    expect(tabBar.lastElementChild).toBe(extra);
    expect(searchControl.parentElement).not.toContainElement(kinds);
    expect(searchControl.nextElementSibling).toBe(status);

    await act(async () => {
      fireEvent.click(screen.getByText('approvalCenter.employeePublication'));
    });
    expect(tabBar).toContainElement(screen.getByText('approvalCenter.employeeUse'));
    expect(screen.getByTestId('publication-toolbar')).not.toContainElement(
      screen.getByText('approvalCenter.employeeUse')
    );
    await act(async () => {
      fireEvent.click(screen.getByText('approvalCenter.employeeUse'));
    });
    await screen.findByText('pending-DIG_EMPLOYEE');
    expect(screen.getByPlaceholderText('myEmployees.searchPlaceholder')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'publication approval' })).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(tabs.getByRole('tab', { name: /approvalCenter.skill/ }));
    });
    await screen.findByText('pending-SKILL');
    expect(screen.queryByText('approvalCenter.employeeUse')).not.toBeInTheDocument();
    expect(screen.queryByText('approvalCenter.employeePublication')).not.toBeInTheDocument();
  });

  it('defaults unknown tabs to employees and respects disabled publication capabilities', async () => {
    window.history.replaceState({}, '', '/approvalCenter?tab=unknown');
    (useEmployeePublicationCapabilities as jest.Mock).mockReturnValue({ enabled: false });
    render(<ApprovalCenter />);
    await screen.findByText('pending-DIG_EMPLOYEE');
    expect(screen.queryByText('approvalCenter.employeePublication')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'publication approval' })).not.toBeInTheDocument();
  });
});
